---
title: Swapline

slug: /technical/swapline
---

The Swapline is a more straightforward way to get synthetic tokens. It exists to keep the price of each of the synthetic tokens close to their original counterparts. Moreover, without it, amount of synthetic tokens in circulation would be smaller than debt, due to interest rate. The _Swapline_ provides a simple way to counteract that.

## Structure of Swapline

    pub struct Swapline {
        pub synthetic: Pubkey,
        pub collateral: Pubkey,
        pub fee: Decimal,
        pub accumulated_fee: Decimal,
        pub balance: Decimal,
        pub limit: Decimal,
        pub collateral_reserve: Pubkey,
        pub halted: bool,
        pub bump: u8,
    }

- **synthetic** - address of a [synthetic](/docs/technical/state#synthetic-asset) token
- **collateral** - address of a [collateral](/docs/technical/state#collateral-asset) token
- **fee** - percentage of every swap taken as a fee
- **accumulated_fee** - total amount of the fee. Can be withdrawn by admin
- **balance** - amount of tokens in reserve
- **limit** - limit of synthetic tokens that can be minted
- **collateral_reserve** - account where collateral tokens are deposited (different from both debt pool and vault counterparts)
- **halted** - swapline can be halted independently of rest of exchange (but halt of exchange affects it too)
- **bump** - used to check the address of Swapline

## Swapping tokens

Tokens can be swapped from collateral to synthetic as long as the total swapped amount is below the swapline limit. The appropriate function is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1645-L1709).

They can also be swapped back from synthetic to collateral, as long as there are enough tokens in _collateral_reserve_ (_balance_). The method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1710-L1772).

As both of these functions are so similar, they both take amount (u64) and the same struct:

    pub struct UseSwapline<'info> {
        pub state: Loader<'info, State>,
        pub swapline: Loader<'info, Swapline>,
        pub synthetic: Info<'info, anchor_spl::token::Mint>,
        pub collateral: Info<'info, anchor_spl::token::Mint>,
        pub user_collateral_account: Account<'info, TokenAccount>,
        pub user_synthetic_account: Account<'info, TokenAccount>,
        pub assets_list: Loader<'info, AssetsList>,
        pub collateral_reserve: Account<'info, TokenAccount>,
        pub signer: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **swapline** - structure with data of the exchange
- **synthetic** - address of the synthetic token
- **collateral** - address of the collateral token
- **user_collateral_account** - user account with collateral tokens
- **user_synthetic_account** - user account with synthetic tokens
- **assets_list** - list of assets structured as [this](/docs/technical/state#assetslist-structure)
- **collateral_reserve** - account with collateral tokens
- **signer** - owner of the user accounts with tokens
- **exchange_authority** - pubkey of the exchange program
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
