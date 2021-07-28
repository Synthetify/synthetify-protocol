use std::{cell::RefMut, convert::TryInto};

use crate::*;

// Min decimals for asset = 6
pub const ACCURACY: u8 = 6;
pub const PRICE_OFFSET: u8 = 6;
pub const INTEREST_RATE_DECIMAL: u8 = 18;
pub const MIN_SWAP_USD_VALUE: u64 = 1000; // depends on ACCURACY
pub const MINUTES_IN_YEAR: u32 = 525600;

pub fn calculate_debt(assets_list: &RefMut<AssetsList>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u128;
    let synthetics = &assets_list.synthetics;
    let head = assets_list.head_synthetics as usize;
    for synthetic in synthetics[..head].iter() {
        let asset = &assets_list.assets[synthetic.asset_index as usize];
        if asset.last_update < (slot - max_delay as u64) {
            return Err(ErrorCode::OutdatedOracle.into());
        }

        // rounding up to be sure that debt is not less than minted tokens
        debt += div_up(
            (asset.price as u128)
                .checked_mul(synthetic.supply as u128)
                .unwrap(),
            10u128
                .checked_pow((synthetic.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        );
    }
    Ok(debt as u64)
}
pub fn calculate_max_debt_in_usd(account: &ExchangeAccount, assets_list: &AssetsList) -> u128 {
    let mut max_debt = 0u128;
    let head = account.head as usize;
    for collateral_entry in account.collaterals[..head].iter() {
        let collateral = &assets_list.collaterals[collateral_entry.index as usize];
        let asset = &assets_list.assets[collateral.asset_index as usize];
        // rounding up to be sure that debt is not less than minted tokens
        max_debt += (asset.price as u128)
            .checked_mul(collateral_entry.amount as u128)
            .unwrap()
            .checked_mul(collateral.collateral_ratio.into())
            .unwrap()
            .checked_div(100)
            .unwrap()
            .checked_div(
                10u128
                    .checked_pow((collateral.decimals + PRICE_OFFSET - ACCURACY).into())
                    .unwrap(),
            )
            .unwrap();
    }
    return max_debt;
}
pub fn calculate_user_debt_in_usd(
    user_account: &ExchangeAccount,
    debt: u64,
    debt_shares: u64,
) -> u64 {
    if debt_shares == 0 {
        return 0;
    }
    // rounding up to be sure that user debt is not less than user minted tokens
    let user_debt = div_up(
        (debt as u128)
            .checked_mul(user_account.debt_shares as u128)
            .unwrap(),
        debt_shares as u128,
    );
    return user_debt as u64;
}
pub fn calculate_new_shares_by_rounding_down(
    all_shares: u64,
    full_amount: u64,
    new_amount: u64,
) -> u64 {
    //  full_amount is always != 0 if all_shares > 0
    if all_shares == 0u64 {
        return new_amount;
    }
    let new_shares = (all_shares as u128)
        .checked_mul(new_amount as u128)
        .unwrap()
        .checked_div(full_amount as u128)
        .unwrap();

    return new_shares.try_into().unwrap();
}
pub fn calculate_new_shares_by_rounding_up(
    all_shares: u64,
    full_amount: u64,
    new_amount: u64,
) -> u64 {
    //  full_amount is always != 0 if all_shares > 0
    if all_shares == 0u64 {
        return new_amount;
    }
    let new_shares = div_up(
        (all_shares as u128)
            .checked_mul(new_amount as u128)
            .unwrap(),
        full_amount as u128,
    );

    return new_shares.try_into().unwrap();
}
pub fn calculate_max_withdraw_in_usd(
    max_user_debt_in_usd: u64,
    user_debt_in_usd: u64,
    collateral_ratio: u8,
    health_factor: u8,
) -> u64 {
    if max_user_debt_in_usd < user_debt_in_usd {
        return 0;
    }
    return (max_user_debt_in_usd - user_debt_in_usd)
        .checked_mul(10000)
        .unwrap()
        .checked_div(collateral_ratio as u64)
        .unwrap()
        .checked_div(health_factor.into())
        .unwrap();
}
pub fn amount_to_shares_by_rounding_down(all_shares: u64, full_amount: u64, amount: u64) -> u64 {
    // full_amount is always != 0 if all_shares > 0
    if all_shares == 0 {
        return 0;
    }
    let shares = (amount as u128)
        .checked_mul(all_shares as u128)
        .unwrap()
        .checked_div(full_amount as u128)
        .unwrap();
    return shares.try_into().unwrap();
}
pub fn amount_to_shares_by_rounding_up(all_shares: u64, full_amount: u64, amount: u64) -> u64 {
    // full_amount is always != 0 if all_shares > 0
    if all_shares == 0 {
        return 0;
    }
    let shares = div_up(
        (amount as u128).checked_mul(all_shares as u128).unwrap(),
        full_amount as u128,
    );
    return shares.try_into().unwrap();
}
pub fn amount_to_discount(amount: u64) -> u8 {
    // decimals of token = 6
    const ONE_SNY: u64 = 1_000_000u64;
    match () {
        () if amount < ONE_SNY * 100 => return 0,
        () if amount < ONE_SNY * 200 => return 1,
        () if amount < ONE_SNY * 500 => return 2,
        () if amount < ONE_SNY * 1_000 => return 3,
        () if amount < ONE_SNY * 2_000 => return 4,
        () if amount < ONE_SNY * 5_000 => return 5,
        () if amount < ONE_SNY * 10_000 => return 6,
        () if amount < ONE_SNY * 25_000 => return 7,
        () if amount < ONE_SNY * 50_000 => return 8,
        () if amount < ONE_SNY * 100_000 => return 9,
        () if amount < ONE_SNY * 250_000 => return 10,
        () if amount < ONE_SNY * 250_000 => return 10,
        () if amount < ONE_SNY * 500_000 => return 11,
        () if amount < ONE_SNY * 1_000_000 => return 12,
        () if amount < ONE_SNY * 2_000_000 => return 13,
        () if amount < ONE_SNY * 5_000_000 => return 14,
        () if amount < ONE_SNY * 10_000_000 => return 15,
        () => return 15,
    };
}
pub fn calculate_value_in_usd(price: u64, amount: u64, decimal: u8) -> u64 {
    return (price as u128)
        .checked_mul(amount as u128)
        .unwrap()
        .checked_div(10u128.checked_pow(decimal as u32).unwrap())
        .unwrap() as u64;
}
pub fn calculate_value_difference_in_usd(
    price_in: u64,
    amount_in: u64,
    decimal_in: u8,
    price_out: u64,
    amount_out: u64,
    decimal_out: u8,
) -> u64 {
    // price in should be always bigger than price out
    let value_in = calculate_value_in_usd(price_in, amount_in, decimal_in);
    let value_out = calculate_value_in_usd(price_out, amount_out, decimal_out);

    return value_in.checked_sub(value_out).unwrap();
}
pub fn calculate_swap_tax(total_fee: u64, swap_tax: u8) -> u64 {
    return (swap_tax as u128)
        .checked_mul(total_fee as u128)
        .unwrap()
        .checked_div(100)
        .unwrap() as u64;
}
pub fn calculate_swap_out_amount(
    asset_in: &Asset,
    asset_for: &Asset,
    synthetic_in: &Synthetic,
    synthetic_for: &Synthetic,
    amount: u64,
    fee: u32, // in range from 0-99 | 30/10000 => 0.3% fee
) -> (u64, u64) {
    let amount_before_fee = (asset_in.price as u128)
        .checked_mul(amount as u128)
        .unwrap()
        .checked_div(asset_for.price as u128)
        .unwrap();

    // If assets have different decimals we need to scale them.
    let decimal_difference = synthetic_for.decimals as i32 - synthetic_in.decimals as i32;
    let scaled_amount_before_fee = if decimal_difference < 0 {
        let decimal_change = 10u128.pow((-decimal_difference) as u32);
        amount_before_fee.checked_div(decimal_change).unwrap()
    } else {
        let decimal_change = 10u128.pow(decimal_difference as u32);
        amount_before_fee.checked_mul(decimal_change).unwrap()
    };

    let amount_after_fee = scaled_amount_before_fee
        .checked_sub(
            scaled_amount_before_fee
                .checked_mul(fee as u128)
                .unwrap()
                .checked_div(100000)
                .unwrap(),
        )
        .unwrap();

    let fee_in_usd = calculate_value_difference_in_usd(
        asset_in.price,
        amount as u64,
        synthetic_in.decimals,
        asset_for.price,
        amount_after_fee as u64,
        synthetic_for.decimals,
    );

    return (amount_after_fee.try_into().unwrap(), fee_in_usd);
}
pub fn calculate_burned_shares(
    asset: &Asset,
    synthetic: &Synthetic,
    all_debt: u64,
    all_shares: u64,
    amount: u64,
) -> u64 {
    if all_debt == 0 {
        return 0u64;
    }

    let burn_amount_in_usd = (asset.price as u128)
        .checked_mul(amount as u128)
        .unwrap()
        .checked_div(
            10u128
                .checked_pow((synthetic.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        )
        .unwrap();
    let burned_shares = burn_amount_in_usd
        .checked_mul(all_shares as u128)
        .unwrap()
        .checked_div(all_debt as u128)
        .unwrap();
    return burned_shares.try_into().unwrap();
}

// This should always retur user_debt if xusd === 1 USD
// Should we remove this funtion ?
pub fn calculate_max_burned_in_xusd(asset: &Asset, user_debt: u64) -> u64 {
    // rounding up to be sure that burned amount is not less than user debt
    let burned_amount_token = div_up(
        (user_debt as u128)
            .checked_mul(10u128.pow(PRICE_OFFSET.into()))
            .unwrap(),
        asset.price as u128,
    );
    return burned_amount_token.try_into().unwrap();
}
pub fn usd_to_token_amount(asset: &Asset, collateral: &Collateral, amount: u64) -> u64 {
    let decimal_difference = collateral.decimals as i32 - ACCURACY as i32;
    if decimal_difference < 0 {
        let amount = (amount as u128)
            .checked_mul(10u128.pow(PRICE_OFFSET.into()))
            .unwrap()
            .checked_div(10u128.pow(decimal_difference.try_into().unwrap()))
            .unwrap()
            .checked_div(asset.price as u128)
            .unwrap();
        return amount.try_into().unwrap();
    } else {
        let amount = (amount as u128)
            .checked_mul(10u128.pow(PRICE_OFFSET.into()))
            .unwrap()
            .checked_mul(10u128.pow(decimal_difference.try_into().unwrap()))
            .unwrap()
            .checked_div(asset.price as u128)
            .unwrap();
        return amount.try_into().unwrap();
    }
}
pub const CONFIDENCE_OFFSET: u8 = 6u8;

// confidence is in range 0 - 1000000
// 0 -> perfect price
// 100 -> 0.01% accuracy
// 1000 -> 0.1% accuracy
// 10000 -> 1% accuracy
pub fn calculate_confidence(conf: u64, price: i64) -> u32 {
    return (conf as u128)
        .checked_mul(10u128.pow(CONFIDENCE_OFFSET.into()))
        .unwrap()
        .checked_div(price.try_into().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
}
pub fn pow_with_accuracy(mut base: u128, mut exp: u128, accuracy: u8) -> u128 {
    let one = 1u128
        .checked_mul(10u128.checked_pow(accuracy.into()).unwrap())
        .unwrap();

    if exp == 0 {
        return one;
    }
    let mut result: u128 = one;

    while exp > 0 {
        if exp % 2 != 0 {
            result = result
                .checked_mul(base)
                .unwrap()
                .checked_div(10u128.checked_pow(accuracy.into()).unwrap())
                .unwrap();
        }
        exp /= 2;
        base = base
            .checked_mul(base)
            .unwrap()
            .checked_div(10u128.checked_pow(accuracy.into()).unwrap())
            .unwrap();
    }
    return result;
}
pub fn calculate_compounded_interest(
    base_value: u64,
    periodic_interest_rate: u128,
    periods_number: u128,
) -> u64 {
    // base_price * ((1 + periodic_interest_rate) ^ periods_number - 1)
    let interest_offset = 10u128.pow(INTEREST_RATE_DECIMAL.into());
    let interest = (periodic_interest_rate as u128)
        .checked_add(interest_offset)
        .unwrap();
    let compounded = pow_with_accuracy(interest, periods_number, INTEREST_RATE_DECIMAL)
        .checked_sub(interest_offset)
        .unwrap();
    let scaled_value = (base_value as u128).checked_mul(compounded).unwrap();

    return div_up(scaled_value, interest_offset).try_into().unwrap();
}
pub fn calculate_debt_interest_rate(debt_interest_rate: u8) -> u128 {
    // 1 -> 0.1%
    return (debt_interest_rate as u128)
        .checked_mul(10u128.checked_pow(INTEREST_RATE_DECIMAL.into()).unwrap())
        .unwrap()
        .checked_div(1000)
        .unwrap();
}
pub fn calculate_minute_interest_rate(apr: u128) -> u128 {
    return apr.checked_div(MINUTES_IN_YEAR.into()).unwrap();
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, ops::Div};

    use super::*;
    #[test]
    fn test_calculate_new_shares() {
        // Initialize shares
        {
            let collateral_shares = 0u64;
            let collateral_amount = 0u64;
            let to_deposit_amount = 10u64.pow(6);
            let new_shares_rounding_down = calculate_new_shares_by_rounding_down(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            let new_shares_rounding_up = calculate_new_shares_by_rounding_up(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            // Initial shares = deposited amount
            assert_eq!(new_shares_rounding_down, to_deposit_amount);
            assert_eq!(new_shares_rounding_up, to_deposit_amount);
        }
        // With existing shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = 10u64.pow(6);
            let to_deposit_amount = 10u64.pow(6);
            let new_shares_rounding_down = calculate_new_shares_by_rounding_down(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            let new_shares_rounding_up = calculate_new_shares_by_rounding_up(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            // Deposit same amount so new shares should eq existing
            assert_eq!(new_shares_rounding_down, collateral_shares);
            assert_eq!(new_shares_rounding_up, collateral_shares);
        }
        // Zero new shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = 10u64.pow(6);
            let to_deposit_amount = 0u64;
            let new_shares_rounding_down = calculate_new_shares_by_rounding_down(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            let new_shares_rounding_up = calculate_new_shares_by_rounding_up(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            // deposit 0
            assert_eq!(new_shares_rounding_down, 0u64);
            assert_eq!(new_shares_rounding_up, 0u64);
        }
        // Valid rounding
        {
            let collateral_shares = 10_001 * 10u64.pow(6);
            let collateral_amount = 988_409 * 10u64.pow(6);
            let to_deposit_amount = 579_112;
            let new_shares_rounding_down = calculate_new_shares_by_rounding_down(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            let new_shares_rounding_up = calculate_new_shares_by_rounding_up(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            // 5859,617...
            assert_eq!(new_shares_rounding_down, 5859);
            assert_eq!(new_shares_rounding_up, 5860);
        }
        // Test on big numbers
        {
            let collateral_shares = 100_000_000 * 10u64.pow(6);
            let collateral_amount = 100_000_000 * 10u64.pow(6);
            let to_deposit_amount = 10_000_000 * 10u64.pow(6);
            let new_shares_rounding_down = calculate_new_shares_by_rounding_down(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            let new_shares_rounding_up = calculate_new_shares_by_rounding_up(
                collateral_shares,
                collateral_amount,
                to_deposit_amount,
            );
            // Deposit  1/10 of existing balance
            assert_eq!(new_shares_rounding_down, collateral_shares.div(10));
            assert_eq!(new_shares_rounding_up, collateral_shares.div(10));
        }
    }
    #[test]
    fn test_calculate_max_withdraw_in_usd() {
        // user_debt == max_user_debt
        {
            let debt = 999_999_999;
            let max_debt = 999_999_999;
            let max_withdraw = calculate_max_withdraw_in_usd(max_debt, debt, 10, 100);
            assert_eq!(max_withdraw, 0);
        }
        // user_debt > max_user_debt
        {
            let debt = 1_000_000_000;
            let max_debt = 900_000_000;
            let max_withdraw = calculate_max_withdraw_in_usd(max_debt, debt, 10, 100);
            assert_eq!(max_withdraw, 0);
        }
        // user_debt < max_user_debt
        {
            let debt = 900_000_123;
            let max_debt = 1_000_000_000;
            let max_withdraw = calculate_max_withdraw_in_usd(max_debt, debt, 80, 100);
            // 124999846,25
            assert_eq!(max_withdraw, 124999846);
        }
        // other health factor
        {
            let debt = 900_000_000;
            let max_debt = 1_000_000_000;
            let max_withdraw = calculate_max_withdraw_in_usd(max_debt, debt, 10, 40);
            assert_eq!(max_withdraw, 2_500_000_000);
        }
    }
    #[test]
    fn test_calculate_debt() {
        {
            let slot = 100;
            // debt 0 - no assets
            let assets_list = AssetsList {
                ..Default::default()
            };
            let assets_ref = RefCell::new(assets_list);
            let assets_ref = assets_ref.borrow_mut();

            let result = calculate_debt(&assets_ref, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 0),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // debt 1000
            assets_list.append_asset(Asset {
                price: 10 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 100 * 10u64.pow(6),
                decimals: 6,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 2400
            assets_list.append_asset(Asset {
                price: 12 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 200 * 10u64.pow(6),
                decimals: 6,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 1000
            assets_list.append_asset(Asset {
                price: 20 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 50 * 10u64.pow(8),
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 4400
            let assets_ref = RefCell::new(assets_list);
            let assets_ref = assets_ref.borrow_mut();

            let result = calculate_debt(&assets_ref, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 4400_000000),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // debt 200_000_000
            assets_list.append_asset(Asset {
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 100_000_000 * 10u64.pow(6),
                decimals: 6,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 5_000_000_000
            assets_list.append_asset(Asset {
                price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 100_000 * 10u64.pow(8),
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 1_000_000
            assets_list.append_asset(Asset {
                price: (1 * 10u64.pow(PRICE_OFFSET.into())),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 1_000_000 * 10u64.pow(8),
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 5201000000_000000),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // debt 200_000_000
            assets_list.append_asset(Asset {
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 100_000_000 * 10u64.pow(8),
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 5_000_000_000
            assets_list.append_asset(Asset {
                price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 100_000 * 10u64.pow(8),
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 0.0001
            assets_list.append_asset(Asset {
                price: (0.0001 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: 1 * 10u64.pow(6),
                decimals: 6,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 0.152407...
            assets_list.append_asset(Asset {
                price: (1.2345 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: (0.12345678 * 10u64.pow(8) as f64) as u64,
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 5200000000_152508),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // debt 198807739,182321
            assets_list.append_asset(Asset {
                price: (1.567 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: (126871562.97531672 * 10u64.pow(8) as f64) as u64,
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 733398054,012891
            assets_list.append_asset(Asset {
                price: (51420.19 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: (14262.842164 * 10u64.pow(6) as f64) as u64,
                decimals: 6,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 5138,531149
            assets_list.append_asset(Asset {
                price: (3.9672 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: (1295.25386912 * 10u64.pow(8) as f64) as u64,
                decimals: 8,
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 932210931_726364),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
    }
    #[test]
    fn test_calculate_debt_error() {
        let slot = 100;
        let mut assets_list = AssetsList {
            ..Default::default()
        };

        // debt 1400
        assets_list.append_asset(Asset {
            price: 10 * 10u64.pow(PRICE_OFFSET.into()),
            last_update: slot - 10,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            supply: 100 * 10u64.pow(8),
            decimals: 8,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // debt 1000
        assets_list.append_asset(Asset {
            price: 12 * 10u64.pow(PRICE_OFFSET.into()),
            last_update: 100,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            supply: 200 * 10u64.pow(8),
            decimals: 8,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        let assets_ref = RefCell::new(assets_list);

        // debt 2400
        let result = calculate_debt(&assets_ref.borrow_mut(), slot, 0);
        assert!(result.is_err());
    }
    #[test]
    fn test_calculate_max_debt_in_usd() {
        let mut assets_list = AssetsList {
            ..Default::default()
        };
        // SNY
        assets_list.append_asset(Asset {
            price: 2 * 10u64.pow(PRICE_OFFSET.into()),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            decimals: 6,
            collateral_ratio: 50,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // BTC
        assets_list.append_asset(Asset {
            price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            decimals: 8,
            collateral_ratio: 50,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // SOL
        assets_list.append_asset(Asset {
            price: 25 * 10u64.pow(PRICE_OFFSET.into()),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            decimals: 4,
            collateral_ratio: 12,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // USD
        assets_list.append_asset(Asset {
            price: 10u64.pow(PRICE_OFFSET.into()),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            decimals: 6,
            collateral_ratio: 90,
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // No collaterals
        {
            let exchange_account = ExchangeAccount {
                ..Default::default()
            };
            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            assert_eq!(result, 0);
        }
        // Simple calculations
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                amount: 1 * 10u64.pow(6),
                index: 0,
                ..Default::default()
            });

            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            assert_eq!(result, 1 * 10u128.pow(6));
        }
        // Multiple collaterals
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            // 1 * 50000 * 0.5
            exchange_account.append(CollateralEntry {
                amount: 1 * 10u64.pow(6),
                index: 0,
                ..Default::default()
            });
            // 1 * 2 * 0.5
            exchange_account.append(CollateralEntry {
                amount: 1 * 10u64.pow(8),
                index: 1,
                ..Default::default()
            });
            // 1 * 25 * 0.12
            exchange_account.append(CollateralEntry {
                amount: 1 * 10u64.pow(4),
                index: 2,
                ..Default::default()
            });

            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            assert_eq!(result, 25_004 * 10u128.pow(6));
        }
        // Small numbers
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            // 1
            exchange_account.append(CollateralEntry {
                amount: 1,
                index: 0,
                ..Default::default()
            });
            // 500
            exchange_account.append(CollateralEntry {
                amount: 1,
                index: 2,
                ..Default::default()
            });

            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            assert_eq!(result, 301);
        }
        // Rounding down
        {
            let mut exchange_account = ExchangeAccount {
                ..Default::default()
            };
            exchange_account.append(CollateralEntry {
                amount: 1,
                index: 3,
                ..Default::default()
            });

            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            // 0.9
            assert_eq!(result, 0);
        }
    }
    #[test]
    fn test_calculate_user_debt() {
        {
            let user_account = ExchangeAccount {
                debt_shares: 0,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = 1_000_000;

            let result = calculate_user_debt_in_usd(&user_account, debt, 0);
            assert_eq!(result, 0);
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 100,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = 4400_162356;

            let result = calculate_user_debt_in_usd(&user_account, debt, 1234);
            assert_eq!(result, 356_577177)
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 1525783,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = 932210931_726361;

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, 115211)
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 9234567898765432,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = 526932210931_726361;

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, 394145294459_835461)
        }
    }
    #[test]
    fn test_amount_to_shares() {
        // not initialized shares
        {
            let all_shares = 0;
            let full_amount = 0;
            let amount = 0;

            let amount_by_rounding_down =
                amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
            let amount_by_rounding_up =
                amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
            assert_eq!(amount_by_rounding_down, 0);
            assert_eq!(amount_by_rounding_up, 0);
        }
        // zero amount
        {
            let all_shares = 100;
            let full_amount = 100 * 10u64.pow(6);
            let amount = 0;

            let amount_by_rounding_down =
                amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
            let amount_by_rounding_up =
                amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
            assert_eq!(amount_by_rounding_down, 0);
            assert_eq!(amount_by_rounding_up, 0);
        }
        // basic
        {
            let all_shares = 10;
            let full_amount = 100;
            let amount = 10;

            let amount_by_rounding_down =
                amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
            let amount_by_rounding_up =
                amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
            // 1/10 of all_shares
            assert_eq!(amount_by_rounding_down, 1);
            assert_eq!(amount_by_rounding_up, 1);
        }
        // large numbers
        {
            let all_shares = 10u64.pow(6);
            let full_amount = 1_000_000_000 * 10u64.pow(10);
            let amount = 198_112 * 10u64.pow(10);

            let amount_by_rounding_down =
                amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
            let amount_by_rounding_up =
                amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
            // 198,112
            assert_eq!(amount_by_rounding_down, 198);
            assert_eq!(amount_by_rounding_up, 199);
        }
    }
    #[test]
    fn test_amount_to_discount() {
        {
            let amount = 10u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 0)
        }
        {
            let amount = 100u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 1)
        }
        {
            let amount = 200u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 2)
        }
        {
            let amount = 350u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 2)
        }
        {
            let amount = 500u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 3)
        }
        {
            let amount = 1_000_000u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 13);
            let result = amount_to_discount(amount - 1);
            assert_eq!(result, 12);
            // max discount 20%
            let result = amount_to_discount(amount * 2);
            assert_eq!(result, 14);
        }
    }
    #[test]
    fn test_calculate_swap_out_amount() {
        {
            let asset_usd = Asset {
                price: 1 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let synthetic_usd = Synthetic {
                decimals: 6,
                ..Default::default()
            };
            let asset_btc = Asset {
                price: 50000 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let synthetic_btc = Synthetic {
                decimals: 8,
                ..Default::default()
            };
            let asset_eth = Asset {
                price: 2000 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let synthetic_eth = Synthetic {
                decimals: 7,
                ..Default::default()
            };
            let fee = 300u32;
            let (out_amount, swap_fee) = calculate_swap_out_amount(
                &asset_usd,
                &asset_btc,
                &synthetic_usd,
                &synthetic_btc,
                50000 * 10u64.pow(6),
                fee,
            );
            // out amount should be 0.997 BTC
            assert_eq!(out_amount, 0_99700000);
            // fee should be 150 USD
            assert_eq!(swap_fee, 150 * 10u64.pow(PRICE_OFFSET.into()));

            let (out_amount, swap_fee) = calculate_swap_out_amount(
                &asset_btc,
                &asset_usd,
                &synthetic_btc,
                &synthetic_usd,
                1 * 10u64.pow(8),
                fee,
            );
            // out amount should be 49850 USD
            assert_eq!(out_amount, 49850_000_000);
            // fee should be 150 USD
            assert_eq!(swap_fee, 150 * 10u64.pow(PRICE_OFFSET.into()));

            let (out_amount, swap_fee) = calculate_swap_out_amount(
                &asset_btc,
                &asset_eth,
                &synthetic_btc,
                &synthetic_eth,
                99700000,
                fee,
            );
            // out amount should be 24.850225 ETH
            assert_eq!(out_amount, 24_850_2250);
            // fee should be 149,55 USD
            assert_eq!(swap_fee, 14955 * 10u64.pow(4));
        }
    }
    #[test]
    fn test_calculate_burned_shares() {
        // all_debt
        {
            // 7772,102...
            let asset = Asset {
                price: 14 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let synthetic = Synthetic {
                decimals: 6,
                ..Default::default()
            };
            let all_debt = 1598;
            let all_shares = 90;
            let amount = 9857;
            let burned_shares =
                calculate_burned_shares(&asset, &synthetic, all_debt, all_shares, amount);
            assert_eq!(burned_shares, 7772);
        }
        // user_debt
        {
            // user_debt = 0
            let asset = Asset {
                price: 14 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let synthetic = Synthetic {
                decimals: 6,
                ..Default::default()
            };
            let user_debt = 0;
            let user_shares = 0;
            let amount = 0;
            let burned_shares =
                calculate_burned_shares(&asset, &synthetic, user_debt, user_shares, amount);
            assert_eq!(burned_shares, 0);
        }
    }
    #[test]
    fn test_calculate_value_in_usd() {
        // zero price
        {
            let price = 0;
            let amount = 2 * 10u64.pow(PRICE_OFFSET.into());
            let decimal = PRICE_OFFSET;
            let value_in_usd = calculate_value_in_usd(price, amount, decimal);
            // should be 0 USD
            assert_eq!(value_in_usd, 0);
        }
        // No amount
        {
            let price = 50 * 10u64.pow(PRICE_OFFSET.into());
            let amount = 0;
            let decimal = PRICE_OFFSET;
            let value_in_usd = calculate_value_in_usd(price, amount, decimal);
            // should be 0 USD
            assert_eq!(value_in_usd, 0);
        }
        // decimal same as xUSD
        {
            let price = 3 * 10u64.pow(PRICE_OFFSET.into());
            let amount = 2 * 10u64.pow(6);
            let decimal = PRICE_OFFSET;
            let value_in_usd = calculate_value_in_usd(price, amount, decimal);
            // should be 6 USD
            assert_eq!(value_in_usd, 6 * 10u64.pow(PRICE_OFFSET.into()));
        }
        // decimal lower than xUSD
        {
            let price = 112 * 10u64.pow(PRICE_OFFSET as u32);
            let amount = 2 * 10u64.pow(6);
            let decimal = 4;
            let value_in_usd = calculate_value_in_usd(price, amount, decimal);
            // should be 22400 USD
            assert_eq!(value_in_usd, 22_400 * 10u64.pow(PRICE_OFFSET.into()));
        }
        // decimal bigger than xUSD
        {
            let price = 91 * 10u64.pow(PRICE_OFFSET as u32);
            let amount = 2 * 10u64.pow(12);
            let decimal = 10;
            let value_in_usd = calculate_value_in_usd(price, amount, decimal);
            // should be 18200 USD
            assert_eq!(value_in_usd, 18_200 * 10u64.pow(PRICE_OFFSET.into()));
        }
    }
    #[test]
    fn test_calculate_value_difference_in_usd() {
        let xbtc_price = 30_000 * 10u64.pow(PRICE_OFFSET as u32);
        let xbtc_decimal = 8u8;

        let xusd_price = 1 * 10u64.pow(PRICE_OFFSET as u32);
        let xusd_decimal = 6u8;
        // xUSD -> xBTC
        {
            let xbtc_amount = 1 * 10u64.pow(8);
            let xusd_amount = 28_999 * 10u64.pow(6);

            let value_difference_in_usd = calculate_value_difference_in_usd(
                xbtc_price,
                xbtc_amount,
                xbtc_decimal,
                xusd_price,
                xusd_amount,
                xusd_decimal,
            );
            // should be 1_001
            assert_eq!(
                value_difference_in_usd,
                1_001 * 10u64.pow(PRICE_OFFSET as u32)
            );
        }
        // xBTC -> xUSD
        {
            let xbtc_amount = 89 * 10u64.pow(6);
            let xusd_amount = 35_000 * 10u64.pow(6);
            let value_difference_in_usd = calculate_value_difference_in_usd(
                xusd_price,
                xusd_amount,
                xusd_decimal,
                xbtc_price,
                xbtc_amount,
                xbtc_decimal,
            );
            // should be 8_300
            assert_eq!(value_difference_in_usd, 8_300 * 10u64.pow(6));
        }
    }

    #[test]
    fn test_calculate_swap_tax() {
        // MIN - 0%
        {
            let total_fee: u64 = 1_227_775;
            let swap_tax: u8 = 0;
            let swap_tax_in_usd = calculate_swap_tax(total_fee, swap_tax);
            // expect 0 tax
            assert_eq!(swap_tax_in_usd, 0);
        }
        // MAX - 20%
        {
            let total_fee: u64 = 1_227_775;
            let swap_tax: u8 = 20;
            let swap_tax = calculate_swap_tax(total_fee, swap_tax);
            // 245555
            assert_eq!(swap_tax, 245555);
        }
        // ~11% (valid rounding)
        {
            let total_fee: u64 = 1_227_775;
            let swap_tax: u8 = 11;
            // 135055,25
            let swap_tax = calculate_swap_tax(total_fee, swap_tax);
            assert_eq!(swap_tax, 135_055);
        }
    }

    #[test]
    fn test_usd_to_token_amount() {
        // round down
        {
            let asset = Asset {
                price: 14 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let collateral = Collateral {
                decimals: 6,
                ..Default::default()
            };

            let amount = 100;
            let token_amount = usd_to_token_amount(&asset, &collateral, amount);
            // 7,142...
            assert_eq!(token_amount, 7);
        }
        // large amount
        {
            let asset = Asset {
                price: 91 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let collateral = Collateral {
                decimals: 10,
                ..Default::default()
            };

            let amount = 1_003_900_802 * 10u64.pow(8);
            let token_amount = usd_to_token_amount(&asset, &collateral, amount);
            // 11031876945054945054
            assert_eq!(token_amount, 11031876945054945054)
        }
    }
    #[test]
    fn test_calculate_confidence() {
        let offset = 10u32.pow(CONFIDENCE_OFFSET.into());
        // 100% -> 1 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 100_000_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (1f64 * f64::from(offset)) as u32)
        }
        // 1% -> 0.01 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 1_000_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.01 * f64::from(offset)) as u32)
        }
        // 0.1% -> 0.001 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 100_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.001 * f64::from(offset)) as u32)
        }
        // 0.01% -> 0.0001 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 10_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.0001 * f64::from(offset)) as u32)
        }
    }
    #[test]
    fn test_pow_with_accuracy() {
        // Zero base
        {
            let decimal: u8 = PRICE_OFFSET;
            let offset: u128 = 10u128.pow(decimal.into());
            let base: u128 = 0;
            let exp: u128 = 100;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            assert_eq!(result, 0);
        }
        // Zero exponent
        {
            let decimal: u8 = PRICE_OFFSET;
            let offset: u128 = 10u128.pow(decimal.into());
            let base: u128 = 10;
            let exp: u128 = 0;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            assert_eq!(result, 1 * offset);
        }
        // 2^17, with price decimal
        {
            let decimal: u8 = PRICE_OFFSET;
            let offset: u128 = 10u128.pow(decimal.into());
            let base: u128 = 2;
            let exp: u128 = 17;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            // should be 131072
            assert_eq!(result, 131072 * offset);
        }
        // 1.00000002^525600, with interest decimal
        {
            let decimal: u8 = INTEREST_RATE_DECIMAL;
            let offset: u128 = 10u128.pow((decimal - 8).into());
            let base: u128 = 1_000_000_02;
            let exp: u128 = 525600;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            // expected 1.010567445075371...
            // real     1.010567445075377...
            assert_eq!(result, 1010567445075371366);
        }
        // 1.000000015^2, with interest decimal
        {
            let decimal: u8 = INTEREST_RATE_DECIMAL;
            let offset: u128 = 10u128.pow((decimal - 9).into());
            let base: u128 = 1_000_000_015;
            let exp: u128 = 2;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            // expected 1.000000030000000225
            // real     1.000000030000000225
            assert_eq!(result, 1000000030000000225); // TODO: fix
        }
        // 1^525600, with interest decimal
        {
            let decimal: u8 = INTEREST_RATE_DECIMAL;
            let offset: u128 = 10u128.pow((decimal).into());
            let base: u128 = 1;
            let exp: u128 = 525600;
            let result = pow_with_accuracy(base * offset, exp, decimal);
            // expected not change value
            assert_eq!(result, base * offset);
        }
    }
    #[test]
    fn test_calculate_compounded_interest() {
        // periods_number = 0
        {
            // value = 100 000$
            // period interest rate = 0.0000015%
            let base_value = 100_000 * 10u64.pow(PRICE_OFFSET.into());
            let period_interest_rate = 15 * 10u128.pow((INTEREST_RATE_DECIMAL - 9).into());
            let periods_number: u128 = 0;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // should be 0
            assert_eq!(compounded_value, 0);
        }
        // periods_number = 1
        {
            // value = 100 000$
            // period interest rate = 0.0000015%
            let base_value = 100_000 * 10u64.pow(PRICE_OFFSET.into());
            let period_interest_rate = 15 * 10u128.pow((INTEREST_RATE_DECIMAL - 9).into());
            let periods_number: u128 = 1;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 0.0015 $
            // real     0.0015... $
            assert_eq!(compounded_value, 1_500);
        }
        // period_number = 2
        {
            // value = 100 000$
            // period interest rate = 0.000001902587519%
            let base_value = 100_000 * 10u64.pow(PRICE_OFFSET.into());
            let period_interest_rate = 19025875190;
            let periods_number: u128 = 2;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 0.003806... $
            // real     0.0038051... $
            assert_eq!(compounded_value, 3_806);
        }
        // periods_number = 525600 (every minute of the year )
        {
            // value = 300 000$
            // period interest rate = 0.000002%
            let base_value = 300_000 * 10u64.pow(PRICE_OFFSET.into());
            let period_interest_rate = 2 * 10u128.pow((INTEREST_RATE_DECIMAL - 8).into());
            let periods_number: u128 = 525600;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 3170.233523... $
            // real     3170.233522... $
            assert_eq!(compounded_value, 3_170_233523);
        }
    }

    #[test]
    fn test_calculate_multi_compounded_interest() {
        let period_interest_rate: u128 = 2 * 10u128.pow((INTEREST_RATE_DECIMAL - 8).into());
        let start_value = 200_000 * 10u64.pow(PRICE_OFFSET.into());
        // irregular compound
        // 100_000 -> 10_000 -> 5 -> 415_595
        {
            let compounded_value =
                calculate_compounded_interest(start_value, period_interest_rate, 100_000);

            let base_value = start_value.checked_add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 10_000);

            let base_value = base_value.checked_add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 5);

            let base_value = base_value.checked_add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 415_595);

            let final_value = base_value.checked_add(compounded_value).unwrap();
            let interest_diff = final_value.checked_sub(start_value).unwrap();
            // real     2113.489015... $
            // expected 2113.489017... $
            assert_eq!(interest_diff, 2113489017);
        }
        // regular compound (every 3 minutes for the year)
        {
            let mut i: u128 = 0;
            let interval: u128 = 3;
            let mut base_value = start_value;
            loop {
                let compounded_value =
                    calculate_compounded_interest(base_value, period_interest_rate, interval);
                base_value = base_value.checked_add(compounded_value).unwrap();

                i += interval;
                if i >= 525600 {
                    break;
                }
            }
            let interest_diff = base_value.checked_sub(start_value).unwrap();
            // real     2113.4... $
            // expected 2113.5... $
            assert_eq!(interest_diff, 2113577183);
        }
    }

    #[test]
    fn test_calculate_debt_interest_rate() {
        let tenth_of_percent = 10u128.pow((INTEREST_RATE_DECIMAL - 3).into());
        // 0%
        {
            let debt_interest_rate = calculate_debt_interest_rate(0);
            assert_eq!(debt_interest_rate, 0);
        }
        // 0.1%
        {
            let debt_interest_rate = calculate_debt_interest_rate(1);
            assert_eq!(debt_interest_rate, tenth_of_percent);
        }
        // 1%
        {
            let debt_interest_rate = calculate_debt_interest_rate(10);
            assert_eq!(debt_interest_rate, 10 * tenth_of_percent);
        }
        // 20%
        {
            let debt_interest_rate = calculate_debt_interest_rate(200);
            assert_eq!(debt_interest_rate, 200 * tenth_of_percent);
        }
    }

    #[test]
    fn test_calculate_minute_interest_rate() {
        // 0%
        {
            let minute_interest_rate = calculate_minute_interest_rate(0);

            // should be 0
            assert_eq!(minute_interest_rate, 0);
        }
        // 1%
        {
            let one_percent: u128 = 10u128.pow((INTEREST_RATE_DECIMAL - 2).into());
            let minute_interest_rate = calculate_minute_interest_rate(one_percent);

            // real     0.0000019025875190... %
            // expected 0.0000019025875190    %
            assert_eq!(minute_interest_rate, 19025875190);
        }
        // 20%
        {
            let twenty_percent: u128 = 20 * 10u128.pow((INTEREST_RATE_DECIMAL - 2).into());
            let minute_interest_rate = calculate_minute_interest_rate(twenty_percent);

            // real     0.0000380517503805...%
            // expected 0.0000380517503805   %
            assert_eq!(minute_interest_rate, 380517503805);
        }
    }
}
