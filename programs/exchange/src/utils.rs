use std::borrow::BorrowMut;
use std::cell::RefMut;
use std::convert::TryInto;
use std::str::FromStr;

use crate::decimal::{Add, Compare, Div, Mul, MulUp, PowAccuracy, Sub, PRICE_SCALE};
use crate::math::{calculate_compounded_interest, calculate_debt, calculate_minute_interest_rate};
use crate::*;
use account::*;

pub fn check_feed_update(
    assets: &[Asset],
    index_a: usize,
    index_b: usize,
    max_delay: u32,
    slot: u64,
) -> Result<()> {
    // Check assetA
    if assets[index_a].last_update < slot.checked_sub(max_delay.into()).unwrap() {
        return Err(ErrorCode::OutdatedOracle.into());
    }
    // Check assetB
    if assets[index_b].last_update < slot.checked_sub(max_delay.into()).unwrap() {
        return Err(ErrorCode::OutdatedOracle.into());
    }
    return Ok(());
}

pub fn check_value_collateral_price_feed(
    collateral_price_feed: &AccountInfo,
    oracle_type: u8,
) -> Result<()> {
    let oracle_type = to_oracle_type(oracle_type)?;
    match oracle_type {
        OracleType::Pyth => {
            require!(
                collateral_price_feed.key() == Pubkey::default()
                    || (collateral_price_feed.owner == &oracle::oracle::ID
                        && collateral_price_feed.data_len() == 3312),
                InvalidOracleProgram
            );
        }
        _ => {
            return Err(ErrorCode::InvalidOracleType.into());
        }
    }

    Ok(())
}

pub fn load_price_from_feed(
    price_feed: &AccountInfo,
    oracle_type: u8,
    assets: &[Asset; 255],
) -> Result<Decimal> {
    if price_feed.key().eq(&Pubkey::default()) {
        let asset = match assets.iter().find(|x| x.feed_address.eq(&price_feed.key())) {
            Some(a) => a,
            None => return Err(ErrorCode::NoAssetFound.into()),
        };

        return Ok(asset.price);
    }

    let oracle_type = to_oracle_type(oracle_type)?;
    match oracle_type {
        OracleType::Pyth => {
            let loaded_price = load_pyth_price(price_feed)?;
            Ok(loaded_price)
        }
        _ => {
            return Err(ErrorCode::InvalidOracleType.into());
        }
    }
}
pub fn load_pyth_price(price_feed_account: &AccountInfo) -> Result<Decimal> {
    let price_feed = Price::load(price_feed_account)?;
    let offset = price_feed.expo.checked_add(PRICE_SCALE.into()).unwrap();

    let scaled_price = match offset >= 0 {
        true => price_feed
            .agg
            .price
            .checked_mul(10i64.pow(offset.try_into().unwrap()))
            .unwrap(),
        false => price_feed
            .agg
            .price
            .checked_div(10i64.pow((-offset).try_into().unwrap()))
            .unwrap(),
    };
    let scaled_confidence = match offset >= 0 {
        true => price_feed
            .agg
            .conf
            .checked_mul(10u64.pow(offset.try_into().unwrap()))
            .unwrap(),
        false => price_feed
            .agg
            .conf
            .checked_div(10u64.pow((-offset).try_into().unwrap()))
            .unwrap(),
    };
    // validate price confidence - confidence/price ratio should be less than 2.5%
    let confidence: i64 = scaled_confidence.try_into().unwrap();
    let confidence_40x = confidence.checked_mul(40).unwrap();
    if confidence_40x > scaled_price {
        let luna_oracle = Pubkey::from_str("5bmWuR1dgP4avtGYMNKLuxumZTVKGgoN2BCMXWDNL9nY").unwrap();
        if !price_feed_account.to_account_info().key.eq(&luna_oracle) {
            return Err(ErrorCode::PriceConfidenceOutOfRange.into());
        }
    };
    let price = Decimal::from_price(scaled_price.try_into().unwrap());

    return Ok(price);
}
pub fn div_up(a: u128, b: u128) -> u128 {
    return a
        .checked_add(b.checked_sub(1).unwrap())
        .unwrap()
        .checked_div(b)
        .unwrap();
}

pub fn adjust_staking_rounds(state: &mut State, slot: u64) {
    if slot <= state.staking.next_round.start {
        return;
    }
    let slot_diff = slot.checked_sub(state.staking.next_round.start).unwrap();
    let round_diff: u32 = div_up(slot_diff.into(), state.staking.round_length.into())
        .try_into()
        .unwrap();
    match round_diff {
        1 => {
            state.staking.finished_round = state.staking.current_round.clone();
            state.staking.current_round = state.staking.next_round.clone();
            state.staking.next_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(state.staking.round_length.into())
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            }
        }
        2 => {
            state.staking.finished_round = state.staking.next_round.clone();
            state.staking.current_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(state.staking.round_length.into())
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            };
            state.staking.next_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(state.staking.round_length.checked_mul(2).unwrap().into())
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            }
        }
        _ => {
            state.staking.finished_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(
                        state
                            .staking
                            .round_length
                            .checked_mul(round_diff.checked_sub(2).unwrap())
                            .unwrap()
                            .into(),
                    )
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            };
            state.staking.current_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(
                        state
                            .staking
                            .round_length
                            .checked_mul(round_diff.checked_sub(1).unwrap())
                            .unwrap()
                            .into(),
                    )
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            };
            state.staking.next_round = StakingRound {
                start: state
                    .staking
                    .next_round
                    .start
                    .checked_add(
                        state
                            .staking
                            .round_length
                            .checked_mul(round_diff)
                            .unwrap()
                            .into(),
                    )
                    .unwrap(),
                all_points: state.debt_shares,
                amount: state.staking.amount_per_round,
            }
        }
    }
    return;
}
pub fn adjust_staking_account(exchange_account: &mut ExchangeAccount, staking: &Staking) {
    if exchange_account.user_staking_data.last_update >= staking.current_round.start {
        return;
    } else {
        if exchange_account.user_staking_data.last_update < staking.finished_round.start {
            exchange_account.user_staking_data.finished_round_points = exchange_account.debt_shares;
            exchange_account.user_staking_data.current_round_points = exchange_account.debt_shares;
            exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
        } else {
            exchange_account.user_staking_data.finished_round_points =
                exchange_account.user_staking_data.current_round_points;
            exchange_account.user_staking_data.current_round_points =
                exchange_account.user_staking_data.next_round_points;
            exchange_account.user_staking_data.next_round_points = exchange_account.debt_shares;
        }
    }

    exchange_account.user_staking_data.last_update =
        staking.current_round.start.checked_add(1).unwrap();
    return;
}

pub fn calculate_debt_with_adjustment(
    state: &mut State,
    assets_list: &mut RefMut<AssetsList>,
    slot: u64,
    timestamp: i64,
) -> Result<Decimal> {
    adjust_interest_debt(state, assets_list, slot, timestamp);
    Ok(calculate_debt(assets_list, slot, state.max_delay, false).unwrap())
}

pub fn adjust_interest_debt(
    state: &mut State,
    assets_list: &mut RefMut<AssetsList>,
    slot: u64,
    timestamp: i64,
) {
    const ADJUSTMENT_PERIOD: i64 = 60;
    let diff = timestamp
        .checked_sub(state.last_debt_adjustment)
        .unwrap()
        .checked_div(ADJUSTMENT_PERIOD)
        .unwrap();
    if diff >= 1 {
        let total_debt_twap = calculate_debt(assets_list, slot, state.max_delay, true).unwrap();
        let minute_interest_rate = calculate_minute_interest_rate(state.debt_interest_rate);
        let compounded_interest = calculate_compounded_interest(
            total_debt_twap,
            minute_interest_rate,
            diff.try_into().unwrap(),
        );
        let usd = &mut assets_list.borrow_mut().synthetics[0];

        // increase in interest supply may exceed the max supply limit
        usd.supply = usd.supply.add(compounded_interest).unwrap();
        state.accumulated_debt_interest = state
            .accumulated_debt_interest
            .add(compounded_interest)
            .unwrap();
        state.last_debt_adjustment = diff
            .checked_mul(ADJUSTMENT_PERIOD)
            .unwrap()
            .checked_add(state.last_debt_adjustment)
            .unwrap();
    }
}

pub fn adjust_vault_interest_rate(vault: &mut Vault, timestamp: i64) {
    const ADJUSTMENT_PERIOD: i64 = 60;
    let diff = timestamp
        .checked_sub(vault.last_update)
        .unwrap()
        .checked_div(ADJUSTMENT_PERIOD)
        .unwrap();

    if diff >= 1 {
        let minute_interest_rate = calculate_minute_interest_rate(vault.debt_interest_rate);
        let one = Decimal::from_integer(1).to_interest_rate();
        let base = minute_interest_rate.add(one).unwrap();
        let time_period_interest = base.pow_with_accuracy(diff.try_into().unwrap());

        vault.accumulated_interest_rate = vault.accumulated_interest_rate.mul(time_period_interest);
        vault.last_update = diff
            .checked_mul(ADJUSTMENT_PERIOD)
            .unwrap()
            .checked_add(vault.last_update)
            .unwrap();
    }
}
pub fn adjust_vault_entry_interest_debt(
    vault: &mut Vault,
    vault_entry: &mut VaultEntry,
    synthetic: &mut Synthetic,
    timestamp: i64,
) {
    adjust_vault_interest_rate(vault, timestamp);
    let interest_denominator = vault_entry.last_accumulated_interest_rate;
    let interest_nominator = vault.accumulated_interest_rate;

    if interest_nominator == interest_denominator {
        return;
    }

    let interest_debt_diff = interest_nominator.div(interest_denominator);
    let new_synthetic_amount = vault_entry.synthetic_amount.mul_up(interest_debt_diff);
    let additional_tokens = new_synthetic_amount
        .sub(vault_entry.synthetic_amount)
        .unwrap();

    // increase in interest supply may exceed the max supply limit
    // increase synthetic supply
    synthetic.supply = synthetic.supply.add(additional_tokens).unwrap();
    // increase synthetic borrowed_supply
    synthetic.borrowed_supply = synthetic.borrowed_supply.add(additional_tokens).unwrap();
    // increase vault accumulated_interest
    vault.accumulated_interest = vault.accumulated_interest.add(additional_tokens).unwrap();
    // increase vault mint_amount
    vault.mint_amount = vault.mint_amount.add(additional_tokens).unwrap();
    // increase vault entry synthetic_amount
    vault_entry.synthetic_amount = new_synthetic_amount;
    // commit adjustment by setting interest nominator as new interest denominator
    vault_entry.last_accumulated_interest_rate = interest_nominator;
}
impl Synthetic {
    pub fn set_supply_safely(self: &mut Self, new_supply: Decimal) -> ProgramResult {
        // increase can throw error
        if new_supply.gt(self.supply)? && new_supply.gt(self.max_supply)? {
            return Err(ErrorCode::MaxSupply.into());
        }
        // decrease is always safe
        self.supply = new_supply;
        Ok(())
    }
}
impl Vault {
    pub fn set_mint_amount_safely(self: &mut Self, new_mint_amount: Decimal) -> ProgramResult {
        // increase can throw error
        if new_mint_amount.gt(self.mint_amount)? && new_mint_amount.gt(self.max_borrow)? {
            return Err(ErrorCode::VaultBorrowLimit.into());
        }
        // decrease is always safe
        self.mint_amount = new_mint_amount;
        Ok(())
    }
}
impl VaultEntry {
    pub fn decrease_supply_cascade(
        self: &mut Self,
        vault: &mut Vault,
        synthetic: &mut Synthetic,
        burn_amount: Decimal,
    ) -> ProgramResult {
        // decrease is always safe
        // decrease vault_entry supply
        self.synthetic_amount = self.synthetic_amount.sub(burn_amount).unwrap();
        // decrease vault supply
        vault.mint_amount = vault.mint_amount.sub(burn_amount).unwrap();
        // decrease borrowed synthetic supply
        synthetic.borrowed_supply = synthetic.borrowed_supply.sub(burn_amount).unwrap();
        // decrease synthetic supply
        synthetic.supply = synthetic.supply.sub(burn_amount).unwrap();
        Ok(())
    }
    pub fn increase_supply_cascade(
        self: &mut Self,
        vault: &mut Vault,
        synthetic: &mut Synthetic,
        mint_amount: Decimal,
    ) -> ProgramResult {
        // increase can throw limit error
        // increase vault_entry supply
        self.synthetic_amount = self.synthetic_amount.add(mint_amount).unwrap();
        // increase vault supply
        let new_mint_amount = vault.mint_amount.add(mint_amount).unwrap();
        vault.set_mint_amount_safely(new_mint_amount)?;
        // increase borrowed synthetic supply
        synthetic.borrowed_supply = synthetic.borrowed_supply.add(mint_amount).unwrap();
        // increase synthetic supply
        let new_synthetic_supply = synthetic.supply.add(mint_amount).unwrap();
        synthetic.set_supply_safely(new_synthetic_supply)?;
        Ok(())
    }
}
pub fn get_user_sny_collateral_balance(
    exchange_account: &ExchangeAccount,
    sny_asset: &Collateral,
) -> Decimal {
    let entry = exchange_account
        .collaterals
        .iter()
        .find(|x| x.collateral_address.eq(&sny_asset.collateral_address));
    match entry {
        Some(x) => return Decimal::from_sny(x.amount.into()),
        None => return Decimal::from_sny(0),
    }
}
pub enum OracleType {
    Pyth = 0,
    Chainlink = 1,
}
pub fn to_oracle_type(value: u8) -> Result<OracleType> {
    match value {
        0 => Ok(OracleType::Pyth),
        1 => Ok(OracleType::Chainlink),
        _ => Err(ErrorCode::InvalidOracleType.into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, u64};

    #[test]
    fn adjust_staking_account_test() {
        let staking_round_length = 100;
        let amount_per_round = Decimal::from_sny(300);
        let slot = 12u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 1,
                amount: Decimal::from_sny(0),
                start: slot,
            },
            current_round: StakingRound {
                all_points: 2,
                amount: Decimal::from_sny(0),
                start: slot.checked_add(staking_round_length.into()).unwrap(),
            },
            next_round: StakingRound {
                all_points: 3,
                amount: amount_per_round,
                start: slot
                    .checked_add(staking_round_length.into())
                    .unwrap()
                    .checked_add(staking_round_length.into())
                    .unwrap(),
            },
            ..Default::default()
        };
        {
            // Last update before finished round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                // collateral_shares: 100,
                head: 1,
                user_staking_data: UserStaking {
                    amount_to_claim: Decimal::from_sny(0),
                    finished_round_points: 2,
                    current_round_points: 5,
                    next_round_points: 10,
                    last_update: slot - 1,
                },
                ..Default::default()
            };
            let exchange_account_copy = exchange_account.clone();
            adjust_staking_account(&mut exchange_account, &staking);
            assert_ne!(
                exchange_account.user_staking_data,
                exchange_account_copy.user_staking_data
            );
            assert_eq!(
                { exchange_account.user_staking_data.finished_round_points },
                { exchange_account.debt_shares }
            );
            assert_eq!(
                { exchange_account.user_staking_data.current_round_points },
                { exchange_account.debt_shares }
            );
            assert_eq!({ exchange_account.user_staking_data.next_round_points }, {
                exchange_account.debt_shares
            });
            assert_eq!({ exchange_account.user_staking_data.last_update }, {
                staking.current_round.start + 1
            });
        }
        {
            // Last update before current round but after finished round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                user_staking_data: UserStaking {
                    amount_to_claim: Decimal::from_sny(0),
                    finished_round_points: 2,
                    current_round_points: 5,
                    next_round_points: 10,
                    last_update: slot + 1,
                },
                ..Default::default()
            };
            let exchange_account_copy = exchange_account.clone();
            adjust_staking_account(&mut exchange_account, &staking);
            assert_ne!(
                exchange_account.user_staking_data,
                exchange_account_copy.user_staking_data
            );
            assert_eq!(
                { exchange_account.user_staking_data.finished_round_points },
                { exchange_account_copy.user_staking_data.current_round_points }
            );
            assert_eq!(
                { exchange_account.user_staking_data.current_round_points },
                { exchange_account_copy.user_staking_data.next_round_points }
            );
            assert_eq!({ exchange_account.user_staking_data.next_round_points }, {
                exchange_account.debt_shares
            });
            assert_eq!({ exchange_account.user_staking_data.last_update }, {
                staking.current_round.start + 1
            });
        }
        {
            // Last update in current round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                user_staking_data: UserStaking {
                    amount_to_claim: Decimal::from_sny(0),
                    finished_round_points: 2,
                    current_round_points: 5,
                    next_round_points: 10,
                    last_update: slot + staking_round_length as u64 + 1,
                },
                ..Default::default()
            };
            let exchange_account_copy = exchange_account.clone();
            adjust_staking_account(&mut exchange_account, &staking);
            assert_eq!(
                exchange_account.user_staking_data,
                exchange_account_copy.user_staking_data
            );
        }
    }
    #[test]
    fn adjust_staking_rounds_with_fixed_round_length_test() {
        let staking_round_length = 100;
        let amount_per_round = Decimal::from_sny(300);
        let debt_shares = 999u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: 0,
            },
            current_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: staking_round_length.into(),
            },
            next_round: StakingRound {
                all_points: 0,
                amount: amount_per_round,
                start: (staking_round_length * 2).into(),
            },
            ..Default::default()
        };
        let original_state = State {
            debt_shares: debt_shares,
            staking: staking,
            ..Default::default()
        };
        {
            // Should stay same
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 150);
            assert_eq!(adjusted_state, original_state);
        }
        {
            // Should stay same
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 200);
            assert_eq!(adjusted_state, original_state);
        }
        {
            // Should move one round forward
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 201);
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                original_state.staking.current_round
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                original_state.staking.next_round
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: 300,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
        {
            // Should move one round forward
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 300);
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                original_state.staking.current_round
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                original_state.staking.next_round
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: 300,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
        {
            // Should move two rounds forward
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 301);
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                original_state.staking.next_round
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                StakingRound {
                    start: 300,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: 400,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
        {
            // Should move three rounds forward
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 401);
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                StakingRound {
                    start: 300,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                StakingRound {
                    start: 400,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: 500,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
        {
            // Should move more than three rounds forward
            let mut adjusted_state = original_state.clone();
            // move seven rounds forward
            adjust_staking_rounds(&mut adjusted_state, 810);
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                StakingRound {
                    start: 700,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                StakingRound {
                    start: 800,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: 900,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
        {
            // Large numbers
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 1_287_161_137);
            let expected_finished_round_slot: u64 = 1287161000;
            assert_ne!(adjusted_state, original_state);
            assert_eq!(
                adjusted_state.staking.finished_round,
                StakingRound {
                    start: expected_finished_round_slot,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.current_round,
                StakingRound {
                    start: expected_finished_round_slot + staking_round_length as u64,
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
            assert_eq!(
                adjusted_state.staking.next_round,
                StakingRound {
                    start: expected_finished_round_slot + (staking_round_length as u64 * 2),
                    all_points: debt_shares,
                    amount: original_state.staking.amount_per_round,
                }
            );
        }
    }
    #[test]
    fn adjust_staking_rounds_with_variable_round_length_test() {
        let staking_round_length = 100;
        let amount_per_round = Decimal::from_sny(300);
        let debt_shares = 999u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: 0,
            },
            current_round: StakingRound {
                all_points: 0,
                amount: Decimal::from_sny(0),
                start: staking_round_length as u64,
            },
            next_round: StakingRound {
                all_points: 0,
                amount: amount_per_round,
                start: staking_round_length as u64 + staking_round_length as u64,
            },
            ..Default::default()
        };
        let original_state = State {
            debt_shares: debt_shares,
            staking: staking,
            ..Default::default()
        };
        {
            // Should move one round forward
            let mut adjusted_state = original_state.clone();
            adjust_staking_rounds(&mut adjusted_state, 201);
            // |    |   |
            // f    c   n
            // 100  200 300
            assert_ne!(original_state, adjusted_state);

            // Curly braces force copy and makes warning disappear
            assert_eq!({ adjusted_state.staking.finished_round.start }, {
                original_state.staking.current_round.start
            });
            assert_eq!({ adjusted_state.staking.current_round.start }, {
                original_state.staking.next_round.start
            });
            assert_eq!({ adjusted_state.staking.next_round.start }, {
                original_state.staking.next_round.start + staking_round_length as u64
            });
            // change round length

            adjusted_state.staking.round_length = 25;
            adjust_staking_rounds(&mut adjusted_state, 401);
            assert_eq!(375, { adjusted_state.staking.finished_round.start });
            assert_eq!(400, { adjusted_state.staking.current_round.start });
            assert_eq!(425, { adjusted_state.staking.next_round.start });
        }
    }
    #[test]
    fn test_check_feed_update() {
        let mut list = AssetsList {
            ..Default::default()
        };
        list.append_asset(Asset {
            last_update: 10,
            ..Default::default()
        });
        list.append_asset(Asset {
            last_update: 10,
            ..Default::default()
        });

        // Outdated
        assert!(check_feed_update(&list.assets, 0, 1, 10, 100).is_err());
        // Outdated a little
        assert!(check_feed_update(&list.assets, 0, 1, 10, 21).is_err());
        // On the limit
        assert!(check_feed_update(&list.assets, 0, 1, 10, 20).is_ok());
        // No tolerance
        assert!(check_feed_update(&list.assets, 0, 1, 0, 10).is_ok());
    }
    #[test]
    fn test_get_user_sny_collateral_balance() {
        let sny_address = Pubkey::new_unique();
        let sny_asset = Collateral {
            collateral_address: sny_address,
            ..Default::default()
        };

        // Empty list
        {
            let exchange_account = ExchangeAccount {
                ..Default::default()
            };

            let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
            assert_eq!(amount, Decimal::from_sny(0))
        }
        // With other assets
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                collateral_address: Pubkey::new_unique(),
                amount: 100,
                ..Default::default()
            });
            exchange_account.append(CollateralEntry {
                collateral_address: sny_address,
                amount: 100,
                ..Default::default()
            });
            exchange_account.append(CollateralEntry {
                collateral_address: Pubkey::new_unique(),
                amount: 100,
                ..Default::default()
            });

            let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
            assert_eq!(amount, Decimal::from_sny(100))
        }
        // Without SNY
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                collateral_address: Pubkey::new_unique(),
                amount: 100,
                ..Default::default()
            });
            exchange_account.append(CollateralEntry {
                collateral_address: Pubkey::new_unique(),
                amount: 100,
                ..Default::default()
            });

            let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
            assert_eq!(amount, Decimal::from_sny(0))
        }
    }
    #[test]
    fn test_adjust_interest_debt() {
        // 1% debt interest rate
        let state = State {
            debt_interest_rate: Decimal::from_percent(1).to_interest_rate(),
            accumulated_debt_interest: Decimal::from_usd(0),
            last_debt_adjustment: 0,
            ..Default::default()
        };
        // slot and timestamp could be out of sync - no effect in this test
        let current_timestamp = 65;
        let current_slot = 100;

        let mut assets_list = AssetsList {
            ..Default::default()
        };
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(1).to_price(),
            twap: Decimal::from_integer(1).to_price(),
            last_update: current_slot,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            supply: Decimal::from_integer(100_000).to_usd(),
            swapline_supply: Decimal::from_usd(0),
            borrowed_supply: Decimal::from_usd(0),
            asset_index: assets_list.head_assets - 1,
            ..Default::default()
        });
        // single period adjustment
        {
            let mut state = state.clone();
            let assets_ref = RefCell::new(assets_list);
            // real     0.0019025... $
            // expected 0.001903     $
            adjust_interest_debt(
                &mut state,
                &mut assets_ref.borrow_mut(),
                current_slot,
                current_timestamp,
            );

            let usd = assets_ref.borrow().synthetics[0];
            assert_eq!(usd.supply, Decimal::from_usd(100_000_001_903));
            assert_eq!(state.accumulated_debt_interest, Decimal::from_usd(1903));
            assert_eq!({ state.last_debt_adjustment }, 60);
        }
        // multiple period adjustment
        {
            let current_timestamp = 120;
            let mut state = state.clone();
            let assets_ref = RefCell::new(assets_list);
            // real     0.0038051... $
            // expected 0.003806     $
            adjust_interest_debt(
                &mut state,
                &mut assets_ref.borrow_mut(),
                current_slot,
                current_timestamp,
            );

            let usd = assets_ref.borrow().synthetics[0];
            assert_eq!(usd.supply, Decimal::from_usd(100_000_003_806));
            assert_eq!(state.accumulated_debt_interest, Decimal::from_usd(3806));
            assert_eq!({ state.last_debt_adjustment }, 120);
        }
        // multiple adjustment
        {
            // timestamp adjustment points [90 -> 121 -> 183]
            let current_timestamp = 90;
            let mut state = state.clone();
            let assets_ref = RefCell::new(assets_list);
            adjust_interest_debt(
                &mut state,
                &mut assets_ref.borrow_mut(),
                current_slot,
                current_timestamp,
            );

            // real     0.0019025... $
            // expected 0.001903     $
            let usd = assets_ref.borrow().synthetics[0];
            assert_eq!(usd.supply, Decimal::from_usd(100_000_001_903));
            assert_eq!(state.accumulated_debt_interest, Decimal::from_usd(1903));
            assert_eq!({ state.last_debt_adjustment }, 60);

            let current_timestamp = 121;
            adjust_interest_debt(
                &mut state,
                &mut assets_ref.borrow_mut(),
                current_slot,
                current_timestamp,
            );

            // real     0.0038051... $
            // expected 0.003806     $
            let usd = assets_ref.borrow().synthetics[0];
            assert_eq!(usd.supply, Decimal::from_usd(100_000_003_806));
            assert_eq!(state.accumulated_debt_interest, Decimal::from_usd(3806));
            assert_eq!({ state.last_debt_adjustment }, 120);

            let current_timestamp = 183;
            adjust_interest_debt(
                &mut state,
                &mut assets_ref.borrow_mut(),
                current_slot,
                current_timestamp,
            );

            // real     0.005707... $
            // expected 0.005709    $
            let usd = assets_ref.borrow().synthetics[0];
            assert_eq!(usd.supply, Decimal::from_usd(100_000_005_709));
            assert_eq!(state.accumulated_debt_interest, Decimal::from_usd(5709));
            assert_eq!({ state.last_debt_adjustment }, 180);
        }
    }
    #[test]
    fn test_calculate_debt_with_interest_multi_adjustment() {
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };
            // 1% APR
            let mut state = State {
                debt_interest_rate: Decimal::new(1, 2).to_interest_rate(),
                accumulated_debt_interest: Decimal::from_usd(0),
                last_debt_adjustment: 0,
                ..Default::default()
            };

            // xusd - fixed price 1 USD
            // debt 100000
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(1).to_price(),
                twap: Decimal::from_integer(1).to_price(),
                last_update: slot,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000).to_usd(),
                swapline_supply: Decimal::from_integer(0).to_usd(),
                borrowed_supply: Decimal::from_integer(0).to_usd(),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // debt 50000
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(5).to_price(),
                twap: Decimal::from_integer(4).to_price(),
                last_update: slot,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(10_000).to_usd(),
                swapline_supply: Decimal::from_integer(0).to_usd(),
                borrowed_supply: Decimal::from_integer(0).to_usd(),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });
            let timestamp: i64 = 120;

            let assets_ref = RefCell::new(assets_list);
            // price debt 150_000 USD
            // twap debt 140_000 USD
            let total_debt = calculate_debt_with_adjustment(
                &mut state,
                &mut assets_ref.borrow_mut(),
                slot,
                timestamp,
            );
            // real:        current debt price = 150_000 USD,
            //              current debt twap = 140_000 USD
            //              interest debt based od twap = 0.00532724... USD
            //              total debt = current debt price + interest rate[debt twap]
            //              total debt = 150_000.00532724... USD

            // expected:    interest debt based od twap = 0.005328 USD
            //              total debt = 150_000.005328 USD
            match total_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_usd(150_000_005_328)),
                Err(_) => assert!(false, "Shouldn't check"),
            }

            let usd = assets_ref.borrow().synthetics[0];
            let usd_supply = usd.supply;
            let accumulated_debt_interest = state.accumulated_debt_interest;
            let last_debt_adjustment = state.last_debt_adjustment;
            assert_eq!(usd_supply, Decimal::from_usd(100_000_005_328));
            assert_eq!(accumulated_debt_interest, Decimal::from_usd(5328));
            assert_eq!(last_debt_adjustment, 120);

            // timestamp that not trigger debt adjustment
            let timestamp: i64 = 150;

            // price debt 150_000.005328 USD
            // twap debt 140_000.005328 USD
            let total_debt = calculate_debt_with_adjustment(
                &mut state,
                &mut assets_ref.borrow_mut(),
                slot,
                timestamp,
            );
            // debt should be the same
            match total_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_usd(150_000_005_328)),
                Err(_) => assert!(false, "Shouldn't check"),
            }

            let usd = assets_ref.borrow().synthetics[0];
            let usd_supply = usd.supply;
            let accumulated_debt_interest = state.accumulated_debt_interest;
            let last_debt_adjustment = state.last_debt_adjustment;
            // should be the same
            assert_eq!(usd_supply, Decimal::from_usd(100_000_005_328));
            assert_eq!(accumulated_debt_interest, Decimal::from_usd(5328));
            assert_eq!(last_debt_adjustment, 120);

            let timestamp: i64 = 185;

            let total_debt = calculate_debt_with_adjustment(
                &mut state,
                &mut assets_ref.borrow_mut(),
                slot,
                timestamp,
            );
            // real:        current debt price = 150_000.005328 USD,
            //              current debt twap = 140_000.005328 USD
            //              interest debt based od twap = 0.00266362... USD
            //              total debt = current debt price + interest rate[debt twap]
            //              total debt = 150_000.00799162... USD

            // expected:    interest debt based od twap = 0.002664 USD
            //              total debt = 150_000.007992 USD
            match total_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_usd(150_000_007_992)),
                Err(_) => assert!(false, "Shouldn't check"),
            }

            let usd = assets_ref.borrow().synthetics[0];
            let usd_supply = usd.supply;
            let accumulated_debt_interest = state.accumulated_debt_interest;
            let last_debt_adjustment = state.last_debt_adjustment;
            assert_eq!(usd_supply, Decimal::from_usd(100_000_007_992));
            assert_eq!(accumulated_debt_interest, Decimal::from_usd(7992));
            assert_eq!(last_debt_adjustment, 180);
        }
    }
    #[test]
    fn test_adjust_vault_entry_interest_debt() {
        let mut assets_list = AssetsList {
            ..Default::default()
        };
        // xusd with 200_010 supply
        let synthetic_debt_pool_supply = Decimal::from_integer(400_000).to_usd();
        let synthetic_borrowed_supply = Decimal::from_integer(200_010).to_usd();
        let synthetic_total_supply = synthetic_debt_pool_supply
            .add(synthetic_borrowed_supply)
            .unwrap();
        let initial_interest_rate = Decimal::from_percent(100).to_interest_rate();
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(1).to_price(),
            ..Default::default()
        });
        let synthetic = Synthetic {
            supply: synthetic_total_supply,
            asset_index: assets_list.head_assets - 1,
            borrowed_supply: synthetic_borrowed_supply,
            ..Default::default()
        };
        assets_list.append_synthetic(synthetic);

        let vault = Vault {
            // APR 5.5%
            debt_interest_rate: Decimal::new(55, 3).to_interest_rate(),
            accumulated_interest_rate: initial_interest_rate,
            accumulated_interest: Decimal::new(0, synthetic_total_supply.scale),
            mint_amount: synthetic_borrowed_supply,
            last_update: 0,
            ..Default::default()
        };
        let vault_entry = VaultEntry {
            last_accumulated_interest_rate: initial_interest_rate,
            synthetic_amount: synthetic_borrowed_supply,
            ..Default::default()
        };
        // single period adjustment
        {
            let timestamp = 430;
            let vault = &mut vault.clone();
            let vault_entry = &mut vault_entry.clone();
            let assets_list = RefCell::new(assets_list);
            let synthetic = &mut assets_list.borrow_mut().synthetics[0];

            // period interest
            // real     1.0000007324964247752...
            // expected 1.000000732496424772

            // supply increase
            // real     0.1465066...
            // expected 0.146507
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            let expected_period_interest = Decimal::from_interest_rate(1000000732496424772);
            let expected_supply_increase = Decimal::new(146507, synthetic_total_supply.scale);
            let expected_synthetic_borrowed_supply = synthetic_borrowed_supply
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_total_supply = synthetic_total_supply
                .add(expected_supply_increase)
                .unwrap();

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 420);
            assert_eq!(vault.accumulated_interest_rate, expected_period_interest);
            assert_eq!(vault.mint_amount, expected_synthetic_borrowed_supply);
            assert_eq!(vault.accumulated_interest, expected_supply_increase);

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_period_interest
            );
            assert_eq!(
                vault_entry.synthetic_amount,
                expected_synthetic_borrowed_supply
            );

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, expected_synthetic_total_supply);
            assert_eq!(
                synthetic.borrowed_supply,
                expected_synthetic_borrowed_supply
            );
        }
        // empty vault entry adjustment
        {
            let timestamp = 1200000;
            let vault = &mut vault.clone();
            let vault_entry = &mut vault_entry.clone();
            let assets_list = RefCell::new(assets_list);
            let synthetic = &mut assets_list.borrow_mut().synthetics[0];
            let synthetic_borrowed_supply = Decimal::from_usd(0);

            // update borrowed supply
            vault.mint_amount = synthetic_borrowed_supply;
            vault_entry.synthetic_amount = synthetic_borrowed_supply;
            synthetic.borrowed_supply = synthetic_borrowed_supply;
            synthetic.supply = synthetic_debt_pool_supply;

            // period interest
            // real     1.0020950376925351829...
            // expected 1.002095037692524283
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);
            let expected_interest_new_minuend = Decimal::from_interest_rate(1002095037692524283);

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 1200000);
            assert_eq!(
                vault.accumulated_interest_rate,
                expected_interest_new_minuend
            );
            assert_eq!(vault.mint_amount, Decimal::from_usd(0));
            assert_eq!(vault.accumulated_interest, Decimal::from_usd(0));

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_interest_new_minuend
            );
            assert_eq!(vault_entry.synthetic_amount, Decimal::from_usd(0));

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, synthetic_debt_pool_supply);
            assert_eq!(synthetic.borrowed_supply, Decimal::from_usd(0));
        }
        // multi period adjustment
        {
            let timestamp = 59;
            let vault = &mut vault.clone();
            let vault_entry = &mut vault_entry.clone();
            let assets_list = RefCell::new(assets_list);
            let synthetic = &mut assets_list.borrow_mut().synthetics[0];
            // should not adjust
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 0);
            assert_eq!(vault.accumulated_interest_rate, initial_interest_rate);
            assert_eq!(vault.mint_amount, synthetic_borrowed_supply);
            assert_eq!(
                vault.accumulated_interest,
                Decimal::new(0, synthetic_total_supply.scale)
            );

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                initial_interest_rate
            );
            assert_eq!(vault_entry.synthetic_amount, synthetic_borrowed_supply);

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, synthetic_total_supply);
            assert_eq!(synthetic.borrowed_supply, synthetic_borrowed_supply);

            let timestamp = 124;

            // period interest
            // real     1.0000002092846380428...
            // expected 1.000000209284638042

            // new interest denominator
            // real     1.0000002092846380428...
            // expected 1.000000209284638042

            // supply increase
            // real     0.0418590...
            // expected 0.041860
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            let expected_period_interest = Decimal::from_interest_rate(1000000209284638042);
            let expected_supply_increase = Decimal::new(41860, synthetic_total_supply.scale);
            let expected_synthetic_borrowed_supply = synthetic_borrowed_supply
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_total_supply = synthetic_total_supply
                .add(expected_supply_increase)
                .unwrap();

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 120);
            assert_eq!(vault.accumulated_interest_rate, expected_period_interest);
            assert_eq!(vault.mint_amount, expected_synthetic_borrowed_supply);
            assert_eq!(vault.accumulated_interest, expected_supply_increase);

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_period_interest
            );
            assert_eq!(
                vault_entry.synthetic_amount,
                expected_synthetic_borrowed_supply
            );

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, expected_synthetic_total_supply);
            assert_eq!(
                synthetic.borrowed_supply,
                expected_synthetic_borrowed_supply
            );

            let timestamp = 40269;
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            // period interest
            // real     1.0000700081545562626...
            // expected 1.000070008154555898

            // new interest denominator
            // real     1.000070217453845936...
            // expected 1.000070217453845572

            // supply increase
            // real     14.0023309...
            // expected 14.002334

            let expected_new_interest_denominator =
                Decimal::from_interest_rate(1000070217453845572);
            let accumulated_interest_before_adjustment = expected_supply_increase;
            let expected_supply_increase = Decimal::new(14002334, synthetic_total_supply.scale);
            let expected_accumulated_interest = accumulated_interest_before_adjustment
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_borrowed_supply = expected_synthetic_borrowed_supply
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_total_supply = synthetic_total_supply
                .add(expected_accumulated_interest)
                .unwrap();

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 40260);
            assert_eq!(
                vault.accumulated_interest_rate,
                expected_new_interest_denominator
            );
            assert_eq!(vault.mint_amount, expected_synthetic_borrowed_supply);
            assert_eq!(vault.accumulated_interest, expected_accumulated_interest);

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_new_interest_denominator
            );
            assert_eq!(
                vault_entry.synthetic_amount,
                expected_synthetic_borrowed_supply
            );

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, expected_synthetic_total_supply);
            assert_eq!(
                synthetic.borrowed_supply,
                expected_synthetic_borrowed_supply
            );

            let timestamp = 48325;
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            // period interest
            // real     1.0000140221675912427...
            // expected 1.000014022167591169

            // new interest denominator
            // real     1.000084240606037720...
            // expected 1.000084240606037647

            // supply increase
            // real     2.8047706...
            // expected 2.804771

            let expected_new_interest_denominator =
                Decimal::from_interest_rate(1000084240606037647);
            let accumulated_interest_before_adjustment = expected_accumulated_interest;
            let expected_supply_increase = Decimal::new(2804771, synthetic_total_supply.scale);
            let expected_accumulated_interest = accumulated_interest_before_adjustment
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_borrowed_supply = expected_synthetic_borrowed_supply
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_total_supply = synthetic_total_supply
                .add(expected_accumulated_interest)
                .unwrap();

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 48300);
            assert_eq!(
                vault.accumulated_interest_rate,
                expected_new_interest_denominator
            );
            assert_eq!(vault.mint_amount, expected_synthetic_borrowed_supply);
            assert_eq!(vault.accumulated_interest, expected_accumulated_interest);

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_new_interest_denominator
            );
            assert_eq!(
                vault_entry.synthetic_amount,
                expected_synthetic_borrowed_supply
            );

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, expected_synthetic_total_supply);
            assert_eq!(
                synthetic.borrowed_supply,
                expected_synthetic_borrowed_supply
            );
        }
        // adjust vault entry with working for a while vault
        {
            let timestamp = 48325;
            let vault = &mut vault.clone();
            let vault_entry = &mut vault_entry.clone();
            let assets_list = RefCell::new(assets_list);
            let synthetic = &mut assets_list.borrow_mut().synthetics[0];

            // start at 1.32 vault accumulated_interest_rate
            vault.accumulated_interest_rate = Decimal::from_percent(132).to_interest_rate();
            vault_entry.last_accumulated_interest_rate =
                Decimal::from_percent(132).to_interest_rate();

            // period interest
            // real     1.0000842406060380852...
            // expected 1.000084240606037646

            // new interest denominator
            // real     1.3201111975999702724...
            // expected 1.320111197599969694

            // supply increase
            // real     16.8489636...
            // expected 16.848964
            adjust_vault_entry_interest_debt(vault, vault_entry, synthetic, timestamp);

            let expected_interest_new_minuend = Decimal::from_interest_rate(1320111197599969694);
            let expected_supply_increase = Decimal::new(16848964, synthetic_total_supply.scale);
            let expected_synthetic_borrowed_supply = synthetic_borrowed_supply
                .add(expected_supply_increase)
                .unwrap();
            let expected_synthetic_total_supply = synthetic_total_supply
                .add(expected_supply_increase)
                .unwrap();

            // verify vault adjustment
            assert_eq!({ vault.last_update }, 48300);
            assert_eq!(
                vault.accumulated_interest_rate,
                expected_interest_new_minuend
            );
            assert_eq!(vault.mint_amount, expected_synthetic_borrowed_supply);
            assert_eq!(vault.accumulated_interest, expected_supply_increase);

            // verify vault entry adjustment
            assert_eq!(
                vault_entry.last_accumulated_interest_rate,
                expected_interest_new_minuend
            );
            assert_eq!(
                vault_entry.synthetic_amount,
                expected_synthetic_borrowed_supply
            );

            // verify synthetic adjustment
            assert_eq!(synthetic.supply, expected_synthetic_total_supply);
            assert_eq!(
                synthetic.borrowed_supply,
                expected_synthetic_borrowed_supply
            );
        }
    }

    #[test]
    fn test_set_supply_safely() {
        let synthetic_decimal = 8;
        let base_synthetic = Synthetic {
            supply: Decimal::from_integer(101).to_scale(synthetic_decimal),
            borrowed_supply: Decimal::from_integer(101).to_scale(synthetic_decimal),
            max_supply: Decimal::from_integer(1000).to_scale(synthetic_decimal),
            ..Default::default()
        };
        let base_vault = Vault {
            mint_amount: Decimal::from_integer(3).to_scale(synthetic_decimal),
            max_borrow: Decimal::from_integer(50).to_scale(synthetic_decimal),
            ..Default::default()
        };
        // increase supply, not crossed max supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();

            let new_supply = Decimal::from_integer(179).to_scale(synthetic_decimal);
            let new_mint_amount = Decimal::from_integer(21).to_scale(synthetic_decimal);
            let supply_result = synthetic.set_supply_safely(new_supply);
            let mint_amount_result = vault.set_mint_amount_safely(new_mint_amount);

            assert!(supply_result.is_ok());
            assert!(mint_amount_result.is_ok());
            assert_eq!(synthetic.supply, new_supply);
            assert_eq!(vault.mint_amount, new_mint_amount);
        }
        // increase supply, crossed max supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();

            let new_supply = Decimal::from_integer(1001).to_scale(synthetic_decimal);
            let new_mint_amount = Decimal::from_integer(61).to_scale(synthetic_decimal);
            let setting_result = synthetic.set_supply_safely(new_supply);
            let mint_amount_result = vault.set_mint_amount_safely(new_mint_amount);

            assert!(setting_result.is_err());
            assert!(mint_amount_result.is_err());
            assert_eq!(synthetic.supply, base_synthetic.supply);
            assert_eq!(vault.mint_amount, base_vault.mint_amount);
        }
        // decrease supply, not crossed max supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();

            let new_supply = Decimal::from_integer(1).to_scale(synthetic_decimal);
            let new_mint_amount = Decimal::from_integer(1).to_scale(synthetic_decimal);
            let setting_result = synthetic.set_supply_safely(new_supply);
            let mint_amount_result = vault.set_mint_amount_safely(new_mint_amount);

            assert!(setting_result.is_ok());
            assert!(mint_amount_result.is_ok());
            assert_eq!(synthetic.supply, new_supply);
            assert_eq!(vault.mint_amount, new_mint_amount);
        }
        // decrease supply, crossed max supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();
            synthetic.supply = Decimal::from_integer(1800).to_scale(synthetic_decimal);
            vault.mint_amount = Decimal::from_integer(150).to_scale(synthetic_decimal);

            let new_supply = Decimal::from_integer(1300).to_scale(synthetic_decimal);
            let new_mint_amount = Decimal::from_integer(90).to_scale(synthetic_decimal);
            let setting_result = synthetic.set_supply_safely(new_supply);
            let mint_amount_result = vault.set_mint_amount_safely(new_mint_amount);

            assert!(setting_result.is_ok());
            assert!(mint_amount_result.is_ok());
            assert_eq!(synthetic.supply, new_supply);
            assert_eq!(vault.mint_amount, new_mint_amount);
        }
    }

    #[test]
    fn test_vault_entry_cascade_supply_change() {
        let synthetic_decimal = 8;
        let base_synthetic = Synthetic {
            supply: Decimal::from_integer(50).to_scale(synthetic_decimal),
            borrowed_supply: Decimal::from_integer(10).to_scale(synthetic_decimal),
            max_supply: Decimal::from_integer(100).to_scale(synthetic_decimal),
            ..Default::default()
        };
        let base_vault = Vault {
            mint_amount: Decimal::from_integer(2).to_scale(synthetic_decimal),
            max_borrow: Decimal::from_integer(20).to_scale(synthetic_decimal),
            ..Default::default()
        };
        let base_vault_entry = VaultEntry {
            synthetic_amount: Decimal::from_integer(1).to_scale(synthetic_decimal),
            ..Default::default()
        };
        // increase, not crossed
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();
            let mut vault_entry = base_vault_entry.clone();
            let mint_amount = Decimal::from_integer(5).to_scale(synthetic_decimal);

            let cascade_increase =
                vault_entry.increase_supply_cascade(&mut vault, &mut synthetic, mint_amount);

            assert!(cascade_increase.is_ok());
            assert_eq!(
                vault_entry.synthetic_amount,
                Decimal::from_integer(6).to_scale(synthetic_decimal)
            );
            assert_eq!(
                vault.mint_amount,
                Decimal::from_integer(7).to_scale(synthetic_decimal)
            );
            assert_eq!(
                synthetic.borrowed_supply,
                Decimal::from_integer(15).to_scale(synthetic_decimal)
            );
            assert_eq!(
                synthetic.supply,
                Decimal::from_integer(55).to_scale(synthetic_decimal)
            );
        }
        // increase, crossed max mint amount
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();
            let mut vault_entry = base_vault_entry.clone();
            let mint_amount = Decimal::from_integer(20).to_scale(synthetic_decimal);

            let cascade_increase =
                vault_entry.increase_supply_cascade(&mut vault, &mut synthetic, mint_amount);

            assert!(cascade_increase.is_err());
        }
        // increase, crossed max synthetic supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();
            let mut vault_entry = base_vault_entry.clone();
            vault.max_borrow = Decimal::from_integer(300).to_scale(synthetic_decimal);
            let mint_amount = Decimal::from_integer(100).to_scale(synthetic_decimal);

            let cascade_increase =
                vault_entry.increase_supply_cascade(&mut vault, &mut synthetic, mint_amount);

            assert!(cascade_increase.is_err());
        }
        // decrease supply, crossed max supply
        {
            let mut synthetic = base_synthetic.clone();
            let mut vault = base_vault.clone();
            let mut vault_entry = base_vault_entry.clone();
            let synthetic_supply = Decimal::from_integer(300).to_scale(synthetic_decimal);
            let borrowed_supply = Decimal::from_integer(200).to_scale(synthetic_decimal);
            let vault_mint_amount = Decimal::from_integer(200).to_scale(synthetic_decimal);
            let vault_entry_synthetic_amount =
                Decimal::from_integer(150).to_scale(synthetic_decimal);

            synthetic.supply = synthetic_supply;
            synthetic.borrowed_supply = borrowed_supply;
            vault.mint_amount = vault_mint_amount;
            vault_entry.synthetic_amount = vault_entry_synthetic_amount;
            let burn_amount = Decimal::from_integer(10).to_scale(synthetic_decimal);

            let cascade_decrease =
                vault_entry.decrease_supply_cascade(&mut vault, &mut synthetic, burn_amount);

            assert!(cascade_decrease.is_ok());
            assert_eq!(
                vault_entry.synthetic_amount,
                Decimal::from_integer(140).to_scale(synthetic_decimal)
            );
            assert_eq!(
                vault.mint_amount,
                Decimal::from_integer(190).to_scale(synthetic_decimal)
            );
            assert_eq!(
                synthetic.borrowed_supply,
                Decimal::from_integer(190).to_scale(synthetic_decimal)
            );
            assert_eq!(
                synthetic.supply,
                Decimal::from_integer(290).to_scale(synthetic_decimal)
            );
        }
    }

    #[test]
    fn test_set_mint_amount_safely() {
        // decrease is safe
        {
            let mut vault = Vault {
                mint_amount: Decimal::from_integer(2),
                max_borrow: Decimal::from_integer(2),
                ..Default::default()
            };
            let new_mint_amount = Decimal::from_integer(1);

            vault.set_mint_amount_safely(new_mint_amount).unwrap();

            assert_eq!(vault.mint_amount, new_mint_amount)
        }
        // increase without error
        {
            let mut vault = Vault {
                mint_amount: Decimal::from_integer(2),
                max_borrow: Decimal::from_integer(4),
                ..Default::default()
            };
            let new_mint_amount = Decimal::from_integer(3);

            vault.set_mint_amount_safely(new_mint_amount).unwrap();

            assert_eq!(vault.mint_amount, new_mint_amount)
        }
        // checking error
        {
            let mut vault = Vault {
                mint_amount: Decimal::from_integer(2),
                max_borrow: Decimal::from_integer(2),
                ..Default::default()
            };
            let new_mint_amount = Decimal::from_integer(3);

            let result = vault.set_mint_amount_safely(new_mint_amount);

            assert!(result.is_err());
        }
    }

    #[test]
    fn test_append_exchange_account() {
        {
            let collateral_entry = CollateralEntry {
                amount: 10,
                index: 7,
                ..Default::default()
            };
            let mut exchange_account = ExchangeAccount {
                head: 0,
                collaterals: [collateral_entry; 32],
                ..Default::default()
            };
            let entry = CollateralEntry {
                amount: 10,
                index: 4,
                ..Default::default()
            };

            exchange_account.append(entry);

            assert_eq!(exchange_account.head, 1);
            assert_eq!(
                exchange_account.collaterals[(exchange_account.head - 1) as usize],
                entry
            );
        }
        // double append to the same account
        {
            let collateral_entry = CollateralEntry {
                amount: 10,
                index: 7,
                ..Default::default()
            };
            let mut exchange_account = ExchangeAccount {
                head: 0,
                collaterals: [collateral_entry; 32],
                ..Default::default()
            };
            let entry1 = CollateralEntry {
                amount: 10,
                index: 4,
                ..Default::default()
            };
            let entry2 = CollateralEntry {
                amount: 10,
                index: 4,
                ..Default::default()
            };

            exchange_account.append(entry1);
            exchange_account.append(entry2);

            assert_eq!(exchange_account.head, 2);
            assert_eq!(
                exchange_account.collaterals[(exchange_account.head - 1) as usize],
                entry2
            );
        }
    }

    #[test]
    fn test_remove_exchange_account() {
        {
            let collateral_entry = CollateralEntry {
                amount: 10,
                index: 10,
                ..Default::default()
            };
            let mut exchange_account = ExchangeAccount {
                head: 1,
                collaterals: [collateral_entry; 32],
                ..Default::default()
            };
            let index = 8;

            let check = exchange_account.collaterals[(exchange_account.head - 1) as usize]; // create copy before using function

            exchange_account.remove(index);

            assert_eq!(exchange_account.head, 0);
            assert_eq!(
                exchange_account.collaterals[(exchange_account.head) as usize],
                CollateralEntry {
                    ..Default::default()
                }
            );
            assert_eq!(check, exchange_account.collaterals[(index) as usize]);
        }
        // remove not last entry
        {
            let collateral_entry = CollateralEntry {
                amount: 10,
                index: 8,
                ..Default::default()
            };
            let mut exchange_account = ExchangeAccount {
                head: 5,
                collaterals: [collateral_entry; 32],
                ..Default::default()
            };
            let index = 7;

            let check = exchange_account.collaterals[(exchange_account.head - 1) as usize]; // create copy before using function

            exchange_account.remove(index);

            assert_eq!(exchange_account.head, 4);
            assert_eq!(
                exchange_account.collaterals[(exchange_account.head) as usize],
                CollateralEntry {
                    ..Default::default()
                }
            );
            assert_eq!(check, exchange_account.collaterals[(index) as usize]);
        }
    }

    #[test]
    #[should_panic]
    fn test_remove_exchange_account_with_panic() {
        // panic because self.head == -1
        {
            let collateral_entry = CollateralEntry {
                ..Default::default()
            };
            let mut exchange_account = ExchangeAccount {
                head: 0,
                collaterals: [collateral_entry; 32],
                ..Default::default()
            };
            let index = 1;

            exchange_account.remove(index);
        }
    }

    #[test]
    fn test_append_asset_asset_list() {
        {
            let mut assets_list = AssetsList {
                head_assets: 1,
                head_collaterals: 1,
                head_synthetics: 1,
                ..Default::default()
            };
            let new_asset = Asset {
                ..Default::default()
            };

            assets_list.append_asset(new_asset);

            assert_eq!(
                assets_list.assets[(assets_list.head_assets - 1) as usize],
                new_asset
            );
            assert_eq!(assets_list.head_assets, 2);
        }
    }

    #[test]
    fn test_append_collateral_asset_list() {
        {
            let mut assets_list = AssetsList {
                head_assets: 1,
                head_collaterals: 1,
                head_synthetics: 1,
                ..Default::default()
            };
            let new_collateral = Collateral {
                ..Default::default()
            };

            assets_list.append_collateral(new_collateral);

            assert_eq!(
                assets_list.collaterals[(assets_list.head_collaterals - 1) as usize],
                new_collateral
            );
            assert_eq!(assets_list.head_collaterals, 2);
        }
    }

    #[test]
    fn test_append_synthetic_asset_list() {
        {
            let mut assets_list = AssetsList {
                head_assets: 1,
                head_collaterals: 1,
                head_synthetics: 1,
                ..Default::default()
            };
            let new_synthetic = Synthetic {
                ..Default::default()
            };

            assets_list.append_synthetic(new_synthetic);

            assert_eq!(
                assets_list.synthetics[(assets_list.head_synthetics - 1) as usize],
                new_synthetic
            );
            assert_eq!(assets_list.head_synthetics, 2);
        }
    }

    #[test]
    fn test_remove_synthetic_asset_list() {
        {
            let mut assets_list = AssetsList {
                head_assets: 1,
                head_collaterals: 1,
                head_synthetics: 1,
                ..Default::default()
            };
            let index = 1;

            let check = assets_list.synthetics[(assets_list.head_synthetics - 1) as usize]; // create copy before using function

            assets_list.remove_synthetic(index).unwrap();

            assert_eq!(assets_list.synthetics[index], check);
            assert_eq!(
                assets_list.synthetics[(assets_list.head_synthetics) as usize],
                Synthetic {
                    ..Default::default()
                }
            );
            assert_eq!(assets_list.head_synthetics, 0);
        }
        // check error
        {
            let mut assets_list = AssetsList {
                head_assets: 1,
                head_collaterals: 1,
                head_synthetics: 1,
                ..Default::default()
            };
            let index = 0;

            let result = assets_list.remove_synthetic(index);

            assert!(result.is_err());
        }
    }

    #[test]
    #[should_panic]
    fn test_remove_synthetic_asset_list_with_panic() {
        // panic because self.head == -1
        {
            let mut assets_list = AssetsList {
                head_synthetics: 0,
                ..Default::default()
            };
            let index = 1;

            assets_list.remove_synthetic(index).unwrap();
        }
    }

    #[test]
    fn test_split_borrow_asset_list() {
        {
            let mut assets_list = AssetsList {
                ..Default::default()
            };
            let assets_list_copy = assets_list.clone();

            let result = assets_list.split_borrow();

            for i in 0..255 {
                assert_eq!((result.0)[i], (assets_list_copy.assets)[i]);
                assert_eq!((result.1)[i], (assets_list_copy.collaterals)[i]);
                assert_eq!((result.2)[i], (assets_list_copy.synthetics)[i]);
            }
        }
    }

    #[test]
    fn test_div_up() {
        // div of zero
        {
            let a = 0;
            let b = 1;
            assert_eq!(div_up(a, b), 0);
        }
        // // div check rounding up
        {
            let a = 1;
            let b = 2;
            assert_eq!(div_up(a, b), 1);
        }
        // // div big number
        {
            let a = 200_000_000_001;
            let b = 200_000_000_000;
            assert_eq!(div_up(a, b), 2);
        }
    }

    #[test]
    fn test_adjust_vault_interest_rate() {
        let mut assets_list = AssetsList {
            ..Default::default()
        };
        let initial_interest_rate = Decimal::from_percent(100).to_interest_rate();
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(1).to_price(),
            ..Default::default()
        });

        let vault = Vault {
            // APR 5.5%
            debt_interest_rate: Decimal::new(55, 3).to_interest_rate(),
            accumulated_interest_rate: initial_interest_rate,
            last_update: 0,
            ..Default::default()
        };

        {
            let timestamp = 430;
            let vault = &mut vault.clone();
            adjust_vault_interest_rate(vault, timestamp);

            let expected_accumulated_interest_rate =
                Decimal::from_interest_rate(1000000732496424772);
            let expected_last_update = 420;

            // verify vault adjustment
            assert_eq!(
                vault.accumulated_interest_rate,
                expected_accumulated_interest_rate
            );
            assert_eq!({ vault.last_update }, expected_last_update);
        }
    }
}
