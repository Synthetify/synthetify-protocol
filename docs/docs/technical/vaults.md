---
title: Vaults

slug: /technical/vaults
---

Vaults can be used to deposit and mint tokens without participating in the debt pool.

## Structure of Vault

Data describing a vault is stored inside a _Vault_ struct. Its address is generated from addresses of tokens it uses. It is structured as following:

    struct Vault {
        pub halted: bool,
        pub synthetic: Pubkey,
        pub collateral: Pubkey,
        pub debt_interest_rate: Decimal,
        pub collateral_ratio: Decimal,
        pub liquidation_threshold: Decimal,
        pub liquidation_ratio: Decimal,
        pub liquidation_penalty_liquidator: Decimal,
        pub liquidation_penalty_exchange: Decimal,
        pub accumulated_interest: Decimal,
        pub accumulated_interest_rate: Decimal,
        pub collateral_reserve: Pubkey,
        pub mint_amount: Decimal,
        pub collateral_amount: Decimal,
        pub max_borrow: Decimal,
        pub last_update: i64,
        pub bump: u8,
    }

- **halted** - vault can be halted independently of rest of exchange (but halt of exchange affects it too)
- **synthetic** - address of the synthetic token
- **collateral** - address of the token used as collateral
- **debt_interest_rate** - yearly interest rate (charged minutely)
- **collateral_ratio** - ratio of collateral to synthetic token that can be [borrowed](#borrow) using it
- **liquidation_threshold** - ratio of debt to the value of collateral defining when an account can be [liquidated](#liquidation)
- **liquidation_ratio** - percentage of user's collateral that can be liquidated at once
- **liquidation_penalty_liquidator** - percentage of additional collateral going to a liquidator
- **liquidation_penalty_exchange** - percentage of liquidation that goes to liquidation fund as a penalty
- **accumulated_interest** - interest rate of minted tokens. Can be withdrawn by admin
- **accumulated_interest_rate** - compounded interest rate. Can be used instead of compounding amount by the interest rate for every user
- **collateral_reserve** - address of the account to which tokens are deposited (different than reserve for [deposit](/docs/technical/collateral#deposit) to staking)
- **mint_amount** - the amount already minted (both amount borrowed and interest)
- **collateral_amount** - the amount of deposited collateral in reserve
- **max_borrow** - limit of total synthetic that can be borrowed
- **last_update** - timestamp since the last update of interest rate
- **bump** - used to generate the address of an account

## Vault entry

Vault entry is created for every user using a vault and it stores data for it.

    pub struct VaultEntry {
        pub owner: Pubkey,
        pub vault: Pubkey,
        pub last_accumulated_interest_rate: Decimal,
        pub synthetic_amount: Decimal,
        pub collateral_amount: Decimal,
        pub bump: u8,
    }

- **owner** - pubkey belonging to the owner of an entry
- **vault** - address of vault which is used
- **last_accumulated_interest_rate** - the value of _accumulated_interest_rate_ when it was last charged to the user
- **synthetic_amount** - the amount of minted synthetic, is increased by interest rate
- **collateral_amount** - the amount of deposited collateral token
- **bump** - bump used as a seed

### Creation of _Vault Entry_

Vault entry is created [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1836-L1867), takes bump (u8) and a following context:

    struct CreateVaultEntry<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub owner: AccountInfo<'info>,
        pub vault: Loader<'info, Vault>,
        pub assets_list: Loader<'info, AssetsList>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub rent: Sysvar<'info, Rent>,
        pub system_program: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault
- **owner** - pubkey belonging to the owner of the account
- **vault** - vault for which entry is created
- **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
- **synthetic** - address of synthetic token used as a seed for entry
- **collateral** - address of collateral token also used as seed
- **rent** - a data structure relating to [rent](https://docs.solana.com/developing/programming-model/accounts#rent), needed to create an account
- **system_program** - Solana's [_System Program_](https://docs.solana.com/developing/runtime-facilities/programs#system-program) needed to create an account

## Deposit

Method depositing tokens is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1869-L1912), takes amount (u64) and a context structured like this:

    pub struct DepositVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub reserve_address: Account<'info, TokenAccount>,
        pub user_collateral_account: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault
- **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
- **synthetic** - address of asset used as synthetic in the used vault
- **collateral** - address of the deposited token
- **reserve_address** - address of the account to which tokens are deposited (different than reserve for deposit to staking)
- **user_collateral_account** - account from which tokens are transferred
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
- **owner** - the owner of _collateral account_ and [_vault entry_ ](/docs/technical/vaults#vault-entry)
- **exchange_authority** - pubkey belonging to the exchange

## Borrow

Borrow is the counterpart of minting in _Vault_. It allows user to borrow synthetic asset up to _collateral_amount_ _\*_ _collateral_ratio_. It is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1913-L1992), takes amount (u64) and a context:

    struct BorrowVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub assets_list: Loader<'info, AssetsList>,
        pub to: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault
- **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
- **synthetic** - address of the borrowed token
- **collateral** - address of token used as a collateral token
- **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
- **to** - account to which borrowed tokens will be transferred (does not have to be owned by signer)
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **owner** - signer, owner of [_vault entry_ ](/docs/technical/vaults#vault-entry)
- **exchange_authority** - pubkey belonging to the exchange

## Withdraw

Method responsible for withdrawal is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1994-L2062). It withdraws users collateral up to when value of collateral \* _collateral_ratio_ are equal to borrowed synthetic. It takes amount (u64, when equal to _u64::MAX_ maximum amount will be withdrawn) and a following context:

    struct WithdrawVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub reserve_address: Account<'info, TokenAccount>,
        pub user_collateral_account: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub assets_list: Loader<'info, AssetsList>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
- **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
- **synthetic** - address of token used as a synthetic
- **collateral** - address of token used as collateral
- **reserve_address** - address of the account from which tokens are withdrawn (same as in the corresponding vault)
- **user_collateral_account** - account to which tokens will be transferred
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **assets_list** - list of assets, structured like [this](/docs/technical/state#structure-of-assetslist)
- **owner** - signer, owner of _VaultEntry_, signer of the transaction
- **exchange_authority** - pubkey of the exchange program

## Repay

Repay method allows user to burn borrowed tokens, and free its collateral. It is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L2064-L2109), takes amount (u64) and a following context:

    struct RepayVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub assets_list: Loader<'info, AssetsList>,
        pub user_token_account_repay: Account<'info, TokenAccount>,
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
- **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
- **synthetic** - address of token used as a synthetic
- **collateral** - address of token used as collateral
- **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
- **user_token_account_repay** - account from with tokens will be repaid
- **owner** - the owner of _VaultEntry_ and collateral amount, signer of a transaction
- **exchange_authority** - pubkey of the exchange program

## Liquidation

Function responsible for liquidation is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L2110-L2282). It checks if user can be liquidated, and if amount is valid. Liquidated amount is not greater than difference between borrow limit and current debt and below _liquidation_ratio_ of collateral (or sets is at maximum valid value if amount is equal to _u64::MAX_). Method takes amount (u64) and this context:

    pub struct LiquidateVault<'info> {
        pub state: Loader<'info, State>,
        pub vault_entry: Loader<'info, VaultEntry>,
        pub vault: Loader<'info, Vault>,
        pub synthetic: Account<'info, anchor_spl::token::Mint>,
        pub collateral: Account<'info, anchor_spl::token::Mint>,
        pub assets_list: Loader<'info, AssetsList>,
        pub collateral_reserve: Account<'info, TokenAccount>,
        pub liquidator_synthetic_account: Account<'info, TokenAccount>,
        pub liquidator_collateral_account: Box<Account<'info, TokenAccount>>,
        pub liquidation_fund: Box<Account<'info, TokenAccount>>,
        pub token_program: AccountInfo<'info>,
        pub owner: AccountInfo<'info>,
        pub liquidator: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **vault_entry** - user account in vault ([this one](/docs/technical/vaults#vault-entry))
- **vault** - account storing [data](/docs/technical/vaults#structure-of-vault) for particular pair
- **synthetic** - address of token used as a synthetic
- **collateral** - address of token used as collateral
- **assets_list** - list of assets, structured like [this](/docs/technical/state#assetslist-structure)
- **collateral_reserve** - address of account where deposited tokens are kept
- **liquidator_synthetic_account** - account from which synthetic tokens will be repaid
- **liquidator_collateral_account** - account to which collateral tokens will be transferred
- **liquidation_fund** - the account where _liquidation_penalty_exchange_ will be transferred (same as in [_Collateral_](/docs/technical/state#collateral-asset) struct)
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **owner** - the owner of _vault_entry_, needed to check the address of it
- **liquidator** - signer, owner of accounts with synthetics and collateral tokens
- **exchange_authority** - pubkey of the exchange program
