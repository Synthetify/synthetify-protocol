use std::{cell::RefMut, convert::TryInto};

use crate::decimal::{
    Add, Compare, Div, DivScale, DivUp, Mul, MulUp, PowAccuracy, Sub, XUSD_SCALE,
};
use crate::*;

pub const MINUTES_IN_YEAR: u32 = 525600;
pub const MIN_SWAP_USD_VALUE: Decimal = Decimal {
    val: 1000u128,
    scale: XUSD_SCALE,
};

pub fn calculate_debt(
    assets_list: &RefMut<AssetsList>,
    slot: u64,
    max_delay: u32,
    twap: bool,
) -> Result<Decimal> {
    let mut debt = Decimal::from_usd(0);
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
        let supply = synthetic
            .supply
            .sub(synthetic.swapline_supply)
            .unwrap()
            .sub(synthetic.borrowed_supply)
            .unwrap();
        // rounding up to be sure that debt is not less than minted tokens
        debt = debt.add(price.mul_up(supply).to_usd_up()).unwrap();
    }
    Ok(debt)
}
pub fn calculate_max_debt_in_usd(account: &ExchangeAccount, assets_list: &AssetsList) -> Decimal {
    let mut max_debt = Decimal::from_usd(0);
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
                    .mul(collateral.collateral_ratio)
                    .to_usd(),
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
        return Decimal::from_usd(0);
    }

    let debt_shares = Decimal::from_integer(debt_shares);
    let user_shares = Decimal::from_integer(user_account.debt_shares);
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
        .mul_up(new_amount)
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
pub fn amount_to_discount(sny_amount: Decimal) -> Decimal {
    // decimals of token = 6
    let one_sny = Decimal::from_integer(1).to_sny().val;
    let amount = sny_amount.val;

    let v: u16 = match () {
        () if amount < one_sny * 100 => 0,
        () if amount < one_sny * 200 => 1,
        () if amount < one_sny * 500 => 2,
        () if amount < one_sny * 1_000 => 3,
        () if amount < one_sny * 2_000 => 4,
        () if amount < one_sny * 5_000 => 5,
        () if amount < one_sny * 10_000 => 6,
        () if amount < one_sny * 25_000 => 7,
        () if amount < one_sny * 50_000 => 8,
        () if amount < one_sny * 100_000 => 9,
        () if amount < one_sny * 250_000 => 10,
        () if amount < one_sny * 250_000 => 10,
        () if amount < one_sny * 500_000 => 11,
        () if amount < one_sny * 1_000_000 => 12,
        () if amount < one_sny * 2_000_000 => 13,
        () if amount < one_sny * 5_000_000 => 14,
        () if amount < one_sny * 10_000_000 => 15,
        () => 15,
    };
    return Decimal::from_percent(v);
}
pub fn calculate_value_in_usd(price: Decimal, amount: Decimal) -> Decimal {
    price.mul(amount).to_usd()
}
pub fn calculate_swap_tax(total_fee: Decimal, swap_tax: Decimal) -> Decimal {
    total_fee.mul(swap_tax)
}
pub fn calculate_swap_out_amount(
    asset_in: &Asset,
    asset_for: &Asset,
    decimals_out: u8,
    amount: Decimal,
    fee: Decimal, // in range from 0-99 | 30/10000 => 0.3% fee
) -> Result<(Decimal, Decimal)> {
    let value_in_usd = (asset_in.price).mul(amount).to_usd();
    // Check min swap value
    if value_in_usd.lt(MIN_SWAP_USD_VALUE).unwrap() {
        return Err(ErrorCode::InsufficientValueTrade.into());
    }
    let fee = value_in_usd.mul_up(fee);
    let value_out_usd = value_in_usd.sub(fee).unwrap();
    let amount_out = usd_to_token_amount(asset_for, value_out_usd, decimals_out);
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
        .mul(Decimal::from_integer(all_shares))
        .div(all_debt)
        .to_scale(0)
        .into()
}

pub fn usd_to_token_amount(asset: &Asset, value_in_usd: Decimal, decimals_out: u8) -> Decimal {
    return value_in_usd.div_to_scale(asset.price, decimals_out);
}

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
    Decimal::from_unified_percent(debt_interest_rate).to_interest_rate()
}
pub fn calculate_minute_interest_rate(apr: Decimal) -> Decimal {
    Decimal::from_interest_rate(apr.val.checked_div(MINUTES_IN_YEAR.into()).unwrap())
}
pub fn calculate_vault_borrow_limit(
    collateral_asset: Asset,
    synthetic_asset: Asset,
    synthetic: Synthetic,
    collateral_amount: Decimal,
    collateral_ratio: Decimal,
) -> Decimal {
    let collateral_value = calculate_value_in_usd(collateral_asset.price, collateral_amount);
    let max_debt = collateral_value.mul(collateral_ratio);
    let max_synthetic_amount =
        usd_to_token_amount(&synthetic_asset, max_debt, synthetic.supply.scale);

    return max_synthetic_amount;
}
pub fn calculate_vault_withdraw_limit(
    collateral_asset: Asset,
    synthetic_asset: Asset,
    collateral_amount: Decimal,
    synthetic_amount: Decimal,
    collateral_ratio: Decimal,
) -> Result<Decimal> {
    let vault_debt_value = calculate_value_in_usd(synthetic_asset.price, synthetic_amount);
    let collateral_value = calculate_value_in_usd(collateral_asset.price, collateral_amount);
    let max_debt_value = collateral_value.mul(collateral_ratio);

    if vault_debt_value.gte(max_debt_value)? {
        return Err(ErrorCode::VaultWithdrawLimit.into());
    }
    let max_withdraw_value = max_debt_value.sub(vault_debt_value).unwrap();
    let max_withdraw_amount = usd_to_token_amount(
        &collateral_asset,
        max_withdraw_value,
        collateral_amount.scale,
    );
    return Ok(max_withdraw_amount);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, ops::Div};

    #[test]
    fn test_calculate_new_shares() {
        // Initialize shares
        {
            let collateral_shares = 0u64;
            let collateral_amount = Decimal::from_usd(0);
            let to_deposit_amount = Decimal::from_integer(1).to_usd();
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
            let collateral_amount = Decimal::from_integer(1).to_usd();
            let to_deposit_amount = Decimal::from_integer(1).to_usd();
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
            let collateral_amount = Decimal::from_integer(1).to_usd();
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
            let collateral_amount = Decimal::from_integer(988_409).to_usd();
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
            let collateral_amount = Decimal::from_integer(100_000_000).to_usd();
            let to_deposit_amount = Decimal::from_integer(10_000_000).to_usd();
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
            let collateral_ratio = Decimal::from_percent(10);
            let health_factor = Decimal::from_percent(100);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            assert_eq!(max_withdraw, Decimal::from_usd(0));
        }
        // user_debt > max_user_debt
        {
            let debt = Decimal::from_usd(1_000_000_000);
            let max_debt = Decimal::from_usd(900_000_000);
            let collateral_ratio = Decimal::from_percent(10);
            let health_factor = Decimal::from_percent(100);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            assert_eq!(max_withdraw, Decimal::from_usd(0));
        }
        // user_debt < max_user_debt
        {
            let debt = Decimal::from_usd(900_000_123);
            let max_debt = Decimal::from_usd(1_000_000_000);
            let collateral_ratio = Decimal::from_percent(80);
            let health_factor = Decimal::from_percent(100);

            let max_withdraw =
                calculate_max_withdraw_in_usd(max_debt, debt, collateral_ratio, health_factor);
            // 124999846,25
            assert_eq!(max_withdraw, Decimal::from_usd(124999846));
        }
        // other health factor
        {
            let debt = Decimal::from_usd(900_000_000);
            let max_debt = Decimal::from_usd(1_000_000_000);
            let collateral_ratio = Decimal::from_percent(10);
            let health_factor = Decimal::from_percent(40);

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

            // price debt 1000 USD
            // twap debt 1100 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(10).to_price(),
                twap: Decimal::from_integer(11).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100).to_scale(6),
                swapline_supply: Decimal::from_integer(0).to_scale(6),
                borrowed_supply: Decimal::from_integer(0).to_scale(6),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 2400 USD
            // twap debt 2000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(12).to_price(),
                twap: Decimal::from_integer(10).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(200).to_scale(6),
                swapline_supply: Decimal::from_integer(0).to_scale(6),
                borrowed_supply: Decimal::from_integer(0).to_scale(6),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 1000 USD
            // twap debt 750 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(20).to_price(),
                twap: Decimal::from_integer(15).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(50).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // total price debt 4400 USD
            // total twap debt 3850 USD
            let assets_ref = RefCell::new(assets_list);
            let assets_ref = assets_ref.borrow_mut();

            let price_debt = calculate_debt(&assets_ref, slot, 100, false);
            let twap_debt = calculate_debt(&assets_ref, slot, 100, true);
            match price_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(4400).to_usd()),
                Err(_) => assert!(false, "Shouldn't check"),
            }
            match twap_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(3850).to_usd()),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // price debt 200_000_000 USD
            // twap debt 100_000_000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(2).to_price(),
                twap: Decimal::from_integer(1).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(115_000_000).to_scale(6),
                swapline_supply: Decimal::from_integer(10_000_000).to_scale(6),
                borrowed_supply: Decimal::from_integer(5_000_000).to_scale(6),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 5_000_000_000 USD
            // twap debt 5_100_000_000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(50_000).to_price(),
                twap: Decimal::from_integer(51_000).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 1_000_000 USD
            // twap debt 1_000_000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(1).to_price(),
                twap: Decimal::from_integer(1).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(1_000_000).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let price_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
            let twap_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, true);
            match price_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(5201000000).to_usd()),
                Err(_) => assert!(false, "Shouldn't check"),
            }
            match twap_debt {
                Ok(debt) => assert_eq!(debt, Decimal::from_integer(5201000000).to_usd()),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // price debt 200_000_000 USD
            // twap debt 200_000_000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(2).to_price(),
                twap: Decimal::from_integer(2).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000_000).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 5_000_000_000 USD
            // twap debt 4_800_000_000 USD
            assets_list.append_asset(Asset {
                price: Decimal::from_integer(50_000).to_price(),
                twap: Decimal::from_integer(45_000).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(100_000).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 0.0001 USD
            // twap debt 0.00015 USD
            assets_list.append_asset(Asset {
                price: Decimal::new(1, 4).to_price(),
                twap: Decimal::new(15, 5).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::from_integer(1).to_scale(6),
                swapline_supply: Decimal::from_integer(0).to_scale(6),
                borrowed_supply: Decimal::from_integer(0).to_scale(6),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 0.152407... USD
            // twap debt  0.152407... USD
            assets_list.append_asset(Asset {
                price: Decimal::new(1_2345, 4).to_price(),
                twap: Decimal::new(1_2345, 4).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::new(12345678, 8).to_scale(8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let price_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
            let twap_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, true);
            match price_debt {
                Ok(debt) => assert_eq!({ debt.val }, 5200000000_152508),
                Err(_) => assert!(false, "Shouldn't check"),
            }
            match twap_debt {
                Ok(debt) => assert_eq!({ debt.val }, 4700000000_152558),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            let mut assets_list = AssetsList {
                ..Default::default()
            };

            // price debt 198807739,182321 USD
            // twap debt  152245875,570381 USD
            assets_list.append_asset(Asset {
                price: Decimal::new(1_567, 3).to_price(),
                twap: Decimal::new(1_200, 3).to_price(),
                last_update: slot - 10,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::new(126871562_97531672, 8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets as u8 - 1,
                ..Default::default()
            });

            // price debt 733398054,012891 USD
            // twap debt  713142108,2 USD
            assets_list.append_asset(Asset {
                price: Decimal::new(51420_19, 2).to_price(),
                twap: Decimal::new(50000, 0).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::new(14262_842164, 6),
                swapline_supply: Decimal::from_integer(0).to_scale(6),
                borrowed_supply: Decimal::from_integer(0).to_scale(6),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            // price debt 5138,531149 USD
            // twap debt  5181,015477 USD
            assets_list.append_asset(Asset {
                price: Decimal::new(3_9672, 4).to_price(),
                twap: Decimal::from_integer(4).to_price(),
                last_update: 100,
                ..Default::default()
            });
            assets_list.append_synthetic(Synthetic {
                supply: Decimal::new(1295_25386912, 8),
                swapline_supply: Decimal::from_integer(0).to_scale(8),
                borrowed_supply: Decimal::from_integer(0).to_scale(8),
                asset_index: assets_list.head_assets - 1,
                ..Default::default()
            });

            let assets_ref = RefCell::new(assets_list);

            let price_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, false);
            let twap_debt = calculate_debt(&assets_ref.borrow_mut(), slot, 100, true);
            match price_debt {
                Ok(debt) => assert_eq!({ debt.val }, 932210931_726364),
                Err(_) => assert!(false, "Shouldn't check"),
            }
            match twap_debt {
                Ok(debt) => assert_eq!({ debt.val }, 865393164_785858),
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
            price: Decimal::from_integer(10).to_price(),
            last_update: slot - 10,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            supply: Decimal::from_integer(100).to_scale(8),
            swapline_supply: Decimal::from_integer(0).to_scale(8),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // debt 1000
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(12).to_price(),
            last_update: 100,
            ..Default::default()
        });
        assets_list.append_synthetic(Synthetic {
            supply: Decimal::from_integer(200).to_scale(8),
            swapline_supply: Decimal::from_integer(0).to_scale(8),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        let assets_ref = RefCell::new(assets_list);

        // debt 2400
        let result = calculate_debt(&assets_ref.borrow_mut(), slot, 0, false);
        assert!(result.is_err());
    }
    #[test]
    fn test_calculate_max_debt_in_usd() {
        let mut assets_list = AssetsList {
            ..Default::default()
        };
        // SNY
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(2).to_price(),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            reserve_balance: Decimal::from_integer(0).to_scale(6), // only for decimals
            collateral_ratio: Decimal::from_percent(50),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // BTC
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(50_000).to_price(),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            reserve_balance: Decimal::from_integer(0).to_scale(8),
            collateral_ratio: Decimal::from_percent(50),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // SOL
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(25).to_price(),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            reserve_balance: Decimal::from_integer(0).to_scale(4),
            collateral_ratio: Decimal::from_percent(12),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // USD
        assets_list.append_asset(Asset {
            price: Decimal::from_integer(1).to_price(),
            ..Default::default()
        });
        assets_list.append_collateral(Collateral {
            reserve_balance: Decimal::from_integer(0).to_scale(6),
            collateral_ratio: Decimal::from_percent(90),
            asset_index: assets_list.head_assets as u8 - 1,
            ..Default::default()
        });

        // No collaterals
        {
            let exchange_account = ExchangeAccount {
                ..Default::default()
            };
            let result = calculate_max_debt_in_usd(&exchange_account, &assets_list);
            assert_eq!(result, Decimal::from_integer(0).to_usd());
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
            assert_eq!(result, Decimal::from_integer(1).to_usd());
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
            assert_eq!(result, Decimal::from_integer(25_004).to_usd());
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
            assert_eq!(result, Decimal::from_usd(301));
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
            assert_eq!(result, Decimal::from_integer(0).to_usd());
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
            let debt = Decimal::from_integer(1).to_usd();

            let result = calculate_user_debt_in_usd(&user_account, debt, 0);
            assert_eq!(result, Decimal::from_integer(0).to_usd());
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 100,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = Decimal::from_usd(4400_162356);

            let result = calculate_user_debt_in_usd(&user_account, debt, 1234);
            assert_eq!(result, Decimal::from_usd(356_577177))
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 1525783,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = Decimal::from_usd(932210931_726361);

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, Decimal::from_usd(115211))
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 9234567898765432,
                owner: Pubkey::default(),
                ..Default::default()
            };
            let debt = Decimal::from_usd(526932210931_726361);

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, Decimal::from_usd(394145294459_835461))
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
            let amount = Decimal::from_integer(10).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(0))
        }
        {
            let amount = Decimal::from_integer(100).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(1000))
        }
        {
            let amount = Decimal::from_integer(200).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(2000))
        }
        {
            let amount = Decimal::from_integer(350).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(2000))
        }
        {
            let amount = Decimal::from_integer(500).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(3000))
        }
        {
            let amount = Decimal::from_integer(999_999).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(12000))
        }
        {
            let amount = Decimal::from_integer(1_000_000).to_sny();
            let result = amount_to_discount(amount);
            assert_eq!(result, Decimal::from_unified_percent(13000))
        }
    }
    #[test]
    fn test_calculate_swap_out_amount() {
        let usd_decimal = 6;
        let asset_usd = Asset {
            price: Decimal::from_integer(1).to_price(),
            ..Default::default()
        };
        let btc_decimal = 8;
        let asset_btc = Asset {
            price: Decimal::from_integer(50000).to_price(),
            ..Default::default()
        };
        let eth_decimal = 7;
        let asset_eth = Asset {
            price: Decimal::from_integer(2000).to_price(),
            ..Default::default()
        };
        let fee = Decimal::from_unified_percent(300);
        // should fail because swap value is too low
        {
            let amount = Decimal::new(10, 6);
            let result =
                calculate_swap_out_amount(&asset_usd, &asset_btc, btc_decimal, amount, fee);
            assert!(result.is_err());
        }
        {
            let amount = Decimal::from_integer(50000).to_usd();
            let (out_amount, swap_fee) =
                calculate_swap_out_amount(&asset_usd, &asset_btc, btc_decimal, amount, fee)
                    .unwrap();
            // out amount should be 0.997 BTC
            assert_eq!(out_amount, Decimal::new(99700000, btc_decimal));
            // fee should be 150 USD
            assert_eq!(swap_fee, Decimal::from_integer(150).to_usd());
        }
        {
            let (out_amount, swap_fee) = calculate_swap_out_amount(
                &asset_btc,
                &asset_usd,
                usd_decimal,
                Decimal::from_integer(1).to_scale(btc_decimal),
                fee,
            )
            .unwrap();
            // out amount should be 49850 USD
            assert_eq!(
                out_amount,
                Decimal::from_integer(49850).to_scale(usd_decimal)
            );
            // fee should be 150 USD
            assert_eq!(swap_fee, Decimal::from_integer(150).to_usd());
        }
        {
            let amount = Decimal::new(99700000, btc_decimal);
            let (out_amount, swap_fee) =
                calculate_swap_out_amount(&asset_btc, &asset_eth, eth_decimal, amount, fee)
                    .unwrap();
            // out amount should be 24.850225 ETH
            assert_eq!(out_amount, Decimal::new(24_850_2250, eth_decimal));
            // fee should be 149,55 USD
            assert_eq!(swap_fee, Decimal::new(149_55, 2).to_usd());
        }
    }
    #[test]
    fn test_calculate_burned_shares() {
        // all_debt
        {
            // 7772,102...
            let asset = Asset {
                price: Decimal::from_integer(14).to_price(),
                ..Default::default()
            };
            let all_debt = Decimal::from_usd(1598);
            let all_shares = 90;
            let amount = Decimal::from_usd(9857);
            let burned_shares = calculate_burned_shares(&asset, all_debt, all_shares, amount);
            assert_eq!(burned_shares, 7772);
        }
        // user_debt
        {
            // user_debt = 0
            let asset = Asset {
                price: Decimal::from_integer(14).to_price(),
                ..Default::default()
            };
            let user_debt = Decimal::from_usd(0);
            let user_shares = 0;
            let amount = Decimal::from_usd(0);
            let burned_shares = calculate_burned_shares(&asset, user_debt, user_shares, amount);
            assert_eq!(burned_shares, 0);
        }
    }
    #[test]
    fn test_calculate_value_in_usd() {
        // zero price
        {
            let price = Decimal::from_integer(0).to_price();
            let amount = Decimal::from_integer(2).to_usd();
            let value_in_usd = calculate_value_in_usd(price, amount);
            // should be 0 USD
            assert_eq!(value_in_usd, Decimal::from_integer(0).to_usd());
        }
        // No amount
        {
            let price = Decimal::from_integer(50).to_price();
            let amount = Decimal::from_integer(0).to_usd();
            let value_in_usd = calculate_value_in_usd(price, amount);
            // should be 0 USD
            assert_eq!(value_in_usd, Decimal::from_integer(0).to_usd());
        }
        // decimal same as xUSD
        {
            let price = Decimal::from_integer(3).to_price();
            let amount = Decimal::from_integer(2).to_usd();
            let value_in_usd = calculate_value_in_usd(price, amount);
            // should be 6 USD
            assert_eq!(value_in_usd, Decimal::from_integer(6).to_usd());
        }
        // // decimal lower than xUSD
        {
            let asset_scale = 4;
            let price = Decimal::from_integer(112).to_price();
            let amount = Decimal::from_integer(200).to_scale(asset_scale);
            let value_in_usd = calculate_value_in_usd(price, amount);
            // should be 22400 USD
            let expected = Decimal::from_integer(22_400).to_usd();
            assert_eq!(value_in_usd, expected);
        }
        // decimal bigger than xUSD
        {
            let asset_scale = 10;
            let price = Decimal::from_integer(91).to_price();
            let amount = Decimal::from_integer(200).to_scale(asset_scale);
            let value_in_usd = calculate_value_in_usd(price, amount);
            // should be 18200 USD
            let expected = Decimal::from_integer(18_200).to_usd();
            assert_eq!(value_in_usd, expected);
        }
    }
    #[test]
    fn test_calculate_swap_tax() {
        // MIN - 0%
        {
            let total_fee = Decimal::from_usd(1_227_775);
            let swap_tax_ratio = Decimal::from_percent(0);
            let swap_tax = calculate_swap_tax(total_fee, swap_tax_ratio);
            // expect 0 tax
            assert_eq!(swap_tax, Decimal::from_usd(0));
        }
        // MAX - 20%
        {
            let total_fee = Decimal::from_usd(1_227_775);
            let swap_tax_ratio = Decimal::from_percent(20);
            let swap_tax = calculate_swap_tax(total_fee, swap_tax_ratio);
            // 245555
            let expected = Decimal::from_usd(245_555);
            assert_eq!(swap_tax, expected);
        }
        // 11% - valid rounding
        {
            let total_fee = Decimal::from_usd(1_227_775);
            let swap_tax_ratio = Decimal::from_percent(11);
            let swap_tax = calculate_swap_tax(total_fee, swap_tax_ratio);
            // 135055,25
            let expected = Decimal::from_usd(135_055);
            assert_eq!(swap_tax, expected);
        }
    }
    #[test]
    fn test_usd_to_token_amount() {
        // round down
        {
            let asset = Asset {
                price: Decimal::from_integer(14).to_price(),
                ..Default::default()
            };
            let scale = 6u8;
            let value = Decimal::from_usd(100);
            let token_amount = usd_to_token_amount(&asset, value, scale);
            // 7,142...
            let expected = Decimal::new(7, scale);
            assert_eq!(token_amount, expected);
        }
        // large amount
        {
            let asset = Asset {
                price: Decimal::from_integer(91).to_price(),
                ..Default::default()
            };
            let scale = 10u8;
            let value = Decimal::from_integer(100_003_900_802).to_usd();
            let token_amount = usd_to_token_amount(&asset, value, scale);
            // used to be 11031876945054945054
            // 1098943964,857142857
            let expected = Decimal {
                val: 1098943964_8571428571,
                scale,
            };

            assert_eq!(token_amount, expected);
        }
    }
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
            let expected = Decimal::new(2113489017, XUSD_SCALE);
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
            let expected = Decimal::new(2113577183, XUSD_SCALE);
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

    #[test]
    fn test_calculate_vault_borrow_limit() {
        let btc_decimal = 8;
        let btc_asset = Asset {
            price: Decimal::from_integer(49_862).to_price(),
            ..Default::default()
        };
        let xusd_asset = Asset {
            price: Decimal::from_integer(1).to_price(),
            ..Default::default()
        };
        let xusd_synthetic = Synthetic {
            supply: Decimal::from_integer(100).to_usd(),
            ..Default::default()
        };
        let collateral_amount = Decimal::from_integer(2).to_scale(btc_decimal);
        let collateral_ratio = Decimal::from_percent(70);

        let borrow_limit = calculate_vault_borrow_limit(
            btc_asset,
            xusd_asset,
            xusd_synthetic,
            collateral_amount,
            collateral_ratio,
        );
        let expected_borrow_limit = Decimal::new(698068, 1).to_usd();
        assert_eq!(borrow_limit, expected_borrow_limit);
    }
}
