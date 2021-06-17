pub mod math;
mod utils;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
use manager::{AssetsList, SetAssetSupply};
use utils::*;
const SYNTHETIFY_EXCHANGE_SEED: &str = "Synthetify";
#[program]
pub mod exchange {
    use std::convert::TryInto;

    use crate::math::{
        amount_to_discount, amount_to_shares_by_rounding_down, amount_to_shares_by_rounding_up,
        calculate_amount_mint_in_usd, calculate_burned_shares, calculate_debt,
        calculate_liquidation, calculate_max_burned_in_token, calculate_max_user_debt_in_usd,
        calculate_max_withdraw_in_usd, calculate_max_withdrawable,
        calculate_new_shares_by_rounding_down, calculate_new_shares_by_rounding_up,
        calculate_swap_out_amount, calculate_user_collateral_in_token, calculate_user_debt_in_usd,
        usd_to_token_amount,
    };

    use super::*;
    #[state(642)] // To ensure upgradability state is about 2x bigger than required
    pub struct InternalState {
        // size = 321
        //8 Account signature
        pub admin: Pubkey,                //32
        pub halted: bool,                 //1
        pub nonce: u8,                    //1
        pub debt_shares: u64,             //8
        pub collateral_shares: u64,       //8
        pub collateral_token: Pubkey,     //32
        pub collateral_account: Pubkey,   //32
        pub assets_list: Pubkey,          //32
        pub collateralization_level: u32, //4   In % should range from 300%-1000%
        pub max_delay: u32,               //4   Delay bettwen last oracle update 100 blocks ~ 1 min
        pub fee: u32,                     //4   Default fee per swap 300 => 0.3%
        pub liquidation_account: Pubkey,  //32
        pub liquidation_penalty: u8,      //1   In % range 0-25%
        pub liquidation_threshold: u8,    //1   In % should range from 130-200%
        pub liquidation_buffer: u32,      //4   Time given user to fix collateralization ratio
        pub account_version: u8,          //1 Version of account supported by program
        pub staking: Staking,             //116
    }
    impl InternalState {
        pub fn new(
            ctx: Context<New>,
            nonce: u8,
            staking_round_length: u32,
            amount_per_round: u64,
        ) -> Result<Self> {
            let slot = Clock::get()?.slot;
            Ok(Self {
                admin: *ctx.accounts.admin.key,
                halted: false,
                nonce: nonce,
                debt_shares: 0u64,
                collateral_shares: 0u64,
                collateral_token: *ctx.accounts.collateral_token.key,
                collateral_account: *ctx.accounts.collateral_account.key,
                assets_list: *ctx.accounts.assets_list.key,
                liquidation_account: *ctx.accounts.liquidation_account.key,
                collateralization_level: 1000,
                // once we will not be able to fit all data into one transaction we will
                // use max_delay to allow split updating oracles and exchange operation
                max_delay: 0,
                fee: 300,
                liquidation_penalty: 15,
                liquidation_threshold: 200,
                liquidation_buffer: 172800, // about 24 Hours,
                account_version: 0,
                staking: Staking {
                    round_length: staking_round_length,
                    amount_per_round: amount_per_round,
                    fund_account: *ctx.accounts.staking_fund_account.to_account_info().key,
                    finished_round: StakingRound {
                        all_points: 0,
                        amount: 0,
                        start: 0,
                    },
                    current_round: StakingRound {
                        all_points: 0,
                        amount: 0,
                        start: slot,
                    },
                    next_round: StakingRound {
                        all_points: 0,
                        amount: amount_per_round,
                        start: slot.checked_add(staking_round_length.into()).unwrap(),
                    },
                },
            })
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        collateral_account(&self,&ctx.accounts.collateral_account))]
        pub fn deposit(&mut self, ctx: Context<Deposit>, amount: u64) -> Result<()> {
            msg!("Synthetify: DEPOSIT");

            let exchange_account = &mut ctx.accounts.exchange_account;

            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let exchange_collateral_balance = ctx.accounts.collateral_account.amount;
            let user_collateral_account = &mut ctx.accounts.user_collateral_account;

            let tx_signer = ctx.accounts.owner.key;
            // Signer need to be owner of source account
            if !tx_signer.eq(&user_collateral_account.owner) {
                return Err(ErrorCode::InvalidSigner.into());
            }

            // Get shares based on deposited amount
            // Rounding down - collateral is deposited in favor of the system
            let new_shares = calculate_new_shares_by_rounding_down(
                self.collateral_shares,
                exchange_collateral_balance,
                amount,
            );
            // Adjust program and user collateral_shares
            exchange_account.collateral_shares = exchange_account
                .collateral_shares
                .checked_add(new_shares)
                .unwrap();
            self.collateral_shares = self.collateral_shares.checked_add(new_shares).unwrap();

            // Transfer token
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);

            token::transfer(cpi_ctx, amount)?;
            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list)
        collateral_account(&self,&ctx.accounts.collateral_account)
        assets_list(&self,&ctx.accounts.assets_list))]
        pub fn mint(&mut self, ctx: Context<Mint>, amount: u64) -> Result<()> {
            msg!("Synthetify: MINT");
            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let collateral_account = &ctx.accounts.collateral_account;
            let assets_list = &ctx.accounts.assets_list;

            let assets = &assets_list.assets;
            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();

            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);
            // We can only mint xUSD
            // Both xUSD and collateral token have static index in assets array
            let mint_asset = &assets[0];
            let collateral_asset = &assets[1];
            let collateral_amount = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let max_user_debt = calculate_max_user_debt_in_usd(
                &collateral_asset,
                self.collateralization_level,
                collateral_amount,
            );
            if max_user_debt < amount.checked_add(user_debt).unwrap() {
                return Err(ErrorCode::MintLimit.into());
            }

            // Adjust program and user debt_shares
            // Rounding up - debt is created in favor of the system
            let new_shares =
                calculate_new_shares_by_rounding_up(self.debt_shares, total_debt, amount);
            self.debt_shares = self.debt_shares.checked_add(new_shares).unwrap();
            exchange_account.debt_shares = exchange_account
                .debt_shares
                .checked_add(new_shares)
                .unwrap();
            // Change points for next staking round
            exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
            self.staking.next_round.all_points = self.debt_shares;

            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_program = ctx.accounts.manager_program.clone();
            let cpi_accounts = SetAssetSupply {
                assets_list: ctx.accounts.assets_list.clone().into(),
                exchange_authority: ctx.accounts.exchange_authority.clone().into(),
            };
            // Adjust supply of xUSD
            let set_supply_cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
            manager::cpi::set_asset_supply(
                set_supply_cpi_ctx,
                0u8, // xUSD always have 0 index
                mint_asset.supply.checked_add(amount).unwrap(),
            )?;
            // Mint xUSD to user
            let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(mint_cpi_ctx, amount)?;
            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        collateral_account(&self,&ctx.accounts.collateral_account)
        assets_list(&self,&ctx.accounts.assets_list))]
        pub fn withdraw(&mut self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            msg!("Synthetify: WITHDRAW");

            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let collateral_account = &ctx.accounts.collateral_account;
            let assets_list = &ctx.accounts.assets_list;
            let assets = &assets_list.assets;

            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();
            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);

            // collateral_asset have static index
            let collateral_asset = &assets[1];

            let collateral_amount = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let max_user_debt = calculate_max_user_debt_in_usd(
                &collateral_asset,
                self.collateralization_level,
                collateral_amount,
            );
            let max_withdraw_in_usd = calculate_max_withdraw_in_usd(
                max_user_debt,
                user_debt,
                self.collateralization_level,
            );
            let max_withdrawable =
                calculate_max_withdrawable(collateral_asset, max_withdraw_in_usd);

            if max_withdrawable < amount {
                return Err(ErrorCode::WithdrawLimit.into());
            }

            // Rounding up - collateral is withdrawn in favor of the system
            let shares_to_burn = amount_to_shares_by_rounding_up(
                self.collateral_shares,
                collateral_account.amount,
                amount,
            );

            // Adjust program and user debt_shares
            self.collateral_shares = self.collateral_shares.checked_sub(shares_to_burn).unwrap();
            exchange_account.collateral_shares = exchange_account
                .collateral_shares
                .checked_sub(shares_to_burn)
                .unwrap();

            // Send withdrawn collateral to user
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount)?;

            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        collateral_account(&self,&ctx.accounts.collateral_account)
        assets_list(&self,&ctx.accounts.assets_list))]
        pub fn swap(&mut self, ctx: Context<Swap>, amount: u64) -> Result<()> {
            msg!("Synthetify: SWAP");

            let slot = Clock::get()?.slot;
            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let collateral_account = &ctx.accounts.collateral_account;
            let token_address_in = ctx.accounts.token_in.key;
            let token_address_for = ctx.accounts.token_for.key;
            let slot = Clock::get()?.slot;
            let assets_list = &ctx.accounts.assets_list;
            let assets = &assets_list.assets;
            let user_token_account_in = &ctx.accounts.user_token_account_in;
            let tx_signer = ctx.accounts.owner.key;

            // Signer need to be owner of source account
            if !tx_signer.eq(&user_token_account_in.owner) {
                return Err(ErrorCode::InvalidSigner.into());
            }
            if token_address_for.eq(&assets[1].asset_address) {
                return Err(ErrorCode::SyntheticCollateral.into());
            }
            // Swaping for same assets is forbidden
            if token_address_in.eq(token_address_for) {
                return Err(ErrorCode::WashTrade.into());
            }
            //Get indexes of both assets
            let asset_in_index = assets
                .iter()
                .position(|x| x.asset_address == *token_address_in)
                .unwrap();
            let asset_for_index = assets
                .iter()
                .position(|x| x.asset_address == *token_address_for)
                .unwrap();

            // Check is oracles have been updated
            check_feed_update(
                &assets,
                asset_in_index,
                asset_for_index,
                self.max_delay,
                slot,
            )
            .unwrap();

            let collateral_amount = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            // Get effective_fee base on user collateral balance
            let discount = amount_to_discount(collateral_amount);
            let effective_fee = self
                .fee
                .checked_sub(
                    (self
                        .fee
                        .checked_mul(discount as u32)
                        .unwrap()
                        .checked_div(100))
                    .unwrap(),
                )
                .unwrap();

            // Output amount ~ 100% - fee of input
            let amount_for = calculate_swap_out_amount(
                &assets[asset_in_index],
                &assets[asset_for_index],
                amount,
                effective_fee,
            );
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];

            let cpi_program = ctx.accounts.manager_program.clone();
            let cpi_accounts = SetAssetSupply {
                assets_list: ctx.accounts.assets_list.clone().into(),
                exchange_authority: ctx.accounts.exchange_authority.clone().into(),
            };
            // Set new supply output token
            let cpi_ctx_for =
                CpiContext::new(cpi_program.clone(), cpi_accounts.clone()).with_signer(signer);
            manager::cpi::set_asset_supply(
                cpi_ctx_for,
                asset_for_index.try_into().unwrap(),
                assets[asset_for_index]
                    .supply
                    .checked_add(amount_for)
                    .unwrap(),
            )?;
            // Set new supply input token
            let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
            manager::cpi::set_asset_supply(
                cpi_ctx_in,
                asset_in_index.try_into().unwrap(),
                assets[asset_in_index].supply.checked_sub(amount).unwrap(),
            )?;
            // Burn input token
            let cpi_ctx_burn: CpiContext<Burn> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx_burn, amount)?;

            // Mint output token
            let cpi_ctx_mint: CpiContext<MintTo> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx_mint, amount_for)?;
            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        assets_list(&self,&ctx.accounts.assets_list)
        usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list))]
        pub fn burn(&mut self, ctx: Context<BurnToken>, amount: u64) -> Result<()> {
            msg!("Synthetify: BURN");
            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let assets_list = &ctx.accounts.assets_list;
            let assets = &assets_list.assets;

            let tx_signer = ctx.accounts.owner.key;
            let user_token_account_burn = &ctx.accounts.user_token_account_burn;

            // Signer need to be owner of source account
            if !tx_signer.eq(&user_token_account_burn.owner) {
                return Err(ErrorCode::InvalidSigner.into());
            }
            // xUSD got static index 0
            let burn_asset = &assets[0];

            let debt = calculate_debt(&assets, slot, self.max_delay).unwrap();
            let user_debt = calculate_user_debt_in_usd(exchange_account, debt, self.debt_shares);

            // Rounding down - debt is burned in favor of the system
            let burned_shares = calculate_burned_shares(
                &burn_asset,
                user_debt,
                exchange_account.debt_shares,
                amount,
            );

            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];

            // Check if user burned more than debt
            if burned_shares >= exchange_account.debt_shares {
                // Burn adjusted amount
                let burned_amount = calculate_max_burned_in_token(&burn_asset, user_debt);
                self.debt_shares = self
                    .debt_shares
                    .checked_sub(exchange_account.debt_shares)
                    .unwrap();

                self.staking.next_round.all_points = self.debt_shares;
                // Should be fine used checked math just in case
                self.staking.current_round.all_points = self
                    .staking
                    .current_round
                    .all_points
                    .checked_sub(exchange_account.user_staking_data.current_round_points)
                    .unwrap();

                exchange_account.debt_shares = 0;
                // Change points for next staking round
                exchange_account.user_staking_data.next_round_points = 0;
                // Change points for current staking round
                exchange_account.user_staking_data.current_round_points = 0;

                // Change supply
                let cpi_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    0u8, // xUSD got static index 0
                    burn_asset.supply.checked_sub(burned_amount).unwrap(),
                )?;
                // Burn token
                // We do not use full allowance maybe its better to burn full allowance
                // and mint matching amount
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, burned_amount)?;
                Ok(())
            } else {
                // Burn intended amount
                exchange_account.debt_shares = exchange_account
                    .debt_shares
                    .checked_sub(burned_shares)
                    .unwrap();
                self.debt_shares = self.debt_shares.checked_sub(burned_shares).unwrap();
                self.staking.next_round.all_points = self.debt_shares;

                // Change points for next staking round
                exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
                // Change points for current staking round
                if exchange_account.user_staking_data.current_round_points >= burned_shares {
                    exchange_account.user_staking_data.current_round_points = exchange_account
                        .user_staking_data
                        .current_round_points
                        .checked_sub(burned_shares)
                        .unwrap();
                    self.staking.current_round.all_points = self
                        .staking
                        .current_round
                        .all_points
                        .checked_sub(burned_shares)
                        .unwrap();
                } else {
                    self.staking.current_round.all_points = self
                        .staking
                        .current_round
                        .all_points
                        .checked_sub(exchange_account.user_staking_data.current_round_points)
                        .unwrap();
                    exchange_account.user_staking_data.current_round_points = 0;
                }

                // Change supply
                let cpi_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);

                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    0u8, // xUSD got static index 0
                    burn_asset.supply.checked_sub(amount).unwrap(),
                )?;
                // Burn token
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, amount)?;
                Ok(())
            }
        }

        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        assets_list(&self,&ctx.accounts.assets_list)
        usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list)
        collateral_account(&self,&ctx.accounts.collateral_account))]
        pub fn liquidate(&mut self, ctx: Context<Liquidate>) -> Result<()> {
            msg!("Synthetify: LIQUIDATE");

            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let liquidation_account = ctx.accounts.liquidation_account.to_account_info().key;
            let assets_list = &ctx.accounts.assets_list;
            let signer = ctx.accounts.signer.key;
            let user_usd_account = &ctx.accounts.user_usd_account;
            let collateral_account = &ctx.accounts.collateral_account;
            let assets = &assets_list.assets;

            // xUSD as collateral_asset have static indexes
            let usd_token = &assets[0];
            let collateral_asset = &assets[1];

            // Signer need to be owner of source amount
            if !signer.eq(&user_usd_account.owner) {
                return Err(ErrorCode::InvalidSigner.into());
            }

            // Check program liquidation account
            if !liquidation_account.eq(&self.liquidation_account) {
                return Err(ErrorCode::ExchangeLiquidationAccount.into());
            }

            // Time given user to adjust collateral ratio passed
            if exchange_account.liquidation_deadline > slot {
                return Err(ErrorCode::LiquidationDeadline.into());
            }

            let collateral_amount_in_token = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );

            let collateral_amount_in_usd =
                calculate_amount_mint_in_usd(&collateral_asset, collateral_amount_in_token);

            let debt = calculate_debt(&assets, slot, self.max_delay).unwrap();
            let user_debt = calculate_user_debt_in_usd(exchange_account, debt, self.debt_shares);

            // Check if collateral ratio is user 200%
            check_liquidation(
                collateral_amount_in_usd,
                user_debt,
                self.liquidation_threshold,
            )
            .unwrap();

            let (burned_amount, user_reward_usd, system_reward_usd) = calculate_liquidation(
                collateral_amount_in_usd,
                user_debt,
                self.collateralization_level,
                self.liquidation_penalty,
            );
            // Get amount of collateral send to luquidator and system account
            let amount_to_liquidator = usd_to_token_amount(&collateral_asset, user_reward_usd);
            let amount_to_system = usd_to_token_amount(&collateral_asset, system_reward_usd);

            // Rounding down - debt is burned in favor of the system
            let burned_debt_shares =
                amount_to_shares_by_rounding_down(self.debt_shares, debt, burned_amount);
            // Rounding up - collateral is withdrawn in favor of the system
            let burned_collateral_shares = amount_to_shares_by_rounding_up(
                self.collateral_shares,
                collateral_account.amount,
                amount_to_system.checked_add(amount_to_liquidator).unwrap(),
            );

            // Adjust shares of collateral and debt
            self.collateral_shares = self
                .collateral_shares
                .checked_sub(burned_collateral_shares)
                .unwrap();
            self.debt_shares = self.debt_shares.checked_sub(burned_debt_shares).unwrap();
            exchange_account.debt_shares = exchange_account
                .debt_shares
                .checked_sub(burned_debt_shares)
                .unwrap();
            exchange_account.collateral_shares = exchange_account
                .collateral_shares
                .checked_sub(burned_collateral_shares)
                .unwrap();

            // Remove staking for liquidation
            self.staking.next_round.all_points = self.debt_shares;
            self.staking.current_round.all_points = self
                .staking
                .current_round
                .all_points
                .checked_sub(exchange_account.user_staking_data.current_round_points)
                .unwrap();
            self.staking.finished_round.all_points = self
                .staking
                .finished_round
                .all_points
                .checked_sub(exchange_account.user_staking_data.finished_round_points)
                .unwrap();
            exchange_account.user_staking_data.finished_round_points = 0u64;
            exchange_account.user_staking_data.current_round_points = 0u64;
            exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;

            // Remove liquidation_deadline from liquidated account
            exchange_account.liquidation_deadline = u64::MAX;

            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer_seeds = &[&seeds[..]];
            {
                // burn xUSD
                let manager_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in =
                    CpiContext::new(manager_program, cpi_accounts).with_signer(signer_seeds);

                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    0u8, // xUSD always have 0 index
                    usd_token.supply.checked_sub(burned_amount).unwrap(),
                )?;
                let burn_accounts = Burn {
                    mint: ctx.accounts.usd_token.to_account_info(),
                    to: ctx.accounts.user_usd_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let burn = CpiContext::new(token_program, burn_accounts).with_signer(signer_seeds);
                token::burn(burn, burned_amount)?;
            }
            {
                // transfer collateral to liquidator
                let liquidator_accounts = Transfer {
                    from: ctx.accounts.collateral_account.to_account_info(),
                    to: ctx.accounts.user_collateral_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let transfer =
                    CpiContext::new(token_program, liquidator_accounts).with_signer(signer_seeds);
                token::transfer(transfer, amount_to_liquidator)?;
            }
            {
                // transfer collateral to liquidation_account
                let system_accounts = Transfer {
                    from: ctx.accounts.collateral_account.to_account_info(),
                    to: ctx.accounts.liquidation_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let transfer =
                    CpiContext::new(token_program, system_accounts).with_signer(signer_seeds);
                token::transfer(transfer, amount_to_system)?;
            }

            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        collateral_account(&self,&ctx.accounts.collateral_account)
        assets_list(&self,&ctx.accounts.assets_list))]
        pub fn check_account_collateralization(
            &mut self,
            ctx: Context<CheckCollateralization>,
        ) -> Result<()> {
            msg!("Synthetify: CHECK ACCOUNT COLLATERALIZATION");

            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            let assets_list = &ctx.accounts.assets_list;
            let collateral_account = &ctx.accounts.collateral_account;

            let assets = &assets_list.assets;
            let collateral_asset = &assets[1];

            let collateral_amount_in_token = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let collateral_amount_in_usd =
                calculate_amount_mint_in_usd(&collateral_asset, collateral_amount_in_token);

            let debt = calculate_debt(&assets, slot, self.max_delay).unwrap();
            let user_debt = calculate_user_debt_in_usd(exchange_account, debt, self.debt_shares);

            let result = check_liquidation(
                collateral_amount_in_usd,
                user_debt,
                self.liquidation_threshold,
            );
            // If account is undercollaterized set liquidation_deadline
            // After liquidation_deadline slot account can be liquidated
            match result {
                Ok(_) => {
                    if exchange_account.liquidation_deadline == u64::MAX {
                        exchange_account.liquidation_deadline =
                            slot.checked_add(self.liquidation_buffer.into()).unwrap();
                    }
                }
                Err(_) => {
                    exchange_account.liquidation_deadline = u64::MAX;
                }
            }

            Ok(())
        }

        #[access_control(halted(&self) version(&self,&ctx.accounts.exchange_account))]
        pub fn claim_rewards(&mut self, ctx: Context<ClaimRewards>) -> Result<()> {
            msg!("Synthetify: CLAIM REWARDS");

            let slot = Clock::get()?.slot;

            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);
            let exchange_account = &mut ctx.accounts.exchange_account;

            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            if self.staking.finished_round.amount > 0 {
                let reward_amount = self
                    .staking
                    .finished_round
                    .amount
                    .checked_mul(exchange_account.user_staking_data.finished_round_points)
                    .unwrap()
                    .checked_div(self.staking.finished_round.all_points)
                    .unwrap();

                exchange_account.user_staking_data.amount_to_claim = exchange_account
                    .user_staking_data
                    .amount_to_claim
                    .checked_add(reward_amount)
                    .unwrap();
                exchange_account.user_staking_data.finished_round_points = 0;
            }

            Ok(())
        }
        #[access_control(halted(&self)
        version(&self,&ctx.accounts.exchange_account)
        fund_account(&self,&ctx.accounts.staking_fund_account))]
        pub fn withdraw_rewards(&mut self, ctx: Context<WithdrawRewards>) -> Result<()> {
            msg!("Synthetify: WITHDRAW REWARDS");

            let slot = Clock::get()?.slot;
            // Adjust staking round
            adjust_staking_rounds(&mut self.staking, slot, self.debt_shares);

            let exchange_account = &mut ctx.accounts.exchange_account;
            // adjust current staking points for exchange account
            adjust_staking_account(exchange_account, &self.staking);

            if exchange_account.user_staking_data.amount_to_claim == 0u64 {
                return Err(ErrorCode::NoRewards.into());
            }
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer_seeds = &[&seeds[..]];

            // Transfer rewards
            let cpi_accounts = Transfer {
                from: ctx.accounts.staking_fund_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
            token::transfer(cpi_ctx, exchange_account.user_staking_data.amount_to_claim)?;
            // Reset rewards amount
            exchange_account.user_staking_data.amount_to_claim = 0u64;
            Ok(())
        }
        #[access_control(halted(&self))]
        pub fn withdraw_liquidation_penalty(
            &mut self,
            ctx: Context<WithdrawLiquidationPenalty>,
            amount: u64,
        ) -> Result<()> {
            msg!("Synthetify: WITHDRAW LIQUIDATION PENALTY");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            if !ctx
                .accounts
                .liquidation_account
                .to_account_info()
                .key
                .eq(&self.liquidation_account)
            {
                return Err(ErrorCode::ExchangeLiquidationAccount.into());
            }
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer_seeds = &[&seeds[..]];

            // Transfer
            let cpi_accounts = Transfer {
                from: ctx.accounts.liquidation_account.to_account_info(),
                to: ctx.accounts.to.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
            token::transfer(cpi_ctx, amount)?;
            Ok(())
        }
        // admin methods
        #[access_control(admin(&self, &ctx))]
        pub fn set_liquidation_buffer(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_buffer: u32,
        ) -> Result<()> {
            msg!("Synthetify:Admin: SET LIQUIDATION BUFFER");

            self.liquidation_buffer = liquidation_buffer;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_liquidation_threshold(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_threshold: u8,
        ) -> Result<()> {
            msg!("Synthetify:Admin: SET LIQUIDATION THRESHOLD");

            self.liquidation_threshold = liquidation_threshold;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_liquidation_penalty(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_penalty: u8,
        ) -> Result<()> {
            msg!("Synthetify:Admin: SET LIQUIDATION PENALTY");

            self.liquidation_penalty = liquidation_penalty;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_collateralization_level(
            &mut self,
            ctx: Context<AdminAction>,
            collateralization_level: u32,
        ) -> Result<()> {
            msg!("Synthetify:Admin: SET COLLATERALIZATION LEVEL");

            self.collateralization_level = collateralization_level;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_fee(&mut self, ctx: Context<AdminAction>, fee: u32) -> Result<()> {
            msg!("Synthetify:Admin: SET FEE");

            self.fee = fee;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_max_delay(&mut self, ctx: Context<AdminAction>, max_delay: u32) -> Result<()> {
            msg!("Synthetify:Admin: SET MAX DELAY");

            self.max_delay = max_delay;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_halted(&mut self, ctx: Context<AdminAction>, halted: bool) -> Result<()> {
            msg!("Synthetify:Admin: SET HALTED");

            self.halted = halted;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_staking_amount_per_round(
            &mut self,
            ctx: Context<AdminAction>,
            amount_per_round: u64,
        ) -> Result<()> {
            msg!("Synthetify:Admin:Staking: SET AMOUNT PER ROUND");

            self.staking.amount_per_round = amount_per_round;
            Ok(())
        }
        #[access_control(admin(&self, &ctx))]
        pub fn set_staking_round_length(
            &mut self,
            ctx: Context<AdminAction>,
            round_length: u32,
        ) -> Result<()> {
            msg!("Synthetify:Admin:Staking: SET ROUND LENGTH");

            self.staking.round_length = round_length;
            Ok(())
        }
    }
    pub fn create_exchange_account(
        ctx: Context<CreateExchangeAccount>,
        owner: Pubkey,
    ) -> ProgramResult {
        let exchange_account = &mut ctx.accounts.exchange_account;
        exchange_account.owner = owner;
        exchange_account.debt_shares = 0;
        exchange_account.collateral_shares = 0;
        exchange_account.version = 0;
        exchange_account.liquidation_deadline = u64::MAX;
        exchange_account.user_staking_data = UserStaking::default();
        Ok(())
    }
}
#[derive(Accounts)]
pub struct New<'info> {
    pub admin: AccountInfo<'info>,
    pub collateral_token: AccountInfo<'info>,
    pub collateral_account: AccountInfo<'info>,
    pub assets_list: AccountInfo<'info>,
    pub liquidation_account: AccountInfo<'info>,
    pub staking_fund_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct CreateExchangeAccount<'info> {
    #[account(init,associated = admin, with = state,payer=payer)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub admin: AccountInfo<'info>,
    #[account(mut, signer)]
    pub payer: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub state: ProgramState<'info, InternalState>,
    pub system_program: AccountInfo<'info>,
}

#[associated]
#[derive(Default)]
pub struct ExchangeAccount {
    pub owner: Pubkey,                  // Identity controling account
    pub version: u8,                    // Version of account struct
    pub debt_shares: u64,               // Shares representing part of entire debt pool
    pub collateral_shares: u64,         // Shares representing part of entire collateral account
    pub liquidation_deadline: u64,      // Slot number after which account can be liquidated
    pub user_staking_data: UserStaking, // Staking information
}
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.collateral_account.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Mint<'info> {
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}
impl<'a, 'b, 'c, 'info> From<&Mint<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Mint<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_collateral_account: CpiAccount<'info, TokenAccount>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    // owner can deposit to any exchange_account
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Deposit<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.user_collateral_account.to_account_info(),
            to: accounts.collateral_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub user_usd_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_collateral_account: AccountInfo<'info>,
    #[account(mut)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub liquidation_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct BurnToken<'info> {
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_burn: CpiAccount<'info, TokenAccount>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&BurnToken<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &BurnToken<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.user_token_account_burn.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Swap<'info> {
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_in: AccountInfo<'info>,
    #[account(mut)]
    pub token_for: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_in: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_token_account_for: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_in.to_account_info(),
            to: accounts.user_token_account_in.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.token_for.to_account_info(),
            to: accounts.user_token_account_for.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct CheckCollateralization<'info> {
    #[account(mut)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub assets_list: CpiAccount<'info, AssetsList>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
}
#[derive(Accounts)]
pub struct WithdrawRewards<'info> {
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub staking_fund_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct WithdrawLiquidationPenalty<'info> {
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub to: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub liquidation_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct StakingRound {
    pub start: u64,      // 8 Slot when round starts
    pub amount: u64,     // 8 Amount of SNY distributed in this round
    pub all_points: u64, // 8 All points used to calculate user share in staking rewards
}
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct Staking {
    pub fund_account: Pubkey,         //32 Source account of SNY tokens
    pub round_length: u32,            //4 Length of round in slots
    pub amount_per_round: u64,        //8 Amount of SNY distributed per round
    pub finished_round: StakingRound, //24
    pub current_round: StakingRound,  //24
    pub next_round: StakingRound,     //24
}
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct UserStaking {
    pub amount_to_claim: u64,       //8 Amount of SNY accumulated by account
    pub finished_round_points: u64, //8 Points are based on debt_shares in specific round
    pub current_round_points: u64,  //8
    pub next_round_points: u64,     //8
    pub last_update: u64,           //8
}
#[error]
pub enum ErrorCode {
    #[msg("You are not admin")]
    Unauthorized,
    #[msg("Not synthetic USD asset")]
    NotSyntheticUsd,
    #[msg("Oracle price is outdated")]
    OutdatedOracle,
    #[msg("Mint limit")]
    MintLimit,
    #[msg("Withdraw limit")]
    WithdrawLimit,
    #[msg("Invalid collateral_account")]
    CollateralAccountError,
    #[msg("Synthetic collateral is not supported")]
    SyntheticCollateral,
    #[msg("Invalid Assets List")]
    InvalidAssetsList,
    #[msg("Invalid Liquidation")]
    InvalidLiquidation,
    #[msg("Invalid signer")]
    InvalidSigner,
    #[msg("Wash trade")]
    WashTrade,
    #[msg("Invalid exchange liquidation account")]
    ExchangeLiquidationAccount,
    #[msg("Liquidation deadline not passed")]
    LiquidationDeadline,
    #[msg("Program is currently Halted")]
    Halted,
    #[msg("No rewards to claim")]
    NoRewards,
    #[msg("Invalid fund_account")]
    FundAccountError,
    #[msg("Invalid version of user account")]
    AccountVersion,
}

// Access control modifiers.

// Only admin access
fn admin<'info>(state: &InternalState, ctx: &Context<AdminAction<'info>>) -> Result<()> {
    if !ctx.accounts.admin.key.eq(&state.admin) {
        return Err(ErrorCode::Unauthorized.into());
    }
    Ok(())
}
// Check if program is halted
fn halted<'info>(state: &InternalState) -> Result<()> {
    if state.halted {
        return Err(ErrorCode::Halted.into());
    }
    Ok(())
}
// Assert right assets_list
fn assets_list<'info>(
    state: &InternalState,
    assets_list: &CpiAccount<'info, AssetsList>,
) -> Result<()> {
    if !assets_list.to_account_info().key.eq(&state.assets_list) {
        return Err(ErrorCode::InvalidAssetsList.into());
    }
    Ok(())
}
// Assert right collateral_account
fn collateral_account<'info>(
    state: &InternalState,
    collateral_account: &CpiAccount<'info, TokenAccount>,
) -> Result<()> {
    if !collateral_account
        .to_account_info()
        .key
        .eq(&state.collateral_account)
    {
        return Err(ErrorCode::CollateralAccountError.into());
    }
    Ok(())
}
// Assert right usd_token
fn usd_token<'info>(usd_token: &AccountInfo, assets_list: &CpiAccount<AssetsList>) -> Result<()> {
    if !usd_token
        .to_account_info()
        .key
        .eq(&assets_list.assets[0].asset_address)
    {
        return Err(ErrorCode::NotSyntheticUsd.into());
    }
    Ok(())
}

// Assert right fundAccount
fn fund_account<'info>(
    state: &InternalState,
    fund_account: &CpiAccount<'info, TokenAccount>,
) -> Result<()> {
    if !fund_account
        .to_account_info()
        .key
        .eq(&state.staking.fund_account)
    {
        return Err(ErrorCode::FundAccountError.into());
    }
    Ok(())
}
// Check is user account have correct version
fn version<'info>(
    state: &InternalState,
    exchange_account: &ProgramAccount<'info, ExchangeAccount>,
) -> Result<()> {
    if !exchange_account.version == state.account_version {
        return Err(ErrorCode::AccountVersion.into());
    }
    Ok(())
}
