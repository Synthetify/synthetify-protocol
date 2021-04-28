use std::convert::TryInto;

use crate::*;
use manager::Asset;

pub fn check_feed_update(
    assets: &Vec<Asset>,
    indexA: usize,
    indexB: usize,
    max_delay: u32,
    slot: u64,
) -> Result<()> {
    // Check assetA
    if (assets[indexA].last_update as u64) < slot - max_delay as u64 {
        return Err(ErrorCode::OutdatedOracle.into());
    }
    // Check assetB
    if (assets[indexB].last_update as u64) < slot - max_delay as u64 {
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

#[cfg(test)]
mod tests {

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
}
