pub mod decimal;
pub mod math;
mod utils;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
// use manager::{AssetsList, SetAssetSupply};
use pyth::pc::{Price, PriceStatus};
use utils::*;

const SYNTHETIFY_EXCHANGE_SEED: &str = "Synthetify";
// #[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto, fmt::DebugList};

    use crate::math::{
        amount_to_discount, amount_to_shares_by_rounding_down, calculate_burned_shares,
        calculate_max_burned_in_xusd, calculate_max_debt_in_usd, calculate_max_withdraw_in_usd,
        calculate_new_shares_by_rounding_up, calculate_swap_out_amount, calculate_swap_tax,
        calculate_user_debt_in_usd, calculate_value_in_usd, usd_to_token_amount, PRICE_OFFSET,
    };

    use crate::decimal::{
        Add, Ltq, DEBT_INTEREST_RATE_SCALE, FEE_SCALE, HEALTH_FACTOR_SCALE, LIQUIDATION_RATE_SCALE,
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

    // #[access_control(admin(&self, &ctx.accounts.signer))]
    pub fn create_list(
        ctx: Context<InitializeAssetsList>,
        collateral_token: Pubkey,
        collateral_token_feed: Pubkey,
        usd_token: Pubkey,
    ) -> Result<()> {
        let assets_list = &mut ctx.accounts.assets_list.load_init()?;

        let usd_asset = Asset {
            feed_address: Pubkey::default(), // unused
            last_update: u64::MAX,           // we dont update usd price
            price: 1 * 10u64.pow(PRICE_OFFSET.into()),
            confidence: 0,
            twap: 1 * 10u64.pow(PRICE_OFFSET.into()),
            status: PriceStatus::Trading.into(),
            twac: 0,
        };
        let usd_synthetic = Synthetic {
            asset_address: usd_token,
            supply: Decimal { scale: 6, val: 0 },
            max_supply: u64::MAX, // no limit for usd asset
            settlement_slot: u64::MAX,
            asset_index: 0,
        };
        let sny_asset = Asset {
            feed_address: collateral_token_feed,
            last_update: 0,
            price: 0,
            confidence: 0,
            twap: 0,
            status: PriceStatus::Unknown.into(),
            twac: 0,
        };
        let sny_collateral = Collateral {
            asset_index: 1,
            collateral_ratio: 10,
            collateral_address: collateral_token,
            reserve_balance: 0,
            reserve_address: *ctx.accounts.sny_reserve.key,
            liquidation_fund: *ctx.accounts.sny_liquidation_fund.key,
        };

        assets_list.append_asset(usd_asset);
        assets_list.append_asset(sny_asset);
        assets_list.append_synthetic(usd_synthetic);
        assets_list.append_collateral(sny_collateral);
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
                        let scaled_twap = price_feed
                            .twap
                            .val
                            .checked_mul(10i64.pow(offset.try_into().unwrap()))
                            .unwrap();
                        asset.price = scaled_price.try_into().unwrap();
                        asset.twap = scaled_twap.try_into().unwrap();
                    } else {
                        let scaled_price = price_feed
                            .agg
                            .price
                            .checked_div(10i64.pow((-offset).try_into().unwrap()))
                            .unwrap();
                        let scaled_twap = price_feed
                            .twap
                            .val
                            .checked_div(10i64.pow((-offset).try_into().unwrap()))
                            .unwrap();
                        asset.price = scaled_price.try_into().unwrap();
                        asset.twap = scaled_twap.try_into().unwrap();
                    }
                    asset.status = price_feed.agg.status.into();
                    asset.confidence = price_feed.agg.conf;
                    asset.twac = price_feed.twac.val.try_into().unwrap();
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
        state.health_factor = Decimal {
            val: 50_000_000_000,
            scale: 9,
        };
        // once we will not be able to fit all data into one transaction we will
        // use max_delay to allow split updating oracles and exchange operation
        state.max_delay = 0;
        state.fee = Decimal {
            val: 300_000_000_000,
            scale: 9,
        };
        state.swap_tax_ratio = Decimal {
            val: 20_000_000_000,
            scale: 9,
        };
        state.swap_tax_reserve = 0;
        state.debt_interest_rate = Decimal {
            val: 1_000_000_000,
            scale: 9,
        }; // 1%
        state.last_debt_adjustment = timestamp;
        state.penalty_to_liquidator = Decimal {
            val: 5_000_000_000,
            scale: 9,
        };
        state.penalty_to_exchange = Decimal {
            val: 5_000_000_000,
            scale: 9,
        };
        state.liquidation_rate = 20;
        // TODO decide about length of buffer
        // Maybe just couple of minutes will be enough ?
        state.liquidation_buffer = 172800; // about 24 Hours;
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

        collateral.reserve_balance = collateral.reserve_balance.add(amount).unwrap();

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
        let max_borrow = state.health_factor.try_mul(max_debt).unwrap();

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

        let max_borrow = state.health_factor.try_mul(max_debt).unwrap();

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
            let max_withdrawable_in_token = usd_to_token_amount(
                collateral_asset,
                collateral.decimals,
                max_withdrawable_in_usd,
            );

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
        let asset_in = assets[synthetics[synthetic_in_index].asset_index as usize];
        let asset_for = assets[synthetics[synthetic_for_index].asset_index as usize];

        // Check assets status
        if asset_in.status != PriceStatus::Trading.into()
            || asset_for.status != PriceStatus::Trading.into()
        {
            return Err(ErrorCode::SwapUnavailable.into());
        }

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
            &asset_in,
            &asset_for,
            &synthetics[synthetic_in_index],
            &synthetics[synthetic_for_index],
            amount,
            effective_fee,
        )?;

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Update swap_tax_reserve
        let swap_tax_reserve = calculate_swap_tax(fee_usd, state.swap_tax_ratio);
        state.swap_tax_reserve = state
            .swap_tax_reserve
            .checked_add(swap_tax_reserve)
            .unwrap();

        // Update xUSD supply based on tax
        let new_xusd_supply = synthetics[0].supply.checked_add(swap_tax_reserve).unwrap();
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
            liquidated_collateral.decimals,
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

    #[access_control(halted(&ctx.accounts.state))]
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
    #[access_control(halted(&ctx.accounts.state)
    admin(&ctx.accounts.state, &ctx.accounts.admin)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn withdraw_liquidation_penalty(
        ctx: Context<WithdrawLiquidationPenalty>,
        amount: u64,
    ) -> Result<()> {
        msg!("Synthetify: WITHDRAW LIQUIDATION PENALTY");
        let state = &ctx.accounts.state.load_mut()?;

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
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.signer)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn add_new_asset(ctx: Context<AddNewAsset>, new_asset_feed_address: Pubkey) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let new_asset = Asset {
            feed_address: new_asset_feed_address,
            last_update: 0,
            price: 0,
            confidence: 0,
            twap: 0,
            status: PriceStatus::Trading.into(),
            twac: 0,
        };

        assets_list.append_asset(new_asset);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin)
    usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list))]
    pub fn withdraw_swap_tax(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        msg!("Synthetify: WITHDRAW SWAP TAX");
        let state = &mut ctx.accounts.state.load_mut()?;
        let mut actual_amount = amount;

        // u64::MAX mean all available
        if amount == u64::MAX {
            actual_amount = state.swap_tax_reserve;
        }
        // check valid amount
        if actual_amount > state.swap_tax_reserve {
            return Err(ErrorCode::InsufficientAmountAdminWithdraw.into());
        }
        state.swap_tax_reserve = state.swap_tax_reserve.checked_sub(actual_amount).unwrap();

        // Mint xUSD to admin
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, actual_amount)?;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin)
    usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list))]
    pub fn withdraw_accumulated_debt_interest(
        ctx: Context<AdminWithdraw>,
        amount: u64,
    ) -> Result<()> {
        msg!("Synthetify: WITHDRAW ACCUMULATED DEBT INTEREST");
        let state = &mut ctx.accounts.state.load_mut()?;
        let mut actual_amount = amount;

        // u64::MAX mean all available
        if amount == u64::MAX {
            actual_amount = state.accumulated_debt_interest;
        }
        // check valid amount
        if actual_amount > state.accumulated_debt_interest {
            return Err(ErrorCode::InsufficientAmountAdminWithdraw.into());
        }
        state.accumulated_debt_interest = state
            .accumulated_debt_interest
            .checked_sub(actual_amount)
            .unwrap();

        // Mint xUSD to admin
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, actual_amount)?;

        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_swap_tax_ratio(ctx: Context<AdminAction>, swap_tax_ratio: u16) -> Result<()> {
        msg!("Synthetify:Admin: SWAP TAX RATIO");
        let state = &mut ctx.accounts.state.load_mut()?;
        let decimal_swap_tax_ratio = Decimal::from_percent(swap_tax_ratio);
        // max decimal_swap_tax_ratio must be less or equals 20%
        require!(
            decimal_swap_tax_ratio.ltq(Decimal::from_percent(2000))?,
            ParameterOutOfRange
        );

        state.swap_tax_ratio = decimal_swap_tax_ratio;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_debt_interest_rate(
        ctx: Context<AdminAction>,
        debt_interest_rate: u16,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET DEBT INTEREST RATE");
        let state = &mut ctx.accounts.state.load_mut()?;
        let decimal_debt_interest_rate = Decimal::from_percent(debt_interest_rate);
        // max debt_interest_rate must be less or equals 20%
        require!(
            decimal_debt_interest_rate.ltq(Decimal::from_percent(2000))?,
            ParameterOutOfRange
        );

        state.debt_interest_rate = decimal_debt_interest_rate;
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
    pub fn set_liquidation_rate(ctx: Context<AdminAction>, liquidation_rate: u16) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION RATE");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.liquidation_rate = Decimal::from_percent(liquidation_rate);
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_fee(ctx: Context<AdminAction>, fee: u16) -> Result<()> {
        msg!("Synthetify:Admin: SET FEE");
        let state = &mut ctx.accounts.state.load_mut()?;

        let decimal_fee = Decimal::from_percent(fee);
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
    pub fn set_health_factor(ctx: Context<AdminAction>, factor: u16) -> Result<()> {
        msg!("Synthetify:Admin: SET HEALTH FACTOR");
        let state = &mut ctx.accounts.state.load_mut()?;

        let decimal_factor = Decimal::from_percent(factor);
        state.health_factor = decimal_factor;
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
        new_max_supply: Decimal,
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
        penalty_to_exchange: u16,
        penalty_to_liquidator: u16,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION PENALTIES");
        let state = &mut ctx.accounts.state.load_mut()?;

        state.penalty_to_exchange = Decimal::from_percent(penalty_to_exchange);
        state.penalty_to_liquidator = Decimal::from_percent(penalty_to_liquidator);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_collateral(
        ctx: Context<AddCollateral>,
        reserve_balance: u64,
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
            reserve_balance,
            collateral_ratio,
        };
        assets_list.append_collateral(new_collateral);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_collateral_ratio(
        ctx: Context<SetCollateralRatio>,
        collateral_ratio: Decimal,
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
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn set_settlement_slot(
        ctx: Context<SetSettlementSlot>,
        settlement_slot: u64,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET SETTLEMENT SLOT");
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let synthetic = match assets_list
            .synthetics
            .iter_mut()
            .find(|x| x.asset_address == *ctx.accounts.synthetic_address.key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        synthetic.settlement_slot = settlement_slot;
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_synthetic(ctx: Context<AddSynthetic>, max_supply: Decimal) -> Result<()> {
        msg!("Synthetify: ADD SYNTHETIC");

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
            asset_address: *ctx.accounts.asset_address.key,
            max_supply: max_supply,
            settlement_slot: u64::MAX,
            supply: Decimal {
                val: 0,
                scale: max_supply.scale,
            },
        };
        assets_list.append_synthetic(new_synthetic);
        Ok(())
    }
    #[access_control(usd_token(&ctx.accounts.usd_token,&ctx.accounts.assets_list)
    assets_list(&ctx.accounts.state,&ctx.accounts.assets_list))]
    pub fn settle_synthetic(ctx: Context<SettleSynthetic>, bump: u8) -> Result<()> {
        let slot = Clock::get()?.slot;

        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        let state = ctx.accounts.state.load()?;
        let mut settlement = ctx.accounts.settlement.load_init()?;

        let (assets, _, synthetics) = assets_list.split_borrow();

        let synthetic_index = match synthetics
            .iter_mut()
            .position(|x| x.asset_address == *ctx.accounts.token_to_settle.key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        let synthetic = synthetics[synthetic_index];

        let asset = assets[synthetic.asset_index as usize];
        let usd_synthetic = &mut synthetics[0];

        if asset.last_update < (slot - state.max_delay as u64) {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        if synthetic.settlement_slot > slot {
            return Err(ErrorCode::SettlementNotReached.into());
        }

        let usd_value = calculate_value_in_usd(asset.price, synthetic.supply, synthetic.decimals);

        // Init settlement struct
        {
            settlement.bump = bump;
            settlement.decimals_in = synthetic.decimals;
            settlement.decimals_out = usd_synthetic.decimals;
            settlement.token_out_address = usd_synthetic.asset_address;
            settlement.token_in_address = synthetic.asset_address;
            settlement.reserve_address = *ctx.accounts.settlement_reserve.to_account_info().key;
            settlement.ratio = asset.price;
        }

        // Mint xUSD
        let new_supply = usd_synthetic.supply.checked_add(usd_value).unwrap();
        set_synthetic_supply(usd_synthetic, new_supply).unwrap();
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx_mint: CpiContext<MintTo> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx_mint, usd_value)?;

        // Remove synthetic from list
        assets_list.remove_synthetic(synthetic_index).unwrap();

        Ok(())
    }
    pub fn swap_settled_synthetic(ctx: Context<SwapSettledSynthetic>, amount: u64) -> Result<()> {
        msg!("Synthetify: SWAP SETTLED SYNTHETIC");

        let state = ctx.accounts.state.load()?;
        let settlement = ctx.accounts.settlement.load()?;

        let amount_usd = (settlement.ratio as u128)
            .checked_mul(amount as u128)
            .unwrap()
            .checked_div(
                10u128
                    .checked_pow(
                        (settlement.decimals_in + PRICE_OFFSET - settlement.decimals_out).into(),
                    )
                    .unwrap(),
            )
            .unwrap() as u64;
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Burn Synthetic
        let cpi_ctx_mint: CpiContext<Burn> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::burn(cpi_ctx_mint, amount)?;

        // Transfer xUSD
        let cpi_ctx_mint: CpiContext<Transfer> =
            CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx_mint, amount_usd)?;

        Ok(())
    }
}
#[account(zero_copy)]
// #[derive(Default)]
pub struct AssetsList {
    pub head_assets: u8,
    pub head_collaterals: u8,
    pub head_synthetics: u8,
    pub assets: [Asset; 255],
    pub collaterals: [Collateral; 255],
    pub synthetics: [Synthetic; 255],
}
impl Default for AssetsList {
    #[inline]
    fn default() -> AssetsList {
        AssetsList {
            head_assets: 0,
            head_collaterals: 0,
            head_synthetics: 0,
            assets: [Asset {
                ..Default::default()
            }; 255],
            collaterals: [Collateral {
                ..Default::default()
            }; 255],
            synthetics: [Synthetic {
                ..Default::default()
            }; 255],
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
    fn remove_synthetic(&mut self, index: usize) -> Result<()> {
        require!(index > 0, UsdSettlement);
        self.synthetics[index] = self.synthetics[(self.head_synthetics - 1) as usize];
        self.synthetics[(self.head_synthetics - 1) as usize] = Synthetic {
            ..Default::default()
        };
        self.head_synthetics -= 1;
        Ok(())
    }
    fn split_borrow(
        &mut self,
    ) -> (
        &mut [Asset; 255],
        &mut [Collateral; 255],
        &mut [Synthetic; 255],
    ) {
        (
            &mut self.assets,
            &mut self.collaterals,
            &mut self.synthetics,
        )
    }
}
#[derive(Accounts)]
pub struct InitializeAssetsList<'info> {
    #[account(init)]
    pub assets_list: Loader<'info, AssetsList>,
    pub sny_reserve: AccountInfo<'info>,
    pub sny_liquidation_fund: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
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
pub struct AdminWithdraw<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub to: CpiAccount<'info, TokenAccount>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&AdminWithdraw<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>>
{
    fn from(accounts: &AdminWithdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
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
pub struct SetSettlementSlot<'info> {
    #[account(mut, seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub synthetic_address: AccountInfo<'info>,
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
    pub amount: Decimal, // 8 Amount of SNY distributed in this round
    pub all_points: u64, // 8 All points used to calculate user share in staking rewards
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Staking {
    pub fund_account: Pubkey,         //32 Source account of SNY tokens
    pub round_length: u32,            //4 Length of round in slots
    pub amount_per_round: Decimal,    //8 Amount of SNY distributed per round
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
    pub price: Decimal,       // 8
    pub last_update: u64,     // 8
    pub twap: Decimal,        // 8
    pub twac: Decimal,        // 8 unused
    pub status: u8,           // 1
    pub confidence: Decimal,  // 8 unused
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Collateral {
    pub asset_index: u8,            // 1
    pub collateral_address: Pubkey, // 32
    pub reserve_address: Pubkey,    // 32
    pub liquidation_fund: Pubkey,   // 32
    pub reserve_balance: Decimal,   // 8
    pub collateral_ratio: Decimal,  // 1 in %
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Synthetic {
    pub asset_index: u8,       // 1
    pub asset_address: Pubkey, // 32
    pub supply: Decimal,       // 8
    pub max_supply: Decimal,   // 8
    pub settlement_slot: u64,  // 8 unused
}
#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct State {
    //8 Account signature
    pub admin: Pubkey,                      //32
    pub halted: bool,                       //1
    pub nonce: u8,                          //1
    pub debt_shares: u64,                   //8
    pub assets_list: Pubkey,                //32
    pub health_factor: Decimal,             //1   In % 1-100% modifier for debt
    pub max_delay: u32, //4   Delay between last oracle update 100 blocks ~ 1 min
    pub fee: u32,       //4   Default fee per swap 300 => 0.3%
    pub swap_tax_ratio: Decimal, //8   In % range 0-20% [1 -> 0.1%]
    pub swap_tax_reserve: Decimal, //64  Amount on tax from swap
    pub liquidation_rate: Decimal, //1   Size of debt repay in liquidation
    pub penalty_to_liquidator: Decimal, //1   In % range 0-25%
    pub penalty_to_exchange: Decimal, //1   In % range 0-25%
    pub liquidation_buffer: u32, //4   Time given user to fix collateralization ratio
    pub debt_interest_rate: Decimal, //8   In % range 0-20% [1 -> 0.1%]
    pub accumulated_debt_interest: Decimal, //64  Accumulated debt interest
    pub last_debt_adjustment: i64, //64
    pub staking: Staking, //116
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

#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct Settlement {
    //8 Account signature
    pub bump: u8,                  //1
    pub reserve_address: Pubkey,   //32
    pub token_in_address: Pubkey,  //32
    pub token_out_address: Pubkey, //32 xUSD
    pub decimals_in: u8,           //1
    pub decimals_out: u8,          //1
    pub ratio: u64,                //8
}
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct SettleSynthetic<'info> {
    #[account(init, seeds = [b"settlement".as_ref(), token_to_settle.key.as_ref(), &[bump]], payer = payer)]
    pub settlement: Loader<'info, Settlement>,
    #[account(seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    pub payer: AccountInfo<'info>,
    pub token_to_settle: AccountInfo<'info>,
    #[account(
        mut,
        "&settlement_reserve.owner == exchange_authority.key",
        "&settlement_reserve.mint == usd_token.key"
    )]
    pub settlement_reserve: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&SettleSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>>
{
    fn from(accounts: &SettleSynthetic<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.settlement_reserve.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct SwapSettledSynthetic<'info> {
    #[account(seeds = [b"settlement".as_ref(), token_to_settle.key.as_ref(), &[settlement.load()?.bump]])]
    pub settlement: Loader<'info, Settlement>,
    #[account(seeds = [b"statev1".as_ref(), &[state.load()?.bump]])]
    pub state: Loader<'info, State>,
    #[account(mut, "token_to_settle.key == &settlement.load()?.token_in_address")]
    pub token_to_settle: AccountInfo<'info>,
    #[account(mut)]
    pub user_settled_token_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_usd_account: CpiAccount<'info, TokenAccount>,
    #[account(
        mut,
        "settlement_reserve.to_account_info().key == &settlement.load()?.reserve_address"
    )]
    pub settlement_reserve: CpiAccount<'info, TokenAccount>,
    #[account("usd_token.key == &settlement.load()?.token_out_address")]
    pub usd_token: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    #[account("token_program.key == &token::ID")]
    pub token_program: AccountInfo<'info>,
    #[account(signer, "&user_settled_token_account.owner == signer.key")]
    pub signer: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&SwapSettledSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>>
{
    fn from(
        accounts: &SwapSettledSynthetic<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.settlement_reserve.to_account_info(),
            to: accounts.user_usd_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&SwapSettledSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Burn<'info>>
{
    fn from(accounts: &SwapSettledSynthetic<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_to_settle.to_account_info(),
            to: accounts.user_settled_token_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Decimal {
    pub val: u128,
    pub scale: u8,
}

#[error]
pub enum ErrorCode {
    #[msg("You are not admin")]
    Unauthorized = 0,
    #[msg("Not synthetic USD asset")]
    NotSyntheticUsd = 1,
    #[msg("Oracle price is outdated")]
    OutdatedOracle = 2,
    #[msg("Mint limit")]
    MintLimit = 3,
    #[msg("Withdraw limit")]
    WithdrawLimit = 4,
    #[msg("Invalid collateral_account")]
    CollateralAccountError = 5,
    #[msg("Synthetic collateral is not supported")]
    SyntheticCollateral = 6,
    #[msg("Invalid Assets List")]
    InvalidAssetsList = 7,
    #[msg("Invalid Liquidation")]
    InvalidLiquidation = 8,
    #[msg("Invalid signer")]
    InvalidSigner = 9,
    #[msg("Wash trade")]
    WashTrade = 10,
    #[msg("Invalid exchange liquidation account")]
    ExchangeLiquidationAccount = 11,
    #[msg("Liquidation deadline not passed")]
    LiquidationDeadline = 12,
    #[msg("Program is currently Halted")]
    Halted = 13,
    #[msg("No rewards to claim")]
    NoRewards = 14,
    #[msg("Invalid fund_account")]
    FundAccountError = 15,
    #[msg("Assets list already initialized")]
    Initialized = 17,
    #[msg("Swap Unavailable")]
    SwapUnavailable = 16,
    #[msg("Assets list is not initialized")]
    Uninitialized = 18,
    #[msg("No asset with such address was found")]
    NoAssetFound = 19,
    #[msg("Asset max_supply crossed")]
    MaxSupply = 20,
    #[msg("Asset is not collateral")]
    NotCollateral = 21,
    #[msg("Asset is already a collateral")]
    AlreadyACollateral = 22,
    #[msg("Insufficient value trade")]
    InsufficientValueTrade = 23,
    #[msg("Insufficient amount admin withdraw")]
    InsufficientAmountAdminWithdraw = 24,
    #[msg("Settlement slot not reached")]
    SettlementNotReached = 25,
    #[msg("Cannot settle xUSD")]
    UsdSettlement = 26,
    #[msg("Parameter out of range")]
    ParameterOutOfRange = 27,
    #[msg("Overflow")]
    Overflow = 28,
    #[msg("Scale is different")]
    DifferentScale = 29,
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
