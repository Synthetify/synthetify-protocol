use std::{cell::RefMut, convert::TryInto};

use crate::decimal::{Add, Div, DivScale, DivUp, Lt, Mul, MulUp, PowAccuracy, Sub};
use crate::*;

// Min decimals for asset = 6
pub const ACCURACY: u8 = 6; // xUSD decimal
pub const PRICE_OFFSET: u8 = 8;
pub const MINUTES_IN_YEAR: u32 = 525600;
pub const MIN_SWAP_USD_VALUE: Decimal = Decimal {
    val: 1000u128,
    scale: ACCURACY,
};

pub fn calculate_debt(
    assets_list: &RefMut<AssetsList>,
    slot: u64,
    max_delay: u32,
    twap: bool,
) -> Result<Decimal> {
    let mut debt = Decimal {
        val: 0,
        scale: ACCURACY,
    };
    let synthetics = &assets_list.synthetics;
    let head = assets_list.head_synthetics as usize;
    for synthetic in synthetics[..head].iter() {
        let asset = &assets_list.assets[synthetic.asset_index as usize];
        if asset.last_update < (slot - max_delay as u64) {
            return Err(ErrorCode::OutdatedOracle.into());
        }
        let price = match twap {
            true => asset.twap,
            _ => asset.price,
        };
        // rounding up to be sure that debt is not less than minted tokens

        debt = debt.add(price.mul_up(synthetic.supply).to_usd()).unwrap();
    }
    Ok(debt)
}
pub fn calculate_max_debt_in_usd(account: &ExchangeAccount, assets_list: &AssetsList) -> Decimal {
    let mut max_debt = Decimal {
        val: 10u128.pow(ACCURACY.into()),
        scale: ACCURACY,
    };
    let head = account.head as usize;
    for collateral_entry in account.collaterals[..head].iter() {
        let collateral = &assets_list.collaterals[collateral_entry.index as usize];
        let asset = &assets_list.assets[collateral.asset_index as usize];
        // rounding up to be sure that debt is not less than minted tokens

        let amount_of_collateral = Decimal {
            val: collateral_entry.amount.into(),
            scale: collateral.reserve_balance.scale,
        };

        max_debt = max_debt
            .add(
                asset
                    .price
                    .mul(amount_of_collateral)
                    .mul(collateral.collateral_ratio),
            )
            .unwrap();
    }
    return max_debt;
}
pub fn calculate_user_debt_in_usd(
    user_account: &ExchangeAccount,
    debt: Decimal,
    debt_shares: u64,
) -> Decimal {
    if debt_shares == 0 {
        return Decimal {
            val: 0,
            scale: ACCURACY,
        };
    }

    let debt_shares = Decimal {
        val: debt_shares.into(),
        scale: 0,
    };
    let user_shares = Decimal {
        val: user_account.debt_shares.into(),
        scale: 0,
    };

    debt.mul(user_shares).div_up(debt_shares).to_usd()
}
pub fn calculate_new_shares_by_rounding_down(
    all_shares: u64,
    full_amount: Decimal,
    new_amount: Decimal,
) -> u64 {
    //  full_amount is always != 0 if all_shares > 0
    if all_shares == 0u64 {
        return new_amount.val.try_into().unwrap();
    }
    Decimal::from_integer(all_shares)
        .mul(new_amount)
        .div(full_amount)
        .to_scale(0)
        .into()
}
pub fn calculate_new_shares_by_rounding_up(
    all_shares: u64,
    full_amount: Decimal,
    new_amount: Decimal,
) -> u64 {
    //  full_amount is always != 0 if all_shares > 0
    if all_shares == 0u64 {
        return new_amount.val.try_into().unwrap();
    }
    let all_shares_decimal = Decimal::from_integer(all_shares);
    all_shares_decimal
        .mul(new_amount)
        .div_up(full_amount)
        .to_scale(0)
        .into()
}
pub fn calculate_max_withdraw_in_usd(
    max_user_debt_in_usd: Decimal,
    user_debt_in_usd: Decimal,
    collateral_ratio: Decimal,
    health_factor: Decimal,
) -> Decimal {
    if max_user_debt_in_usd.lt(user_debt_in_usd).unwrap() {
        return Decimal::from_usd(0);
    }

    max_user_debt_in_usd
        .sub(user_debt_in_usd)
        .unwrap()
        .div(collateral_ratio)
        .div(health_factor)
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
pub fn amount_to_discount(amount: u64) -> Decimal {
    // decimals of token = 6
    const ONE_SNY: u64 = 1_000_000u64;
    let v: u16 = match () {
        () if amount < ONE_SNY * 100 => 0,
        () if amount < ONE_SNY * 200 => 1,
        () if amount < ONE_SNY * 500 => 2,
        () if amount < ONE_SNY * 1_000 => 3,
        () if amount < ONE_SNY * 2_000 => 4,
        () if amount < ONE_SNY * 5_000 => 5,
        () if amount < ONE_SNY * 10_000 => 6,
        () if amount < ONE_SNY * 25_000 => 7,
        () if amount < ONE_SNY * 50_000 => 8,
        () if amount < ONE_SNY * 100_000 => 9,
        () if amount < ONE_SNY * 250_000 => 10,
        () if amount < ONE_SNY * 250_000 => 10,
        () if amount < ONE_SNY * 500_000 => 11,
        () if amount < ONE_SNY * 1_000_000 => 12,
        () if amount < ONE_SNY * 2_000_000 => 13,
        () if amount < ONE_SNY * 5_000_000 => 14,
        () if amount < ONE_SNY * 10_000_000 => 15,
        () => 15,
    };
    return Decimal::from_percent(v);
}
pub fn calculate_value_in_usd(price: Decimal, amount: Decimal) -> Decimal {
    // return (price as u128)
    //     .checked_mul(amount as u128)
    //     .unwrap()
    //     .checked_div(
    //         10u128
    //             .checked_pow((decimal + PRICE_OFFSET - ACCURACY).into())
    //             .unwrap(),
    //     )
    //     .unwrap() as u64;

    price.mul(amount).to_usd()
}
pub fn calculate_swap_tax(total_fee: Decimal, swap_tax: Decimal) -> Decimal {
    return swap_tax.mul(total_fee);
}
pub fn calculate_swap_out_amount(
    asset_in: &Asset,
    asset_for: &Asset,
    amount: Decimal,
    fee: Decimal, // in range from 0-99 | 30/10000 => 0.3% fee
) -> Result<(Decimal, Decimal)> {
    let value_in_usd = (asset_in.price).mul(amount).to_usd();
    // Check min swap value
    if value_in_usd.lt(MIN_SWAP_USD_VALUE).unwrap() {
        return Err(ErrorCode::InsufficientValueTrade.into());
    }
    let fee = value_in_usd.mul(fee);
    let value_out_usd = value_in_usd.sub(fee).unwrap();
    let amount_out = usd_to_token_amount(asset_for, value_out_usd);
    return Ok((amount_out, fee));
}
pub fn calculate_burned_shares(
    asset: &Asset,
    all_debt: Decimal,
    all_shares: u64,
    amount: Decimal,
) -> u64 {
    if all_debt.val == 0 {
        return 0u64;
    }
    calculate_value_in_usd(asset.price, amount)
        .mul(Decimal {
            val: all_shares.into(),
            scale: 0,
        })
        .div(all_debt)
        .to_scale(0)
        .into()
}

// This should always return user_debt if xusd === 1 USD
// Should we remove this function ?
// pub fn calculate_max_burned_in_xusd(asset: &Asset, user_debt: u64) -> u64 {
//     // rounding up to be sure that burned amount is not less than user debt
//     let burned_amount_token = div_up(
//         (user_debt as u128)
//             .checked_mul(10u128.pow(PRICE_OFFSET.into()))
//             .unwrap(),
//         asset.price as u128,
//     );
//     return burned_amount_token.try_into().unwrap();
// }
pub fn usd_to_token_amount(asset: &Asset, value_in_usd: Decimal) -> Decimal {
    return value_in_usd.div_to_scale(asset.price, asset.price.scale);
}
pub const CONFIDENCE_OFFSET: u8 = 6u8;

// pub fn pow_with_accuracy(mut base: Decimal, mut exp: u128) -> Decimal {
//     let one = Decimal {
//         val: 1 * base.denominator(),
//         scale: base.scale,
//     };

//     if exp == 0 {
//         return one;
//     }
//     let mut result = one;

//     while exp > 0 {
//         if exp % 2 != 0 {
//             result = result.mul(base);
//         }
//         exp /= 2;
//         base = base.mul(base);
//     }
//     return result;
// }
pub fn calculate_compounded_interest(
    base_value: Decimal,
    periodic_interest_rate: Decimal,
    periods_number: u128,
) -> Decimal {
    // base_price * ((1 + periodic_interest_rate) ^ periods_number - 1)
    let one = Decimal {
        val: periodic_interest_rate.denominator(),
        scale: periodic_interest_rate.scale,
    };
    let interest = periodic_interest_rate.add(one).unwrap();
    let compounded = interest.pow_with_accuracy(periods_number).sub(one).unwrap();
    base_value.mul_up(compounded)
}
pub fn calculate_debt_interest_rate(debt_interest_rate: u16) -> Decimal {
    Decimal::from_percent(debt_interest_rate).to_interest_rate()
}
pub fn calculate_minute_interest_rate(apr: Decimal) -> Decimal {
    Decimal::from_interest_rate(apr.val.checked_div(MINUTES_IN_YEAR.into()).unwrap())
}

#[cfg(test)]
mod tests {

    use crate::decimal::INTEREST_RATE_SCALE;

    use super::*;
    use std::{cell::RefCell, ops::Div};

    #[test]
    fn test_calculate_new_shares() {
        // Initialize shares
        {
            let collateral_shares = 0u64;
            let collateral_amount = Decimal::from_usd(0);
            let to_deposit_amount = Decimal::from_usd(10u128.pow(6));
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
            assert_eq!(new_shares_rounding_down, to_deposit_amount.into());
            assert_eq!(new_shares_rounding_up, to_deposit_amount.into());
        }
        // With existing shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = Decimal::from_usd(10u128.pow(6));
            let to_deposit_amount = Decimal::from_usd(10u128.pow(6));
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
            let collateral_amount = Decimal::from_usd(10u128.pow(6));
            let to_deposit_amount = Decimal::from_usd(0);
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
            let collateral_amount = Decimal::from_usd(988_409 * 10u128.pow(6));
            let to_deposit_amount = Decimal::from_usd(579_112);
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
            let collateral_amount = Decimal::from_usd(100_000_000 * 10u128.pow(6));
            let to_deposit_amount = Decimal::from_usd(10_000_000 * 10u128.pow(6));
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
            let debt = Decimal::from_usd(999_999_999);
            let max_debt = Decimal::from_usd(999_999_999);
            let collateral_ratio = Decimal::from_percent(1000);
            let health_factor = Decimal::from_percent(10000);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            assert_eq!(max_withdraw, Decimal::from_usd(0));
        }
        // user_debt > max_user_debt
        {
            let debt = Decimal::from_usd(1_000_000_000);
            let max_debt = Decimal::from_usd(900_000_000);
            let collateral_ratio = Decimal::from_percent(1000);
            let health_factor = Decimal::from_percent(10000);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            assert_eq!(max_withdraw, Decimal::from_usd(0));
        }
        // user_debt < max_user_debt
        {
            let debt = Decimal::from_usd(900_000_123);
            let max_debt = Decimal::from_usd(1_000_000_000);
            let collateral_ratio = Decimal::from_percent(8000);
            let health_factor = Decimal::from_percent(10000);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            // 124999846,25
            assert_eq!(max_withdraw, Decimal::from_usd(124999846));
        }
        // other health factor
        {
            let debt = Decimal::from_usd(900_000_000);
            let max_debt = Decimal::from_usd(1_000_000_000);
            let collateral_ratio = Decimal::from_percent(1000);
            let health_factor = Decimal::from_percent(4000);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            assert_eq!(max_withdraw, Decimal::from_usd(2_500_000_000));
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

            let result = calculate_debt(&assets_ref, slot, 100, false);
            match result {
                Ok(debt) => assert_eq!(debt, Decimal::from_usd(0)),
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
                price: Decimal::from_integer(10).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100).to_scale(6),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 2400
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(12).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(200).to_scale(6),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 1000
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(20).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(50).to_scale(8),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 4400
            let assets_ref = RefCell::new(assets_list);
            let assets_ref = assets_ref.borrow_mut();

            let result = calculate_debt(&assets_ref, slot, 100, false);
            match result {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(4400).to_usd()),
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
                price: Decimal::from_integer(2).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000_000).to_scale(6),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 5_000_000_000
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(50_000).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000).to_scale(8),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // debt 1_000_000
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(1).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(1_000_000).to_scale(8),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
            match result {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(5201000000).to_usd()),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        // {
        //     let slot = 100;
        //     let mut assets_list = AssetsList {
        //         ..Default::default()
        //     };

        //     // debt 200_000_000
        //     assets_list.append_asset(Asset {
        //         price: 2 * 10u64.pow(PRICE_OFFSET.into()),
        //         last_update: slot - 10,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: 100_000_000 * 10u64.pow(8),
        //         decimals: 8,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     // debt 5_000_000_000
        //     assets_list.append_asset(Asset {
        //         price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
        //         last_update: 100,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: 100_000 * 10u64.pow(8),
        //         decimals: 8,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     // debt 0.0001
        //     assets_list.append_asset(Asset {
        //         price: (0.0001 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
        //         last_update: 100,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: 1 * 10u64.pow(6),
        //         decimals: 6,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     // debt 0.152407...
        //     assets_list.append_asset(Asset {
        //         price: (1.2345 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
        //         last_update: 100,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: (0.12345678 * 10u64.pow(8) as f64) as u64,
        //         decimals: 8,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     let assets_ref = RefCell::new(assets_list);

        //     let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
        //     match result {
        //         Ok(debt) => assert_eq!(debt, 5200000000_152508),
        //         Err(_) => assert!(false, "Shouldn't check"),
        //     }
        // }
        // {
        //     let slot = 100;
        //     let mut assets_list = AssetsList {
        //         ..Default::default()
        //     };

        //     // debt 198807739,182321
        //     assets_list.append_asset(Asset {
        //         price: (1.567 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
        //         last_update: slot - 10,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: (126871562.97531672 * 10u64.pow(8) as f64) as u64,
        //         decimals: 8,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     // debt 733398054,012891
        //     assets_list.append_asset(Asset {
        //         price: (51420.19 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
        //         last_update: 100,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: (14262.842164 * 10u64.pow(6) as f64) as u64,
        //         decimals: 6,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     // debt 5138,531149
        //     assets_list.append_asset(Asset {
        //         price: (3.9672 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
        //         last_update: 100,
        //         ..Default::default()
        //     });
        //     assets_list.append_synthetic(Synthetic {
        //         supply: (1295.25386912 * 10u64.pow(8) as f64) as u64,
        //         decimals: 8,
        //         asset_index: assets_list.head_assets as u8 - 1,
        //         ..Default::default()
        //     });

        //     let assets_ref = RefCell::new(assets_list);

        //     let result = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
        //     match result {
        //         Ok(debt) => assert_eq!(debt, 932210931_726364),
        //         Err(_) => assert!(false, "Shouldn't check"),
        //     }
        // }
    }
    // #[test]
    // fn test_calculate_debt_error() {
    //     let slot = 100;
    //     let mut assets_list = AssetsList {
    //         ..Default::default()
    //     };

    //     // debt 1400
    //     assets_list.append_asset(Asset {
    //         price: 10 * 10u64.pow(PRICE_OFFSET.into()),
    //         last_update: slot - 10,
    //         ..Default::default()
    //     });
    //     assets_list.append_synthetic(Synthetic {
    //         supply: 100 * 10u64.pow(8),
    //         decimals: 8,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     // debt 1000
    //     assets_list.append_asset(Asset {
    //         price: 12 * 10u64.pow(PRICE_OFFSET.into()),
    //         last_update: 100,
    //         ..Default::default()
    //     });
    //     assets_list.append_synthetic(Synthetic {
    //         supply: 200 * 10u64.pow(8),
    //         decimals: 8,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     let assets_ref = RefCell::new(assets_list);

    //     // debt 2400
    //     let result = calculate_debt(&assets_ref.borrow_mut(), slot, 0, false);
    //     assert!(result.is_err());
    // }
    // #[test]
    // fn test_calculate_max_debt_in_usd() {
    //     let mut assets_list = AssetsList {
    //         ..Default::default()
    //     };
    //     // SNY
    //     assets_list.append_asset(Asset {
    //         price: 2 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     });
    //     assets_list.append_collateral(Collateral {
    //         decimals: 6,
    //         collateral_ratio: 50,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     // BTC
    //     assets_list.append_asset(Asset {
    //         price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     });
    //     assets_list.append_collateral(Collateral {
    //         decimals: 8,
    //         collateral_ratio: 50,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     // SOL
    //     assets_list.append_asset(Asset {
    //         price: 25 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     });
    //     assets_list.append_collateral(Collateral {
    //         decimals: 4,
    //         collateral_ratio: 12,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     // USD
    //     assets_list.append_asset(Asset {
    //         price: 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     });
    //     assets_list.append_collateral(Collateral {
    //         decimals: 6,
    //         collateral_ratio: 90,
    //         asset_index: assets_list.head_assets as u8 - 1,
    //         ..Default::default()
    //     });

    //     // No collaterals
    //     {
    //         let exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
    //         assert_eq!(result, 0);
    //     }
    //     // Simple calculations
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         exchange_account.append(CollateralEntry {
    //             amount: 1 * 10u64.pow(6),
    //             index: 0,
    //             ..Default::default()
    //         });

    //         let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
    //         assert_eq!(result, 1 * 10u128.pow(6));
    //     }
    //     // Multiple collaterals
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         // 1 * 50000 * 0.5
    //         exchange_account.append(CollateralEntry {
    //             amount: 1 * 10u64.pow(6),
    //             index: 0,
    //             ..Default::default()
    //         });
    //         // 1 * 2 * 0.5
    //         exchange_account.append(CollateralEntry {
    //             amount: 1 * 10u64.pow(8),
    //             index: 1,
    //             ..Default::default()
    //         });
    //         // 1 * 25 * 0.12
    //         exchange_account.append(CollateralEntry {
    //             amount: 1 * 10u64.pow(4),
    //             index: 2,
    //             ..Default::default()
    //         });

    //         let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
    //         assert_eq!(result, 25_004 * 10u128.pow(6));
    //     }
    //     // Small numbers
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         // 1
    //         exchange_account.append(CollateralEntry {
    //             amount: 1,
    //             index: 0,
    //             ..Default::default()
    //         });
    //         // 500
    //         exchange_account.append(CollateralEntry {
    //             amount: 1,
    //             index: 2,
    //             ..Default::default()
    //         });

    //         let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
    //         assert_eq!(result, 301);
    //     }
    //     // Rounding down
    //     {
    //         let mut exchange_account = ExchangeAccount {
    //             ..Default::default()
    //         };
    //         exchange_account.append(CollateralEntry {
    //             amount: 1,
    //             index: 3,
    //             ..Default::default()
    //         });

    //         let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
    //         // 0.9
    //         assert_eq!(result, 0);
    //     }
    // }
    // #[test]
    // fn test_calculate_user_debt() {
    //     {
    //         let user_account = ExchangeAccount {
    //             debt_shares: 0,
    //             owner: Pubkey::default(),
    //             ..Default::default()
    //         };
    //         let debt = 1_000_000;

    //         let result = calculate_user_debt_in_usd(&user_account, debt, 0);
    //         assert_eq!(result, 0);
    //     }
    //     {
    //         let user_account = ExchangeAccount {
    //             debt_shares: 100,
    //             owner: Pubkey::default(),
    //             ..Default::default()
    //         };
    //         let debt = 4400_162356;

    //         let result = calculate_user_debt_in_usd(&user_account, debt, 1234);
    //         assert_eq!(result, 356_577177)
    //     }
    //     {
    //         let user_account = ExchangeAccount {
    //             debt_shares: 1525783,
    //             owner: Pubkey::default(),
    //             ..Default::default()
    //         };
    //         let debt = 932210931_726361;

    //         let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
    //         assert_eq!(result, 115211)
    //     }
    //     {
    //         let user_account = ExchangeAccount {
    //             debt_shares: 9234567898765432,
    //             owner: Pubkey::default(),
    //             ..Default::default()
    //         };
    //         let debt = 526932210931_726361;

    //         let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
    //         assert_eq!(result, 394145294459_835461)
    //     }
    // }
    // #[test]
    // fn test_amount_to_shares() {
    //     // not initialized shares
    //     {
    //         let all_shares = 0;
    //         let full_amount = 0;
    //         let amount = 0;

    //         let amount_by_rounding_down =
    //             amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
    //         let amount_by_rounding_up =
    //             amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
    //         assert_eq!(amount_by_rounding_down, 0);
    //         assert_eq!(amount_by_rounding_up, 0);
    //     }
    //     // zero amount
    //     {
    //         let all_shares = 100;
    //         let full_amount = 100 * 10u64.pow(6);
    //         let amount = 0;

    //         let amount_by_rounding_down =
    //             amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
    //         let amount_by_rounding_up =
    //             amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
    //         assert_eq!(amount_by_rounding_down, 0);
    //         assert_eq!(amount_by_rounding_up, 0);
    //     }
    //     // basic
    //     {
    //         let all_shares = 10;
    //         let full_amount = 100;
    //         let amount = 10;

    //         let amount_by_rounding_down =
    //             amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
    //         let amount_by_rounding_up =
    //             amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
    //         // 1/10 of all_shares
    //         assert_eq!(amount_by_rounding_down, 1);
    //         assert_eq!(amount_by_rounding_up, 1);
    //     }
    //     // large numbers
    //     {
    //         let all_shares = 10u64.pow(6);
    //         let full_amount = 1_000_000_000 * 10u64.pow(10);
    //         let amount = 198_112 * 10u64.pow(10);

    //         let amount_by_rounding_down =
    //             amount_to_shares_by_rounding_down(all_shares, full_amount, amount);
    //         let amount_by_rounding_up =
    //             amount_to_shares_by_rounding_up(all_shares, full_amount, amount);
    //         // 198,112
    //         assert_eq!(amount_by_rounding_down, 198);
    //         assert_eq!(amount_by_rounding_up, 199);
    //     }
    // }
    // #[test]
    // fn test_amount_to_discount() {
    //     {
    //         let amount = 10u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 0)
    //     }
    //     {
    //         let amount = 100u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 1)
    //     }
    //     {
    //         let amount = 200u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 2)
    //     }
    //     {
    //         let amount = 350u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 2)
    //     }
    //     {
    //         let amount = 500u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 3)
    //     }
    //     {
    //         let amount = 1_000_000u64 * 10u64.pow(6);
    //         let result = amount_to_discount(amount);
    //         assert_eq!(result, 13);
    //         let result = amount_to_discount(amount - 1);
    //         assert_eq!(result, 12);
    //         // max discount 20%
    //         let result = amount_to_discount(amount * 2);
    //         assert_eq!(result, 14);
    //     }
    // }
    // #[test]
    // fn test_calculate_swap_out_amount() {
    //     let asset_usd = Asset {
    //         price: 1 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     };
    //     let synthetic_usd = Synthetic {
    //         decimals: 6,
    //         ..Default::default()
    //     };
    //     let asset_btc = Asset {
    //         price: 50000 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     };
    //     let synthetic_btc = Synthetic {
    //         decimals: 8,
    //         ..Default::default()
    //     };
    //     let asset_eth = Asset {
    //         price: 2000 * 10u64.pow(PRICE_OFFSET.into()),
    //         ..Default::default()
    //     };
    //     let synthetic_eth = Synthetic {
    //         decimals: 7,
    //         ..Default::default()
    //     };
    //     let fee = 300u32;
    //     // should fail because swap value is too low
    //     {
    //         let result = calculate_swap_out_amount(
    //             &asset_usd,
    //             &asset_btc,
    //             &synthetic_usd,
    //             &synthetic_btc,
    //             10,
    //             fee,
    //         );
    //         assert!(result.is_err());
    //     }
    //     {
    //         let (out_amount, swap_fee) = calculate_swap_out_amount(
    //             &asset_usd,
    //             &asset_btc,
    //             &synthetic_usd,
    //             &synthetic_btc,
    //             50000 * 10u64.pow(ACCURACY.into()),
    //             fee,
    //         )
    //         .unwrap();
    //         // out amount should be 0.997 BTC
    //         assert_eq!(out_amount, 0_99700000);
    //         // fee should be 150 USD
    //         assert_eq!(swap_fee, 150 * 10u64.pow(ACCURACY.into()));
    //     }
    //     {
    //         let (out_amount, swap_fee) = calculate_swap_out_amount(
    //             &asset_btc,
    //             &asset_usd,
    //             &synthetic_btc,
    //             &synthetic_usd,
    //             1 * 10u64.pow(synthetic_btc.decimals.into()),
    //             fee,
    //         )
    //         .unwrap();
    //         // out amount should be 49850 USD
    //         assert_eq!(out_amount, 49850_000_000);
    //         // fee should be 150 USD
    //         assert_eq!(swap_fee, 150 * 10u64.pow(ACCURACY.into()));
    //     }
    //     {
    //         let (out_amount, swap_fee) = calculate_swap_out_amount(
    //             &asset_btc,
    //             &asset_eth,
    //             &synthetic_btc,
    //             &synthetic_eth,
    //             99700000,
    //             fee,
    //         )
    //         .unwrap();
    //         // out amount should be 24.850225 ETH
    //         assert_eq!(out_amount, 24_850_2250);
    //         // fee should be 149,55 USD
    //         assert_eq!(swap_fee, 14955 * 10u64.pow(4));
    //     }
    // }
    // #[test]
    // fn test_calculate_burned_shares() {
    //     // all_debt
    //     {
    //         // 7772,102...
    //         let asset = Asset {
    //             price: 14 * 10u64.pow(PRICE_OFFSET.into()),
    //             ..Default::default()
    //         };
    //         let synthetic = Synthetic {
    //             decimals: 6,
    //             ..Default::default()
    //         };
    //         let all_debt = 1598;
    //         let all_shares = 90;
    //         let amount = 9857;
    //         let burned_shares =
    //             calculate_burned_shares(&asset, &synthetic, all_debt, all_shares, amount);
    //         assert_eq!(burned_shares, 7772);
    //     }
    //     // user_debt
    //     {
    //         // user_debt = 0
    //         let asset = Asset {
    //             price: 14 * 10u64.pow(PRICE_OFFSET.into()),
    //             ..Default::default()
    //         };
    //         let synthetic = Synthetic {
    //             decimals: 6,
    //             ..Default::default()
    //         };
    //         let user_debt = 0;
    //         let user_shares = 0;
    //         let amount = 0;
    //         let burned_shares =
    //             calculate_burned_shares(&asset, &synthetic, user_debt, user_shares, amount);
    //         assert_eq!(burned_shares, 0);
    //     }
    // }
    // #[test]
    // fn test_calculate_value_in_usd() {
    //     // zero price
    //     {
    //         let price = 0;
    //         let amount = 2 * 10u64.pow(PRICE_OFFSET.into());
    //         let decimal = PRICE_OFFSET;
    //         let value_in_usd = calculate_value_in_usd(price, amount, decimal);
    //         // should be 0 USD
    //         assert_eq!(value_in_usd, 0);
    //     }
    //     // No amount
    //     {
    //         let price = 50 * 10u64.pow(PRICE_OFFSET.into());
    //         let amount = 0;
    //         let decimal = PRICE_OFFSET;
    //         let value_in_usd = calculate_value_in_usd(price, amount, decimal);
    //         // should be 0 USD
    //         assert_eq!(value_in_usd, 0);
    //     }
    //     // decimal same as xUSD
    //     {
    //         let price = 3 * 10u64.pow(PRICE_OFFSET.into());
    //         let amount = 2 * 10u64.pow(ACCURACY.into());
    //         let decimal = ACCURACY;
    //         let value_in_usd = calculate_value_in_usd(price, amount, decimal);
    //         // should be 6 USD
    //         assert_eq!(value_in_usd, 6 * 10u64.pow(ACCURACY.into()));
    //     }
    //     // decimal lower than xUSD
    //     {
    //         let price = 112 * 10u64.pow(PRICE_OFFSET as u32);
    //         let amount = 2 * 10u64.pow(6);
    //         let decimal = 4;
    //         let value_in_usd = calculate_value_in_usd(price, amount, decimal);
    //         // should be 22400 USD
    //         assert_eq!(value_in_usd, 22_400 * 10u64.pow(ACCURACY.into()));
    //     }
    //     // decimal bigger than xUSD
    //     {
    //         let price = 91 * 10u64.pow(PRICE_OFFSET as u32);
    //         let amount = 2 * 10u64.pow(12);
    //         let decimal = 10;
    //         let value_in_usd = calculate_value_in_usd(price, amount, decimal);
    //         // should be 18200 USD
    //         assert_eq!(value_in_usd, 18_200 * 10u64.pow(ACCURACY.into()));
    //     }
    // }
    // #[test]
    // fn test_calculate_swap_tax() {
    //     // MIN - 0%
    //     {
    //         let total_fee: u64 = 1_227_775;
    //         let swap_tax: Decimal = Decimal { val: 0, scale: 9 };
    //         let swap_tax_in_usd = calculate_swap_tax(total_fee, swap_tax);
    //         // expect 0 tax
    //         assert_eq!(swap_tax_in_usd, 0);
    //     }
    //     // MAX - 20%
    //     {
    //         let total_fee: u64 = 1_227_775;
    //         let swap_tax: Decimal = Decimal {
    //             val: 20_000,
    //             scale: 5,
    //         };

    //         let swap_tax = calculate_swap_tax(total_fee, swap_tax);
    //         // 245555
    //         assert_eq!(swap_tax, 245555);
    //     }
    //     // ~11% (valid rounding)
    //     {
    //         let total_fee: u64 = 1_227_775;
    //         let swap_tax: Decimal = Decimal {
    //             val: 11_000,
    //             scale: 5,
    //         };
    //         // 135055,25
    //         let swap_tax = calculate_swap_tax(total_fee, swap_tax);
    //         assert_eq!(swap_tax, 135_055);
    //     }
    // }

    // #[test]
    // fn test_usd_to_token_amount() {
    //     // round down
    //     {
    //         let asset = Asset {
    //             price: Decimal::from_price(14 * 10u128.pow(PRICE_OFFSET.into())),
    //             ..Default::default()
    //         };
    //         let value = Decimal::from_usd(100);
    //         let token_amount = usd_to_token_amount(&asset, value);
    //         // 7,142...
    //         let expected = Decimal {
    //             val: 7,
    //             scale: asset.price.scale,
    //         };
    //         assert!(token_amount.eq(&expected));
    //     }
    //     // large amount
    //     {
    //         let asset = Asset {
    //             price: Decimal::from_price(91 * 10u128.pow(PRICE_OFFSET.into())),
    //             ..Default::default()
    //         };
    //         let value = Decimal::from_usd(100_003_900_802 * 10u128.pow(ACCURACY));
    //         let token_amount = usd_to_token_amount(&asset, value);
    //         // 11031876945054945054
    //         let expected = Decimal {
    //             val: 11031876945054945054,
    //             scale: asset.price.scale,
    //         };
    //         assert!(token_amount.eq(&expected));
    //     }
    // }
    #[test]
    fn test_calculate_compounded_interest() {
        // periods_number = 0
        {
            // value = 100 000$
            // period interest rate = 0.0000015% = 15 * 10^(-9)
            let base_value = Decimal::from_integer(100_000).to_usd();
            let period_interest_rate = Decimal::new(15, 9).to_interest_rate();
            let periods_number: u128 = 0;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // should be 0
            assert_eq!(compounded_value, Decimal::new(0, base_value.scale));
        }
        // periods_number = 1
        {
            // value = 100 000$
            // period interest rate = 0.0000015% = 15 * 10^(-9)
            let base_value = Decimal::from_integer(100_000).to_usd();
            let period_interest_rate = Decimal::new(15, 9).to_interest_rate();
            let periods_number: u128 = 1;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 0.0015 $
            // real     0.0015... $
            let expected = Decimal::new(1_500, base_value.scale);
            assert_eq!(compounded_value, expected);
        }
        // period_number = 2
        {
            // value = 100 000$
            // period interest rate = 0.000001902587519%
            let base_value = Decimal::from_integer(100_000).to_usd();
            let period_interest_rate = Decimal::from_interest_rate(19025875190);
            let periods_number: u128 = 2;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 0.003806... $
            // real     0.0038051... $
            let expected = Decimal::new(3_806, base_value.scale);
            assert_eq!(compounded_value, expected);
        }
        // periods_number = 525600 (every minute of the year )
        {
            // value = 300 000$
            // period interest rate = 0.000002% = 2 * 10^(-8)
            let base_value = Decimal::from_integer(300_000).to_usd();
            let period_interest_rate = Decimal::new(2, 8).to_interest_rate();
            let periods_number: u128 = 525600;
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, periods_number);
            // expected 3170.233523... $
            // real     3170.233522... $
            let expected = Decimal::new(3_170_233523, base_value.scale);
            assert_eq!(compounded_value, expected);
        }
    }

    #[test]
    fn test_calculate_multi_compounded_interest() {
        // start value 200 000 $
        // period interest rate = 0.000002% = 2 * 10^(-8)
        let period_interest_rate = Decimal::new(2, 8).to_interest_rate();
        let start_value = Decimal::from_integer(200_000).to_usd();
        // irregular compound
        // [period number] 100_000 -> 10_000 -> 5 -> 415_595
        {
            let compounded_value =
                calculate_compounded_interest(start_value, period_interest_rate, 100_000);

            let base_value = start_value.add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 10_000);

            let base_value = base_value.add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 5);

            let base_value = base_value.add(compounded_value).unwrap();
            let compounded_value =
                calculate_compounded_interest(base_value, period_interest_rate, 415_595);

            let final_value = base_value.add(compounded_value).unwrap();
            let interest_diff = final_value.sub(start_value).unwrap();
            // real     2113.489015... $
            // expected 2113.489017... $
            let expected = Decimal::new(2113489017, ACCURACY);
            assert_eq!(interest_diff, expected);
        }
        // regular compound (every 3 minutes for the year)
        {
            let mut i: u128 = 0;
            let interval: u128 = 3;
            let mut base_value = start_value;
            loop {
                let compounded_value =
                    calculate_compounded_interest(base_value, period_interest_rate, interval);
                base_value = base_value.add(compounded_value).unwrap();

                i += interval;
                if i >= MINUTES_IN_YEAR.into() {
                    break;
                }
            }
            let interest_diff = base_value.sub(start_value).unwrap();
            // real     2113.4... $
            // expected 2113.5... $
            let expected = Decimal::new(2113577183, ACCURACY);
            assert_eq!(interest_diff, expected);
        }
    }

    #[test]
    fn test_calculate_minute_interest_rate() {
        // 0%
        {
            let apr = Decimal::from_interest_rate(0);
            let minute_interest_rate = calculate_minute_interest_rate(apr);
            // should be 0
            let expected = Decimal::from_interest_rate(0);
            assert_eq!(minute_interest_rate, expected);
        }
        // 1%
        {
            let apr = Decimal::new(1, 2).to_interest_rate();
            let minute_interest_rate = calculate_minute_interest_rate(apr);
            // real     0.0000019025875190... %
            // expected 0.0000019025875190    %
            let expected = Decimal::from_interest_rate(19025875190);
            assert_eq!(minute_interest_rate, expected);
        }
        // 20%
        {
            let apr = Decimal::new(2, 1).to_interest_rate();
            let minute_interest_rate = calculate_minute_interest_rate(apr);
            // real     0.0000380517503805...%
            // expected 0.0000380517503805   %
            let expected = Decimal::from_interest_rate(380517503805);
            assert_eq!(minute_interest_rate, expected);
        }
        // 11% [UNIFIED_PERCENT_SCALE]
        {
            let apr_percent = Decimal::new(11, 2).to_percent();
            let apr = apr_percent.to_interest_rate();
            let minute_interest_rate = calculate_minute_interest_rate(apr);
            // real     0.00002092846270928... %
            // expected 0.0000209284627092     %
            let expected = Decimal::from_interest_rate(209284627092);
            assert_eq!(minute_interest_rate, expected);
        }
    }
}
