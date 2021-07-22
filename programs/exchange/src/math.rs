use std::{cell::RefMut, convert::TryInto, ops::Div};

use crate::*;

// Min decimals for asset = 6
pub const XUSD_DECIMAL: u8 = 6;
pub const ACCURACY: u8 = 6;
pub const PRICE_OFFSET: u8 = 6;

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
    // we want discounts start from 2000 -> 4000 ...
    let units = amount / 10u64.pow(6 + 3);
    if units == 0 {
        return 0;
    }
    let discount = log2(units);
    if discount > 20 {
        return 20;
    } else {
        return discount as u8;
    }
}
pub fn calculate_price_in_usd(price: u64, amount: u64, decimal: u8) -> u64 {
    let decimal_diff = (decimal as i32).checked_sub(XUSD_DECIMAL as i32).unwrap();
    // price * amount / decimal

    if decimal_diff > 0 {
        return (price as u128)
            .checked_mul(amount as u128)
            .unwrap()
            .checked_div(10u128.checked_pow(decimal_diff as u32).unwrap())
            .unwrap() as u64;
    } else {
        return (price as u128)
            .checked_mul(amount as u128)
            .unwrap()
            .checked_mul(10u128.checked_pow(-decimal_diff as u32).unwrap())
            .unwrap() as u64;
    }
}
pub fn calculate_swap_tax(total_fee: u64, swap_tax: u8) -> u64 {
    let divisor = 100u64.checked_mul(u8::MAX.into()).unwrap() as u128;

    return (swap_tax as u128)
        .checked_mul(20)
        .unwrap()
        .checked_mul(total_fee as u128)
        .unwrap()
        .checked_div(divisor)
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
    let in_usd = (asset_in.price as u128)
        .checked_mul(amount as u128)
        .unwrap();

    let amount_before_fee = in_usd.checked_div(asset_for.price as u128).unwrap();
    let amount = amount_before_fee
        .checked_sub(
            amount_before_fee
                .checked_mul(fee as u128)
                .unwrap()
                .checked_div(100000)
                .unwrap(),
        )
        .unwrap();
    // If assets have different decimals we need to scale them.
    let decimal_difference = synthetic_for.decimals as i32 - synthetic_in.decimals as i32;
    if decimal_difference < 0 {
        let decimal_change = 10u128.pow((-decimal_difference) as u32);
        let scaled_amount = amount.checked_div(decimal_change).unwrap();
        let out_usd = (asset_for.price as u128)
            .checked_mul(scaled_amount as u128)
            .unwrap();
        let fee_usd = in_usd.checked_sub(out_usd).unwrap() as u64;
        return (scaled_amount.try_into().unwrap(), fee_usd);
    } else {
        let decimal_change = 10u128.pow(decimal_difference as u32);
        let scaled_amount = amount.checked_mul(decimal_change).unwrap();
        let out_usd = (asset_for.price as u128)
            .checked_mul(scaled_amount as u128)
            .unwrap();
        let fee_usd = in_usd.checked_sub(out_usd).unwrap() as u64;
        return (scaled_amount.try_into().unwrap(), fee_usd);
    }
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
            let amount = 0u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 0)
        }
        {
            let amount = 12u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 0)
        }
        {
            let amount = 1_999u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 0)
        }
        {
            let amount = 2_000u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 1)
        }
        {
            let amount = 4_900u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 2)
        }
        {
            let amount = 1_024_000u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 10)
        }
        {
            let amount = 1_048_576_000u64 * 10u64.pow(6);
            let result = amount_to_discount(amount);
            assert_eq!(result, 20);
            let result = amount_to_discount(amount - 1);
            assert_eq!(result, 19);
            // max discount 20%
            let result = amount_to_discount(amount * 2);
            assert_eq!(result, 20);
        }
    }
    // fn test_calculate_swap_out_amount() {
    //     {
    //         let asset_usd = Asset {
    //             synthetic: Synthetic {
    //                 decimals: 6,
    //                 ..Default::default()
    //             },
    //             price: 1 * 10u64.pow(PRICE_OFFSET.into()),
    //             ..Default::default()
    //         };
    //         let asset_btc = Asset {
    //             synthetic: Synthetic {
    //                 decimals: 8,
    //                 ..Default::default()
    //             },
    //             price: 50000 * 10u64.pow(PRICE_OFFSET.into()),
    //             ..Default::default()
    //         };
    //         let asset_eth = Asset {
    //             synthetic: Synthetic {
    //                 decimals: 7,
    //                 ..Default::default()
    //             },
    //             price: 2000 * 10u64.pow(PRICE_OFFSET.into()),
    //             ..Default::default()
    //         };
    //         let fee = 300u32;
    //         let result =
    //             calculate_swap_out_amount(&asset_usd, &asset_btc, 50000 * 10u64.pow(6), fee);
    //         assert_eq!(result, 0_99700000);
    //         let result = calculate_swap_out_amount(&asset_btc, &asset_usd, 1 * 10u64.pow(8), fee);
    //         assert_eq!(result, 49850_000_000);
    //         let result = calculate_swap_out_amount(&asset_btc, &asset_eth, 99700000, fee);
    //         assert_eq!(result, 24_850_2250);
    //     }
    // }
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
    fn test_calculate_price_in_usd() {
        // zero price
        {
            let price = 0;
            let amount = 2 * 10u64.pow(6);
            let decimal = XUSD_DECIMAL;
            let price_in_usd = calculate_price_in_usd(price, amount, decimal);
            // should be 0 USD
            assert_eq!(price_in_usd, 0);
        }
        // No amount
        {
            let price = 50 * 10u64.pow(6);
            let amount = 0;
            let decimal = XUSD_DECIMAL;
            let price_in_usd = calculate_price_in_usd(price, amount, decimal);
            // should be 0 USD
            assert_eq!(price_in_usd, 0);
        }
        // decimal same as xUSD
        {
            let price = 3;
            let amount = 2 * 10u64.pow(6);
            let decimal = XUSD_DECIMAL;
            let price_in_usd = calculate_price_in_usd(price, amount, decimal);
            // should be 6 USD
            assert_eq!(price_in_usd, 6 * 10u64.pow(6));
        }
        // decimal lower than xUSD
        {
            let price = 112;
            let amount = 2 * 10u64.pow(6);
            let decimal = 4;
            let price_in_usd = calculate_price_in_usd(price, amount, decimal);
            // should be 22400 USD
            assert_eq!(price_in_usd, 22_400 * 10u64.pow(6));
        }
        // decimal bigger than xUSD
        {
            let price = 91;
            let amount = 2 * 10u64.pow(12);
            let decimal = 10;
            let price_in_usd = calculate_price_in_usd(price, amount, decimal);
            // should be 18200 USD
            assert_eq!(price_in_usd, 18_200 * 10u64.pow(6));
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
            let swap_tax: u8 = u8::MAX;
            let swap_tax = calculate_swap_tax(total_fee, swap_tax);
            // 245555
            assert_eq!(swap_tax, 245555);
        }
        // ~10,04% (valid rounding)
        {
            let total_fee: u64 = 1_227_775;
            let swap_tax: u8 = 128;
            // 123258,980392157
            let swap_tax = calculate_swap_tax(total_fee, swap_tax);
            assert_eq!(swap_tax, 123258);
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
}
