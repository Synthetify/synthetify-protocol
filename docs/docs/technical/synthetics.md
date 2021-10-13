---
title: Synthetics

slug: /technical/synthetics
---

User can join enters the _debt pool_ by minting synthetic assets . To do it, they need to deposit some [collateral](/docs/technical/collateral) first.

## Debt

Debt is stored as _debt_shares_ in [_ExchangeAccount_](/docs/technical/account). To convert it to the actual amount, fraction got by dividing user's _debt_shares_ by total amount of _debt_shares_ from [state](/docs/technical/state#structure-of-state) has to be multiplied by total debt calculated from the sum of supplies of minted tokens (excluding borrowed and _swapline_ supplies).

Total debt is calculated [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/math.rs#L14-L42) as a sum of all minted assets converted to USD.

### Interest rate

Every time total debt is calculated, interest rate is added to it. It's compounded of every minute since _last_debt_adjustment_ stored in [state](/docs/technical/state#structure-of-state).

### Max debt

The maximum amount of debt a user can have before they can be liquidated.

### Mint limit

The maximum amount of tokens a user can mint is their mint limit. It's calculated by multiplying [_max debt_](#max-debt) by [health factor](/docs/technical/state#structure-of-state)

## Mint

A user can get xUSD by minting it. Afterward, it can be swapped for other synthetics. The method responsible for minting is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L299-L360). It checks if the sum of [debt](/docs/technical/synthetics#debt) and amount is less than [_mint_limit_](#mint-limit) and if so, mints token to the specified account.

It takes _amount_ (u64) and following context

    struct Mint<'info> {
        pub state: Loader<'info, State>,
        pub assets_list: Loader<'info, AssetsList>,
        pub exchange_authority: AccountInfo<'info>,
        pub usd_token: Info<'info, anchor_spl::token::Mint>,
        pub to: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **assets_list** - list of assets structured as [this](/docs/technical/state#assetslist-structure)
- **exchange_authority** - pubkey of the exchange program
- **usd_token** - address of xUSD token
- **to** - account, to which xUSD is minted
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **exchange_account** - account with [user's data](/docs/technical/account#structure-of-account)
- **owner** - owner of the _exchange account_

## Burn

User can burn only xUSD. Burning reduces user's debt and allows them to withdraw tokens used as collateral. Burning tokens reduces [rewards](#/docs/technical/staking#staking-structure) in _current_round_.
Method responsible for burning is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L581-L697). It takes _amount_ (u64) and this context:

    struct BurnToken<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub usd_token: Account<'info, anchor_spl::token::Mint>,
        pub user_token_account_burn: Account<'info, TokenAccount>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_authority** - pubkey of the exchange program
- **assets_list** - list of assets structured as [this](/docs/technical/state#assetslist-structure)
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **usd_token** - address of xUSD token
- **user_token_account_burn** - account, from which tokens will be burned
- **exchange_account** - account with [user's data](/docs/technical/account#structure-of-account)
- **owner** - owner of the _exchange account_

## Swap

Synthetic tokens can be swapped in the Exchange. The fee is 0.3% for all pairs and is fixed. Having SNY as collateral gives the user a discount.

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
500_000 => 11%  
1_000_000 => 12%  
2_000_000 => 13%  
5_000_000 => 14%  
10_000_000 => 15%

### Swap method

Method responsible for swap is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L470-L580). It burns one token, charges fee and mints reduced amount of the other token. It takes amount (u64) and a following context:

    struct Swap<'info> {
        pub state: Loader<'info, State>,
        pub exchange_authority: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub token_program: AccountInfo<'info>,
        pub token_in: Account<'info, anchor_spl::token::Mint>,
        pub token_for: Account<'info, anchor_spl::token::Mint>,
        pub user_token_account_in: Account<'info, TokenAccount>,
        pub user_token_account_for: Account<'info, TokenAccount>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_authority** - pubkey of the exchange program
- **assets_list** - list of assets structured as [this](/docs/technical/state#assetslist-structure)
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **token_in** - token, which is sent to the Exchange
- **token_for** - token, which is sent back to the user
- **user_token_account_in** - user's account, from which tokens will be taken
- **user_token_account_for** - user's account, to which tokens will be sent
- **exchange_account** - account with [user's data](/docs/technical/account#structure-of-account)
- **owner** - owner of the _exchange account_

## Settlement

Admin can set a settlement slot (stored in [the state](/docs/technical/state#structure-of-state)). When it is reached (or passed), settlement will be triggered.

### Settlement data

Data needed for settlement is stored in this structure:

    struct Settlement {
        pub bump: u8,
        pub reserve_address: Pubkey,
        pub token_in_address: Pubkey,
        pub token_out_address: Pubkey,
        pub decimals_in: u8,
        pub decimals_out: u8,
        pub ratio: Decimal,
    }

- **bump** - used to [confirm the address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of the state passed to a method
- **reserve_address** - account belonging to the exchange, where deposited collateral is kept
- **token_in_address** - token, which was settled
- **token_out_address** - token, in which settlement will be sent (equal to xUSD token)
- **decimals_in** - number of decimal places in the settled token
- **decimals_out** - the number of decimal places in the target token
- **ratio** - ratio of prices of both tokens at the moment of settlement (for xUSD just price of token)

### Swapping settled synthetic

Method _swap_settled_synthetic_ is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1541-L1565). It gets specified amount and uses below structure to swap it for xUSD. It takes single number _amount_ (u64) and a following context:

    struct SwapSettledSynthetic<'info> {
        pub settlement: Loader<'info, Settlement>,
        pub state: Loader<'info, State>,
        pub token_to_settle: Account<'info, anchor_spl::token::Mint>,
        pub user_settled_token_account: Account<'info, TokenAccount>,
        pub user_usd_account: Account<'info, TokenAccount>,
        pub settlement_reserve: Account<'info, TokenAccount>,
        pub usd_token: Account<'info, anchor_spl::token::Mint>,
        pub exchange_authority: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
        pub signer: AccountInfo<'info>,
    }

- **settlement** - _Settlement_ structure with data needed for settlement (about [settlement data](#settlement-data))
- **state** - account with [data of the program](/docs/technical/state)
- **token_to_settle** - address of the settled token
- **user_settled_token_account** - user's account with settled tokens belonging to the user
- **user_usd_account** - user's account with xUSD
- **settlement_reserve** - account, from which xUSD is transferred (specified in _Settlement_ structure)
- **usd_token** - address of xUSD token
- **exchange_authority** - pubkey belonging to the program
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **signer** - owner of the account with settled tokens
