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

pub fn adjust_staking_rounds(staking: &mut Staking, slot: u64, debt_shares: u64) {
    if slot <= staking.next_round.start {
        return;
    } else {
        staking.finished_round = staking.current_round.clone();
        staking.current_round = staking.next_round.clone();
        staking.next_round = StakingRound {
            start: staking
                .next_round
                .start
                .checked_add(staking.round_length.into())
                .unwrap(),
            all_points: debt_shares,
            amount: staking.amount_per_round,
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

pub fn set_asset_supply(asset: &mut Asset, new_supply: u64) -> ProgramResult {
    if new_supply.gt(&asset.max_supply) {
        return Err(ErrorCode::MaxSupply.into());
    }
    asset.supply = new_supply;
    Ok(())
}

#[cfg(test)]
mod tests {

    use std::u64;

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
                start: slot + staking_round_length as u64,
            },
            next_round: StakingRound {
                all_points: 3,
                amount: amount_per_round,
                start: (slot + staking_round_length as u64)
                    .checked_add(staking_round_length.into())
                    .unwrap(),
            },
            ..Default::default()
        };

        {
            // Last update before finished round
            let mut exchange_account = ExchangeAccount {
                debt_shares: 10,
                collateral_shares: 100,
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
                collateral_shares: 100,
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
                collateral_shares: 100,
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
    fn adjust_staking_rounds_test() {
        let staking_round_length = 100;
        let amount_per_round = 300;
        let debt_shares = 999u64;
        let mut staking = Staking {
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
        {
            // Should stay same
            let staking_copy = staking.clone();
            adjust_staking_rounds(&mut staking, 10, debt_shares);
            assert_eq!(staking_copy, staking);
        }
        {
            // Should stay same
            let staking_copy = staking.clone();
            adjust_staking_rounds(&mut staking, 200, debt_shares);
            assert_eq!(staking_copy, staking);
        }
        {
            // Should push new staking round
            let staking_copy = staking.clone();
            adjust_staking_rounds(&mut staking, 201, debt_shares);
            assert_ne!(staking_copy, staking);
            assert_eq!(staking.finished_round, staking_copy.current_round);
            assert_eq!(staking.current_round, staking_copy.next_round);
            assert_eq!(
                staking.next_round,
                StakingRound {
                    start: staking_copy
                        .next_round
                        .start
                        .checked_add(staking_copy.round_length.into())
                        .unwrap(),
                    all_points: debt_shares,
                    amount: staking_copy.amount_per_round,
                }
            );
        }
    }
}
