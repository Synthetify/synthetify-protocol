---
title: Swapline

slug: /technical/swapline
---

Swapline is more straightforward way to get synthetic tokens. It exists to keep price of synthetic token close to original token. Also without it amount of synthetic tokens in circulation would be smaller than debt, due to interest rate. Swapline provides simple way to counteract that.

## Structure of Swapline

    pub struct Swapline {
        // 166
        pub synthetic: Pubkey,          // 32
        pub collateral: Pubkey,         // 32
        pub fee: Decimal,               // 17
        pub accumulated_fee: Decimal,   // 17
        pub balance: Decimal,           // 17
        pub limit: Decimal,             // 17
        pub collateral_reserve: Pubkey, // 32
        pub halted: bool,               // 1
        pub bump: u8,                   // 1
    }

- **synthetic** - address of [synthetic](/docs/technical/state#synthetic-asset) token
- **collateral** - address of [collateral](/docs/technical/state#collateral-asset) token
- **fee** - percentage of every swap taken as fee
- **accumulated_fee** - total amount of fee, can be withdrawn by admin
- **balance** - amount of tokens in reserve
- **limit** - limit of synthetic tokens that can be minted
- **collateral_reserve** - account where collateral tokens are deposited (different from both debt pool and vault counterparts)
- **halted** - vault can be halted independently of rest of exchange (but halt of exchange affects it too)
- **bump** - used to check address

## Swapping tokens

Tokens can be swapped from collateral to synthetic as long as total amount swapped is below swapline limit. Appropriate function is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1645-L1709).

They can also be swapped back from synthetic to collateral, as long as there is enough tokens in *collateral_reserve* (_balance_). Method is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1710-L1772).

As both of these functions are so similar, they both take amount (u64) and the same struct: 

    pub struct UseSwapline<'info> {
        pub state: Loader<'info, State>,
        pub swapline: Loader<'info, Swapline>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub user_collateral_account: CpiAccount<'info, TokenAccount>,
        pub user_synthetic_account: CpiAccount<'info, TokenAccount>,
        pub assets_list: Loader<'info, AssetsList>,
        pub collateral_reserve: CpiAccount<'info, TokenAccount>,
        pub signer: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **swapline** - structures with data of the exchange
  * **synthetic** - address of synthetic token
  * **collateral** - address of collateral token
  * **user_collateral_account** - user account on collateral token
  * **user_synthetic_account** - user account on synthetic token
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **collateral_reserve** - account with collateral tokens
  * **signer** - owner of accounts on tokens
  * **exchange_authority** - pubkey of exchange program
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
