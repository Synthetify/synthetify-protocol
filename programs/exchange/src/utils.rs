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

    use super::*;
    use std::u64;

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
            assert_eq!(
                adjusted_state.staking.finished_round.start,
                original_state.staking.current_round.start
            );
            assert_eq!(
                adjusted_state.staking.current_round.start,
                original_state.staking.next_round.start
            );
            assert_eq!(
                adjusted_state.staking.next_round.start,
                original_state
                    .staking
                    .next_round
                    .start
                    .checked_add(staking_round_length.into())
                    .unwrap()
            );
            // change round length

            adjusted_state.staking.round_length = 25;
            adjust_staking_rounds(&mut adjusted_state, 401);
            assert_eq!(375, adjusted_state.staking.finished_round.start);
            assert_eq!(400, adjusted_state.staking.current_round.start);
            assert_eq!(425, adjusted_state.staking.next_round.start);
        }
    }
    #[test]
    fn test_div_up() {
        assert_eq!(div_up(0, 1), 0);
        assert_eq!(div_up(1, 2), 1);
        assert_eq!(div_up(2 * 10u128.pow(20) + 1, 2), 10u128.pow(20) + 1);
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
        // No tollerance
        assert!(check_feed_update(&list.assets, 0, 1, 0, 10).is_ok());
    }

    #[test]
    fn test_set_synthetic_supply() {
        // Regular
        {
            let mut synthetic = Synthetic {
                supply: 10,
                max_supply: 100,
                ..Default::default()
            };
            let result = set_synthetic_supply(&mut synthetic, 50);
            assert!(result.is_ok());
            assert_eq!(synthetic.max_supply, 100);
            assert_eq!(synthetic.supply, 50);
        }
        // Up to limit
        {
            let mut synthetic = Synthetic {
                supply: 10,
                max_supply: 100,
                ..Default::default()
            };
            let result = set_synthetic_supply(&mut synthetic, 100);
            assert!(result.is_ok());
            assert_eq!(synthetic.supply, 100);
        }
        // Over limit
        {
            let mut synthetic = Synthetic {
                supply: 10,
                max_supply: 100,
                ..Default::default()
            };
            let result = set_synthetic_supply(&mut synthetic, 101);
            assert!(result.is_err());
        }
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
            assert_eq!(amount, 0)
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
            assert_eq!(amount, 100)
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
            assert_eq!(amount, 0)
        }
    }
}
