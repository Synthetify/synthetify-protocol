mod math;
mod utils;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
use manager::{Asset, AssetsList, SetAssetSupply};
use math::*;
use utils::*;
const SYNTHETIFY_EXCHANGE_SEED: &str = "Synthetify";
#[program]
pub mod exchange {

    use crate::math::{calculate_debt, get_collateral_shares};

    use super::*;
    #[state(400)] // To ensure upgradability state is about 2x bigger than required
    pub struct InternalState {
        // size = 204
        //8 Account signature
        pub admin: Pubkey,                //32
        pub halted: bool,                 //1
        pub nonce: u8,                    //1
        pub debt_shares: u64,             //8
        pub collateral_shares: u64,       //8
        pub collateral_token: Pubkey,     //32
        pub collateral_account: Pubkey,   //32
        pub assets_list: Pubkey,          //32
        pub collateralization_level: u32, //4   in % should range from 300%-1000%
        pub max_delay: u32,               //4   max blocks of delay 100 blocks ~ 1 min
        pub fee: u32,                     //4   300 = 0.3%
        pub liquidation_account: Pubkey,  //32
        pub liquidation_penalty: u8,      //1   in % range 0-25%
        pub liquidation_threshold: u8,    //1   in % should range from 130-200%
        pub liquidation_buffer: u32,      //4   time given user to fix collateralization ratio
    }
    impl InternalState {
        pub fn new(ctx: Context<New>, nonce: u8) -> Result<Self> {
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
                max_delay: 10,
                fee: 300,
                liquidation_penalty: 15,
                liquidation_threshold: 200,
                liquidation_buffer: 172800, // about 24 Hours
            })
        }
        pub fn deposit(&mut self, ctx: Context<Deposit>, amount: u64) -> Result<()> {
            msg!("Syntetify: DEPOSIT");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            if !ctx
                .accounts
                .collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            let exchange_collateral_balance = ctx.accounts.collateral_account.amount;
            // Transfer token
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount);
            let new_shares = get_collateral_shares(
                &exchange_collateral_balance,
                &amount,
                &self.collateral_shares,
            );
            let exchange_account = &mut ctx.accounts.exchange_account;

            exchange_account.collateral_shares = exchange_account
                .collateral_shares
                .checked_add(new_shares)
                .unwrap();
            self.collateral_shares = self.collateral_shares.checked_add(new_shares).unwrap();
            Ok(())
        }
        pub fn mint(&mut self, ctx: Context<Mint>, amount: u64) -> Result<()> {
            msg!("Syntetify: MINT");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let mint_token_adddress = ctx.accounts.usd_token.key;
            let collateral_account = &ctx.accounts.collateral_account;
            let assets_list = &ctx.accounts.assets_list;
            if !mint_token_adddress.eq(&ctx.accounts.assets_list.assets[0].asset_address) {
                return Err(ErrorCode::NotSyntheticUsd.into());
            }
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let assets = &assets_list.assets;
            let exchange_account = &mut ctx.accounts.exchange_account;
            let slot = ctx.accounts.clock.slot;
            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();

            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);

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
            let new_shares = calculate_new_shares(self.debt_shares, total_debt, amount);
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_program = ctx.accounts.manager_program.clone();
            let cpi_accounts = SetAssetSupply {
                assets_list: ctx.accounts.assets_list.clone().into(),
                exchange_authority: ctx.accounts.exchange_authority.clone().into(),
            };
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
            manager::cpi::set_asset_supply(
                cpi_ctx,
                mint_asset.asset_address,
                mint_asset.supply.checked_add(amount).unwrap(),
            );
            self.debt_shares = self.debt_shares.checked_add(new_shares).unwrap();
            exchange_account.debt_shares = exchange_account
                .debt_shares
                .checked_add(new_shares)
                .unwrap();

            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx, amount);
            Ok(())
        }
        pub fn withdraw(&mut self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            msg!("Syntetify: WITHDRAW");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let collateral_account = &ctx.accounts.collateral_account;
            let assets_list = &ctx.accounts.assets_list;
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let slot = ctx.accounts.clock.slot;
            let assets = &assets_list.assets;
            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();

            let exchange_account = &mut ctx.accounts.exchange_account;

            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);

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
                &max_user_debt,
                &user_debt,
                &self.collateralization_level,
            );
            let max_withdrawable =
                calculate_max_withdrawable(collateral_asset, max_withdraw_in_usd);
            if max_withdrawable < amount {
                return Err(ErrorCode::WithdrawLimit.into());
            }
            let shares_to_burn =
                amount_to_shares(self.collateral_shares, collateral_account.amount, amount);
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];

            self.collateral_shares = self.collateral_shares.checked_sub(shares_to_burn).unwrap();
            exchange_account.collateral_shares = exchange_account
                .collateral_shares
                .checked_sub(shares_to_burn)
                .unwrap();

            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount);
            Ok(())
        }
        pub fn swap(&mut self, ctx: Context<Swap>, amount: u64) -> Result<()> {
            msg!("Syntetify: SWAP");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let exchange_account = &mut ctx.accounts.exchange_account;
            let token_address_in = ctx.accounts.token_in.key;
            let token_address_for = ctx.accounts.token_for.key;
            let slot = ctx.accounts.clock.slot;
            let assets_list = &ctx.accounts.assets_list;
            let assets = &assets_list.assets;

            let collateral_account = &ctx.accounts.collateral_account;
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            if token_address_for.eq(&assets[1].asset_address) {
                return Err(ErrorCode::SyntheticCollateral.into());
            }
            if token_address_in.eq(token_address_for) {
                return Err(ErrorCode::WashTrade.into());
            }
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let asset_in_index = assets
                .iter()
                .position(|x| x.asset_address == *token_address_in)
                .unwrap();
            let asset_for_index = assets
                .iter()
                .position(|x| x.asset_address == *token_address_for)
                .unwrap();

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

            let amount_for = calculate_swap_out_amount(
                &assets[asset_in_index],
                &assets[asset_for_index],
                &amount,
                &effective_fee,
            );
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];

            let cpi_program = ctx.accounts.manager_program.clone();
            let cpi_accounts = SetAssetSupply {
                assets_list: ctx.accounts.assets_list.clone().into(),
                exchange_authority: ctx.accounts.exchange_authority.clone().into(),
            };
            let cpi_ctx_for =
                CpiContext::new(cpi_program.clone(), cpi_accounts.clone()).with_signer(signer);
            manager::cpi::set_asset_supply(
                cpi_ctx_for,
                assets[asset_for_index].asset_address,
                assets[asset_for_index]
                    .supply
                    .checked_add(amount_for)
                    .unwrap(),
            );
            let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);

            manager::cpi::set_asset_supply(
                cpi_ctx_in,
                assets[asset_in_index].asset_address,
                assets[asset_in_index].supply.checked_sub(amount).unwrap(),
            );

            let cpi_ctx_burn: CpiContext<Burn> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx_burn, amount);

            let cpi_ctx_mint: CpiContext<MintTo> =
                CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx_mint, amount_for);
            Ok(())
        }
        pub fn burn(&mut self, ctx: Context<BurnToken>, amount: u64) -> Result<()> {
            msg!("Syntetify: BURN");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let exchange_account = &mut ctx.accounts.exchange_account;
            let token_address = ctx.accounts.token_burn.key;
            let slot = ctx.accounts.clock.slot;
            let assets_list = &ctx.accounts.assets_list;
            let assets = &assets_list.assets;
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let debt = calculate_debt(&assets, slot, self.max_delay).unwrap();
            let burn_asset_index = assets
                .iter()
                .position(|x| x.asset_address == *token_address)
                .unwrap();
            let burn_asset = &assets[burn_asset_index];
            let user_debt = calculate_user_debt_in_usd(exchange_account, debt, self.debt_shares);

            let burned_shares = calculate_burned_shares(
                &burn_asset,
                &user_debt,
                &exchange_account.debt_shares,
                &amount,
            );
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer = &[&seeds[..]];
            if burned_shares >= exchange_account.debt_shares {
                let burned_amount = calculate_max_burned_in_token(&burn_asset, &user_debt);

                self.debt_shares = self
                    .debt_shares
                    .checked_sub(exchange_account.debt_shares)
                    .unwrap();
                exchange_account.debt_shares = 0;
                // Change supply
                let cpi_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    burn_asset.asset_address,
                    burn_asset.supply.checked_sub(burned_amount).unwrap(),
                );
                // Burn token
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, burned_amount);
                Ok(())
            } else {
                exchange_account.debt_shares = exchange_account
                    .debt_shares
                    .checked_sub(burned_shares)
                    .unwrap();
                self.debt_shares = self.debt_shares.checked_sub(burned_shares).unwrap();
                // Change supply
                let cpi_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);

                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    burn_asset.asset_address,
                    burn_asset.supply.checked_sub(amount).unwrap(),
                );
                // Burn token
                let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
                token::burn(cpi_ctx, amount);
                Ok(())
            }
        }
        pub fn liquidate(&mut self, ctx: Context<Liquidate>) -> Result<()> {
            msg!("Syntetify: LIQUIDATE");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let exchange_account = &mut ctx.accounts.exchange_account;
            let liquidation_account = ctx.accounts.liquidation_account.to_account_info().key;
            let assets_list = &ctx.accounts.assets_list;
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let signer = ctx.accounts.signer.key;
            let user_usd_account = &ctx.accounts.user_usd_account;
            if !signer.eq(&user_usd_account.owner) {
                return Err(ErrorCode::InvalidSigner.into());
            }
            let slot = ctx.accounts.clock.slot;

            let assets = &assets_list.assets;
            let collateral_account = &ctx.accounts.collateral_account;
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            if !liquidation_account.eq(&self.liquidation_account) {
                return Err(ErrorCode::ExchangeLiquidationAccount.into());
            }

            let usd_token = &assets[0];
            if !ctx.accounts.usd_token.key.eq(&usd_token.asset_address) {
                return Err(ErrorCode::NotSyntheticUsd.into());
            }

            if exchange_account.liquidation_deadline > slot {
                return Err(ErrorCode::LiquidationDeadline.into());
            }

            let collateral_amount_in_token = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let collateral_asset = &assets[1];

            let collateral_amount_in_usd =
                calculate_amount_mint_in_usd(&collateral_asset, collateral_amount_in_token);

            let debt = calculate_debt(&assets, slot, self.max_delay).unwrap();
            let user_debt = calculate_user_debt_in_usd(exchange_account, debt, self.debt_shares);

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
            let amount_to_liquidator = usd_to_token_amount(&collateral_asset, user_reward_usd);
            let amount_to_system = usd_to_token_amount(&collateral_asset, system_reward_usd);
            msg!("amount_to_liquidator  {}", amount_to_liquidator);
            msg!("amount_to_system  {}", amount_to_system);

            let burned_debt_shares = amount_to_shares(self.debt_shares, debt, burned_amount);
            let burned_collateral_shares = amount_to_shares(
                self.collateral_shares,
                collateral_account.amount,
                amount_to_system.checked_add(amount_to_liquidator).unwrap(),
            );

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
            exchange_account.liquidation_deadline = u64::MAX;
            let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[self.nonce]];
            let signer_seeds = &[&seeds[..]];
            {
                // burn usd
                let manager_program = ctx.accounts.manager_program.clone();
                let cpi_accounts = SetAssetSupply {
                    assets_list: ctx.accounts.assets_list.clone().into(),
                    exchange_authority: ctx.accounts.exchange_authority.clone().into(),
                };
                let cpi_ctx_in =
                    CpiContext::new(manager_program, cpi_accounts).with_signer(signer_seeds);

                manager::cpi::set_asset_supply(
                    cpi_ctx_in,
                    usd_token.asset_address,
                    usd_token.supply.checked_sub(burned_amount).unwrap(),
                );
                let burn_accounts = Burn {
                    mint: ctx.accounts.usd_token.to_account_info(),
                    to: ctx.accounts.user_usd_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let burn = CpiContext::new(token_program, burn_accounts).with_signer(signer_seeds);
                token::burn(burn, burned_amount);
                msg!("burned_amount {}", burned_amount);
            }
            {
                // transfer to liquidator
                let liquidator_accounts = Transfer {
                    from: ctx.accounts.collateral_account.to_account_info(),
                    to: ctx.accounts.user_collateral_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let transfer =
                    CpiContext::new(token_program, liquidator_accounts).with_signer(signer_seeds);
                token::transfer(transfer, amount_to_liquidator);
            }
            {
                // transfer to system
                let system_accounts = Transfer {
                    from: ctx.accounts.collateral_account.to_account_info(),
                    to: ctx.accounts.liquidation_account.to_account_info(),
                    authority: ctx.accounts.exchange_authority.to_account_info(),
                };
                let token_program = ctx.accounts.token_program.to_account_info();
                let transfer =
                    CpiContext::new(token_program, system_accounts).with_signer(signer_seeds);
                token::transfer(transfer, amount_to_system);
            }

            Ok(())
        }
        pub fn check_account_collateralization(
            &mut self,
            ctx: Context<CheckCollateralization>,
        ) -> Result<()> {
            msg!("Syntetify: CHECK ACCOUNT COLLATERALIZATION");

            if self.halted {
                return Err(ErrorCode::Halted.into());
            }

            let assets_list = &ctx.accounts.assets_list;
            let collateral_account = &ctx.accounts.collateral_account;
            let exchange_account = &mut ctx.accounts.exchange_account;
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            if !assets_list.to_account_info().key.eq(&self.assets_list) {
                return Err(ErrorCode::InvalidAssetsList.into());
            }
            let assets = &assets_list.assets;
            let slot = ctx.accounts.clock.slot;
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
        // admin methods
        pub fn set_liquidation_buffer(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_buffer: u32,
        ) -> Result<()> {
            msg!("Syntetify:Admin: SET LIQUIDATION BUFFER");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.liquidation_buffer = liquidation_buffer;
            Ok(())
        }
        pub fn set_liquidation_threshold(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_threshold: u8,
        ) -> Result<()> {
            msg!("Syntetify:Admin: SET LIQUIDATION THRESHOLD");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.liquidation_threshold = liquidation_threshold;
            Ok(())
        }
        pub fn set_liquidation_penalty(
            &mut self,
            ctx: Context<AdminAction>,
            liquidation_penalty: u8,
        ) -> Result<()> {
            msg!("Syntetify:Admin: SET LIQUIDATION PENALTY");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.liquidation_penalty = liquidation_penalty;
            Ok(())
        }
        pub fn set_collateralization_level(
            &mut self,
            ctx: Context<AdminAction>,
            collateralization_level: u32,
        ) -> Result<()> {
            msg!("Syntetify:Admin: SET COLLATERALIZATION LEVEL");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.collateralization_level = collateralization_level;
            Ok(())
        }
        pub fn set_fee(&mut self, ctx: Context<AdminAction>, fee: u32) -> Result<()> {
            msg!("Syntetify:Admin: SET FEE");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.fee = fee;
            Ok(())
        }
        pub fn set_max_delay(&mut self, ctx: Context<AdminAction>, max_delay: u32) -> Result<()> {
            msg!("Syntetify:Admin: SET MAX DELAY");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.max_delay = max_delay;
            Ok(())
        }
        pub fn set_halted(&mut self, ctx: Context<AdminAction>, halted: bool) -> Result<()> {
            msg!("Syntetify:Admin: SET HALTED");

            if !ctx.accounts.admin.key.eq(&self.admin) {
                return Err(ErrorCode::Unauthorized.into());
            }
            self.halted = halted;
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
        exchange_account.liquidation_deadline = u64::MAX;
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
}
#[derive(Accounts)]
pub struct CreateExchangeAccount<'info> {
    #[account(associated = admin, with = state,payer=payer)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub admin: AccountInfo<'info>,
    #[account(mut, signer)]
    pub payer: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub state: ProgramState<'info, InternalState>,
    pub system_program: AccountInfo<'info>,
}
#[associated]
pub struct ExchangeAccount {
    pub owner: Pubkey,
    pub debt_shares: u64,
    pub collateral_shares: u64,
    pub liquidation_deadline: u64,
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
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub clock: Sysvar<'info, Clock>,
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
    pub token_program: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub clock: Sysvar<'info, Clock>,
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
    pub token_program: AccountInfo<'info>,
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
    pub clock: Sysvar<'info, Clock>,
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
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_burn: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_burn: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
    pub manager_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&BurnToken<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &BurnToken<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_burn.to_account_info(),
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
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_in: AccountInfo<'info>,
    #[account(mut)]
    pub token_for: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_in: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_for: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub clock: Sysvar<'info, Clock>,
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
    pub clock: Sysvar<'info, Clock>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}

#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
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
}
