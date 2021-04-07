use std::convert::TryInto;

use crate::*;
use manager::Asset;

const ORACLE_OFFSET: u8 = 4;
// Min decimals for asset = 6
const ACCURACY: u8 = 6;

pub fn get_collateral_shares(
    collateral_amount: &u64,
    to_deposit_amount: &u64,
    collateral_shares: &u64,
) -> u64 {
    if *collateral_shares == 0u64 {
        return *to_deposit_amount;
    }
    let shares =
        *to_deposit_amount as u128 * *collateral_shares as u128 / *collateral_amount as u128;
    return shares as u64;
}

pub fn calculate_debt(assets: &Vec<Asset>, slot: u64, max_delay: u32) -> Result<u64> {
    let mut debt = 0u128;
    for asset in assets.iter() {
        if asset.last_update < (slot - max_delay as u64) {
            return Err(ErrorCode::OutdatedOracle.into());
        }

        debt += (asset.price as u128 * asset.supply as u128)
            / 10u128.pow((asset.decimals + ORACLE_OFFSET - ACCURACY).into())
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
    let user_debt = debt as u128 * user_account.debt_shares as u128 / debt_shares as u128;
    return user_debt as u64;
}

pub fn calculate_amount_mint_in_usd(mint_asset: &Asset, amount: u64) -> u64 {
    let mint_amount_in_usd = mint_asset.price as u128 * amount as u128
        / 10u128.pow((mint_asset.decimals + ORACLE_OFFSET - ACCURACY).into());
    return mint_amount_in_usd as u64;
}

pub fn calculate_max_user_debt_in_usd(
    collateral_asset: &Asset,
    collateralization_level: u32,
    collateral_amount: u64,
) -> u64 {
    let user_max_debt = collateral_asset.price as u128 * collateral_amount as u128
        / 10u128.pow((collateral_asset.decimals + ORACLE_OFFSET - ACCURACY).into());
    return (user_max_debt * 100 / collateralization_level as u128)
        .try_into()
        .unwrap();
}

pub fn calculate_new_shares(shares: u64, debt: u64, minted_amount_usd: u64) -> u64 {
    if shares == 0u64 {
        return minted_amount_usd;
    }
    let new_shares = (shares as u128 * minted_amount_usd as u128) / debt as u128;

    return new_shares as u64;
}
pub fn calculate_max_withdraw_in_usd(
    max_user_debt_in_usd: &u64,
    user_debt_in_usd: &u64,
    collateralization_level: &u32,
) -> u64 {
    if max_user_debt_in_usd < user_debt_in_usd {
        return 0;
    }
    return ((max_user_debt_in_usd - user_debt_in_usd) * *collateralization_level as u64) / 100;
}
pub fn calculate_user_collateral_in_token(
    user_collateral_shares: u64,
    collateral_shares: u64,
    balance: u64,
) -> u64 {
    if user_collateral_shares == 0 {
        return 0;
    }
    let tokens = user_collateral_shares as u128 * balance as u128 / collateral_shares as u128;
    return tokens as u64;
}
pub fn calculate_max_withdrawable(collateral_asset: &Asset, user_max_withdraw_in_usd: u64) -> u64 {
    // collateral and usd have same number of decimals
    let tokens = user_max_withdraw_in_usd as u128 * 10u128.pow(ORACLE_OFFSET.into())
        / collateral_asset.price as u128;
    return tokens as u64;
}
pub fn amount_to_shares(all_shares: u64, full_amount: u64, amount: u64) -> u64 {
    let shares = amount as u128 * all_shares as u128 / full_amount as u128;
    return shares as u64;
}
pub fn amount_to_discount(amount: u64) -> u8 {
    // decimals of token = 6
    // we want discounts start from 2000 -> 4000 ...
    let units = amount / 10u64.pow(6 + 3);
    let discount = (units as f64).log2();
    if discount > 20.0 {
        return 20;
    } else {
        return discount.floor() as u8;
    }
}

#[cfg(test)]
mod tests {
    use std::ops::Div;

    use super::*;
    #[test]
    fn test_get_collateral_shares() {
        // Zero shares
        {
            let collateral_shares = 0u64;
            let collateral_amount = 0u64;
            let to_deposit_amount = 10u64.pow(6);
            let new_shares =
                get_collateral_shares(&collateral_amount, &to_deposit_amount, &collateral_shares);
            // Initial shares = deposited amount
            assert_eq!(new_shares, to_deposit_amount)
        }
        // With existing shares
        {
            let collateral_shares = 10u64.pow(6);
            let collateral_amount = 10u64.pow(6);
            let to_deposit_amount = 10u64.pow(6);
            let new_shares =
                get_collateral_shares(&collateral_amount, &to_deposit_amount, &collateral_shares);
            // Deposit same amount so new shares should eq existing
            assert_eq!(new_shares, collateral_shares)
        }
        // Test on big numbers
        {
            let collateral_shares = 100_000_000 * 1u64.pow(6);
            let collateral_amount = 100_000_000 * 1u64.pow(6);
            let to_deposit_amount = 10_000_000 * 1u64.pow(6);
            let new_shares =
                get_collateral_shares(&collateral_amount, &to_deposit_amount, &collateral_shares);
            // Deposit  1/10 of existing balance
            assert_eq!(new_shares, collateral_shares.div(10))
        }
    }
    #[test]
    fn test_calculate_debt_success() {
        {
            let slot = 100;
            // debt 1000
            let asset_1 = Asset {
                // oracle offset set as 4
                price: 10 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 100 * 10u64.pow(6),
                last_update: slot - 10,
                decimals: 6,
                ..Default::default()
            };
            // debt 2400
            let asset_2 = Asset {
                price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 200 * 10u64.pow(6),
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 1000
            let asset_3 = Asset {
                price: 20 * 10u64.pow(ORACLE_OFFSET.into()),
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
                price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 100_000_000 * 10u64.pow(6),
                last_update: slot - 10,
                decimals: 6,
                ..Default::default()
            };
            // debt 5_000_000_000
            let asset_2 = Asset {
                price: 50_000 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 100_000 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            // debt 1_000_000
            let asset_3 = Asset {
                price: (1 * 10u64.pow(ORACLE_OFFSET.into())),
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
                price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 100_000_000 * 10u64.pow(8),
                last_update: slot - 10,
                decimals: 8,
                ..Default::default()
            };
            // debt 5_000_000_000
            let asset_2 = Asset {
                price: 50_000 * 10u64.pow(ORACLE_OFFSET.into()),
                supply: 100_000 * 10u64.pow(8),
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            // debt 0.0001
            let asset_3 = Asset {
                price: (0.0001 * 10u64.pow(ORACLE_OFFSET.into()) as f64) as u64,
                supply: 1 * 10u64.pow(6),
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 0.152407...
            let asset_4 = Asset {
                price: (1.2345 * 10u64.pow(ORACLE_OFFSET.into()) as f64) as u64,
                supply: (0.12345678 * 10u64.pow(8) as f64) as u64,
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3, asset_4];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 5200000000_152507),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
        {
            let slot = 100;
            // debt 198807739,182321
            let asset_1 = Asset {
                price: (1.567 * 10u64.pow(ORACLE_OFFSET.into()) as f64) as u64,
                supply: (126871562.97531672 * 10u64.pow(8) as f64) as u64,
                last_update: slot - 10,
                decimals: 8,
                ..Default::default()
            };
            // debt 733398054,012891
            let asset_2 = Asset {
                price: (51420.19 * 10u64.pow(ORACLE_OFFSET.into()) as f64) as u64,
                supply: (14262.842164 * 10u64.pow(6) as f64) as u64,
                last_update: 100,
                decimals: 6,
                ..Default::default()
            };
            // debt 5138,531149
            let asset_3 = Asset {
                price: (3.9672 * 10u64.pow(ORACLE_OFFSET.into()) as f64) as u64,
                supply: (1295.25386912 * 10u64.pow(8) as f64) as u64,
                last_update: 100,
                decimals: 8,
                ..Default::default()
            };
            let assets: Vec<Asset> = vec![asset_1, asset_2, asset_3];
            let result = calculate_debt(&assets, slot, 100);
            match result {
                Ok(debt) => assert_eq!(debt, 932210931_726361),
                Err(_) => assert!(false, "Shouldn't check"),
            }
        }
    }
    #[test]
    fn test_calculate_debt_error() {
        let slot = 100;
        let asset_1 = Asset {
            price: 10 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 100 * 10u64.pow(8),
            last_update: slot - 10,
            decimals: 8,
            feed_address: Pubkey::new_unique(),
            ..Default::default()
        };
        // debt 1000
        let asset_2 = Asset {
            price: 12 * 10u64.pow(ORACLE_OFFSET.into()),
            supply: 200 * 10u64.pow(8),
            last_update: 100,
            decimals: 8,
            ..Default::default()
        };
        // debt 2400
        let assets: Vec<Asset> = vec![asset_1, asset_2];
        let result = calculate_debt(&assets, slot, 0);
        // println!("{:?}", result);
        assert!(result.is_err());
    }
    #[test]
    fn test_calculate_user_debt() {
        {
            let user_account = ExchangeAccount {
                debt_shares: 100,
                owner: Pubkey::default(),
                collateral_shares: 1,
            };
            let debt = 4400_162356;

            let result = calculate_user_debt_in_usd(&user_account, debt, 1234);
            assert_eq!(result, 356_577176)
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 1525783,
                owner: Pubkey::default(),
                collateral_shares: 1,
            };
            let debt = 932210931_726361;

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, 115210)
        }
        {
            let user_account = ExchangeAccount {
                debt_shares: 9234567898765432,
                owner: Pubkey::default(),
                collateral_shares: 1,
            };
            let debt = 526932210931_726361;

            let result = calculate_user_debt_in_usd(&user_account, debt, 12345678987654321);
            assert_eq!(result, 394145294459_835460)
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
                price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
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
                price: 2 * 10u64.pow(ORACLE_OFFSET.into()),
                ..Default::default()
            };
            let result = calculate_max_user_debt_in_usd(&asset, 1000, 100 * 10u64.pow(6));
            assert_eq!(result, 20_000_000)
        }
    }
    #[test]
    fn test_amount_to_discount() {
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
}
