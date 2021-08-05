---
title: Collateral

slug: /technical/collateral 
---

### Why do you need collateral?

Collateral is needed to ensure that platform doesn't suffer losses.

Collateral is kept as a _CollateralEntry_ in an array of up to 32 different ones. It and an index to array is kept inside [_ExchangeAccount_](http://localhost:3000/docs/technical/account#structure-of-account).

Based on collateral program calculates [_mint limit_](/docs/glossary#mint-limit)


### Deposit

To have a collateral you have to deposit it. Method responsible for it takes _amount (u64)_ and a following context: 

    // Constraints were removed for simplicity 
    struct Deposit<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub reserve_address: CpiAccount<'info, TokenAccount>,
        pub user_collateral_account: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        // owner can deposit to any exchange_account
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }
