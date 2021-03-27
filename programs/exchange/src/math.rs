use crate::*;

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
}
