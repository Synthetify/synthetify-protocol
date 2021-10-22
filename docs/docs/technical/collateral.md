---
title: Collateral

slug: /technical/collateral
---

### Why is there a need for collateral?

Collateral is needed to ensure that platform doesn't suffer losses. User's collateral is kept as a _CollateralEntry_ in an array of up to 32 different ones. It is kept inside [_ExchangeAccount_](/docs/technical/account#structure-of-account) together with an index to it.

Collateral allows users to have debt and to mint tokens up to the [_mint limit_](/docs/glossary#mint-limit) calculated based on it.

## Deposit

To have a collateral user has to deposit it. Method responsible for it takes amount (u64) and a following context:

    struct Deposit<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub reserve_address: Account<'info, TokenAccount>,
        pub user_collateral_account: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_account** - account with [user-specific data](/docs/technical/account)
- **reserve_address** - account belonging to exchange where deposited collaterals are kept
- **user_collateral_account** - user's account with deposited tokens
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **assets_list** - list of assets, structured as [this](/docs/technical/state#assetslist-structure)
- **owner** - the owner of the collateral, doesn't have to own an _Exchange Account_
- **exchange_authority** - pubkey belonging to the exchange, used to sign transactions

Deposit instruction has to be preceded by an [approval](https://spl.solana.com/token#authority-delegation) allowing _exchange authority_ to transfer funds.

## Withdrawal

Unused collateral can be withdrawn. Tokens can be withdrawn up to a difference between debt and collateral value multiplied by health factor. Passing _u64::MAX_ will withdraw maximum valid amount. Method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L361-L469), which takes amount (u64) and a following context:

    pub struct Withdraw<'info> {
        pub state: Loader<'info, State>,
        pub assets_list: Loader<'info, AssetsList>,
        pub exchange_authority: AccountInfo<'info>,
        pub reserve_account: Account<'info, TokenAccount>,
        pub user_collateral_account: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **assets_list** - list of assets, structured as [this](/docs/technical/state#assetslist-structure)
- **exchange_authority** - pubkey of the exchange
- **reserve_account** - the account, where deposited tokens are kept. Must be the same as in [_Collateral_](/docs/technical/state#collateral-asset) struct
- **user_collateral_account** - tokens where collateral will be sent
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
- **owner** - the owner of the _exchange account_

## Collateral in account

Collateral is stored inside _ExchangeAccount_ as one of up to 32 _CollateralEntries_. Each of them corresponds to different deposited token and look like this:

    pub struct CollateralEntry {
        pub amount: u64,
        pub collateral_address: Pubkey,
        pub index: u8,
    }

- **amount** - the amount of tokens, with decimals as in [_Collateral_](/docs/technical/state#collateral-asset) structure
- **collateral_address** - address of deposited tokens
- **index** - corresponds to the index of Collateral in [_AssetList_](/docs/technical/state#assetslist-structure)

## Liquidation

When the value of user's debt in USD exceeds the value of their collateral, there is a risk of liquidation. This can happen due to a drop in the price of collateral tokens or an increase in debt per [_debt_share_](/docs/technical/synthetics#debt). When that happens and the account is _checked_ (see below), liquidation deadline is set.
If user doesn't deposit collateral after a certain buffer time or burn synthetics, account will be liquidated and part of the collateral taken.

### Checking collateralization

Function responsible for it is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L928-L963). It takes minimal context of:

    struct CheckCollateralization<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub assets_list: Loader<'info, AssetsList>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_account** - account with [user's](/docs/technical/account) collateral
- **assets_list** - list of [assets](/docs/technical/state#assetslist-structure) containing prices

The method calculates [debt](/docs/technical/synthetics#debt) with the [interest rate](/docs/technical/synthetics#interest-rate). as well as _max_debt_. based on collateral and compares them. If the debt is greater _liquidation_deadline_ is set at the current [slot](https://docs.solana.com/terminology#slot) increased by _liquidation_buffer_. When the slot number catches up to it user can be liquidated.

### User Liquidation

Liquidation method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L698-L927) and takes amount (u64) and this context:

    pub struct Liquidate<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub usd_token: Account<'info, anchor_spl::token::Mint>,
        pub liquidator_usd_account: Account<'info, TokenAccount>,
        pub liquidator_collateral_account: Account<'info, TokenAccount>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub signer: AccountInfo<'info>,
        pub liquidation_fund: Account<'info, TokenAccount>,
        pub reserve_account: Account<'info, TokenAccount>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_authority** - pubkey belonging to the exchange, which is used to sing transactions
- **assets_list** - list of [assets](/docs/technical/state#assetslist-structure) containing prices
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **usd_token** - address of xUSD token
- **liquidator_usd_account** - signer's account with xUSD tokens
- **liquidator_collateral_account** - account with collateral tokens that is liquidated
- **exchange_account** - account with data of the liquidated user
- **signer** - liquidator that signed transaction
- **liquidation_fund** - the account keeping liquidation penalty
- **reserve_account** - the account with collateral tokens belonging to the exchange program

This method checks if _liquidation_deadline_ has passed and debt exceeds the value of the collateral. If so, it proceeds to liquidate a specified amount, up to _liquidation_rate_ of total collateral increased by liquidation penalties. Liquidator's xUSD is burned and liquidated user's debt*shares decreases. Collateral, together with \_penalty_to_liquidator*, (percentage of liquidated amount) goes to a user's account and _penalty_to_exchange_ to _liquidation_fund_.
