pub mod math;
mod utils;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
// use manager::{AssetsList, SetAssetSupply};
use utils::*;
const SYNTHETIFY_EXCHANGE_SEED: &str = "Synthetify";
#[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto};

    use pyth::pc::Price;

    use crate::math::{
        amount_to_discount, amount_to_shares_by_rounding_down, calculate_burned_shares,
        calculate_max_burned_in_xusd, calculate_max_debt_in_usd, calculate_max_withdraw_in_usd,
        calculate_new_shares_by_rounding_up, calculate_swap_out_amount, calculate_swap_tax,
        calculate_user_debt_in_usd, calculate_value_in_usd, usd_to_token_amount,
        MIN_SWAP_USD_VALUE, PRICE_OFFSET,
    };

    use super::*;

    pub fn create_exchange_account(ctx: Context<CreateExchangeAccount>, bump: u8) -> ProgramResult {
        let exchange_account = &mut ctx.accounts.exchange_account.load_init()?;
        exchange_account.owner = *ctx.accounts.admin.key;
        exchange_account.debt_shares = 0;
        exchange_account.version = 0;
        exchange_account.bump = bump;
        exchange_account.liquidation_deadline = u64::MAX;
        exchange_account.user_staking_data = UserStaking::default();
        Ok(())
    }
    pub fn create_assets_list(ctx: Context<CreateAssetsList>) -> ProgramResult {
        let assets_list = &mut ctx.accounts.assets_list.load_init()?;
        assets_list.initialized = false;
        Ok(())
    }
    // #[access_control(admin(&self, &ctx.accounts.signer))]
    pub fn create_list(
        ctx: Context<InitializeAssetsList>,
        collateral_token: Pubkey,
        collateral_token_feed: Pubkey,

        usd_token: Pubkey,
    ) -> Result<()> {
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;

        if assets_list.initialized {
            return Err(ErrorCode::Initialized.into());
        }
        let usd_asset = Asset {
            feed_address: Pubkey::default(), // unused
            last_update: u64::MAX,           // we dont update usd price
            price: 1 * 10u64.pow(PRICE_OFFSET.into()),
            confidence: 0,
        };
        let usd_synthetic = Synthetic {
            decimals: 6,
            asset_address: usd_token,
            supply: 0,
            max_supply: u64::MAX, // no limit for usd asset
            settlement_slot: u64::MAX,
            asset_index: 0,
        };
        let sny_asset = Asset {
            feed_address: collateral_token_feed,
            last_update: 0,
            price: 0,
            confidence: 0,
        };
        let sny_collateral = Collateral {
            asset_index: 1,
            collateral_ratio: 10,
            collateral_address: collateral_token,
            reserve_balance: 0,
            decimals: 6,
            reserve_address: *ctx.accounts.sny_reserve.key,
            liquidation_fund: *ctx.accounts.sny_liquidation_fund.key,
        };

        assets_list.append_asset(usd_asset);
        assets_list.append_asset(sny_asset);
        assets_list.append_synthetic(usd_synthetic);
        assets_list.append_collateral(sny_collateral);
        assets_list.initialized = true;
        Ok(())
    }
    pub fn set_assets_prices(ctx: Context<SetAssetsPrices>) -> Result<()> {
        msg!("SYNTHETIFY: SET ASSETS PRICES");
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        for oracle_account in ctx.remaining_accounts {
            let price_feed = Price::load(oracle_account)?;
            let feed_address = oracle_account.key;
            let asset = assets_list
                .assets
                .iter_mut()
                .find(|x| x.feed_address == *feed_address);
            match asset {
                Some(asset) => {
                    let offset = (PRICE_OFFSET as i32).checked_add(price_feed.expo).unwrap();
                    if offset >= 0 {
                        let scaled_price = price_feed
                            .agg
                            .price
                            .checked_mul(10i64.pow(offset.try_into().unwrap()))
                            .unwrap();

                        asset.price = scaled_price.try_into().unwrap();
                    } else {
                        let scaled_price = price_feed
                            .agg
                            .price
                            .checked_div(10i64.pow((-offset).try_into().unwrap()))
                            .unwrap();

                        asset.price = scaled_price.try_into().unwrap();
                    }

                    asset.confidence =
                        math::calculate_confidence(price_feed.agg.conf, price_feed.agg.price);
                    asset.last_update = Clock::get()?.slot;
                }
                None => return Err(ErrorCode::NoAssetFound.into()),
            }
        }
        Ok(())
    }
    pub fn init(
        ctx: Context<Init>,
        bump: u8,
        nonce: u8,
        staking_round_length: u32,
        amount_per_round: u64,
    ) -> Result<()> {
        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        let mut state = ctx.accounts.state.load_init()?;

        state.bump = bump;
        state.admin = *ctx.accounts.admin.key;
        state.halted = false;
        state.nonce = nonce;
        state.debt_shares = 0u64;
        state.assets_list = *ctx.accounts.assets_list.key;
        state.health_factor = 50;
        // once we will not be able to fit all data into one transaction we will
        // use max_delay to allow split updating oracles and exchange operation
        state.max_delay = 0;
        state.fee = 300;
        state.swap_tax = 20;
        state.pool_fee = 0;
        state.debt_interest_rate = 10; // 1%
        state.last_debt_adjustment = timestamp;
        state.penalty_to_liquidator = 5;
        state.penalty_to_exchange = 5;
        state.liquidation_rate = 20;
        // TODO decide about length of buffer
        // Maybe just couple of minutes will be enough ?
        state.liquidation_buffer = 172800; // about 24 Hours;
        state.account_version = 0;
        state.staking = Staking {
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
        };
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
        version(&ctx.accounts.state,&ctx.accounts.exchange_account)
        assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        msg!("Synthetify: DEPOSIT");
        let state = &mut ctx.accounts.state.load_mut()?;

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;

        let slot = Clock::get()?.slot;

        // Adjust staking round
        adjust_staking_rounds(state, slot);

        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let user_collateral_account = &mut ctx.accounts.user_collateral_account;

        let tx_signer = ctx.accounts.owner.key;
        // Signer need to be owner of source account
        if !tx_signer.eq(&user_collateral_account.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }

        let collateral_index = assets_list
            .collaterals
            .iter_mut()
            .position(|x| {
                x.reserve_address
                    .eq(ctx.accounts.reserve_address.to_account_info().key)
            })
            .unwrap();
        let collateral = &mut assets_list.collaterals[collateral_index];

        collateral.reserve_balance = collateral.reserve_balance.checked_add(amount).unwrap();

        let exchange_account_collateral = exchange_account
            .collaterals
            .iter_mut()
            .find(|x| x.collateral_address.eq(&collateral.collateral_address));

        match exchange_account_collateral {
            Some(entry) => entry.amount = entry.amount.checked_add(amount).unwrap(),
            None => exchange_account.append(CollateralEntry {
                amount,
                collateral_address: collateral.collateral_address,
                index: collateral_index as u8,
                ..Default::default()
            }),
        }

        // Transfer token
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);

        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn mint(ctx: Context<Mint>, amount: u64) -> Result<()> {
        msg!("Synthetify: MINT");
        let mut state = &mut ctx.accounts.state.load_mut()?;

        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;

        let total_debt = calculate_debt_with_interest(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);
        let max_borrow = max_debt
            .checked_mul(state.health_factor.into())
            .unwrap()
            .checked_div(100)
            .unwrap();

        let synthetics = &mut assets_list.synthetics;

        // We can only mint xUSD
        // Both xUSD and collateral token have static index in assets array
        let mut xusd_synthetic = &mut synthetics[0];

        if max_borrow < amount.checked_add(user_debt).unwrap().into() {
            return Err(ErrorCode::MintLimit.into());
        }

        // Adjust program and user debt_shares
        // Rounding up - debt is created in favor of the system
        let new_shares = calculate_new_shares_by_rounding_up(state.debt_shares, total_debt, amount);
        state.debt_shares = state.debt_shares.checked_add(new_shares).unwrap();
        exchange_account.debt_shares = exchange_account
            .debt_shares
            .checked_add(new_shares)
            .unwrap();
        // Change points for next staking round
        exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
        state.staking.next_round.all_points = state.debt_shares;

        let new_supply = xusd_synthetic.supply.checked_add(amount).unwrap();
        set_synthetic_supply(&mut xusd_synthetic, new_supply)?;
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        // Mint xUSD to user
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, amount)?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        msg!("Synthetify: WITHDRAW");
        let mut state = &mut ctx.accounts.state.load_mut()?;

        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        // adjust current staking points for exchange account
        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        adjust_staking_account(exchange_account, &state.staking);

        // Check signer
        let user_collateral_account = &mut ctx.accounts.user_collateral_account;
        let tx_signer = ctx.accounts.owner.key;
        if !tx_signer.eq(&user_collateral_account.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }

        // Calculate debt
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let total_debt = calculate_debt_with_interest(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);
        let max_borrow = max_debt
            .checked_mul(state.health_factor.into())
            .unwrap()
            .checked_div(100)
            .unwrap();
        let (assets, collaterals, _) = assets_list.split_borrow();
        let mut collateral = match collaterals
            .iter_mut()
            .find(|x| x.collateral_address.eq(&user_collateral_account.mint))
        {
            Some(v) => v,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };

        let (entry_index, mut exchange_account_collateral) = match exchange_account
            .collaterals
            .iter_mut()
            .enumerate()
            .find(|(_, x)| x.collateral_address.eq(&collateral.collateral_address))
        {
            Some(v) => v,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };

        // Check if not overdrafing
        let max_withdrawable_in_usd = calculate_max_withdraw_in_usd(
            max_borrow as u64,
            user_debt,
            collateral.collateral_ratio,
            state.health_factor,
        );
        let collateral_asset = &assets[collateral.asset_index as usize];

        let amount_to_withdraw: u64;
        if amount == u64::MAX {
            let max_withdrawable_in_token =
                usd_to_token_amount(collateral_asset, collateral, max_withdrawable_in_usd);

            if max_withdrawable_in_token > exchange_account_collateral.amount {
                amount_to_withdraw = exchange_account_collateral.amount;
            } else {
                amount_to_withdraw = max_withdrawable_in_token;
            }
        } else {
            amount_to_withdraw = amount;
            let amount_to_withdraw_in_usd = calculate_value_in_usd(
                collateral_asset.price,
                amount_to_withdraw,
                collateral.decimals,
            );

            if amount_to_withdraw_in_usd > max_withdrawable_in_usd {
                return Err(ErrorCode::WithdrawLimit.into());
            }
        }

        // Update balance on exchange account
        exchange_account_collateral.amount = exchange_account_collateral
            .amount
            .checked_sub(amount_to_withdraw)
            .unwrap();

        if exchange_account_collateral.amount == 0 {
            exchange_account.remove(entry_index);
        }

        // Update reserve balance in AssetList
        collateral.reserve_balance = collateral
            .reserve_balance
            .checked_sub(amount_to_withdraw)
            .unwrap(); // should never fail

        // Send withdrawn collateral to user
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx, amount_to_withdraw)?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
        version(&ctx.accounts.state,&ctx.accounts.exchange_account)
        assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn swap(ctx: Context<Swap>, amount: u64) -> Result<()> {
        msg!("Synthetify: SWAP");
        let mut state = &mut ctx.accounts.state.load_mut()?;

        let slot = Clock::get()?.slot;
        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let token_address_in = ctx.accounts.token_in.key;
        let token_address_for = ctx.accounts.token_for.key;
        let slot = Clock::get()?.slot;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        let user_token_account_in = &ctx.accounts.user_token_account_in;
        let tx_signer = ctx.accounts.owner.key;

        // Signer need to be owner of source account
        if !tx_signer.eq(&user_token_account_in.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }
        // Swaping for same assets is forbidden
        if token_address_in.eq(token_address_for) {
            return Err(ErrorCode::WashTrade.into());
        }
        //Get indexes of both assets
        let synthetic_in_index = synthetics
            .iter()
            .position(|x| x.asset_address == *token_address_in)
            .unwrap();
        let synthetic_for_index = synthetics
            .iter()
            .position(|x| x.asset_address == *token_address_for)
            .unwrap();

        // Check is oracles have been updated
        check_feed_update(
            assets,
            synthetics[synthetic_in_index].asset_index as usize,
            synthetics[synthetic_for_index].asset_index as usize,
            state.max_delay,
            slot,
        )
        .unwrap();
        let sny_collateral = &mut collaterals[0];

        let collateral_amount = get_user_sny_collateral_balance(&exchange_account, &sny_collateral);

        // Check min swap value
        let value_in = calculate_value_in_usd(
            assets[synthetics[synthetic_in_index].asset_index as usize].price,
            amount,
            synthetics[synthetic_in_index].decimals,
        );
        if value_in < MIN_SWAP_USD_VALUE {
            return Err(ErrorCode::InsufficientValueTrade.into());
        }

        // Get effective_fee base on user collateral balance
        let discount = amount_to_discount(collateral_amount);
        let effective_fee = state
            .fee
            .checked_sub(
                (state
                    .fee
                    .checked_mul(discount as u32)
                    .unwrap()
                    .checked_div(100))
                .unwrap(),
            )
            .unwrap();
        // Output amount ~ 100% - fee of input
        let (amount_for, fee_usd) = calculate_swap_out_amount(
            &assets[synthetics[synthetic_in_index].asset_index as usize],
            &assets[synthetics[synthetic_for_index].asset_index as usize],
            &synthetics[synthetic_in_index],
            &synthetics[synthetic_for_index],
            amount,
            effective_fee,
        );

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Update pool fee
        let pool_fee = calculate_swap_tax(fee_usd, state.swap_tax);
        state.pool_fee = state.pool_fee.checked_add(pool_fee).unwrap();

        // Update xUSD supply based on tax
        let new_xusd_supply = synthetics[0].supply.checked_add(pool_fee).unwrap();
        set_synthetic_supply(&mut synthetics[0], new_xusd_supply)?;

        // Set new supply output token
        let new_supply_output = synthetics[synthetic_for_index]
            .supply
            .checked_add(amount_for)
            .unwrap();
        set_synthetic_supply(&mut synthetics[synthetic_for_index], new_supply_output)?;
        // Set new supply input token
        let new_supply_input = synthetics[synthetic_in_index]
            .supply
            .checked_sub(amount)
            .unwrap();
        set_synthetic_supply(&mut synthetics[synthetic_in_index], new_supply_input)?;
        // Burn input token
        let cpi_ctx_burn: CpiContext<Burn> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::burn(cpi_ctx_burn, amount)?;

        // Mint output token
        let cpi_ctx_mint: CpiContext<MintTo> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx_mint, amount_for)?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list)
    usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list))]
    pub fn burn(ctx: Context<BurnToken>, amount: u64) -> Result<()> {
        msg!("Synthetify: BURN");
        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let total_debt = calculate_debt_with_interest(state, assets_list, slot, timestamp).unwrap();
        let (assets, _, synthetics) = assets_list.split_borrow();

        let tx_signer = ctx.accounts.owner.key;
        let user_token_account_burn = &ctx.accounts.user_token_account_burn;

        // Signer need to be owner of source account
        if !tx_signer.eq(&user_token_account_burn.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }
        // xUSD got static index 0
        let burn_asset = &mut assets[0];
        let burn_synthetic = &mut synthetics[0];

        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);

        // Rounding down - debt is burned in favor of the system
        let burned_shares = calculate_burned_shares(
            &burn_asset,
            &burn_synthetic,
            user_debt,
            exchange_account.debt_shares,
            amount,
        );

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Check if user burned more than debt
        if burned_shares >= exchange_account.debt_shares {
            // Burn adjusted amount
            let burned_amount = calculate_max_burned_in_xusd(&burn_asset, user_debt);
            state.debt_shares = state
                .debt_shares
                .checked_sub(exchange_account.debt_shares)
                .unwrap();

            state.staking.next_round.all_points = state.debt_shares;
            // Should be fine used checked math just in case
            state.staking.current_round.all_points = state
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
            set_synthetic_supply(
                burn_synthetic,
                burn_synthetic.supply.checked_sub(burned_amount).unwrap(),
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
            state.debt_shares = state.debt_shares.checked_sub(burned_shares).unwrap();
            state.staking.next_round.all_points = state.debt_shares;

            // Change points for next staking round
            exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
            // Change points for current staking round
            if exchange_account.user_staking_data.current_round_points >= burned_shares {
                exchange_account.user_staking_data.current_round_points = exchange_account
                    .user_staking_data
                    .current_round_points
                    .checked_sub(burned_shares)
                    .unwrap();
                state.staking.current_round.all_points = state
                    .staking
                    .current_round
                    .all_points
                    .checked_sub(burned_shares)
                    .unwrap();
            } else {
                state.staking.current_round.all_points = state
                    .staking
                    .current_round
                    .all_points
                    .checked_sub(exchange_account.user_staking_data.current_round_points)
                    .unwrap();
                exchange_account.user_staking_data.current_round_points = 0;
            }

            // Change supply
            set_synthetic_supply(
                burn_synthetic,
                burn_synthetic.supply.checked_sub(amount).unwrap(),
            )?;
            // Burn token
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx, amount)?;
            Ok(())
        }
    }
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list)
    usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list))]
    pub fn liquidate(ctx: Context<Liquidate>, amount: u64) -> Result<()> {
        msg!("Synthetify: LIQUIDATE");

        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let signer = ctx.accounts.signer.key;
        let reserve_account = &ctx.accounts.reserve_account;
        let liquidator_usd_account = &ctx.accounts.liquidator_usd_account;

        // Signer need to be owner of source amount
        if !signer.eq(&liquidator_usd_account.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }

        // Time given user to adjust collateral ratio passed
        if exchange_account.liquidation_deadline > slot {
            return Err(ErrorCode::LiquidationDeadline.into());
        }

        let total_debt = calculate_debt_with_interest(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);

        // Check collateral ratio
        if max_debt.gt(&(user_debt as u128)) {
            return Err(ErrorCode::InvalidLiquidation.into());
        }
        // Cannot payback more than liquidation_rate of user debt
        let max_repay = user_debt
            .checked_mul(state.liquidation_rate.into())
            .unwrap()
            .checked_div(100)
            .unwrap();

        if amount.gt(&max_repay) {
            return Err(ErrorCode::InvalidLiquidation.into());
        }
        let (assets, collaterals, _) = assets_list.split_borrow();

        let liquidated_collateral = match collaterals
            .iter_mut()
            .find(|x| x.collateral_address.eq(&reserve_account.mint))
        {
            Some(v) => v,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };

        let liquidated_asset = &assets[liquidated_collateral.asset_index as usize];
        let seized_collateral_in_usd = div_up(
            amount
                .checked_mul(
                    state
                        .penalty_to_liquidator
                        .checked_add(state.penalty_to_exchange)
                        .unwrap()
                        .into(),
                )
                .unwrap()
                .into(),
            100,
        )
        .checked_add(amount.into())
        .unwrap();

        // Rounding down - debt is burned in favor of the system

        let burned_debt_shares =
            amount_to_shares_by_rounding_down(state.debt_shares, total_debt, amount);
        state.debt_shares = state.debt_shares.checked_sub(burned_debt_shares).unwrap();

        exchange_account.debt_shares = exchange_account
            .debt_shares
            .checked_sub(burned_debt_shares)
            .unwrap();

        let seized_collateral_in_token = usd_to_token_amount(
            liquidated_asset,
            liquidated_collateral,
            seized_collateral_in_usd.try_into().unwrap(),
        );

        let mut exchange_account_collateral =
            match exchange_account.collaterals.iter_mut().find(|x| {
                x.collateral_address
                    .eq(&liquidated_collateral.collateral_address)
            }) {
                Some(v) => v,
                None => return Err(ErrorCode::NoAssetFound.into()),
            };
        exchange_account_collateral.amount = exchange_account_collateral
            .amount
            .checked_sub(seized_collateral_in_token)
            .unwrap();
        liquidated_collateral.reserve_balance = liquidated_collateral
            .reserve_balance
            .checked_sub(seized_collateral_in_token)
            .unwrap();

        let collateral_to_exchange = div_up(
            seized_collateral_in_token
                .checked_mul(state.penalty_to_exchange.into())
                .unwrap()
                .into(),
            100u128
                .checked_add(state.penalty_to_liquidator.into())
                .unwrap()
                .checked_add(state.penalty_to_exchange.into())
                .unwrap(),
        );
        let collateral_to_liquidator = seized_collateral_in_token
            .checked_sub(collateral_to_exchange.try_into().unwrap())
            .unwrap();

        // Remove staking for liquidation
        state.staking.next_round.all_points = state.debt_shares;
        state.staking.current_round.all_points = state
            .staking
            .current_round
            .all_points
            .checked_sub(exchange_account.user_staking_data.current_round_points)
            .unwrap();
        state.staking.finished_round.all_points = state
            .staking
            .finished_round
            .all_points
            .checked_sub(exchange_account.user_staking_data.finished_round_points)
            .unwrap();
        exchange_account.user_staking_data.finished_round_points = 0u64;
        exchange_account.user_staking_data.current_round_points = 0u64;
        exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer_seeds = &[&seeds[..]];

        {
            // transfer collateral to liquidator
            let liquidator_accounts = Transfer {
                from: ctx.accounts.reserve_account.to_account_info(),
                to: ctx.accounts.liquidator_collateral_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let transfer =
                CpiContext::new(token_program, liquidator_accounts).with_signer(signer_seeds);
            token::transfer(transfer, collateral_to_liquidator)?;
        }
        {
            if !ctx
                .accounts
                .liquidation_fund
                .to_account_info()
                .key
                .eq(&liquidated_collateral.liquidation_fund)
            {
                return Err(ErrorCode::ExchangeLiquidationAccount.into());
            }
            // transfer collateral to liquidation_account
            let exchange_accounts = Transfer {
                from: ctx.accounts.reserve_account.to_account_info(),
                to: ctx.accounts.liquidation_fund.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let transfer =
                CpiContext::new(token_program, exchange_accounts).with_signer(signer_seeds);
            token::transfer(transfer, collateral_to_exchange.try_into().unwrap())?;
        }
        {
            // burn xUSD
            let new_supply = assets_list.synthetics[0]
                .supply
                .checked_sub(amount)
                .unwrap();
            set_synthetic_supply(&mut assets_list.synthetics[0], new_supply)?;
            let burn_accounts = Burn {
                mint: ctx.accounts.usd_token.to_account_info(),
                to: ctx.accounts.liquidator_usd_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let burn = CpiContext::new(token_program, burn_accounts).with_signer(signer_seeds);
            token::burn(burn, amount)?;
        }

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn check_account_collateralization(ctx: Context<CheckCollateralization>) -> Result<()> {
        msg!("Synthetify: CHECK ACCOUNT COLLATERALIZATION");

        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;

        let total_debt =
            calculate_debt_with_interest(state, assets_list.borrow_mut(), slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);

        // If account is undercollaterized set liquidation_deadline
        // After liquidation_deadline slot account can be liquidated
        if max_debt.gt(&(user_debt as u128)) {
            exchange_account.liquidation_deadline = u64::MAX;
        } else {
            if exchange_account.liquidation_deadline == u64::MAX {
                exchange_account.liquidation_deadline =
                    slot.checked_add(state.liquidation_buffer.into()).unwrap();
            }
        }

        Ok(())
    }

    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account))]
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        msg!("Synthetify: CLAIM REWARDS");

        let slot = Clock::get()?.slot;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);
        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;

        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        if state.staking.finished_round.amount > 0 {
            let reward_amount = state
                .staking
                .finished_round
                .amount
                .checked_mul(exchange_account.user_staking_data.finished_round_points)
                .unwrap()
                .checked_div(state.staking.finished_round.all_points)
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
    #[access_control(halted(&ctx.accounts.state)
    version(&ctx.accounts.state,&ctx.accounts.exchange_account)
    fund_account(&ctx.accounts.state,&ctx.accounts.staking_fund_account))]
    pub fn withdraw_rewards(ctx: Context<WithdrawRewards>) -> Result<()> {
        msg!("Synthetify: WITHDRAW REWARDS");

        let slot = Clock::get()?.slot;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        if exchange_account.user_staking_data.amount_to_claim == 0u64 {
            return Err(ErrorCode::NoRewards.into());
        }
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
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
    #[access_control(halted(&ctx.accounts.state))]
    pub fn withdraw_liquidation_penalty(
        ctx: Context<WithdrawLiquidationPenalty>,
        amount: u64,
    ) -> Result<()> {
        msg!("Synthetify: WITHDRAW LIQUIDATION PENALTY");
        let state = &ctx.accounts.state.load_mut()?;

        if !ctx.accounts.admin.key.eq(&state.admin) {
            return Err(ErrorCode::Unauthorized.into());
        }
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let liquidation_fund = ctx.accounts.liquidation_fund.to_account_info().key;
        let collateral = assets_list
            .collaterals
            .iter_mut()
            .find(|x| x.liquidation_fund.eq(liquidation_fund))
            .unwrap();
        collateral.reserve_balance = collateral.reserve_balance.checked_sub(amount).unwrap();
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer_seeds = &[&seeds[..]];

        // Transfer
        let cpi_accounts = Transfer {
            from: ctx.accounts.liquidation_fund.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer_seeds);
        token::transfer(cpi_ctx, amount)?;
        Ok(())
    }
    // admin methods
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.signer))]
    pub fn add_new_asset(ctx: Context<AddNewAsset>, new_asset_feed_address: Pubkey) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        if !assets_list.initialized {
            return Err(ErrorCode::Uninitialized.into());
        }
        let new_asset = Asset {
            feed_address: new_asset_feed_address,
            last_update: 0,
            price: 0,
            confidence: 0,
        };

        assets_list.append_asset(new_asset);
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_liquidation_buffer(
        ctx: Context<AdminAction>,
        liquidation_buffer: u32,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION BUFFER");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.liquidation_buffer = liquidation_buffer;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_liquidation_rate(ctx: Context<AdminAction>, liquidation_rate: u8) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION RATE");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.liquidation_rate = liquidation_rate;
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_fee(ctx: Context<AdminAction>, fee: u32) -> Result<()> {
        msg!("Synthetify:Admin: SET FEE");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.fee = fee;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_max_delay(ctx: Context<AdminAction>, max_delay: u32) -> Result<()> {
        msg!("Synthetify:Admin: SET MAX DELAY");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.max_delay = max_delay;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_halted(ctx: Context<AdminAction>, halted: bool) -> Result<()> {
        msg!("Synthetify:Admin: SET HALTED");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.halted = halted;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_health_factor(ctx: Context<AdminAction>, factor: u8) -> Result<()> {
        msg!("Synthetify:Admin: SET HEALTH FACTOR");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.health_factor = factor;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_staking_amount_per_round(
        ctx: Context<AdminAction>,
        amount_per_round: u64,
    ) -> Result<()> {
        msg!("Synthetify:Admin:Staking: SET AMOUNT PER ROUND");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.staking.amount_per_round = amount_per_round;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_staking_round_length(ctx: Context<AdminAction>, round_length: u32) -> Result<()> {
        msg!("Synthetify:Admin:Staking: SET ROUND LENGTH");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.staking.round_length = round_length;
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.signer))]
    pub fn set_max_supply(
        ctx: Context<SetMaxSupply>,
        asset_address: Pubkey,
        new_max_supply: u64,
    ) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let synthetic = assets_list
            .synthetics
            .iter_mut()
            .find(|x| x.asset_address == asset_address);

        match synthetic {
            Some(x) => x.max_supply = new_max_supply,
            None => return Err(ErrorCode::NoAssetFound.into()),
        }
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.signer))]
    pub fn set_price_feed(ctx: Context<SetPriceFeed>, old_feed_address: Pubkey) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let asset = assets_list
            .assets
            .iter_mut()
            .find(|x| x.feed_address == old_feed_address);

        match asset {
            Some(asset) => asset.feed_address = *ctx.accounts.price_feed.key,
            None => return Err(ErrorCode::NoAssetFound.into()),
        }
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_liquidation_penalties(
        ctx: Context<AdminAction>,
        penalty_to_exchange: u8,
        penalty_to_liquidator: u8,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION PENALTIES");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.penalty_to_exchange = penalty_to_exchange;
        state.penalty_to_liquidator = penalty_to_liquidator;

        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_collateral(
        ctx: Context<AddCollateral>,
        reserve_balance: u64,
        decimals: u8,
        collateral_ratio: u8,
    ) -> Result<()> {
        msg!("Synthetify:Admin: ADD COLLATERAL");
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let asset_index = match assets_list
            .assets
            .iter_mut()
            .position(|x| x.feed_address == *ctx.accounts.feed_address.key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        let new_collateral = Collateral {
            asset_index: asset_index as u8,
            collateral_address: *ctx.accounts.asset_address.key,
            liquidation_fund: *ctx.accounts.liquidation_fund.key,
            reserve_address: *ctx.accounts.reserve_account.to_account_info().key,
            reserve_balance: reserve_balance,
            decimals: decimals,
            collateral_ratio: collateral_ratio,
        };
        assets_list.append_collateral(new_collateral);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_collateral_ratio(
        ctx: Context<SetCollateralRatio>,
        collateral_ratio: u8,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET COLLATERAL RATIO");
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let collateral = match assets_list
            .collaterals
            .iter_mut()
            .find(|x| x.collateral_address == *ctx.accounts.collateral_address.key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        collateral.collateral_ratio = collateral_ratio;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_synthetic(ctx: Context<AddSynthetic>, max_supply: u64, decimals: u8) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        let asset_index = match assets_list
            .assets
            .iter_mut()
            .position(|x| x.feed_address == *ctx.accounts.feed_address.key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        let new_synthetic = Synthetic {
            asset_index: asset_index as u8,
            decimals: decimals,
            asset_address: *ctx.accounts.asset_address.key,
            max_supply: max_supply,
            settlement_slot: u64::MAX,
            supply: 0,
        };
        assets_list.append_synthetic(new_synthetic);
        Ok(())
    }
}
#[account(zero_copy)]
// #[derive(Default)]
pub struct AssetsList {
    pub initialized: bool,
    pub head_assets: u8,
    pub head_collaterals: u8,
    pub head_synthetics: u8,
    pub assets: [Asset; 256],
    pub collaterals: [Collateral; 256],
    pub synthetics: [Synthetic; 256],
}
impl Default for AssetsList {
    #[inline]
    fn default() -> AssetsList {
        AssetsList {
            initialized: false,
            head_assets: 0,
            head_collaterals: 0,
            head_synthetics: 0,
            assets: [Asset {
                ..Default::default()
            }; 256],
            collaterals: [Collateral {
                ..Default::default()
            }; 256],
            synthetics: [Synthetic {
                ..Default::default()
            }; 256],
        }
    }
}
impl AssetsList {
    fn append_asset(&mut self, new_asset: Asset) {
        self.assets[(self.head_assets) as usize] = new_asset;
        self.head_assets += 1;
    }
    fn append_collateral(&mut self, new_collateral: Collateral) {
        self.collaterals[(self.head_collaterals) as usize] = new_collateral;
        self.head_collaterals += 1;
    }
    fn append_synthetic(&mut self, new_synthetic: Synthetic) {
        self.synthetics[(self.head_synthetics) as usize] = new_synthetic;
        self.head_synthetics += 1;
    }
    fn split_borrow(
        &mut self,
    ) -> (
        &mut [Asset; 256],
        &mut [Collateral; 256],
        &mut [Synthetic; 256],
    ) {
        (
            &mut self.assets,
            &mut self.collaterals,
            &mut self.synthetics,
        )
    }
}
#[derive(Accounts)]
pub struct CreateAssetsList<'info> {
    #[account(init)]
    pub assets_list: Loader<'info, AssetsList>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct InitializeAssetsList<'info> {
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub sny_reserve: AccountInfo<'info>,
    pub sny_liquidation_fund: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetAssetsPrices<'info> {
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct AddNewAsset<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct SetMaxSupply<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct SetPriceFeed<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub price_feed: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct AddCollateral<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub asset_address: AccountInfo<'info>,
    pub liquidation_fund: AccountInfo<'info>,
    pub reserve_account: AccountInfo<'info>,
    pub feed_address: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetCollateralRatio<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub collateral_address: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct AddSynthetic<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub asset_address: AccountInfo<'info>,
    pub feed_address: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct New<'info> {
    pub admin: AccountInfo<'info>,
    pub assets_list: AccountInfo<'info>,
    pub staking_fund_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateExchangeAccount<'info> {
    #[account(init,seeds = [b"accountv1", admin.key.as_ref(), &[bump]], payer=payer )]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    pub admin: AccountInfo<'info>,
    #[account(mut, signer)]
    pub payer: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: AccountInfo<'info>,
}

#[associated(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct ExchangeAccount {
    pub owner: Pubkey,                  // Identity controling account
    pub version: u8,                    // Version of account struct
    pub debt_shares: u64,               // Shares representing part of entire debt pool
    pub liquidation_deadline: u64,      // Slot number after which account can be liquidated
    pub user_staking_data: UserStaking, // Staking information
    pub head: u8,
    pub bump: u8,
    pub collaterals: [CollateralEntry; 32],
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct CollateralEntry {
    amount: u64,
    collateral_address: Pubkey,
    index: u8,
}
impl ExchangeAccount {
    fn append(&mut self, entry: CollateralEntry) {
        self.collaterals[(self.head) as usize] = entry;
        self.head += 1;
    }
    fn remove(&mut self, index: usize) {
        self.collaterals[index] = self.collaterals[(self.head - 1) as usize];
        self.collaterals[(self.head - 1) as usize] = CollateralEntry {
            ..Default::default()
        };
        self.head -= 1;
    }
}
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub reserve_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_collateral_account: CpiAccount<'info, TokenAccount>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.reserve_account.to_account_info(),
            to: accounts.user_collateral_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Mint<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
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
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(mut)]
    pub reserve_address: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_collateral_account: CpiAccount<'info, TokenAccount>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    // owner can deposit to any exchange_account
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Deposit<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.user_collateral_account.to_account_info(),
            to: accounts.reserve_address.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub liquidator_usd_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub liquidator_collateral_account: AccountInfo<'info>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub liquidation_fund: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub reserve_account: CpiAccount<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct BurnToken<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub user_token_account_burn: CpiAccount<'info, TokenAccount>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
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
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
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
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
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
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
}
#[derive(Accounts)]
pub struct WithdrawRewards<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
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
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub to: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub liquidation_fund: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct StakingRound {
    pub start: u64,      // 8 Slot when round starts
    pub amount: u64,     // 8 Amount of SNY distributed in this round
    pub all_points: u64, // 8 All points used to calculate user share in staking rewards
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Staking {
    pub fund_account: Pubkey,         //32 Source account of SNY tokens
    pub round_length: u32,            //4 Length of round in slots
    pub amount_per_round: u64,        //8 Amount of SNY distributed per round
    pub finished_round: StakingRound, //24
    pub current_round: StakingRound,  //24
    pub next_round: StakingRound,     //24
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct UserStaking {
    pub amount_to_claim: u64,       //8 Amount of SNY accumulated by account
    pub finished_round_points: u64, //8 Points are based on debt_shares in specific round
    pub current_round_points: u64,  //8
    pub next_round_points: u64,     //8
    pub last_update: u64,           //8
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Asset {
    pub feed_address: Pubkey, // 32 Pyth oracle account address
    pub price: u64,           // 8
    pub last_update: u64,     // 8
    pub confidence: u32,      // 4 unused
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Collateral {
    pub asset_index: u8,            // 1
    pub collateral_address: Pubkey, // 32
    pub reserve_address: Pubkey,    // 32
    pub liquidation_fund: Pubkey,   // 32
    pub reserve_balance: u64,       // 8
    pub decimals: u8,               // 1
    pub collateral_ratio: u8,       // 1 in %
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Synthetic {
    pub asset_index: u8,       // 1
    pub asset_address: Pubkey, // 32
    pub supply: u64,           // 8
    pub decimals: u8,          // 1
    pub max_supply: u64,       // 8
    pub settlement_slot: u64,  // 8 unused
}
#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct State {
    //8 Account signature
    pub admin: Pubkey,                  //32
    pub halted: bool,                   //1
    pub nonce: u8,                      //1
    pub debt_shares: u64,               //8
    pub assets_list: Pubkey,            //32
    pub health_factor: u8,              //1   In % 1-100% modifier for debt
    pub max_delay: u32,                 //4   Delay between last oracle update 100 blocks ~ 1 min
    pub fee: u32,                       //4   Default fee per swap 300 => 0.3%
    pub swap_tax: u8,                   //8   In % range 0-20%
    pub pool_fee: u64,                  //64  Amount on tax from swap
    pub liquidation_rate: u8,           //1   Size of debt repay in liquidation
    pub penalty_to_liquidator: u8,      //1   In % range 0-25%
    pub penalty_to_exchange: u8,        //1   In % range 0-25%
    pub liquidation_buffer: u32,        //4   Time given user to fix collateralization ratio
    pub account_version: u8,            //1   Version of account supported by program
    pub debt_interest_rate: u8,         //8   In % range 0-20% [1 -> 0.1%]
    pub accumulated_debt_interest: u64, //64  Accumulated debt interest
    pub last_debt_adjustment: i64,      //64
    pub staking: Staking,               //116
    pub bump: u8,
}
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Init<'info> {
    #[account(init, seeds = [b"statev1".as_ref(), &[bump]], payer = payer)]
    pub state: Loader<'info, State>,
    pub payer: AccountInfo<'info>,
    pub admin: AccountInfo<'info>,
    pub assets_list: AccountInfo<'info>,
    pub staking_fund_account: CpiAccount<'info, TokenAccount>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: AccountInfo<'info>,
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
    #[msg("Assets list already initialized")]
    Initialized,
    #[msg("Assets list is not initialized")]
    Uninitialized,
    #[msg("No asset with such address was found")]
    NoAssetFound,
    #[msg("Asset max_supply crossed")]
    MaxSupply,
    #[msg("Asset is not collateral")]
    NotCollateral,
    #[msg("Asset is already a collateral")]
    AlreadyACollateral,
    #[msg("Swap amount is too small")]
    InsufficientValueTrade,
}

// Access control modifiers.

// Only admin access
fn admin(state_loader: &Loader<State>, signer: &AccountInfo) -> Result<()> {
    let state = state_loader.load()?;
    require!(signer.key.eq(&state.admin), Unauthorized);
    Ok(())
}
// Check if program is halted
fn halted<'info>(state_loader: &Loader<State>) -> Result<()> {
    let state = state_loader.load()?;
    require!(!state.halted, Halted);
    Ok(())
}
// Assert right assets_list
fn assets_list<'info>(
    state_loader: &Loader<State>,
    assets_list: &Loader<'info, AssetsList>,
) -> Result<()> {
    let state = state_loader.load()?;
    require!(
        assets_list.to_account_info().key.eq(&state.assets_list),
        InvalidAssetsList
    );
    Ok(())
}
// Assert right usd_token
fn usd_token<'info>(usd_token: &AccountInfo, assets_list: &Loader<AssetsList>) -> Result<()> {
    if !usd_token
        .to_account_info()
        .key
        .eq(&assets_list.load()?.synthetics[0].asset_address)
    {
        return Err(ErrorCode::NotSyntheticUsd.into());
    }
    Ok(())
}

// Assert right fundAccount
fn fund_account<'info>(
    state_loader: &Loader<State>,
    fund_account: &CpiAccount<'info, TokenAccount>,
) -> Result<()> {
    let state = state_loader.load()?;

    require!(
        fund_account
            .to_account_info()
            .key
            .eq(&state.staking.fund_account),
        FundAccountError
    );
    Ok(())
}
// Check is user account have correct version
fn version<'info>(
    state_loader: &Loader<State>,
    exchange_account: &Loader<'info, ExchangeAccount>,
) -> Result<()> {
    let state = state_loader.load()?;
    require!(
        exchange_account.load()?.version == state.account_version,
        AccountVersion
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exchange_account_methods() {
        // Freshly created
        {
            let exchange_account = ExchangeAccount {
                ..Default::default()
            };
            assert_eq!(exchange_account.head, 0);
        }
        // Append
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                index: 1,
                ..Default::default()
            });
            exchange_account.append(CollateralEntry {
                index: 2,
                ..Default::default()
            });
            assert_eq!(exchange_account.head, 2);
            assert_eq!(exchange_account.collaterals[0].index, 1);
            assert_eq!(exchange_account.collaterals[1].index, 2);
        }
        // Remove
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                index: 1,
                ..Default::default()
            });
            exchange_account.append(CollateralEntry {
                index: 2,
                ..Default::default()
            });
            exchange_account.remove(0);
            assert_eq!(exchange_account.head, 1);
            assert_eq!(exchange_account.collaterals[0].index, 2);
        }
        // Remove then append
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };

            exchange_account.append(CollateralEntry {
                index: 1,
                ..Default::default()
            });
            exchange_account.remove(0);
            exchange_account.append(CollateralEntry {
                index: 2,
                ..Default::default()
            });

            assert_eq!(exchange_account.head, 1);
            assert_eq!(exchange_account.collaterals[0].index, 2);
        }
    }

    #[test]
    fn test_assets_list_appending() {
        // Freshly created
        {
            let assets_list = AssetsList {
                ..Default::default()
            };
            assert_eq!(assets_list.head_assets, 0);
            assert_eq!(assets_list.head_collaterals, 0);
            assert_eq!(assets_list.head_synthetics, 0);
        }
        // Append assets
        {
            let mut assets_list = AssetsList {
                ..Default::default()
            };
            assets_list.append_asset(Asset {
                price: 2,
                ..Default::default()
            });
            assert_eq!({ assets_list.assets[0].price }, 2);
            assert_eq!(assets_list.head_assets, 1);
            assert_eq!(assets_list.head_collaterals, 0);
            assert_eq!(assets_list.head_synthetics, 0);

            assets_list.append_asset(Asset {
                price: 3,
                ..Default::default()
            });
            assert_eq!({ assets_list.assets[1].price }, 3);
            assert_eq!(assets_list.head_assets, 2);
        }
        // Append collaterals
        {
            let mut assets_list = AssetsList {
                ..Default::default()
            };
            assets_list.append_collateral(Collateral {
                asset_index: 2,
                ..Default::default()
            });
            assert_eq!({ assets_list.collaterals[0].asset_index }, 2);
            assert_eq!(assets_list.head_assets, 0);
            assert_eq!(assets_list.head_collaterals, 1);
            assert_eq!(assets_list.head_synthetics, 0);

            assets_list.append_collateral(Collateral {
                asset_index: 3,
                ..Default::default()
            });
            assert_eq!({ assets_list.collaterals[1].asset_index }, 3);
            assert_eq!(assets_list.head_collaterals, 2);
        }
        // Append synthetics
        {
            let mut assets_list = AssetsList {
                ..Default::default()
            };
            assets_list.append_synthetic(Synthetic {
                asset_index: 2,
                ..Default::default()
            });
            assert_eq!({ assets_list.synthetics[0].asset_index }, 2);
            assert_eq!(assets_list.head_assets, 0);
            assert_eq!(assets_list.head_collaterals, 0);
            assert_eq!(assets_list.head_synthetics, 1);

            assets_list.append_synthetic(Synthetic {
                asset_index: 3,
                ..Default::default()
            });
            assert_eq!({ assets_list.synthetics[1].asset_index }, 3);
            assert_eq!(assets_list.head_synthetics, 2);
        }
    }

    #[test]
    fn test_assets_list_split_borrow() {
        let mut assets_list = AssetsList {
            ..Default::default()
        };
        assets_list.append_asset(Asset {
            price: 2,
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            asset_index: 0,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            asset_index: 0,
            ..Default::default()
        });
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        assert_eq!({ assets[0].price }, 2);
        assert_eq!(collaterals[0].asset_index, 0);
        assert_eq!(synthetics[0].asset_index, 0);
    }
}
