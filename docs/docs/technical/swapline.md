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

  * **synthetic** - address of synthetic token
  * **collateral** - address of collateral token
  * **fee** - percentage of every swap taken as fee
  * **accumulated_fee** - total amount of fee, can be withdrawn by admin
  * **balance** - amount of tokens in reserve
  * **limit** - limit of synthetic tokens that can be minted
  * **collateral_reserve** - account where collateral tokens are deposited
  * **halted** - vault can be halted independently of rest of exchange (but halt of exchange affects it too)
  * **bump** - used to check address

## 