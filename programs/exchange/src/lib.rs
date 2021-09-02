pub mod account;
pub mod context;
pub mod decimal;
pub mod math;
pub mod utils;
use account::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Transfer};
use context::*;
use pyth::pc::{Price, PriceStatus};
use utils::*;

const SYNTHETIFY_EXCHANGE_SEED: &str = "Synthetify";
#[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto};

    use crate::math::{
        amount_to_discount, amount_to_shares_by_rounding_down, calculate_burned_shares,
        calculate_max_debt_in_usd, calculate_max_withdraw_in_usd,
        calculate_new_shares_by_rounding_up, calculate_swap_out_amount, calculate_swap_tax,
        calculate_user_debt_in_usd, calculate_value_in_usd, calculate_vault_borrow_limit,
        calculate_vault_withdraw_limit, usd_to_token_amount,
    };

    use crate::decimal::{
        Add, Compare, DivUp, Mul, MulUp, Sub, PRICE_SCALE, SNY_SCALE, UNIFIED_PERCENT_SCALE,
        XUSD_SCALE,
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
        exchange_account.user_staking_data.amount_to_claim = Decimal::from_sny(0);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn create_list(
        ctx: Context<InitializeAssetsList>,
        collateral_token: Pubkey,
        collateral_token_feed: Pubkey,
        usd_token: Pubkey,
    ) -> Result<()> {
        let assets_list = &mut ctx.accounts.assets_list.load_init()?;

        let usd_asset = Asset {
            feed_address: Pubkey::default(), // unused
            last_update: u64::MAX,           // we don't update usd price
            price: Decimal::from_price(100_000_000),
            confidence: Decimal::from_price(0),
            twap: Decimal::from_price(100_000_000),
            status: PriceStatus::Trading.into(),
            twac: Decimal::from_price(0),
        };
        let usd_synthetic = Synthetic {
            asset_address: usd_token,
            supply: Decimal::from_usd(0),
            borrowed_supply: Decimal::from_usd(0),
            max_supply: Decimal::from_usd(u64::MAX.into()), // no limit for usd asset
            swapline_supply: Decimal::from_usd(0),
            settlement_slot: u64::MAX,
            asset_index: 0,
        };
        let sny_asset = Asset {
            feed_address: collateral_token_feed,
            last_update: 0,
            price: Decimal::from_integer(2).to_price(),
            confidence: Decimal::from_price(0),
            twap: Decimal::from_integer(2).to_price(),
            status: PriceStatus::Unknown.into(),
            twac: Decimal::from_price(0),
        };
        let sny_collateral = Collateral {
            asset_index: 1,
            collateral_ratio: Decimal::from_percent(10), // 10%
            collateral_address: collateral_token,
            reserve_balance: Decimal::from_sny(0),
            reserve_address: *ctx.accounts.sny_reserve.key,
            liquidation_fund: *ctx.accounts.sny_liquidation_fund.key,
            max_collateral: Decimal::from_sny(u64::MAX.into()),
        };

        assets_list.append_asset(usd_asset);
        assets_list.append_asset(sny_asset);
        assets_list.append_synthetic(usd_synthetic);
        assets_list.append_collateral(sny_collateral);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_assets_list(ctx: Context<SetAssetsList>) -> Result<()> {
        msg!("Synthetify:Admin: SET ASSETS LIST");
        let state = &mut ctx.accounts.state.load_mut()?;
        &ctx.accounts.assets_list.load()?;

        state.assets_list = *ctx.accounts.assets_list.to_account_info().key;
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
                    let offset = (PRICE_SCALE as i32).checked_add(price_feed.expo).unwrap();
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
                        let scaled_confidence = price_feed
                            .agg
                            .conf
                            .checked_mul(10u64.pow(offset.try_into().unwrap()))
                            .unwrap();
                        let scaled_twac = price_feed
                            .twac
                            .val
                            .checked_mul(10i64.pow(offset.try_into().unwrap()))
                            .unwrap();
                        asset.price = Decimal::from_price(scaled_price.try_into().unwrap());
                        asset.twap = Decimal::from_price(scaled_twap.try_into().unwrap());
                        asset.confidence =
                            Decimal::from_price(scaled_confidence.try_into().unwrap());
                        asset.twac = Decimal::from_price(scaled_twac.try_into().unwrap());
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
                        let scaled_confidence = price_feed
                            .agg
                            .conf
                            .checked_div(10u64.pow((-offset).try_into().unwrap()))
                            .unwrap();
                        let scaled_twac = price_feed
                            .twac
                            .val
                            .checked_div(10i64.pow((-offset).try_into().unwrap()))
                            .unwrap();
                        asset.price = Decimal::from_price(scaled_price.try_into().unwrap());
                        asset.twap = Decimal::from_price(scaled_twap.try_into().unwrap());
                        asset.confidence =
                            Decimal::from_price(scaled_confidence.try_into().unwrap());
                        asset.twac = Decimal::from_price(scaled_twac.try_into().unwrap());
                    }
                    asset.status = price_feed.agg.status.into();
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
        state.exchange_authority = *ctx.accounts.exchange_authority.key;
        state.admin = *ctx.accounts.admin.key;
        state.halted = false;
        state.nonce = nonce;
        state.debt_shares = 0u64;
        state.health_factor = Decimal::from_percent(50); // 50%

        // once we will not be able to fit all data into one transaction we will
        // use max_delay to allow split updating oracles and exchange operation
        state.max_delay = 0;
        state.fee = Decimal::new(3, 3).to_percent(); // 0.3%
        state.swap_tax_ratio = Decimal::from_percent(20); // 20%
        state.swap_tax_reserve = Decimal::from_usd(0);
        state.debt_interest_rate = Decimal::from_percent(1).to_interest_rate(); //1% APR
        state.last_debt_adjustment = timestamp;
        state.penalty_to_liquidator = Decimal::from_percent(5); // 5%
        state.penalty_to_exchange = Decimal::from_percent(5); // 5%
        state.accumulated_debt_interest = Decimal::from_usd(0);
        state.liquidation_rate = Decimal::from_percent(20); // 20%

        // TODO decide about length of buffer
        // Maybe just couple of minutes will be enough ?
        state.liquidation_buffer = 172800; // about 24 Hours;
        state.staking = Staking {
            round_length: staking_round_length,
            amount_per_round: Decimal {
                val: amount_per_round.into(),
                scale: SNY_SCALE,
            },
            fund_account: *ctx.accounts.staking_fund_account.to_account_info().key,
            finished_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: 0,
            },
            current_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: slot,
            },
            next_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(amount_per_round.into()),
                start: slot.checked_add(staking_round_length.into()).unwrap(),
            },
        };
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
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

        let collateral_index = assets_list
            .collaterals
            .iter_mut()
            .position(|x| {
                x.reserve_address
                    .eq(ctx.accounts.reserve_address.to_account_info().key)
            })
            .unwrap();
        let collateral = &mut assets_list.collaterals[collateral_index];

        let amount_decimal = Decimal {
            val: amount.into(),
            scale: collateral.reserve_balance.scale,
        };
        let new_reserve_balance = collateral.reserve_balance.add(amount_decimal).unwrap();
        if new_reserve_balance.gt(collateral.max_collateral).unwrap() {
            return Err(ErrorCode::CollateralLimitExceeded.into());
        }
        collateral.reserve_balance = new_reserve_balance;

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
    #[access_control(halted(&ctx.accounts.state))]
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

        let total_debt =
            calculate_debt_with_adjustment(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);
        let mint_limit = max_debt.mul(state.health_factor);

        let synthetics = &mut assets_list.synthetics;

        // We can only mint xUSD
        // Both xUSD and collateral token have static index in assets array
        let mut xusd_synthetic = &mut synthetics[0];
        let amount: Decimal = match amount {
            u64::MAX => mint_limit.sub(user_debt).unwrap(),
            _ => Decimal {
                val: amount.into(),
                scale: xusd_synthetic.supply.scale,
            },
        };
        let debt_after_mint = user_debt.add(amount).unwrap();

        if mint_limit.lt(debt_after_mint).unwrap() {
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

        let new_supply = xusd_synthetic.supply.add(amount).unwrap();
        set_synthetic_supply(&mut xusd_synthetic, new_supply)?;
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        // Mint xUSD to user
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, amount.to_u64())?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
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

        let user_collateral_account = &mut ctx.accounts.user_collateral_account;

        // Calculate debt
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let total_debt =
            calculate_debt_with_adjustment(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);

        let max_borrow = max_debt.mul(state.health_factor);

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

        let amount_collateral = Decimal {
            val: exchange_account_collateral.amount.into(),
            scale: collateral.reserve_balance.scale,
        };

        // Check if not overdrafting
        let max_withdrawable_in_usd = calculate_max_withdraw_in_usd(
            max_borrow,
            user_debt,
            collateral.collateral_ratio,
            state.health_factor,
        );
        let collateral_asset = &assets[collateral.asset_index as usize];

        let amount_to_withdraw: Decimal;
        if amount == u64::MAX {
            let max_withdrawable_in_token = usd_to_token_amount(
                collateral_asset,
                max_withdrawable_in_usd,
                collateral.reserve_balance.scale,
            );

            if max_withdrawable_in_token.gt(amount_collateral).unwrap() {
                amount_to_withdraw = amount_collateral;
            } else {
                amount_to_withdraw = max_withdrawable_in_token;
            }
        } else {
            amount_to_withdraw = Decimal {
                val: amount.into(),
                scale: collateral.reserve_balance.scale,
            };
            let amount_to_withdraw_in_usd =
                calculate_value_in_usd(collateral_asset.price, amount_to_withdraw);

            if max_withdrawable_in_usd
                .lt(amount_to_withdraw_in_usd)
                .unwrap()
            {
                return Err(ErrorCode::WithdrawLimit.into());
            }
        }

        // Update balance on exchange account
        exchange_account_collateral.amount = amount_collateral
            .sub(amount_to_withdraw)
            .unwrap()
            .val
            .try_into()
            .unwrap();

        if exchange_account_collateral.amount == 0 {
            exchange_account.remove(entry_index);
        }

        // Update reserve balance in AssetList
        collateral.reserve_balance = collateral.reserve_balance.sub(amount_to_withdraw).unwrap(); // should never fail

        // Send withdrawn collateral to user
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx, amount_to_withdraw.val.try_into().unwrap())?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
    pub fn swap(ctx: Context<Swap>, amount: u64) -> Result<()> {
        msg!("Synthetify: SWAP");
        let mut state = &mut ctx.accounts.state.load_mut()?;

        let slot = Clock::get()?.slot;
        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        let token_address_in = ctx.accounts.token_in.to_account_info().key;
        let token_address_for = ctx.accounts.token_for.to_account_info().key;
        let slot = Clock::get()?.slot;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        let user_token_account_in = &ctx.accounts.user_token_account_in;
        let tx_signer = ctx.accounts.owner.key;

        // Signer need to be owner of source account
        if !tx_signer.eq(&user_token_account_in.owner) {
            return Err(ErrorCode::InvalidSigner.into());
        }
        // Swapping for same assets is forbidden
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
        let effective_fee = state.fee.sub(state.fee.mul(discount)).unwrap();
        // Output amount ~ 100% - fee of input
        let amount_decimal = Decimal {
            val: amount.into(),
            scale: synthetics[synthetic_in_index].supply.scale,
        };
        let (amount_for, fee_usd) = calculate_swap_out_amount(
            &asset_in,
            &asset_for,
            synthetics[synthetic_for_index].supply.scale,
            amount_decimal,
            effective_fee,
        )?;

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Update swap_tax_reserve
        let swap_tax_reserve = calculate_swap_tax(fee_usd, state.swap_tax_ratio);
        state.swap_tax_reserve = state.swap_tax_reserve.add(swap_tax_reserve).unwrap();

        // Update xUSD supply based on tax
        let new_xusd_supply = synthetics[0].supply.add(swap_tax_reserve).unwrap();
        set_synthetic_supply(&mut synthetics[0], new_xusd_supply)?;

        // Set new supply output token
        let new_supply_output = synthetics[synthetic_for_index]
            .supply
            .add(amount_for)
            .unwrap();
        set_synthetic_supply(&mut synthetics[synthetic_for_index], new_supply_output)?;
        // Set new supply input token

        let new_supply_input = synthetics[synthetic_in_index]
            .supply
            .sub(amount_decimal)
            .unwrap();
        set_synthetic_supply(&mut synthetics[synthetic_in_index], new_supply_input)?;
        // Burn input token
        let cpi_ctx_burn: CpiContext<Burn> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::burn(cpi_ctx_burn, amount)?;

        // Mint output token
        let cpi_ctx_mint: CpiContext<MintTo> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx_mint, amount_for.into())?;
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
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
        let total_debt =
            calculate_debt_with_adjustment(state, assets_list, slot, timestamp).unwrap();
        let (assets, _, synthetics) = assets_list.split_borrow();

        // xUSD got static index 0
        let burn_asset = &mut assets[0];
        let burn_synthetic = &mut synthetics[0];
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);

        // Rounding down - debt is burned in favor of the system
        let amount_decimal = Decimal {
            val: amount.into(),
            scale: burn_synthetic.supply.scale,
        };
        let burned_shares = calculate_burned_shares(
            &burn_asset,
            user_debt,
            exchange_account.debt_shares,
            amount_decimal,
        );
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];

        // Check if user burned more than debt
        if burned_shares >= exchange_account.debt_shares {
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
                burn_synthetic.supply.sub(user_debt).unwrap(),
            )?;
            // Burn token
            // We do not use full allowance maybe its better to burn full allowance
            // and mint matching amount
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx, user_debt.to_u64())?;
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
                burn_synthetic.supply.sub(amount_decimal).unwrap(),
            )?;
            // Burn token
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::burn(cpi_ctx, amount)?;
            Ok(())
        }
    }
    #[access_control(halted(&ctx.accounts.state))]
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

        let total_debt =
            calculate_debt_with_adjustment(state, assets_list, slot, timestamp).unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);

        // Check collateral ratio
        if max_debt.gt(user_debt).unwrap() {
            return Err(ErrorCode::InvalidLiquidation.into());
        }
        // Cannot payback more than liquidation_rate of user debt
        let max_repay = user_debt.mul(state.liquidation_rate).to_usd().to_u64();

        let amount: u64 = match amount {
            u64::MAX => max_repay,
            _ => amount,
        };

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
        let liquidation_amount_preflight = Decimal {
            val: amount.into(),
            scale: XUSD_SCALE,
        };

        let seized_collateral_in_usd_preflight = liquidation_amount_preflight
            .mul_up(
                state
                    .penalty_to_liquidator
                    .add(state.penalty_to_exchange)
                    .unwrap(),
            )
            .add(liquidation_amount_preflight)
            .unwrap();

        let seized_collateral_in_token_preflight = usd_to_token_amount(
            liquidated_asset,
            seized_collateral_in_usd_preflight,
            liquidated_collateral.reserve_balance.scale,
        );
        let exchange_account_collateral_index =
            match exchange_account.collaterals.iter().position(|x| {
                x.collateral_address
                    .eq(&liquidated_collateral.collateral_address)
            }) {
                Some(v) => v,
                None => return Err(ErrorCode::NoAssetFound.into()),
            };

        let preflight_check = seized_collateral_in_token_preflight.val
            <= exchange_account.collaterals[exchange_account_collateral_index]
                .amount
                .into();

        let (seized_collateral_in_token, liquidation_amount) = match preflight_check {
            true => (
                seized_collateral_in_token_preflight,
                liquidation_amount_preflight,
            ),
            false => {
                let seized_collateral_in_token = Decimal {
                    val: exchange_account.collaterals[exchange_account_collateral_index]
                        .amount
                        .into(),
                    scale: liquidated_collateral.reserve_balance.scale,
                };
                (
                    seized_collateral_in_token,
                    calculate_value_in_usd(liquidated_asset.price, seized_collateral_in_token),
                )
            }
        };
        // Rounding down - debt is burned in favor of the system

        let burned_debt_shares = amount_to_shares_by_rounding_down(
            state.debt_shares,
            total_debt.to_u64(),
            liquidation_amount.to_u64(),
        );
        state.debt_shares = state.debt_shares.checked_sub(burned_debt_shares).unwrap();

        exchange_account.debt_shares = exchange_account
            .debt_shares
            .checked_sub(burned_debt_shares)
            .unwrap();

        let exchange_account_collateral =
            &mut exchange_account.collaterals[exchange_account_collateral_index];

        exchange_account_collateral.amount = exchange_account_collateral
            .amount
            .checked_sub(seized_collateral_in_token.to_u64())
            .unwrap();
        liquidated_collateral.reserve_balance = liquidated_collateral
            .reserve_balance
            .sub(seized_collateral_in_token)
            .unwrap();

        let collateral_to_exchange = seized_collateral_in_token
            .mul(state.penalty_to_exchange)
            .div_up(
                Decimal::from_percent(100)
                    .add(state.penalty_to_liquidator)
                    .unwrap()
                    .add(state.penalty_to_exchange)
                    .unwrap(),
            );

        let collateral_to_liquidator = seized_collateral_in_token
            .sub(collateral_to_exchange)
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
            token::transfer(transfer, collateral_to_liquidator.to_u64())?;
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
                .sub(liquidation_amount)
                .unwrap();
            set_synthetic_supply(&mut assets_list.synthetics[0], new_supply)?;
            let burn_accounts = Burn {
                mint: ctx.accounts.usd_token.to_account_info(),
                to: ctx.accounts.liquidator_usd_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let burn = CpiContext::new(token_program, burn_accounts).with_signer(signer_seeds);
            token::burn(burn, liquidation_amount.to_u64())?;
        }
        // Clean user collateral if empty
        if exchange_account.collaterals[exchange_account_collateral_index].amount == 0 {
            exchange_account.remove(exchange_account_collateral_index);
        }

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
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
            calculate_debt_with_adjustment(state, assets_list.borrow_mut(), slot, timestamp)
                .unwrap();
        let user_debt = calculate_user_debt_in_usd(exchange_account, total_debt, state.debt_shares);
        let max_debt = calculate_max_debt_in_usd(exchange_account, assets_list);

        // If account is undercollateralized set liquidation_deadline
        // After liquidation_deadline slot account can be liquidated
        if max_debt.gt(user_debt)? {
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

        if state
            .staking
            .finished_round
            .amount
            .gt(Decimal::from_sny(0))?
        {
            let reward_amount: u64 = state
                .staking
                .finished_round
                .amount
                .val
                .checked_mul(
                    exchange_account
                        .user_staking_data
                        .finished_round_points
                        .into(),
                )
                .unwrap()
                .checked_div(state.staking.finished_round.all_points.into())
                .unwrap() as u64;

            exchange_account.user_staking_data.amount_to_claim = exchange_account
                .user_staking_data
                .amount_to_claim
                .add(Decimal::from_sny(reward_amount.into()))?;

            exchange_account.user_staking_data.finished_round_points = 0;
        }

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state))]
    pub fn withdraw_rewards(ctx: Context<WithdrawRewards>) -> Result<()> {
        msg!("Synthetify: WITHDRAW REWARDS");

        let slot = Clock::get()?.slot;
        let mut state = &mut ctx.accounts.state.load_mut()?;

        // Adjust staking round
        adjust_staking_rounds(&mut state, slot);

        let exchange_account = &mut ctx.accounts.exchange_account.load_mut()?;
        // adjust current staking points for exchange account
        adjust_staking_account(exchange_account, &state.staking);

        if exchange_account.user_staking_data.amount_to_claim.val == 0u128 {
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
        token::transfer(
            cpi_ctx,
            exchange_account.user_staking_data.amount_to_claim.to_u64(),
        )?;
        // Reset rewards amount
        exchange_account.user_staking_data.amount_to_claim = Decimal::from_sny(0);
        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state)
    admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn withdraw_liquidation_penalty(
        ctx: Context<WithdrawLiquidationPenalty>,
        amount: Decimal,
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
        collateral.reserve_balance = collateral.reserve_balance.sub(amount)?;
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
        token::transfer(cpi_ctx, amount.val as u64)?;
        Ok(())
    }
    // admin methods
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.signer))]
    pub fn add_new_asset(ctx: Context<AddNewAsset>, new_asset_feed_address: Pubkey) -> Result<()> {
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let new_asset = Asset {
            feed_address: new_asset_feed_address,
            last_update: 0,
            price: Decimal::from_price(0),
            confidence: Decimal::from_price(0),
            twap: Decimal::from_price(0),
            status: PriceStatus::Trading.into(),
            twac: Decimal::from_price(0),
        };

        assets_list.append_asset(new_asset);
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn withdraw_swap_tax(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        msg!("Synthetify: WITHDRAW SWAP TAX");
        let state = &mut ctx.accounts.state.load_mut()?;
        let mut actual_amount = Decimal {
            val: amount.into(),
            scale: state.swap_tax_reserve.scale,
        };
        let max_withdrawable = Decimal {
            val: state.swap_tax_reserve.into(),
            scale: state.swap_tax_reserve.scale,
        };

        // u64::MAX mean all available
        if amount == u64::MAX {
            actual_amount = max_withdrawable;
        }
        // check valid amount
        if actual_amount.gt(state.swap_tax_reserve)? {
            return Err(ErrorCode::InsufficientAmountAdminWithdraw.into());
        }
        state.swap_tax_reserve = state.swap_tax_reserve.sub(actual_amount)?;

        // Mint xUSD to admin
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, actual_amount.to_usd().to_u64())?;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn withdraw_accumulated_debt_interest(
        ctx: Context<WithdrawAccumulatedDebtInterest>,
        amount: u64,
    ) -> Result<()> {
        msg!("Synthetify: WITHDRAW ACCUMULATED DEBT INTEREST");
        let slot = Clock::get()?.slot;
        let timestamp = Clock::get()?.unix_timestamp;
        let state = &mut ctx.accounts.state.load_mut()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;

        adjust_interest_debt(state, assets_list, slot, timestamp);

        let mut actual_amount = Decimal {
            val: amount.into(),
            scale: state.accumulated_debt_interest.scale,
        };
        let max_withdrawable = Decimal {
            val: state.accumulated_debt_interest.into(),
            scale: state.accumulated_debt_interest.scale,
        };
        // u64::MAX mean all available
        if amount == u64::MAX {
            actual_amount = max_withdrawable;
        }
        // check valid amount
        if actual_amount.gt(max_withdrawable)? {
            return Err(ErrorCode::InsufficientAmountAdminWithdraw.into());
        }
        state.accumulated_debt_interest = state.accumulated_debt_interest.sub(actual_amount)?;

        // Mint xUSD to admin
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, actual_amount.to_usd().to_u64())?;

        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_swap_tax_ratio(ctx: Context<AdminAction>, swap_tax_ratio: Decimal) -> Result<()> {
        msg!("Synthetify:Admin: SWAP TAX RATIO");
        let state = &mut ctx.accounts.state.load_mut()?;

        // max swap_tax_ratio must be less or equals 30%
        let same_scale = swap_tax_ratio.scale == state.swap_tax_ratio.scale;
        let in_range = swap_tax_ratio.lte(Decimal::from_percent(30))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        state.swap_tax_ratio = swap_tax_ratio;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_debt_interest_rate(
        ctx: Context<AdminAction>,
        debt_interest_rate: Decimal,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET DEBT INTEREST RATE");
        let state = &mut ctx.accounts.state.load_mut()?;

        // max debt_interest_rate must be less or equals 20%
        let same_scale = debt_interest_rate.scale == state.debt_interest_rate.scale;
        let in_range = debt_interest_rate.lte(Decimal::from_percent(20).to_interest_rate())?;
        require!(same_scale && in_range, ParameterOutOfRange);

        state.debt_interest_rate = debt_interest_rate;
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
    pub fn set_liquidation_rate(
        ctx: Context<AdminAction>,
        liquidation_rate: Decimal,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION RATE");
        let state = &mut ctx.accounts.state.load_mut()?;

        // liquidation_rate should be less or equals 100%
        let same_scale = liquidation_rate.scale == state.liquidation_rate.scale;
        let in_range = liquidation_rate.lte(Decimal::from_percent(100))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        state.liquidation_rate = liquidation_rate;
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_fee(ctx: Context<AdminAction>, fee: Decimal) -> Result<()> {
        msg!("Synthetify:Admin: SET FEE");
        let state = &mut ctx.accounts.state.load_mut()?;

        //  fee must be less or equals 1%
        let same_scale = fee.scale == state.fee.scale;
        let in_range = fee.lte(Decimal::from_percent(1))?;
        require!(same_scale && in_range, ParameterOutOfRange);

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
    pub fn set_health_factor(ctx: Context<AdminAction>, factor: Decimal) -> Result<()> {
        msg!("Synthetify:Admin: SET HEALTH FACTOR");
        let state = &mut ctx.accounts.state.load_mut()?;

        // factor must be less or equals 100%
        let same_scale = factor.scale == state.health_factor.scale;
        let in_range = factor.lte(Decimal::from_percent(100))?;
        require!(same_scale && in_range, ParameterOutOfRange);
        state.health_factor = factor;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_staking_amount_per_round(
        ctx: Context<AdminAction>,
        amount_per_round: Decimal,
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
        penalty_to_exchange: Decimal,
        penalty_to_liquidator: Decimal,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET LIQUIDATION PENALTIES");
        let state = &mut ctx.accounts.state.load_mut()?;

        // penalty_to_exchange and penalty_to_liquidator must be less or equals 25%
        let same_scale = penalty_to_exchange.scale == state.penalty_to_exchange.scale;
        let in_range = penalty_to_exchange.lte(Decimal::from_percent(25))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        let same_scale = penalty_to_liquidator.scale == state.penalty_to_liquidator.scale;
        let in_range = penalty_to_liquidator.lte(Decimal::from_percent(25))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        state.penalty_to_exchange = penalty_to_exchange;
        state.penalty_to_liquidator = penalty_to_liquidator;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_collateral(
        ctx: Context<AddCollateral>,
        reserve_balance: Decimal,
        max_collateral: Decimal,
        collateral_ratio: Decimal,
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
        // collateral_ratio must be less or equals 100%
        let same_scale = collateral_ratio.scale == UNIFIED_PERCENT_SCALE;
        let in_range = collateral_ratio.lte(Decimal::from_percent(100))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        require!(
            reserve_balance.scale == max_collateral.scale,
            DifferentScale
        );

        let new_collateral = Collateral {
            asset_index: asset_index as u8,
            collateral_address: *ctx.accounts.asset_address.key,
            liquidation_fund: *ctx.accounts.liquidation_fund.to_account_info().key,
            reserve_address: *ctx.accounts.reserve_account.to_account_info().key,
            collateral_ratio,
            reserve_balance,
            max_collateral,
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

        let collateral = match assets_list.collaterals.iter_mut().find(|x| {
            x.collateral_address == *ctx.accounts.collateral_address.to_account_info().key
        }) {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        // collateral_ratio must be less or equals 100%
        let same_scale = collateral.collateral_ratio.scale == collateral_ratio.scale;
        let in_range = collateral_ratio.lte(Decimal::from_percent(100))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        collateral.collateral_ratio = collateral_ratio;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_max_collateral(
        ctx: Context<SetMaxCollateral>,
        max_collateral: Decimal,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET COLLATERAL RATIO");
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let collateral = match assets_list.collaterals.iter_mut().find(|x| {
            x.collateral_address == *ctx.accounts.collateral_address.to_account_info().key
        }) {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };

        require!(
            collateral.max_collateral.scale == max_collateral.scale,
            DifferentScale
        );

        collateral.max_collateral = max_collateral;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_admin(ctx: Context<SetAdmin>) -> Result<()> {
        msg!("Synthetify:Admin: SET ADMIN");
        let mut state = ctx.accounts.state.load_mut()?;

        state.admin = *ctx.accounts.new_admin.key;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_settlement_slot(
        ctx: Context<SetSettlementSlot>,
        settlement_slot: u64,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET SETTLEMENT SLOT");
        let mut assets_list = ctx.accounts.assets_list.load_mut()?;

        let synthetic = match assets_list
            .synthetics
            .iter_mut()
            .find(|x| x.asset_address == *ctx.accounts.synthetic_address.to_account_info().key)
        {
            Some(asset) => asset,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };
        synthetic.settlement_slot = settlement_slot;
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn add_synthetic(ctx: Context<AddSynthetic>, max_supply: u64) -> Result<()> {
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
            asset_address: *ctx.accounts.asset_address.to_account_info().key,
            max_supply: Decimal {
                val: max_supply.into(),
                scale: ctx.accounts.asset_address.decimals,
            },
            settlement_slot: u64::MAX,
            borrowed_supply: Decimal::new(0, ctx.accounts.asset_address.decimals),
            supply: Decimal {
                val: 0,
                scale: ctx.accounts.asset_address.decimals,
            },
            swapline_supply: Decimal {
                val: 0,
                scale: ctx.accounts.asset_address.decimals,
            },
        };
        assets_list.append_synthetic(new_synthetic);
        Ok(())
    }
    pub fn settle_synthetic(ctx: Context<SettleSynthetic>, bump: u8) -> Result<()> {
        let slot = Clock::get()?.slot;

        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        let state = ctx.accounts.state.load()?;
        let mut settlement = ctx.accounts.settlement.load_init()?;

        let (assets, _, synthetics) = assets_list.split_borrow();

        let synthetic_index = match synthetics
            .iter_mut()
            .position(|x| x.asset_address == *ctx.accounts.token_to_settle.to_account_info().key)
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

        let usd_value = calculate_value_in_usd(asset.price, synthetic.supply);

        // Init settlement struct
        {
            settlement.bump = bump;
            settlement.decimals_in = synthetic.supply.scale;
            settlement.decimals_out = usd_synthetic.supply.scale;
            settlement.token_out_address = usd_synthetic.asset_address;
            settlement.token_in_address = synthetic.asset_address;
            settlement.reserve_address = *ctx.accounts.settlement_reserve.to_account_info().key;
            settlement.ratio = asset.price;
        }

        // Mint xUSD
        let new_supply = usd_synthetic.supply.add(usd_value).unwrap();
        set_synthetic_supply(usd_synthetic, new_supply).unwrap();
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx_mint: CpiContext<MintTo> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx_mint, usd_value.to_u64())?;

        // Remove synthetic from list
        assets_list.remove_synthetic(synthetic_index).unwrap();

        Ok(())
    }
    pub fn swap_settled_synthetic(ctx: Context<SwapSettledSynthetic>, amount: u64) -> Result<()> {
        msg!("Synthetify: SWAP SETTLED SYNTHETIC");

        let state = ctx.accounts.state.load()?;
        let settlement = ctx.accounts.settlement.load()?;
        let swap_amount = Decimal {
            val: amount.into(),
            scale: settlement.decimals_in,
        };
        let amount_usd = swap_amount.mul(settlement.ratio).to_usd().to_u64();

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
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn create_swapline(ctx: Context<CreateSwapline>, bump: u8, limit: u64) -> Result<()> {
        msg!("Synthetify: CREATE SWAPLINE");

        let mut swapline = ctx.accounts.swapline.load_init()?;
        let assets_list = ctx.accounts.assets_list.load()?;

        let synthetic = assets_list
            .synthetics
            .iter()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();
        let collateral = assets_list
            .collaterals
            .iter()
            .find(|x| {
                x.collateral_address
                    .eq(&ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();
        require!(
            synthetic.asset_index == collateral.asset_index,
            MismatchedTokens
        );
        let collateral_reserve = &ctx.accounts.collateral_reserve;
        swapline.balance = Decimal {
            val: 0,
            scale: collateral.reserve_balance.scale,
        };
        swapline.collateral = collateral.collateral_address;
        swapline.collateral_reserve = *collateral_reserve.to_account_info().key;
        swapline.fee = Decimal::from_percent(1);
        swapline.accumulated_fee = Decimal {
            val: 0,
            scale: collateral.reserve_balance.scale,
        };
        swapline.limit = Decimal {
            val: limit.into(),
            scale: collateral.reserve_balance.scale,
        };
        swapline.synthetic = synthetic.asset_address;
        swapline.halted = false;
        swapline.bump = bump;
        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn withdraw_swapline_fee(ctx: Context<WithdrawSwaplineFee>, amount: u64) -> Result<()> {
        msg!("Synthetify: WITHDRAW SWAPLINE FEE");

        let mut swapline = ctx.accounts.swapline.load_mut()?;
        let state = ctx.accounts.state.load()?;

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let amount = Decimal {
            val: amount.into(),
            scale: swapline.accumulated_fee.scale,
        };

        swapline.accumulated_fee = swapline.accumulated_fee.sub(amount).unwrap();

        // Mint synthetic to user
        let cpi_ctx_transfer: CpiContext<Transfer> =
            CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx_transfer, amount.to_u64())?;

        Ok(())
    }
    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_halted_swapline(ctx: Context<SetHaltedSwapline>, halted: bool) -> Result<()> {
        msg!("Synthetify: SET HALTED SWAPLINE");

        let mut swapline = ctx.accounts.swapline.load_mut()?;
        swapline.halted = halted;
        Ok(())
    }
    pub fn native_to_synthetic(ctx: Context<UseSwapLine>, amount: u64) -> Result<()> {
        // Swaps are only allowed on 1:1 assets
        msg!("Synthetify: NATIVE TO SYNTHETIC");

        let state = ctx.accounts.state.load()?;
        let mut swapline = ctx.accounts.swapline.load_mut()?;

        require!(!swapline.halted, Halted);

        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        let (_, collaterals, synthetics) = assets_list.split_borrow();

        let synthetic = synthetics
            .iter_mut()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();
        let collateral = collaterals
            .iter_mut()
            .find(|x| {
                x.collateral_address
                    .eq(&ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        require!(
            synthetic.asset_index == collateral.asset_index,
            MismatchedTokens
        );

        let amount = Decimal {
            val: amount.into(),
            scale: collateral.reserve_balance.scale,
        };

        let fee = amount.mul(swapline.fee);
        let amount_out = amount.sub(fee).unwrap().to_scale(synthetic.supply.scale);
        let new_supply = synthetic.supply.add(amount_out).unwrap();

        set_synthetic_supply(synthetic, new_supply).unwrap();
        synthetic.swapline_supply = synthetic.swapline_supply.add(amount_out).unwrap();

        swapline.accumulated_fee = swapline.accumulated_fee.add(fee).unwrap();
        swapline.balance = swapline.balance.add(amount).unwrap();
        require!(swapline.balance.lte(swapline.limit).unwrap(), SwaplineLimit);

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        // Mint synthetic to user
        let cpi_ctx_mint: CpiContext<MintTo> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(cpi_ctx_mint, amount_out.to_u64())?;
        // Transfer native token to exchange
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_collateral_account.to_account_info(),
            to: ctx.accounts.collateral_reserve.to_account_info(),
            authority: ctx.accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx_transfer = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
        token::transfer(cpi_ctx_transfer, amount.to_u64())?;

        Ok(())
    }
    pub fn synthetic_to_native(ctx: Context<UseSwapLine>, amount: u64) -> Result<()> {
        // Swaps are only allowed on 1:1 assets
        msg!("Synthetify: SYNTHETIC TO NATIVE");

        let state = ctx.accounts.state.load()?;
        let mut swapline = ctx.accounts.swapline.load_mut()?;

        require!(!swapline.halted, Halted);

        let mut assets_list = ctx.accounts.assets_list.load_mut()?;
        let (_, collaterals, synthetics) = assets_list.split_borrow();

        let synthetic = synthetics
            .iter_mut()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();
        let collateral = collaterals
            .iter_mut()
            .find(|x| {
                x.collateral_address
                    .eq(&ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        require!(
            synthetic.asset_index == collateral.asset_index,
            MismatchedTokens
        );

        let amount = Decimal {
            val: amount.into(),
            scale: synthetic.supply.scale,
        };
        // fee is removed from synthetic supply
        // this causes pro rata distribution to stakers
        let fee = amount.mul(swapline.fee);
        let amount_out = amount.sub(fee).unwrap().to_scale(swapline.balance.scale);
        let new_supply_synthetic = synthetic.supply.sub(amount).unwrap();

        set_synthetic_supply(synthetic, new_supply_synthetic).unwrap();
        synthetic.swapline_supply = synthetic.swapline_supply.sub(amount).unwrap();
        swapline.balance = swapline.balance.sub(amount_out).unwrap();

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        // Burn user synthetic
        let cpi_ctx_burn: CpiContext<Burn> = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::burn(cpi_ctx_burn, amount.to_u64())?;
        // Transfer native token to exchange
        let cpi_accounts = Transfer {
            from: ctx.accounts.collateral_reserve.to_account_info(),
            to: ctx.accounts.user_collateral_account.to_account_info(),
            authority: ctx.accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx_transfer = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
        token::transfer(cpi_ctx_transfer, amount_out.to_u64())?;

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state) admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn create_vault(
        ctx: Context<CreateVault>,
        bump: u8,
        debt_interest_rate: Decimal,
        collateral_ratio: Decimal,
        max_borrow: Decimal,
        liquidation_threshold: Decimal,
        penalty_to_liquidator: Decimal,
        penalty_to_exchange: Decimal,
        liquidation_ratio: Decimal,
    ) -> Result<()> {
        msg!("Synthetify: CREATE VAULT");

        let mut vault = ctx.accounts.vault.load_init()?;
        let assets_list = ctx.accounts.assets_list.load()?;
        let timestamp = Clock::get()?.unix_timestamp;

        let synthetic = assets_list
            .synthetics
            .iter()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();
        let collateral = assets_list.collaterals.iter().find(|x| {
            x.collateral_address
                .eq(ctx.accounts.collateral.to_account_info().key)
        });
        if collateral == None {
            return Err(ErrorCode::NoAssetFound.into());
        }
        let collateral = collateral.unwrap();

        require!(
            collateral_ratio.lte(Decimal::from_percent(100))?,
            ParameterOutOfRange
        );
        // Init vault struct
        {
            vault.bump = bump;
            vault.halted = false;
            vault.synthetic = *ctx.accounts.synthetic.to_account_info().key;
            vault.collateral = *ctx.accounts.collateral.to_account_info().key;
            vault.debt_interest_rate = debt_interest_rate;
            vault.collateral_ratio = collateral_ratio;
            vault.accumulated_interest = Decimal::new(0, synthetic.max_supply.scale);
            vault.accumulated_interest_rate = Decimal::from_integer(1).to_interest_rate();
            vault.mint_amount = Decimal::new(0, synthetic.max_supply.scale);
            vault.collateral_amount = Decimal::new(0, collateral.reserve_balance.scale);
            vault.max_borrow = max_borrow;
            vault.collateral_reserve = *ctx.accounts.collateral_reserve.to_account_info().key;
            vault.last_update = timestamp;
            // Liquidation parameters
            vault.liquidation_threshold = liquidation_threshold;
            vault.liquidation_ratio = liquidation_ratio;
            vault.liquidation_penalty_liquidator = penalty_to_liquidator;
            vault.liquidation_penalty_exchange = penalty_to_exchange;
        }

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn create_vault_entry(ctx: Context<CreateVaultEntry>, bump: u8) -> Result<()> {
        let timestamp = Clock::get()?.unix_timestamp;

        let mut vault_entry = ctx.accounts.vault_entry.load_init()?;
        let mut vault = ctx.accounts.vault.load_mut()?;
        let assets_list = ctx.accounts.assets_list.load()?;

        let synthetic = assets_list
            .synthetics
            .iter()
            .find(|x| x.asset_address.eq(&vault.synthetic))
            .unwrap();
        let collateral = assets_list
            .collaterals
            .iter()
            .find(|x| x.collateral_address.eq(&vault.collateral))
            .unwrap();

        adjust_vault_interest_rate(&mut vault, timestamp);
        // Init vault entry
        {
            vault_entry.bump = bump;
            vault_entry.owner = *ctx.accounts.owner.key;
            vault_entry.vault = *ctx.accounts.vault.to_account_info().key;
            vault_entry.last_accumulated_interest_rate = vault.accumulated_interest_rate;
            vault_entry.synthetic_amount = Decimal::new(0, synthetic.max_supply.scale);
            vault_entry.collateral_amount = Decimal::new(0, collateral.reserve_balance.scale);
        }

        Ok(())
    }

    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn deposit_vault(ctx: Context<DepositVault>, amount: u64) -> Result<()> {
        msg!("Synthetify: DEPOSIT VAULT");
        let timestamp = Clock::get()?.unix_timestamp;

        let state = &ctx.accounts.state.load()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let vault_entry = &mut ctx.accounts.vault_entry.load_mut()?;
        let vault = &mut ctx.accounts.vault.load_mut()?;
        let (_, collaterals, synthetics) = assets_list.split_borrow();

        let collateral = collaterals
            .iter()
            .find(|x| {
                x.collateral_address
                    .eq(ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        let synthetic = synthetics
            .iter_mut()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        let amount_decimal = Decimal {
            val: amount.into(),
            scale: collateral.reserve_balance.scale,
        };
        vault_entry.collateral_amount = vault_entry.collateral_amount.add(amount_decimal)?;
        vault.collateral_amount = vault.collateral_amount.add(amount_decimal)?;

        // Transfer token
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn borrow_vault(ctx: Context<BorrowVault>, amount: u64) -> Result<()> {
        msg!("Synthetify: BORROW VAULT");
        let timestamp = Clock::get()?.unix_timestamp;
        let slot = Clock::get()?.slot;

        let state = ctx.accounts.state.load()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let vault_entry = &mut ctx.accounts.vault_entry.load_mut()?;
        let vault = &mut ctx.accounts.vault.load_mut()?;
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        let synthetic_position = synthetics
            .iter_mut()
            .position(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();

        let collateral_position = collaterals
            .iter()
            .position(|x| {
                x.collateral_address
                    .eq(ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        let synthetic = &mut synthetics[synthetic_position];
        let collateral = &mut collaterals[collateral_position];
        let synthetic_asset = assets[synthetic.asset_index as usize];
        let collateral_asset = assets[collateral.asset_index as usize];

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        if (synthetic_asset.last_update as u64) < slot - state.max_delay as u64 {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        if (collateral_asset.last_update as u64) < slot - state.max_delay as u64 {
            return Err(ErrorCode::OutdatedOracle.into());
        }

        let amount_borrow_limit = calculate_vault_borrow_limit(
            collateral_asset,
            synthetic_asset,
            *synthetic,
            vault_entry.collateral_amount,
            vault.collateral_ratio,
        );

        let borrow_amount = match amount {
            u64::MAX => amount_borrow_limit
                .sub(vault_entry.synthetic_amount)
                .unwrap(),
            _ => Decimal::new(amount.into(), synthetic.supply.scale),
        };
        let amount_after_borrow = vault_entry.synthetic_amount.add(borrow_amount).unwrap();
        if amount_borrow_limit.lt(amount_after_borrow)? {
            return Err(ErrorCode::UserBorrowLimit.into());
        }

        // update vault
        let new_mint_amount = vault.mint_amount.add(borrow_amount).unwrap();
        set_new_vault_mint_amount(vault, new_mint_amount)?;

        // update vault_entry
        vault_entry.synthetic_amount = amount_after_borrow;

        // update synthetic
        synthetic.borrowed_supply = synthetic.borrowed_supply.add(borrow_amount)?;
        let new_synthetic_supply = synthetic.supply.add(borrow_amount).unwrap();
        set_synthetic_supply(synthetic, new_synthetic_supply)?;

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let mint_cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::mint_to(mint_cpi_ctx, borrow_amount.to_u64())?;

        Ok(())
    }

    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn withdraw_vault(ctx: Context<WithdrawVault>, amount: u64) -> Result<()> {
        msg!("Synthetify: WITHDRAW_VAULT");

        let timestamp = Clock::get()?.unix_timestamp;

        let state = ctx.accounts.state.load()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let vault_entry = &mut ctx.accounts.vault_entry.load_mut()?;
        let vault = &mut ctx.accounts.vault.load_mut()?;
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        let synthetic_position = synthetics
            .iter_mut()
            .position(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();

        let collateral_position = collaterals
            .iter()
            .position(|x| {
                x.collateral_address
                    .eq(ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        let synthetic_asset = assets[synthetics[synthetic_position].asset_index as usize];
        let collateral_asset = assets[collaterals[collateral_position].asset_index as usize];
        let synthetic = &mut synthetics[synthetic_position];

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        let vault_withdraw_limit = calculate_vault_withdraw_limit(
            collateral_asset,
            synthetic_asset,
            vault_entry.collateral_amount,
            vault_entry.synthetic_amount,
            vault.collateral_ratio,
        )
        .unwrap();

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        let amount_to_withdraw = match amount {
            u64::MAX => vault_withdraw_limit,
            _ => Decimal::new(amount as u128, vault_entry.collateral_amount.scale),
        };

        if amount_to_withdraw.gt(vault_withdraw_limit)? {
            return Err(ErrorCode::VaultWithdrawLimit.into());
        }

        // update vault, vault_entry balances
        vault.collateral_amount = vault.collateral_amount.sub(amount_to_withdraw).unwrap();
        vault_entry.collateral_amount = vault_entry
            .collateral_amount
            .sub(amount_to_withdraw)
            .unwrap();

        // Send withdrawn collateral to user
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::transfer(cpi_ctx, amount_to_withdraw.val.try_into().unwrap())?;

        Ok(())
    }

    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn repay_vault(ctx: Context<RepayVault>, amount: u64) -> Result<()> {
        msg!("Synthetify: REPAY_VAULT");

        let timestamp = Clock::get()?.unix_timestamp;

        let state = ctx.accounts.state.load()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let vault_entry = &mut ctx.accounts.vault_entry.load_mut()?;
        let vault = &mut ctx.accounts.vault.load_mut()?;
        let (_, _, synthetics) = assets_list.split_borrow();

        let synthetic = synthetics
            .iter_mut()
            .find(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        // determine repay_amount
        let mut repay_amount = match amount {
            u64::MAX => vault_entry.synthetic_amount,
            _ => Decimal::new(amount.into(), vault_entry.synthetic_amount.scale),
        };

        if repay_amount.gt(vault_entry.synthetic_amount)? {
            repay_amount = vault_entry.synthetic_amount;
        };

        // update synthetic, vault, vault_entry supply
        vault.mint_amount = vault.mint_amount.sub(repay_amount).unwrap();
        vault_entry.synthetic_amount = vault_entry.synthetic_amount.sub(repay_amount).unwrap();
        synthetic.supply = synthetic.supply.sub(repay_amount).unwrap();
        synthetic.borrowed_supply = synthetic.borrowed_supply.sub(repay_amount).unwrap();

        // burn tokens
        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer = &[&seeds[..]];
        let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
        token::burn(cpi_ctx, repay_amount.to_u64())?;

        Ok(())
    }
    #[access_control(halted(&ctx.accounts.state) vault_halted(&ctx.accounts.vault))]
    pub fn liquidate_vault(ctx: Context<LiquidateVault>, amount: u64) -> Result<()> {
        msg!("Synthetify: LIQUIDATE VAULT");

        let timestamp = Clock::get()?.unix_timestamp;
        let slot = Clock::get()?.slot;

        let state = ctx.accounts.state.load()?;
        let assets_list = &mut ctx.accounts.assets_list.load_mut()?;
        let vault_entry = &mut ctx.accounts.vault_entry.load_mut()?;
        let vault = &mut ctx.accounts.vault.load_mut()?;
        let (assets, collaterals, synthetics) = assets_list.split_borrow();

        let synthetic_position = synthetics
            .iter_mut()
            .position(|x| {
                x.asset_address
                    .eq(ctx.accounts.synthetic.to_account_info().key)
            })
            .unwrap();

        let collateral_position = collaterals
            .iter()
            .position(|x| {
                x.collateral_address
                    .eq(ctx.accounts.collateral.to_account_info().key)
            })
            .unwrap();

        let synthetic = &mut synthetics[synthetic_position];
        let collateral = &mut collaterals[collateral_position];
        let synthetic_asset = &assets[synthetic.asset_index as usize];
        let collateral_asset = &assets[collateral.asset_index as usize];

        adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

        if (synthetic_asset.last_update as u64) < slot.checked_sub(state.max_delay as u64).unwrap()
        {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        if (collateral_asset.last_update as u64) < slot.checked_sub(state.max_delay as u64).unwrap()
        {
            return Err(ErrorCode::OutdatedOracle.into());
        }

        // Amount of synthetic safely collateralized
        let amount_liquidation_limit = calculate_vault_borrow_limit(
            *collateral_asset,
            *synthetic_asset,
            *synthetic,
            vault_entry.collateral_amount,
            vault.liquidation_threshold,
        );
        // Fail if user is safe
        require!(
            amount_liquidation_limit
                .lt(vault_entry.synthetic_amount)
                .unwrap(),
            InvalidLiquidation
        );
        // Amount of synthetic to repay
        // U64::MAX mean debt * liquidation_ratio (percent of position able to liquidate in single liquidation)
        let liquidation_amount = match amount {
            u64::MAX => vault_entry.synthetic_amount.mul(vault.liquidation_ratio),
            _ => Decimal::new(amount.into(), vault_entry.synthetic_amount.scale),
        };
        // Fail if liquidator wants to liquidate more than allowed number
        require!(
            liquidation_amount
                .lte(vault_entry.synthetic_amount.mul(vault.liquidation_ratio))
                .unwrap(),
            InvalidLiquidation
        );
        // Amount seized in usd
        let seized_collateral_in_usd = liquidation_amount
            .mul_up(
                vault
                    .liquidation_penalty_liquidator
                    .add(vault.liquidation_penalty_exchange)
                    .unwrap(),
            )
            .add(liquidation_amount)
            .unwrap()
            .mul(synthetic_asset.price);

        // Amount seized in token
        let seized_collateral_in_token = usd_to_token_amount(
            &collateral_asset,
            seized_collateral_in_usd,
            collateral.reserve_balance.scale,
        );

        let collateral_to_exchange = seized_collateral_in_token
            .mul(vault.liquidation_penalty_exchange)
            .div_up(
                Decimal::from_percent(100)
                    .add(vault.liquidation_penalty_liquidator)
                    .unwrap()
                    .add(vault.liquidation_penalty_exchange)
                    .unwrap(),
            );

        let collateral_to_liquidator = seized_collateral_in_token
            .sub(collateral_to_exchange)
            .unwrap();

        // Adjust vault_entry variables
        vault_entry.collateral_amount = vault_entry
            .collateral_amount
            .sub(seized_collateral_in_token)
            .unwrap();

        vault_entry.synthetic_amount = vault_entry
            .synthetic_amount
            .sub(liquidation_amount)
            .unwrap();
        // Adjust vault variables
        vault.collateral_amount = vault
            .collateral_amount
            .sub(seized_collateral_in_token)
            .unwrap();
        vault.mint_amount = vault.mint_amount.sub(liquidation_amount).unwrap();
        // Change supply of burned synthetic
        set_synthetic_supply(synthetic, synthetic.supply.sub(liquidation_amount).unwrap()).unwrap();

        let seeds = &[SYNTHETIFY_EXCHANGE_SEED.as_bytes(), &[state.nonce]];
        let signer_seeds = &[&seeds[..]];
        {
            // Transfer collateral to liquidator
            let liquidator_accounts = Transfer {
                from: ctx.accounts.collateral_reserve.to_account_info(),
                to: ctx.accounts.liquidator_collateral_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let transfer =
                CpiContext::new(token_program, liquidator_accounts).with_signer(signer_seeds);
            token::transfer(transfer, collateral_to_liquidator.to_u64())?;
        }
        {
            if !ctx
                .accounts
                .liquidation_fund
                .to_account_info()
                .key
                .eq(&collateral.liquidation_fund)
            {
                return Err(ErrorCode::ExchangeLiquidationAccount.into());
            }
            // Transfer collateral to liquidation_fund
            let exchange_accounts = Transfer {
                from: ctx.accounts.collateral_reserve.to_account_info(),
                to: ctx.accounts.liquidation_fund.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let transfer =
                CpiContext::new(token_program, exchange_accounts).with_signer(signer_seeds);
            token::transfer(transfer, collateral_to_exchange.try_into().unwrap())?;
        }
        {
            // Burn repaid synthetic
            let exchange_accounts = Burn {
                mint: ctx.accounts.synthetic.to_account_info(),
                to: ctx.accounts.liquidator_synthetic_account.to_account_info(),
                authority: ctx.accounts.exchange_authority.to_account_info(),
            };
            let token_program = ctx.accounts.token_program.to_account_info();
            let burn = CpiContext::new(token_program, exchange_accounts).with_signer(signer_seeds);
            token::burn(burn, liquidation_amount.to_u64())?;
        }
        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_vault_halted(ctx: Context<SetVaultHalted>, halted: bool) -> Result<()> {
        msg!("Synthetify:Admin: SET VAULT HALTED");
        let vault = &mut ctx.accounts.vault.load_mut()?;
        vault.halted = halted;

        Ok(())
    }

    #[access_control(admin(&ctx.accounts.state, &ctx.accounts.admin))]
    pub fn set_vault_collateral_ratio(
        ctx: Context<SetVaultParameter>,
        collateral_ratio: Decimal,
    ) -> Result<()> {
        msg!("Synthetify:Admin: SET VAULT COLLATERAL RATIO");
        let vault = &mut ctx.accounts.vault.load_mut()?;

        // collateral_ratio must be less or equals 100%
        let same_scale = vault.collateral_ratio.scale == collateral_ratio.scale;
        let in_range = collateral_ratio.lte(Decimal::from_percent(100))?;
        require!(same_scale && in_range, ParameterOutOfRange);

        vault.collateral_ratio = collateral_ratio;
        Ok(())
    }
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
    #[msg("Tokens does not represent same asset")]
    MismatchedTokens = 30,
    #[msg("Limit crossed")]
    SwaplineLimit = 31,
    #[msg("Limit of collateral exceeded")]
    CollateralLimitExceeded = 32,
    #[msg("User borrow limit")]
    UserBorrowLimit = 33,
    #[msg("Vault borrow limit")]
    VaultBorrowLimit = 34,
    #[msg("Vault withdraw limit")]
    VaultWithdrawLimit = 35,
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
// Vault containers
fn vault_halted<'info>(vault_loader: &Loader<Vault>) -> Result<()> {
    let vault = vault_loader.load()?;
    require!(!vault.halted, Halted);
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
            let price = Decimal::from_price(2);
            assets_list.append_asset(Asset {
                price: price,
                ..Default::default()
            });
            assert_eq!({ assets_list.assets[0].price }, price);
            assert_eq!(assets_list.head_assets, 1);
            assert_eq!(assets_list.head_collaterals, 0);
            assert_eq!(assets_list.head_synthetics, 0);
            let price2 = Decimal::from_price(3);
            assets_list.append_asset(Asset {
                price: price2,
                ..Default::default()
            });
            assert_eq!({ assets_list.assets[1].price }, price2);
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
        let price = Decimal::from_price(2);
        assets_list.append_asset(Asset {
            price: price,
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

        assert_eq!({ assets[0].price }, price);
        assert_eq!(collaterals[0].asset_index, 0);
        assert_eq!(synthetics[0].asset_index, 0);
    }
}
