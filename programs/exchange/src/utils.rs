use std::borrow::BorrowMut;
use std::cell::RefMut;

use crate::decimal::{Add, Gt};
use crate::math::{calculate_compounded_interest, calculate_debt, calculate_minute_interest_rate};
use crate::*;

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

pub fn adjust_staking_rounds(state: &mut State, slot: u64) {
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

pub fn calculate_debt_with_interest(
    state: &mut State,
    assets_list: &mut RefMut<AssetsList>,
    slot: u64,
    timestamp: i64,
) -> Result<Decimal> {
    let total_debt_twap = calculate_debt(assets_list, slot, state.max_delay, true).unwrap();
    let usd = &mut assets_list.borrow_mut().synthetics[0];
    let debt_with_interest = adjust_interest_debt(state, usd, total_debt_twap, timestamp);
    Ok(debt_with_interest)
}

// Change total_twap_debt
pub fn adjust_interest_debt(
    state: &mut State,
    usd: &mut Synthetic,
    total_debt: Decimal,
    timestamp: i64,
) -> Decimal {
    const ADJUSTMENT_PERIOD: i64 = 60;
    let diff = timestamp
        .checked_sub(state.last_debt_adjustment)
        .unwrap()
        .checked_div(ADJUSTMENT_PERIOD)
        .unwrap();
    if diff >= 1 {
        // let debt_interest_rate = calculate_debt_interest_rate(state.debt_interest_rate);
        // let minute_interest_rate = calculate_minute_interest_rate(debt_interest_rate);
        let minute_interest_rate = calculate_minute_interest_rate(state.debt_interest_rate);

        let compounded_interest =
            calculate_compounded_interest(total_debt, minute_interest_rate, diff as u128);

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

        return total_debt.add(compounded_interest).unwrap();
    }
    return total_debt;
}

pub fn set_synthetic_supply(synthetic: &mut Synthetic, new_supply: Decimal) -> ProgramResult {
    if new_supply.gt(synthetic.max_supply).unwrap() {
        return Err(ErrorCode::MaxSupply.into());
    }
    synthetic.supply = new_supply;
    Ok(())
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

#[cfg(test)]
mod tests {

    use crate::math::{ACCURACY, PRICE_OFFSET};

    use super::*;
    use std::{cell::RefCell, u64};

    #[test]
    fn adjust_staking_account_test() {
        let staking_round_length = 100;
        let amount_per_round = Decimal::new(300, ACCURACY);
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
        let amount_per_round = Decimal::new(300, ACCURACY);
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
        let amount_per_round = Decimal::new(300, ACCURACY);
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
    // #[test]
    // fn test_div_up() {
    //     assert_eq!(div_up(0, 1), 0);
    //     assert_eq!(div_up(1, 2), 1);
    //     assert_eq!(div_up(2 * 10u128.pow(20) + 1, 2), 10u128.pow(20) + 1);
    // }
    // #[test]
    // fn test_check_feed_update() {
    //     let mut list = AssetsList {
    //         ..Default::default()
    //     };
    //     list.append_asset(Asset {
    //         last_update: 10,
    //         ..Default::default()
    //     });
    //     list.append_asset(Asset {
    //         last_update: 10,
    //         ..Default::default()
    //     });

    //     // Outdated
    //     assert!(check_feed_update(&list.assets, 0, 1, 10, 100).is_err());
    //     // Outdated a little
    //     assert!(check_feed_update(&list.assets, 0, 1, 10, 21).is_err());
    //     // On the limit
    //     assert!(check_feed_update(&list.assets, 0, 1, 10, 20).is_ok());
    //     // No tollerance
    //     assert!(check_feed_update(&list.assets, 0, 1, 0, 10).is_ok());
    // }

    // #[test]
    // fn test_set_synthetic_supply() {
    //     // Regular
    //     {
    //         let mut synthetic = Synthetic {
    //             supply: 10,
    //             max_supply: 100,
    //             ..Default::default()
    //         };
    //         let result = set_synthetic_supply(&mut synthetic, 50);
    //         assert!(result.is_ok());
    //         assert_eq!({ synthetic.max_supply }, 100);
    //         assert_eq!({ synthetic.supply }, 50);
    //     }
    //     // Up to limit
    //     {
    //         let mut synthetic = Synthetic {
    //             supply: 10,
    //             max_supply: 100,
    //             ..Default::default()
    //         };
    //         let result = set_synthetic_supply(&mut synthetic, 100);
    //         assert!(result.is_ok());
    //         assert_eq!({ synthetic.supply }, 100);
    //     }
    //     // Over limit
    //     {
    //         let mut synthetic = Synthetic {
    //             supply: 10,
    //             max_supply: 100,
    //             ..Default::default()
    //         };
    //         let result = set_synthetic_supply(&mut synthetic, 101);
    //         assert!(result.is_err());
    //     }
    // }

    // #[test]
    // fn test_get_user_sny_collateral_balance() {
    //     let sny_address = Pubkey::new_unique();
    //     let sny_asset = Collateral {
    //         collateral_address: sny_address,
    //         ..Default::default()
    //     };

    //     // Empty list
    //     {
    //         let exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };

    //         let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
    //         assert_eq!(amount, 0)
    //     }
    //     // With other assets
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         exchange_account.append(CollateralEntry {
    //             collateral_address: Pubkey::new_unique(),
    //             amount: 100,
    //             ..Default::default()
    //         });
    //         exchange_account.append(CollateralEntry {
    //             collateral_address: sny_address,
    //             amount: 100,
    //             ..Default::default()
    //         });
    //         exchange_account.append(CollateralEntry {
    //             collateral_address: Pubkey::new_unique(),
    //             amount: 100,
    //             ..Default::default()
    //         });

    //         let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
    //         assert_eq!(amount, 100)
    //     }
    //     // Without SNY
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         exchange_account.append(CollateralEntry {
    //             collateral_address: Pubkey::new_unique(),
    //             amount: 100,
    //             ..Default::default()
    //         });
    //         exchange_account.append(CollateralEntry {
    //             collateral_address: Pubkey::new_unique(),
    //             amount: 100,
    //             ..Default::default()
    //         });

    //         let amount = get_user_sny_collateral_balance(&exchange_account, &sny_asset);
    //         assert_eq!(amount, 0)
    //     }
    // }

    // #[test]
    // fn test_adjust_interest_debt() {
    //     let state = State {
    //         debt_interest_rate: 10,
    //         accumulated_debt_interest: 0,
    //         last_debt_adjustment: 0,
    //         ..Default::default()
    //     };
    //     let usd = Synthetic {
    //         supply: 100_000 * 10u64.pow(ACCURACY.into()),
    //         ..Default::default()
    //     };
    //     // single period adjustment
    //     {
    //         let total_debt = 100_000 * 10u64.pow(ACCURACY.into());
    //         let current_timestamp = 65;
    //         let mut state = state.clone();
    //         let mut usd = usd.clone();
    //         adjust_interest_debt(&mut state, &mut usd, total_debt, current_timestamp);

    //         // real     0.0019025... $
    //         // expected 0.001903     $
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_001_903);
    //         assert_eq!(accumulated_debt_interest, 1903);
    //         assert_eq!(last_debt_adjustment, 60);
    //     }
    //     // multiple period adjustment
    //     {
    //         let total_debt = 100_000 * 10u64.pow(ACCURACY.into());
    //         let current_timestamp = 120;
    //         let mut state = state.clone();
    //         let mut usd = usd.clone();
    //         adjust_interest_debt(&mut state, &mut usd, total_debt, current_timestamp);

    //         // real     0.0038051... $
    //         // expected 0.003806     $
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_003_806);
    //         assert_eq!(accumulated_debt_interest, 3806);
    //         assert_eq!(last_debt_adjustment, 120);
    //     }
    //     // multiple adjustment interest rate
    //     {
    //         // timestamp [90 -> 31 -> 62]
    //         let total_debt = 100_000 * 10u64.pow(ACCURACY.into());
    //         let current_timestamp = 90;
    //         let mut state = state.clone();
    //         let mut usd = usd.clone();
    //         adjust_interest_debt(&mut state, &mut usd, total_debt, current_timestamp);

    //         // real     0.0019025... $
    //         // expected 0.001903     $
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_001_903);
    //         assert_eq!(accumulated_debt_interest, 1903);
    //         assert_eq!(last_debt_adjustment, 60);

    //         let current_timestamp = 121;
    //         adjust_interest_debt(&mut state, &mut usd, total_debt, current_timestamp);

    //         // real     0.0038051... $
    //         // expected 0.003806     $
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_003_806);
    //         assert_eq!(accumulated_debt_interest, 3806);
    //         assert_eq!(last_debt_adjustment, 120);

    //         let current_timestamp = 183;
    //         adjust_interest_debt(&mut state, &mut usd, total_debt, current_timestamp);

    //         // real     0.005707... $
    //         // expected 0.005709    $
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_005_709);
    //         assert_eq!(accumulated_debt_interest, 5709);
    //         assert_eq!(last_debt_adjustment, 180);
    //     }
    // }

    // #[test]
    // fn test_calculate_debt_with_interest_multi_adjustment() {
    //     {
    //         let slot = 100;
    //         let mut assets_list = AssetsList {
    //             ..Default::default()
    //         };
    //         let mut state = State {
    //             debt_interest_rate: 10,
    //             accumulated_debt_interest: 0,
    //             last_debt_adjustment: 0,
    //             ..Default::default()
    //         };

    //         // xusd - fixed price 1 USD
    //         // debt 100000
    //         assets_list.append_asset(Asset {
    //             twap: 10u64.pow(PRICE_OFFSET.into()),
    //             last_update: slot,
    //             ..Default::default()
    //         });
    //         assets_list.append_synthetic(Synthetic {
    //             supply: 100_000 * 10u64.pow(6),
    //             decimals: 6,
    //             asset_index: assets_list.head_assets as u8 - 1,
    //             ..Default::default()
    //         });

    //         // debt 50000
    //         assets_list.append_asset(Asset {
    //             twap: 5 * 10u64.pow(PRICE_OFFSET.into()),
    //             last_update: slot,
    //             ..Default::default()
    //         });
    //         assets_list.append_synthetic(Synthetic {
    //             supply: 10_000 * 10u64.pow(6),
    //             decimals: 6,
    //             asset_index: assets_list.head_assets as u8 - 1,
    //             ..Default::default()
    //         });
    //         let timestamp: i64 = 120;

    //         let assets_ref = RefCell::new(assets_list);
    //         // base debt 150000
    //         let total_debt = calculate_debt_with_interest(
    //             &mut state,
    //             &mut assets_ref.borrow_mut(),
    //             slot,
    //             timestamp,
    //         );
    //         // real     150_000.005_707... $
    //         // expected 150_000.005_708    $
    //         match total_debt {
    //             Ok(debt) => assert_eq!(debt, 150_000_005_708),
    //             Err(_) => assert!(false, "Shouldn't check"),
    //         }

    //         let usd = assets_ref.borrow().synthetics[0];
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_005_708);
    //         assert_eq!(accumulated_debt_interest, 5708);
    //         assert_eq!(last_debt_adjustment, 120);

    //         // timestamp that not trigger debt adjustment
    //         let timestamp: i64 = 150;

    //         let total_debt = calculate_debt_with_interest(
    //             &mut state,
    //             &mut assets_ref.borrow_mut(),
    //             slot,
    //             timestamp,
    //         );
    //         // debt should be the same
    //         match total_debt {
    //             Ok(debt) => assert_eq!(debt, 150_000_005_708),
    //             Err(_) => assert!(false, "Shouldn't check"),
    //         }

    //         let usd = assets_ref.borrow().synthetics[0];
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         // should be the same
    //         assert_eq!(usd_supply, 100_000_005_708);
    //         assert_eq!(accumulated_debt_interest, 5708);
    //         assert_eq!(last_debt_adjustment, 120);

    //         let timestamp: i64 = 185;

    //         let total_debt = calculate_debt_with_interest(
    //             &mut state,
    //             &mut assets_ref.borrow_mut(),
    //             slot,
    //             timestamp,
    //         );
    //         // real     150_000.008_561... $
    //         // expected 150_000.008_562    $
    //         match total_debt {
    //             Ok(debt) => assert_eq!(debt, 150_000_008_562),
    //             Err(_) => assert!(false, "Shouldn't check"),
    //         }

    //         let usd = assets_ref.borrow().synthetics[0];
    //         let usd_supply = usd.supply;
    //         let accumulated_debt_interest = state.accumulated_debt_interest;
    //         let last_debt_adjustment = state.last_debt_adjustment;
    //         assert_eq!(usd_supply, 100_000_008_562);
    //         assert_eq!(accumulated_debt_interest, 8562);
    //         assert_eq!(last_debt_adjustment, 180);
    //     }
    // }
}
