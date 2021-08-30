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
  * **collateral_ratio** - ratio of value of collateral to value of synthetic that can be borrowed using it
  * **liquidation_threshold** - ratio of debt to value of collateral when account can be liquidated
  * **liquidation_ratio** - percentage of user's collateral that can be liquidated with one liquidation
  * **liquidation_penalty_liquidator** - percentage of additional collateral that goes to liquidator
  * **liquidation_penalty_exchange** - percentage of liquidation that goes to liquidation fund as a penalty
  * **accumulated_interest** - interest rate of minted tokens, can be withdrawn by admin
  * **accumulated_interest_rate** - compounded interest rate, can be used instead of compounding amount by interest for every user
  * **collateral_reserve** - address of account to which tokens are deposited (different than reserve for deposit to staking)
  * **mint_amount** - amount already minted (both amount borrowed and interest)
  * **collateral_amount** - amount of deposited collateral in reserve
  * **max_borrow** - limit of total synthetic that can be borrowed
  * **last_update** - 
  * **bump** - used to generate address of account


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

Vault entry is created [TODO](#), takes bump (u8) and a following context: 

    struct CreateVaultEntry<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub owner: AccountInfo<'info>,
        pub vault: Loader<'info, Vault>,
        pub assets_list: Loader<'info, AssetsList>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub rent: Sysvar<'info, Rent>,
        pub system_program: AccountInfo<'info>,
    }

  * **state** -   * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - 
  * **owner** - pubkey belonging to owner of the account
  * **vault** - vault for which entry is created
  * **assets_list** - list of assets, structured like [this]('/docs/technical/state#assetslist-structure')
  * **synthetic** - address of synthetic token used as a seed for entry
  * **collateral** - address of collateral token also used as seed
* **rent** - a data structure relating to [rent](https://docs.solana.com/developing/programming-model/accounts#rent), used by Solana
* **system_program** - needed to create account


## Deposit 

Method depositing tokens is defined [TODO](#), takes amount (u64) and a context structured like this:

    pub struct DepositVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub reserve_address: CpiAccount<'info, TokenAccount>,
        pub user_collateral_account: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - user account in vault
  * **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
  * **synthetic** - address of asset used as synthetic in vault
  * **collateral** - address of deposited token
  * **reserve_address** - address of account to which tokens are deposited (different than reserve for deposit to staking)
  * **user_collateral_account** - account from which tokens are transferred  
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **owner** - owner of _collateral account_ and [_vault entry_ ](/docs/technical/vaults#vault-entry)
  * **exchange_authority** - pubkey belonging to the exchange


## Borrow

Borrow is the counterpart of minting in _Vault_. It allows user to borrow synthetic asset up to *collateral_amount* * *collateral_ratio*. It is defined [TODO](#), takes amount (u64) and a context: 

    struct BorrowVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub to: CpiAccount<'info, TokenAccount>, // not must be owner
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }


  * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - user account in vault
  * **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
  * **synthetic** - address of borrowed token
  * **collateral** - address of token used as collateral token
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **to** - account to which borrowed tokens will be transferred
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **owner** - owner of [_vault entry_ ](/docs/technical/vaults#vault-entry)
  * **exchange_authority** - pubkey belonging to the exchange


## Withdraw

Method responsible for withdrawal is defined [here]. It withdraws users collateral up to when value of collateral * *collateral_ratio* are equal to borrowed synthetic. It takes amount (u64, when equal to u64::MAX maximum amount will be withdrawn) and a followind context: 

    struct WithdrawVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub reserve_address: CpiAccount<'info, TokenAccount>,
        pub user_collateral_account: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
  * **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
  * **synthetic** - address of token used as a synthetic
  * **collateral** - address of token used as collateral
  * **reserve_address** - address of account from which tokens are withdrawn (same as in corresponding vault)
  * **user_collateral_account** - account to which tokens will be transferred
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
  * **owner** - owner of _VaultEntry_, signer of transaction
  * **exchange_authority** - pubkey of exchange program


## Repay

Repay method allows user to burn borrowed tokens, and free it's collateral. It is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/15532f5847c194f0bfcaa9ca5806601fdab45f46/programs/exchange/src/lib.rs#L2016-L2058), takes amount (u64) and a following context:

    struct RepayVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub user_token_account_repay: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
  * **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
  * **synthetic** - address of token used as a synthetic
  * **collateral** - address of token used as collateral
  * **assets_list** - list of assets, structured like [this]('/docs/technical/state#assetslist-structure')
  * **user_token_account_repay** - account from with tokens will be repaid
  * **owner** - owner of _VaultEntry_ and collateral amount, signer of transaction
  * **exchange_authority** - pubkey of exchange program


## Liquidation

Function responsible for liquidation is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/15532f5847c194f0bfcaa9ca5806601fdab45f46/programs/exchange/src/lib.rs#L2059-L2225). It checks if user can be liquidated, and if amount is valid. Liquidated amount is smaller or equal to difference between borrow limit and current debt and is below *liquidation_ratio* of collateral (or sets is at max if amount is equal to u64::MAX). Method takes amount (u64) and this context: 


    pub struct LiquidateVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: AccountInfo<'info>,
        pub collateral: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub collateral_reserve: CpiAccount<'info, TokenAccount>,
        pub liquidator_synthetic_account: CpiAccount<'info, TokenAccount>,
        pub liquidator_collateral_account: CpiAccount<'info, TokenAccount>,
        pub liquidation_fund: CpiAccount<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub liquidator: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

  * **state** - account with [data of the program](/docs/technical/state)
  * **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
  * **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
  * **synthetic** - address of token used as a synthetic
  * **collateral** - address of token used as collateral
  * **assets_list** - list of assets, structured like [this]('/docs/technical/state#assetslist-structure')  
  * **collateral_reserve** - address of account where deposited tokens are kept
  * **liquidator_synthetic_account** - account from which synthetic tokens will be repaid
  * **liquidator_collateral_account** - account to which collateral tokens will be transferred
  * **liquidation_fund** - account where *liquidation_penalty_exchange* will be transferred (same as in [_Collateral_](/docs/technical/state#collateral-asset) struct)
  * **token_program** - address of solana's [_Token Program_](https://spl.solana.com/token)
  * **owner** - owner of *vault_entry*, needed to check address
  * **liquidator** - signer, owner of accounts on synthetic and collateral
  * **exchange_authority** - pubkey of exchange program
