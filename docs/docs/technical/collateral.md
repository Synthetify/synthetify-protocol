---
title: Collateral

slug: /technical/collateral 
---

### Why do you need collateral?

Collateral is needed to ensure that platform doesn't suffer losses. User's collateral is kept as a _CollateralEntry_ in an array of up to 32 different ones. It and an index to array is kept inside [_ExchangeAccount_](http://localhost:3000/docs/technical/account#structure-of-account).

Collateral allows user to have debt and to mint tokens up to 
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
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **exchange_account** - account with [user specific data](/docs/technical/account)
  * **reserve_address** - account belonging to exchange where deposited collaterals are kept
  * **user_collateral_account** - user account with deposited tokens
  * **token_program** - program of the deposited token
  * **assets_list** - list of assets, structured like [this]('/docs/technical/state#assetslist-structure')
  * **owner** - owner of collateral, doesn't have be own the _Exchange Account_
  * **exchange_authority** - authority of the exchange

Deposit instruction has to be preceded by an [approve](https://spl.solana.com/token#authority-delegation) allowing _exchange authority_ to transfer funds.


### Collateral in account

Inside _ExchangeAccount_ collateral is stored as one of up to 32 _CollateralEntries_. Each of them corresponds to different deposited token and look like this:

    struct CollateralEntry {
        amount: u64,
        collateral_address: Pubkey,
        index: u8,
    }

  * **amount** - amount of tokens, with decimals as in [_Collateral_](/docs/technical/state#collateral-asset) structure
  * **collateral_address** - address of deposited tokens
  * **index** - corresponds to index of Collateral in [_AssetList_](/docs/technical/state#assetslist-structure)