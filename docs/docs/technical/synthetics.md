---
title: Synthetics 

slug: /technical/synthetics
---

To mint synthetic assets user has to have [collateral](/docs/technical/collateral). 


## Debt

Debt is stored as *debt_shares* in [_ExchangeAccount_](/docs/technical/account). To convert it to actual amount total count of *debt_shares* from [state](http://localhost:3000/docs/technical/state#structure-of-state) and calculated total debt.

Total debt is calculated [here](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/exchange/src/math.rs#L12-L33) as a sum of all minted assets converted to USD.


### Interest rate 

Every time total debt is calculated interest rate is added to it. It's is compounded for every minute since *last_debt_adjustment* stored in [state](http://localhost:3000/docs/technical/state#structure-of-state). 


### Max debt

Maximum amount of debt user can have before it is liquidated.


### Mint limit

Maximum amount of tokens user can mint is their mint limit. It's calculated by multiplying [*max debt*](#max-debt) by [health factor](http://localhost:3000/docs/technical/state#structure-of-state)


## Settlement

Admin can set settlement slot (stored in [state](/docs/technical/state#structure-of-state)). When it is reached (or passed) settlement will be triggered.

### Settlement data

Data needed for settlement is stored in this structure:

    struct Settlement {
        pub bump: u8,
        pub reserve_address: Pubkey,
        pub token_in_address: Pubkey,
        pub token_out_address: Pubkey,
        pub decimals_in: u8,
        pub decimals_out: u8,
        pub ratio: u64,
    }

  * **bump** - used to [confirm address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method
  * **reserve_address** - account belonging to exchange where deposited collaterals are kept
  * **token_in_address** - token which was settled
  * **token_out_address** - token in which settlement will be pain (equal to xUSD token)
  * **decimals_in** - amount of decimal places in settled token
  * **decimals_out** - amount of decimal places in target token
  * **ratio** - ratio of prices of both tokens at moment of settlement (for xUSD just price of token)

### Swapping settled synthetic

Method *swap_settled_synthetic* is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/exchange/src/lib.rs#L1362-L1393). It gets specified amount and uses above structure to swap it for xUSD. It takes single number _amount_ (u64) and a following context:

    struct SwapSettledSynthetic<'info> {
        pub settlement: Loader<'info, Settlement>,
        pub state: Loader<'info, State>,
        pub token_to_settle: AccountInfo<'info>,
        pub user_settled_token_account: CpiAccount<'info, TokenAccount>,
        pub user_usd_account: CpiAccount<'info, TokenAccount>,
        pub settlement_reserve: CpiAccount<'info, TokenAccount>,
        pub usd_token: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
        pub signer: AccountInfo<'info>,
    }

  * **settlement** - _Settlement_ structure with data needed for settlement (see [above](#settlement-data))
  * **state** - account with [data of the program](/docs/technical/state)
  * **token_to_settle** - address of settled token
  * **user_settled_token_account** - account on settled token belonging to user
  * **user_usd_account** - account on xUSD
  * **settlement_reserve** - account from which xUSD is transferred (specified in _Settlement_ structure)
  * **usd_token** - address of xUSD token
  * **exchange_authority** - pubkey belonging to program
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **signer** - owner of account on settled token


## Mint

To get Synthetic tokens you have to mint them. Only xUSD can be minted. 

It check if sum of debt and amount is less than [*mint_limit*](#mint-limit) and if so mints token to specified account.



### Mint method

Method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/cb56d5f6aa971375d651ae452c216d42203c511a/programs/exchange/src/lib.rs#L258-L314) and takes _amount_ (u64) and following context

    struct Mint<'info> {
        pub state: Loader<'info, State>,
        pub assets_list: Loader<'info, AssetsList>,
        pub exchange_authority: AccountInfo<'info>,
        pub usd_token: AccountInfo<'info>,
        pub to: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **assets_list** - list of assets, structured like [this]('/docs/technical/state#assetslist-structure')
  * **exchange_authority** - authority of the program
  * **usd_token** - address of xUSD token
  * **to** - account to which xUSD is minted
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_


## Burn
User can burn only xUSD.
TODO: finish this

### Burn method

Method responsible for burning is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/cb56d5f6aa971375d651ae452c216d42203c511a/programs/exchange/src/lib.rs#L539-L661). It takes _amount_ (u64) and this context:

    struct BurnToken<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub usd_token: AccountInfo<'info>,
        pub user_token_account_burn: CpiAccount<'info, TokenAccount>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **exchange_authority** - authority of the program
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **usd_token** - address of xUSD token
  * **user_token_account_burn** - account on token from which tokens will be burned
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_

## Liquidation