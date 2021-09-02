---
title: Collateral

slug: /technical/collateral 
---

### Why is there a need for collateral?

Collateral is needed to ensure that platform doesn't suffer losses. User's collateral is kept as a _CollateralEntry_ in an array of up to 32 different ones. It is kept inside [_ExchangeAccount_](/docs/technical/account#structure-of-account) together with index to it.

Collateral allows user to have debt and to mint tokens up to [_mint limit_](/docs/glossary#mint-limit) calculated based on it.

## Deposit

To have a collateral user has to deposit it. Method responsible for it takes amount (u64) and a following context: 

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
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **owner** - owner of collateral, doesn't have be own the _Exchange Account_
  * **exchange_authority** - pubkey belonging to the exchange, used to sign transactions

Deposit instruction has to be preceded by an [approve](https://spl.solana.com/token#authority-delegation) allowing _exchange authority_ to transfer funds.


## Withdrawal 

Unused collateral can be withdrawn. Tokens can be withdrawn up to difference between debt and collateral value multiplied by health factor. Passing _u64::MAX_ will withdraw maximum valid amount. Method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L361-L469), takes amount (u64) and a following context: 

    pub struct Withdraw<'info> {
        pub state: Loader<'info, State>,
        pub assets_list: Loader<'info, AssetsList>,
        pub exchange_authority: AccountInfo<'info>,
        pub reserve_account: CpiAccount<'info, TokenAccount>,
        pub user_collateral_account: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **exchange_authority** - pubkey of the exchange
  * **reserve_account** - account where deposited tokens are kept, must be the same as in [*Collateral*](/docs/technical/state#collateral-asset) struct
  * **user_collateral_account** - tokens where collateral will be send
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_


## Collateral in account

Inside _ExchangeAccount_ collateral is stored as one of up to 32 _CollateralEntries_. Each of them corresponds to different deposited token and look like this:

    pub struct CollateralEntry {
        // 41
        pub amount: u64,                // 8
        pub collateral_address: Pubkey, // 32
        pub index: u8,                  // 1
    }

  * **amount** - amount of tokens, with decimals as in [_Collateral_](/docs/technical/state#collateral-asset) structure
  * **collateral_address** - address of deposited tokens
  * **index** - corresponds to index of Collateral in [_AssetList_](/docs/technical/state#assetslist-structure)


## Liquidation

When value of user debt in USD exceeds value of it's collateral there is a risk of liquidation. This can happen due to drop in price of collateral tokens or increase in debt per [*debt_share*](/docs/technical/synthetics#debt). When that happens and account will be _checked_ (see below) liquidation deadline is set. 
If after certain buffer time user doesn't deposit collateral or burn synthetics account will be liquidated and part of collateral taken.


### Checking collateralization

Function responsible for it is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L928-L963). It takes minimal context of: 

    struct CheckCollateralization<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub assets_list: Loader<'info, AssetsList>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **exchange_account** - account with [user's](/docs/technical/account) collateral
  * **assets_list** - list of [assets](/docs/technical/state#assetslist-structure), containing prices

Method calculates [debt](/docs/technical/synthetics#debt) with [interest rate](/docs/technical/synthetics#interest-rate) as well as *max_debt* based on collateral and compares them. If debt is greater *liquidation_deadline* is set at current [slot](https://docs.solana.com/terminology#slot) increased by *liquidation_buffer*. When slot catches up to it user can be liquidated.


### User Liquidation

Liquidation method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L698-L927) and takes amount (u64) and this context:

    pub struct Liquidate<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub usd_token: AccountInfo<'info>,
        pub liquidator_usd_account: CpiAccount<'info, TokenAccount>,
        pub liquidator_collateral_account: AccountInfo<'info>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub signer: AccountInfo<'info>,
        pub liquidation_fund: CpiAccount<'info, TokenAccount>,
        pub reserve_account: CpiAccount<'info, TokenAccount>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **exchange_authority** - pubkey belonging to the exchange, used to sing transactions
  * **assets_list** - list of [assets](/docs/technical/state#assetslist-structure), containing prices
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **usd_token** - address of xUSD token
  * **liquidator_usd_account** - signer's account on xUSD token
  * **liquidator_collateral_account** - account on collateral token that is liquidated
  * **exchange_account** - account with data of liquidated user
  * **signer** - liquidator that signed transaction
  * **liquidation_fund** - account where liquidation penalty is kept
  * **reserve_account** - account with collateral tokens belonging to exchange

This method checks if *liquidation_deadline* has passed and debt exceeds value of collateral. If so it proceeds to liquidate specified amount up to *liquidation_rate* of total collateral increased by liquidation penalties. Liquidators xUSD is burned and liquidated users debt_shares decreased. Collateral together with *penalty_to_liquidator* (percentage of liquidated amount) goes to user account and *penalty_to_exchange* to *liquidation_fund*.