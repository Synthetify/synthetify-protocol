---
title: Vaults 

slug: /technical/vaults
---

Vaults can be used to deposit and mint tokens without participating in debt pool. 


## Structure of Vault
Data describing a vault are stored inside a _Vault_ struct. Address of it generated from addresses of tokens it uses. It is structured like following: 

    struct Vault { // 293
        pub halted: bool,                            // 1
        pub synthetic: Pubkey,                       // 32
        pub collateral: Pubkey,                      // 32
        pub debt_interest_rate: Decimal,             // 17
        pub collateral_ratio: Decimal,               // 17
        pub liquidation_threshold: Decimal,          // 17
        pub liquidation_ratio: Decimal,              // 17
        pub liquidation_penalty_liquidator: Decimal, // 17
        pub liquidation_penalty_exchange: Decimal,   // 17
        pub accumulated_interest: Decimal,           // 17
        pub accumulated_interest_rate: Decimal,      // 17
        pub collateral_reserve: Pubkey,              // 32
        pub mint_amount: Decimal,                    // 17
        pub collateral_amount: Decimal,              // 17
        pub max_borrow: Decimal,                     // 17
        pub last_update: i64,                        // 8
        pub bump: u8,                                // 1
    }

  * **halted** - vault can be halted independently of rest of exchange (but halt of exchange affects it too)
  * **synthetic** - address of synthetic token
  * **collateral** - address of token used as collateral
  * **debt_interest_rate** - interest on debt 
  * **collateral_ratio** - ratio of value of collateral to value of synthetic
  * **liquidation_threshold** - 
  * **liquidation_ratio** - 
  * **liquidation_penalty_liquidator** - 
  * **liquidation_penalty_exchange** - 
  * **accumulated_interest** - interest rate of minted tokens, can be withdrawn by admin
  * **accumulated_interest_rate** - compounded interest rate, can be used instead of compounding amount by interest for every user
  * **collateral_reserve** - 
  * **mint_amount** - 
  * **collateral_amount** - 
  * **max_borrow** - 
  * **last_update** - 
  * **bump** - 


## Vault entry

Vault entry is created for every user using a vault and it stores data for it.

    pub struct VaultEntry { // 116
        pub owner: Pubkey,                           // 32
        pub vault: Pubkey,                           // 32
        pub last_accumulated_interest_rate: Decimal, // 17
        pub synthetic_amount: Decimal,               // 17
        pub collateral_amount: Decimal,              // 17
        pub bump: u8,                                // 1
    }
  
  * **owner** - owner of entry
  * **vault** - address of vault which is used
  * **last_accumulated_interest_rate** - value of *accumulated_interest_rate* when it was last charged to user
  * **synthetic_amount** - amount of minted synthetic, is increased by interest rate
  * **collateral_amount** - amount of deposited collateral token
  * **bump** - bump used as a seed

### Creation of _Vault Entry_