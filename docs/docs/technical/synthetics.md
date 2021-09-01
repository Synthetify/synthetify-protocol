---
title: Synthetics 

slug: /technical/synthetics
---

By minting synthetic assets user enters the _debt pool_. To do it it needs to deposit some [collateral](/docs/technical/collateral) first.


## Debt

Debt is stored as *debt_shares* in [_ExchangeAccount_](/docs/technical/account). To convert it to actual amount total amount of *debt_shares* from [state](/docs/technical/state#structure-of-state) and a total debt calculated from supply (excluding borrowed and swapline supplies).

Total debt is calculated [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/math.rs#L14-L42) as a sum of all minted assets converted to USD.


### Interest rate 

Every time total debt is calculated interest rate is added to it. It's is compounded for every minute since *last_debt_adjustment* stored in [state](/docs/technical/state#structure-of-state). 


### Max debt

Maximum amount of debt user can have before it can be liquidated.


### Mint limit

Maximum amount of tokens user can mint is their mint limit. It's calculated by multiplying [*max debt*](#max-debt) by [health factor](/docs/technical/state#structure-of-state)



## Mint

User can get xUSD by minting it. Afterwards it can be swapped for other synthetics. Method responsible for minting is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L299-L360). It checks if [debt](/docs/technical/synthetics#debt) and amount is less than [*mint_limit*](#mint-limit) and if so mints token to specified account.

It takes _amount_ (u64) and following context

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
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **exchange_authority** - pubkey of exchange program
  * **usd_token** - address of xUSD token
  * **to** - account to which xUSD is minted
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_



## Burn
User can burn only xUSD. Burning reduces users debt and allows it to withdraw tokens used as collateral. Burning tokens reduces [rewards](#/docs/technical/staking#staking-structure) in *current_round*.
Method responsible for burning is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L581-L697). It takes _amount_ (u64) and this context:

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
  * **exchange_authority** - pubkey of exchange program
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **usd_token** - address of xUSD token
  * **user_token_account_burn** - account on token from which tokens will be burned
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_


## Swap 
Synthetic tokens can be swapped inside exchange. Constant fee is 0.3% for all pairs. Having SNY as a collateral gives user a discount


### Discount

  Discount is calculated [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/math.rs#L151-L177) as a percentage of fee. 

  100 => 0%  
  200 => 1%  
  500 => 2%  
  1_000 => 3%  
  2_000 => 4%  
  5_000 => 5%  
  10_000 => 6%  
  25_000 => 7%  
  50_000 => 8%  
  100_000 => 9%  
  250_000 => 10%  
  250_000 => 10%  
  500_000 => 11%  
  1_000_000 => 12%  
  2_000_000 => 13%  
  5_000_000 => 14%  
  10_000_000 => 15%  


### Swap method

Method defined for swap is defined here [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L470-L580). It burns one token, charges fee and mints reduced amount of the other token. It takes amount (u64) and a following context: 

    struct Swap<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub token_in: CpiAccount<'info, anchor_spl::token::Mint>,
        pub token_for: CpiAccount<'info, anchor_spl::token::Mint>,
        pub user_token_account_in: CpiAccount<'info, TokenAccount>,
        pub user_token_account_for: CpiAccount<'info, TokenAccount>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **exchange_authority** - pubkey of exchange program
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **token_in** - token which is send to exchange
  * **token_for** - token which is send back to user
  * **user_token_account_in** - user's account from which tokens will be taken
  * **user_token_account_for** - user's account to which tokens will be send
  * **exchange_account** - account with [user data](/docs/technical/account#structure-of-account)
  * **owner** - owner of _exchange account_


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

Method *swap_settled_synthetic* is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1541-L1565). It gets specified amount and uses above structure to swap it for xUSD. It takes single number _amount_ (u64) and a following context:

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
