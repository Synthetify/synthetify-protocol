use std::convert::TryInto;

use crate::*;
use manager::Asset;
use manager::PRICE_OFFSET;

// Min decimals for asset = 6
pub const ACCURACY: u8 = 6;

pub fn calculate_debt(assets: &Vec<Asset>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u128;
    for asset in assets.iter() {
        if asset.last_update < (slot - max_delay as u64) {
            return Err(ErrorCode::OutdatedOracle.into());
        }

        debt += div_up(
            (asset.price as u128)
                .checked_mul(asset.supply as u128)
                .unwrap(),
            10u128
                .checked_pow((asset.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        );
    }
    Ok(debt as u64)
}

pub fn calculate_user_debt_in_usd(
    user_account: &ExchangeAccount,
    debt: u64,
    debt_shares: u64,
) -> u64 {
    if debt_shares == 0 {
        return 0;
    }
    let user_debt = div_up(
        (debt as u128)
            .checked_mul(user_account.debt_shares as u128)
            .unwrap(),
        debt_shares as u128,
    );
    return user_debt as u64;
}

pub fn calculate_amount_mint_in_usd(mint_asset: &Asset, amount: u64) -> u64 {
    let mint_amount_in_usd = (mint_asset.price as u128)
        .checked_mul(amount as u128)
        .unwrap()
        .checked_div(
            10u128
                .checked_pow((mint_asset.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        )
        .unwrap();
    return mint_amount_in_usd as u64;
}

pub fn calculate_max_user_debt_in_usd(
    collateral_asset: &Asset,
    collateralization_level: u32,
    collateral_amount: u64,
) -> u64 {
    let user_max_debt = (collateral_asset.price as u128)
        .checked_mul(collateral_amount as u128)
        .unwrap()
        .checked_div(
            10u128
                .checked_pow((collateral_asset.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        )
        .unwrap();
    return (user_max_debt
        .checked_mul(100)
        .unwrap()
        .checked_div(collateralization_level as u128)
        .unwrap())
    .try_into()
    .unwrap();
}

pub fn calculate_new_shares(all_shares: u64, full_amount: u64, new_amount: u64) -> u64 {
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
pub fn calculate_max_withdraw_in_usd(
    max_user_debt_in_usd: u64,
    user_debt_in_usd: u64,
    collateralization_level: u32,
) -> u64 {
    if max_user_debt_in_usd < user_debt_in_usd {
        return 0;
    }
    return (max_user_debt_in_usd - user_debt_in_usd)
        .checked_mul(collateralization_level as u64)
        .unwrap()
        .checked_div(100)
        .unwrap();
}
pub fn calculate_user_collateral_in_token(
    user_collateral_shares: u64,
    collateral_shares: u64,
    balance: u64,
) -> u64 {
    if user_collateral_shares == 0 {
        return 0;
    }
    let tokens = (user_collateral_shares as u128)
        .checked_mul(balance as u128)
        .unwrap()
        .checked_div(collateral_shares as u128)
        .unwrap();
    return tokens.try_into().unwrap();
}
pub fn calculate_max_withdrawable(collateral_asset: &Asset, user_max_withdraw_in_usd: u64) -> u64 {
    // collateral and usd have same number of decimals
    let tokens = (user_max_withdraw_in_usd as u128)
        .checked_mul(10u128.pow(PRICE_OFFSET.into()))
        .unwrap()
        .checked_div(collateral_asset.price as u128)
        .unwrap();
    return tokens.try_into().unwrap();
}
pub fn amount_to_shares(all_shares: u64, full_amount: u64, amount: u64) -> u64 {
    let shares = (amount as u128)
        .checked_mul(all_shares as u128)
        .unwrap()
        .checked_div(full_amount as u128)
        .unwrap();
    return shares.try_into().unwrap();
}
const BITS: u64 = (core::mem::size_of::<u64>() * 8) as u64;
pub const fn log2(n: u64) -> u64 {
    (BITS - 1) - n.leading_zeros() as u64
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
pub fn calculate_swap_out_amount(
    asset_in: &Asset,
    asset_for: &Asset,
    amount: &u64,
    fee: &u32, // in range from 0-99 | 30/10000 => 0.3% fee
) -> u64 {
    let amount_before_fee = (asset_in.price as u128)
        .checked_mul(*amount as u128)
        .unwrap()
        .checked_div(asset_for.price as u128)
        .unwrap();
    let amount = amount_before_fee
        .checked_sub(
            amount_before_fee
                .checked_mul(*fee as u128)
                .unwrap()
                .checked_div(100000)
                .unwrap(),
        )
        .unwrap();
    // If assets have different decimals we need to scale them.
    let decimal_difference = asset_for.decimals as i32 - asset_in.decimals as i32;
    if decimal_difference < 0 {
        let decimal_change = 10u128.pow((-decimal_difference) as u32);
        let scaled_amount = amount / (decimal_change);
        return scaled_amount.try_into().unwrap();
    } else {
        let decimal_change = 10u128.pow(decimal_difference as u32);
        let scaled_amount = amount * (decimal_change);
        return scaled_amount.try_into().unwrap();
    }
}
pub fn calculate_burned_shares(
    asset: &Asset,
    user_debt: u64,
    user_shares: u64,
    amount: u64,
) -> u64 {
    if user_debt == 0 {
        return 0u64;
    }

    let burn_amount_in_usd = (asset.price as u128)
        .checked_mul(amount as u128)
        .unwrap()
        .checked_div(
            10u128
                .checked_pow((asset.decimals + PRICE_OFFSET - ACCURACY).into())
                .unwrap(),
        )
        .unwrap();
    let burned_shares = burn_amount_in_usd
        .checked_mul(user_shares as u128)
        .unwrap()
        .checked_div(user_debt as u128)
        .unwrap();
    return burned_shares.try_into().unwrap();
}
pub fn calculate_max_burned_in_token(asset: &Asset, user_debt: &u64) -> u64 {
    let decimal_difference = asset.decimals as i32 - ACCURACY as i32;
    if decimal_difference >= 0 {
        let burned_amount_token = div_up(
            (*user_debt as u128)
                .checked_mul(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap()
                .checked_mul(10u128.pow(PRICE_OFFSET.into()))
                .unwrap(),
            asset.price as u128,
        );
        return burned_amount_token.try_into().unwrap();
    } else {
        let burned_amount_token = div_up(
            (*user_debt as u128)
                .checked_mul(10u128.pow(PRICE_OFFSET.into()))
                .unwrap()
                .checked_div(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap(),
            asset.price as u128,
        );
        return burned_amount_token.try_into().unwrap();
    }
}
pub fn usd_to_token_amount(asset: &Asset, amount: u64) -> u64 {
    let amount = (amount as u128)
        .checked_mul(10u128.pow(PRICE_OFFSET.into()))
        .unwrap()
        .checked_div(asset.price as u128)
        .unwrap();
    return amount.try_into().unwrap();
}
pub fn calculate_liquidation(
    collateral_value: u64,
    debt_value: u64,
    collateral_ratio: u32,   // in %
    liquidation_penalty: u8, // in %
) -> (u64, u64, u64) {
    let max_burned_amount = ((debt_value as u128)
        .checked_mul(collateral_ratio as u128)
        .unwrap()
        .checked_sub(
            collateral_value
                .checked_mul(100)
                .unwrap()
                .try_into()
                .unwrap(),
        )
        .unwrap())
    .checked_div(
        (collateral_ratio.checked_sub((100 + liquidation_penalty) as u32)).unwrap() as u128,
    )
    .unwrap();
    // 20% of penalty is going system
    let penalty_to_system = liquidation_penalty / 5;
    let penalty_to_user = liquidation_penalty - penalty_to_system;

    let user_reward_usd = (max_burned_amount
        .checked_mul((100 + penalty_to_user).into())
        .unwrap())
    .checked_div(100)
    .unwrap();
    let system_reward_usd = div_up(
        max_burned_amount
            .checked_mul((penalty_to_system).into())
            .unwrap(),
        100,
    );

    return (
        max_burned_amount.try_into().unwrap(),
        user_reward_usd.try_into().unwrap(),
        system_reward_usd.try_into().unwrap(),
    );
}
#[cfg(test)]
mod tests {
    use std::ops::Div;

    use super::*;
    #[test]
    fn test_calculate_new_shares() {
        // Initialize shares
        {
            let collateral_shares = 0u64;
            let collateral_amount = 0u64;
            let to_deposit_amount = 10u64.pow(6);
            let new_shares =
                calculate_new_shares(collateral_shares, collateral_amount, to_deposit_amount);
            // Initial shares = deposited amount
            assert_eq!(new_shares, to_deposit_amount)
        }
        // With existing shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = 10u64.pow(6);
            let to_deposit_amount = 10u64.pow(6);
            let new_shares =
                calculate_new_shares(collateral_shares, collateral_amount, to_deposit_amount);
            // Deposit same amount so new shares should eq existing
            assert_eq!(new_shares, collateral_shares)
        }
        // Zero new shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = 10u64.pow(6);
            let to_deposit_amount = 0u64;
            let new_shares =
                calculate_new_shares(collateral_shares, collateral_amount, to_deposit_amount);
            // deposit 0
            assert_eq!(new_shares, 0u64)
        }
        // Test on big numbers
        {
            let collateral_shares = 100_000_000 * 10u64.pow(6);
            let collateral_amount = 100_000_000 * 10u64.pow(6);
            let to_deposit_amount = 10_000_000 * 10u64.pow(6);
            let new_shares =
                calculate_new_shares(collateral_shares, collateral_amount, to_deposit_amount);
            // Deposit  1/10 of existing balance
            assert_eq!(new_shares, collateral_shares.div(10))
        }
    }
    #[test]
    fn test_calculate_max_withdraw_in_usd() {
        // user_debt == max_user_debt
        {
            let debt = 999_999_999;
            let max_debt = 999_999_999;
            let result = calculate_max_withdraw_in_usd(max_debt, debt, 1000);
            assert_eq!(result, 0);
        }
        // user_debt > max_user_debt
        {
            let debt = 1_000_000_000;
            let max_debt = 900_000_000;
            let result = calculate_max_withdraw_in_usd(max_debt, debt, 1000);
            assert_eq!(result, 0);
        }
        // user_debt < max_user_debt
        {
            let debt = 900_000_123;
            let max_debt = 1_000_000_000;
            let result = calculate_max_withdraw_in_usd(max_debt, debt, 750);
            // 749999077,5 (round down)
            assert_eq!(result, 749999077);
        }
    }
    #[test]
    fn test_calculate_debt_success() {
        {
            let slot = 100;
            // debt 0 - no assets
            let assets: Vec<Asset> = vec![];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 0),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            // debt 1000
            let asset_1 = Asset {
                // oracle offset set as 4
                price: 10 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100 * 10u64.pow(6),
                last_update: slot - 10,
                decimals: 6,
                ..Default::default()
            };
            // debt 2400
            let asset_2 = Asset {
                price: 12 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 200 * 10u64.pow(6),
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 1000
            let asset_3 = Asset {
                price: 20 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 50 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            // debt 4400
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 4400_000000),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            // debt 200_000_000
            let asset_1 = Asset {
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100_000_000 * 10u64.pow(6),
                last_update: slot - 10,
                decimals: 6,
                ..Default::default()
            };
            // debt 5_000_000_000
            let asset_2 = Asset {
                price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100_000 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            // debt 1_000_000
            let asset_3 = Asset {
                price: (1 * 10u64.pow(PRICE_OFFSET.into())),
                supply: 1_000_000 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 5201000000_000000),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            // debt 200_000_000
            let asset_1 = Asset {
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100_000_000 * 10u64.pow(8),
                last_update: slot - 10,
                decimals: 8,
                ..Default::default()
            };
            // debt 5_000_000_000
            let asset_2 = Asset {
                price: 50_000 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100_000 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            // debt 0.0001
            let asset_3 = Asset {
                price: (0.0001 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                supply: 1 * 10u64.pow(6),
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 0.152407...
            let asset_4 = Asset {
                price: (1.2345 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                supply: (0.12345678 * 10u64.pow(8) as f64) as u64,
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3, asset_4];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 5200000000_152508),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            // debt 198807739,182321
            let asset_1 = Asset {
                price: (1.567 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                supply: (126871562.97531672 * 10u64.pow(8) as f64) as u64,
                last_update: slot - 10,
                decimals: 8,
                ..Default::default()
            };
            // debt 733398054,012891
            let asset_2 = Asset {
                price: (51420.19 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                supply: (14262.842164 * 10u64.pow(6) as f64) as u64,
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 5138,531149
            let asset_3 = Asset {
                price: (3.9672 * 10u64.pow(PRICE_OFFSET.into()) as f64) as u64,
                supply: (1295.25386912 * 10u64.pow(8) as f64) as u64,
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 932210931_726364),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
    }
    #[test]
    fn test_calculate_debt_error() {
        let slot = 100;
        let asset_1 = Asset {
            price: 10 * 10u64.pow(PRICE_OFFSET.into()),
            supply: 100 * 10u64.pow(8),
            last_update: slot - 10,
            decimals: 8,
            feed_address: Pubkey::new_unique(),
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(PRICE_OFFSET.into()),
            supply: 200 * 10u64.pow(8),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(&assets, slot, 0);
        assert!(result.is_err());
    }
    #[test]
    fn test_calculate_user_debt() {
        {
            let user_account = ExchangeAccount {
                debt_shares: 0,
                owner: Pubkey::default(),
                collateral_shares: 1,
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
                collateral_shares: 1,
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
                collateral_shares: 1,
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
                collateral_shares: 1,
                ..Default::default()
            };
            let debt = 526932210931_726361;

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, 394145294459_835461)
        }
    }
    #[test]
    fn test_calculate_amount_mint_in_usd() {
        {
            // 2_000_000
            let asset = Asset {
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 1_000_000_000 * 10u64.pow(8),
                last_update: 10,
                decimals: 6,
                ..Default::default()
            };
            let result = calculate_amount_mint_in_usd(&asset, 1_000_000);
            assert_eq!(result, 2_000_000);
        }
        {
            // 2697,551...
            let asset = Asset {
                price: 1_984_953,
                supply: 1_000_000_000 * 10u64.pow(8),
                last_update: 10,
                decimals: 6,
                ..Default::default()
            };
            let result = calculate_amount_mint_in_usd(&asset, 1359);
            assert_eq!(result, 2697);
        }
        {
            // 13986,000014
            let asset = Asset {
                price: 14 * 10u64.pow(3),
                supply: 1_000_000_000 * 10u64.pow(8),
                last_update: 10,
                decimals: 9,
                ..Default::default()
            };
            let result = calculate_amount_mint_in_usd(&asset, 999_000_001);
            assert_eq!(result, 13986);
        }
        {
            // 1_290_000_000
            let asset = Asset {
                price: 129 * 10u64.pow(5),
                supply: 1_000_000_000 * 10u64.pow(8),
                last_update: 10,
                decimals: 7,
                ..Default::default()
            };
            let result = calculate_amount_mint_in_usd(&asset, 1_000_000_000);
            assert_eq!(result, 1_290_000_000);
        }
    }
    #[test]
    fn test_calculate_user_collateral_in_token() {
        {
            let result = calculate_user_collateral_in_token(10, 100, 100);
            assert_eq!(result, 10)
        }
        {
            let result = calculate_user_collateral_in_token(
                1_000_000 * 10u64.pow(6),
                100_000_000 * 10u64.pow(6),
                100_000_000 * 10u64.pow(6),
            );
            assert_eq!(result, 1_000_000 * 10u64.pow(6))
        }
    }
    #[test]
    fn test_calculate_max_withdrawable() {
        {
            let asset = Asset {
                decimals: 6,
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let result = calculate_max_withdrawable(&asset, 100 * 10u64.pow(6));
            assert_eq!(result, 50 * 10u64.pow(6))
        }
    }
    #[test]
    fn test_amount_to_shares() {
        {
            let result = amount_to_shares(10, 100, 10);
            assert_eq!(result, 1)
        }
    }
    #[test]
    fn test_calculate_max_user_debt_in_usd() {
        {
            let asset = Asset {
                decimals: 6,
                price: 2 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let result = calculate_max_user_debt_in_usd(&asset, 1000, 100 * 10u64.pow(6));
            assert_eq!(result, 20_000_000)
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
    #[test]
    fn test_calculate_swap_out_amount() {
        {
            let assetUSD = Asset {
                decimals: 6,
                price: 1 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let assetBTC = Asset {
                decimals: 8,
                price: 50000 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let assetETH = Asset {
                decimals: 7,
                price: 2000 * 10u64.pow(PRICE_OFFSET.into()),
                ..Default::default()
            };
            let fee = 300u32;
            let result =
                calculate_swap_out_amount(&assetUSD, &assetBTC, &(50000 * 10u64.pow(6)), &fee);
            assert_eq!(result, 0_99700000);
            let result = calculate_swap_out_amount(&assetBTC, &assetUSD, &(1 * 10u64.pow(8)), &fee);
            assert_eq!(result, 49850_000_000);
            let result = calculate_swap_out_amount(&assetBTC, &assetETH, &99700000, &fee);
            assert_eq!(result, 24_850_2250);
        }
    }

    #[test]
    fn test_calculate_burned_shares() {
        {
            // 7772,10263
            let asset = Asset {
                price: 14 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100 * 10u64.pow(6),
                last_update: 10,
                decimals: 6,
                ..Default::default()
            };
            let user_debt = 1598;
            let user_shares = 90;
            let amount = 9857;
            let burned_shares = calculate_burned_shares(&asset, user_debt, user_shares, amount);
            assert_eq!(burned_shares, 7772);
        }
        {
            // user_debt = 0
            let asset = Asset {
                price: 14 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 100 * 10u64.pow(6),
                last_update: 10,
                decimals: 6,
                ..Default::default()
            };
            let user_debt = 0;
            let user_shares = 0;
            let amount = 0;
            let burned_shares = calculate_burned_shares(&asset, user_debt, user_shares, amount);
            assert_eq!(burned_shares, 0);
        }
    }

    #[test]
    fn test_calculate_max_burned_in_token() {
        {
            println!("calculate");
        }
    }

    #[test]
    fn test_calculate_liquidation() {
        {
            let collateral_value = 1000 * 10u64.pow(6);
            let debt_value = 500 * 10u64.pow(6);
            let collateral_ratio = 500u32;
            let penalty = 15u8;
            let (max_burned_amount, user_reward_usd, system_reward_usd) =
                calculate_liquidation(collateral_value, debt_value, collateral_ratio, penalty);
            assert_eq!(max_burned_amount, 389_610389);
            assert_eq!(user_reward_usd, 436_363635);
            assert_eq!(system_reward_usd, 116_88312);
            assert_eq!(
                max_burned_amount * (100 + penalty) as u64 / 100,
                user_reward_usd + system_reward_usd
            );
        }
    }
}
