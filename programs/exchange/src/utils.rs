use std::cell::RefMut;

use crate::*;

const BITS: u64 = (core::mem::size_of::<u64>() * 8) as u64;
pub const fn log2(n: u64) -> u64 {
    (BITS - 1) - n.leading_zeros() as u64
}

pub fn check_feed_update(
    assets: &[Asset],
    index_a: usize,
    index_b: usize,
    max_delay: u32,
    slot: u64,
) -> Result<()> {
    // Check assetA
    if (assets[index_a].last_update as u64) < slot - max_delay as u64 {
        return Err(ErrorCode::OutdatedOracle.into());
    }
    // Check assetB
    if (assets[index_b].last_update as u64) < slot - max_delay as u64 {
        return Err(ErrorCode::OutdatedOracle.into());
    }
    return Ok(());
}

pub fn div_up(a: u128, b: u128) -> u128 {
    return a
        .checked_add(b.checked_sub(1).unwrap())
        .unwrap()
        .checked_div(b)
        .unwrap();
}

pub fn check_liquidation(
    user_collateral: u64,
    user_debt: u64,
    liquidation_threshold: u8,
) -> Result<()> {
    let is_safe = (user_debt as u128)
        .checked_mul(liquidation_threshold as u128)
        .unwrap()
        .checked_div(100)
        .unwrap()
        >= user_collateral as u128;
    if is_safe {
        return Ok(());
    } else {
        return Err(ErrorCode::InvalidLiquidation.into());
    }
}

pub fn adjust_staking_rounds(state: &mut RefMut<State>, slot: u64) {
    if slot <= state.staking.next_round.start {
        return;
    }
    let slot_diff = slot.checked_sub(state.staking.next_round.start).unwrap();
    let round_diff = div_up(slot_diff as u128, state.staking.round_length.into()) as u32;
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
                    .checked_add(state.staking.round_length.checked_mul(2).unwrap() as u64)
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
                            .unwrap() as u64,
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
                            .unwrap() as u64,
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
                    .checked_add(state.staking.round_length.checked_mul(round_diff).unwrap() as u64)
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

    exchange_account.user_staking_data.last_update = staking.current_round.start + 1;
    return;
}

pub fn set_synthetic_supply(synthetic: &mut Synthetic, new_supply: u64) -> ProgramResult {
    if new_supply.gt(&synthetic.max_supply) {
        return Err(ErrorCode::MaxSupply.into());
    }
    synthetic.supply = new_supply;
    Ok(())
}
pub fn get_user_sny_collateral_balance(
    exchange_account: &ExchangeAccount,
    sny_asset: &Collateral,
) -> u64 {
    let entry = exchange_account
        .collaterals
        .iter()
        .find(|x| x.collateral_address.eq(&sny_asset.collateral_address));
    match entry {
        Some(x) => return x.amount,
        None => return 0,
    }
}

#[cfg(test)]
mod tests {

    use std::{cell::RefCell, u64};

    use super::*;
    #[test]
    fn test_check_liquidation() {
        {
            let result = check_liquidation(1000, 499, 200);
            match result {
                Ok(_) => assert!(false, "Shouldn't check"),
                Err(_) => assert!(true),
            }
        }
        {
            let result = check_liquidation(1000, 500, 200);
            match result {
                Ok(_) => assert!(true),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
    }
    #[test]
    fn adjust_staking_account_test() {
        let staking_round_length = 100;
        let amount_per_round = 300;
        let slot = 12u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 1,
                amount: 0,
                start: slot,
            },
            current_round: StakingRound {
                all_points: 2,
                amount: 0,
                start: slot.checked_add(staking_round_length as u64).unwrap(),
            },
            next_round: StakingRound {
                all_points: 3,
                amount: amount_per_round,
                start: slot
                    .checked_add(staking_round_length as u64)
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
                    amount_to_claim: 0,
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
                exchange_account.user_staking_data.finished_round_points,
                exchange_account.debt_shares
            );
            assert_eq!(
                exchange_account.user_staking_data.current_round_points,
                exchange_account.debt_shares
            );
            assert_eq!(
                exchange_account.user_staking_data.next_round_points,
                exchange_account.debt_shares
            );
            assert_eq!(
                exchange_account.user_staking_data.last_update,
                staking.current_round.start + 1
            );
        }
        {
            // Last update before current round but after finished round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                user_staking_data: UserStaking {
                    amount_to_claim: 0,
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
                exchange_account.user_staking_data.finished_round_points,
                exchange_account_copy.user_staking_data.current_round_points
            );
            assert_eq!(
                exchange_account.user_staking_data.current_round_points,
                exchange_account_copy.user_staking_data.next_round_points
            );
            assert_eq!(
                exchange_account.user_staking_data.next_round_points,
                exchange_account.debt_shares
            );
            assert_eq!(
                exchange_account.user_staking_data.last_update,
                staking.current_round.start + 1
            );
        }
        {
            // Last update in current round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                user_staking_data: UserStaking {
                    amount_to_claim: 0,
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
        let amount_per_round = 300;
        let debt_shares = 999u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 0,
                amount: 0,
                start: 0,
            },
            current_round: StakingRound {
                all_points: 0,
                amount: 0,
                start: staking_round_length as u64,
            },
            next_round: StakingRound {
                all_points: 0,
                amount: amount_per_round,
                start: (staking_round_length as u64)
                    .checked_add(staking_round_length.into())
                    .unwrap(),
            },
            ..Default::default()
        };
        let state = State {
            debt_shares: debt_shares,
            staking: staking,
            ..Default::default()
        };
        {
            // Should stay same
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 150);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_eq!(state_copy, state_after_adjustment);
        }
        {
            // Should stay same
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 200);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_eq!(state_copy, state_after_adjustment);
        }
        {
            // Should move one round forward
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 201);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                state_copy.staking.current_round
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                state_copy.staking.next_round
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
        {
            // Should move one round forward
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 300);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                state_copy.staking.current_round
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                state_copy.staking.next_round
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
        {
            // Should move two round forward
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 301);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                state_copy.staking.next_round
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.checked_mul(2).unwrap() as u64)
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
        {
            // Should move three round forward
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 401);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.checked_mul(2).unwrap() as u64)
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: state_copy
                        .staking
                        .next_round
                        .start
                        .checked_add(state_copy.staking.round_length.checked_mul(3).unwrap() as u64)
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
        {
            // Should move more then tree round forward
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            // move seven round forward
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 810);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                StakingRound {
                    start: 700,
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                StakingRound {
                    start: 800,
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: 900,
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
        {
            // Large numbers
            let state_ref = RefCell::new(state);
            let state_copy = state.clone();
            // move seven round forward
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 1_287_161_137);
            let state_after_adjustment = *state_ref.try_borrow_mut().unwrap();
            let expected_finished_round_slot: u64 = 1287161000;
            assert_ne!(state_after_adjustment, state_copy);
            assert_eq!(
                state_after_adjustment.staking.finished_round,
                StakingRound {
                    start: expected_finished_round_slot,
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.current_round,
                StakingRound {
                    start: expected_finished_round_slot
                        .checked_add(staking_round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
            assert_eq!(
                state_after_adjustment.staking.next_round,
                StakingRound {
                    start: expected_finished_round_slot
                        .checked_add(staking_round_length.checked_mul(2).unwrap() as u64)
                        .unwrap(),
                    all_points: debt_shares,
                    amount: state_copy.staking.amount_per_round,
                }
            );
        }
    }
    #[test]
    fn adjust_staking_rounds_with_variable_round_length_test() {
        let staking_round_length = 100;
        let amount_per_round = 300;
        let debt_shares = 999u64;
        let staking = Staking {
            round_length: staking_round_length,
            amount_per_round: amount_per_round,
            finished_round: StakingRound {
                all_points: 0,
                amount: 0,
                start: 0,
            },
            current_round: StakingRound {
                all_points: 0,
                amount: 0,
                start: staking_round_length as u64,
            },
            next_round: StakingRound {
                all_points: 0,
                amount: amount_per_round,
                start: (staking_round_length as u64)
                    .checked_add(staking_round_length.into())
                    .unwrap(),
            },
            ..Default::default()
        };
        let state = State {
            debt_shares: debt_shares,
            staking: staking,
            ..Default::default()
        };
        {
            // Should move one round forward
            let state_copy = state.clone();
            let state_ref = RefCell::new(state);
            adjust_staking_rounds(&mut state_ref.try_borrow_mut().unwrap(), 201);
            // |    |   |
            // f    c   n
            // 100  200 300
            let state_after_first_adjustment = *state_ref.try_borrow_mut().unwrap();
            assert_ne!(state_copy, state_after_first_adjustment);
            assert_eq!(
                state_after_first_adjustment.staking.finished_round.start,
                state_copy.staking.current_round.start
            );
            assert_eq!(
                state_after_first_adjustment.staking.current_round.start,
                state_copy.staking.next_round.start
            );
            assert_eq!(
                state_after_first_adjustment.staking.next_round.start,
                state_copy
                    .staking
                    .next_round
                    .start
                    .checked_add(staking_round_length.into())
                    .unwrap()
            );
            // change round length
            let mut state_after_second_adjustment = state_ref.try_borrow_mut().unwrap();
            state_after_second_adjustment.staking.round_length = 25;
            adjust_staking_rounds(&mut state_after_second_adjustment, 401);
            assert_eq!(
                375,
                state_after_second_adjustment.staking.finished_round.start
            );
            assert_eq!(
                400,
                state_after_second_adjustment.staking.current_round.start
            );
            assert_eq!(425, state_after_second_adjustment.staking.next_round.start);
        }
    }
    #[test]
    fn test_check_feed_update() {
        let list = AssetsList {
            ..Default::default()
        };
        list.append_asset(Asset {
            last_update: 10,
            ..Default::default()
        });
        assert!(check_feed_update(&list.assets, 0, 1, 10, 100).is_err());
    }
}
