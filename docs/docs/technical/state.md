---
title: State

slug: /technical/state 
---

## Program data

Protocol needs a place to store persistent data. 
Most of it is stored inside _State_ structure that is passed to methods via _context_ just as any other account.

### Structure of state

State is structured like this:

    pub struct State {
        pub admin: Pubkey,
        pub halted: bool,
        pub nonce: u8,
        pub debt_shares: u64,
        pub assets_list: Pubkey,
        pub health_factor: u8,
        pub max_delay: u32,
        pub fee: u32,
        pub swap_tax_ratio: u8,
        pub swap_tax_reserve: u64,
        pub liquidation_rate: u8,
        pub penalty_to_liquidator: u8,
        pub penalty_to_exchange: u8,
        pub liquidation_buffer: u32,
        pub debt_interest_rate: u8,
        pub accumulated_debt_interest: u64,
        pub last_debt_adjustment: i64,
        pub staking: Staking,
        pub bump: u8,
    }

Respectively these fields are used for:
  * **admin** - public key of admin, only admin can modify some of state's fields using setters
  * **halted** - if set to _true_ access to methods is blocked
  * **nonce** - one of signer seeds, used to sign transactions
  * **debt_shares** - sum of all debt shares, together with user debt shares allows to calculate debt 
  * **assets_list** - address used to confirm correctness of [asset list](/docs/technical/minting#) passed to a method
  * **health_factor** - coefficient of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) (1% - 100%)
  * **max_delay** - maximum amount of slots a price can be outdated by
  * **fee** - amount of fee payed on swap in thousandths of percent (300 amounts to 0.3%)
  * **swap_tax_ratio** - percentage of fee going to the _tax reserve_ in teths of a percent (1 -> 0.1%)
  * **swap_tax_reserve** - part of total amount of charged tax, can be withdrawn by admin
  * **liquidation_rate** - part of user debt repaid on [liquidation](/docs/technical/liquidation)
  * **penalty_to_liquidator** - penalty on liquidation going to user that is liquidating
  * **penalty_to_exchange** - liquidation penalty going to liquidation fund
  * **liquidation_buffer** - amount of blocks between exceeding [max debt](/docs/glossary/max-debt)
  * **debt_interest_rate** - interest rate charged on debt (in tenths of a percent yearly)
  * **accumulated_debt_interest** - total amount charged as interest
  * **last_debt_adjustment** - timestamp of last charge of interest
  * **staking** - structure with all data needed for staking. Details are [here](/docs/technical/staking)
  * **bump** - used to [confirm address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method


### Initialization and changes

State is initialized [here](https://github.com/Synthetify/synthetify-protocol/blob/692b3e478b9a31084d9fc0f82210415aed4bcd36/programs/exchange/src/lib.rs#L129-L183).
It can later be changed using admin methods signed by the admin.


## Assets

To work platform needs to store data about all assets it is 

### Structure of _AssetsList_

Data related to assets is kept inside AssetsList:

    struct AssetsList {
        pub initialized: bool,
        pub head_assets: u8,
        pub head_collaterals: u8,
        pub head_synthetics: u8,
        pub assets: [Asset; 255],
        pub collaterals: [Collateral; 255],
        pub synthetics: [Synthetic; 255],
    }

First field just tells if _AssetsList_ has been initialized. Next three are indexes of corresponding arrays, points to last element, used as length. Last three keep data and are described below:


### Asset

Synthetify uses [Pyth oracles](https://pyth.network/) to get accurate prices of all assets. It keeps them in one place for ease of use. Data related to price is kept inside _Asset_ structure: 

    pub struct Asset {
        pub feed_address: Pubkey,
        pub price: u64,
        pub last_update: u64,
        pub twap: u64,
        pub twac: u64,
        pub status: u8,
        pub confidence: u32,
    }

* **feed_address** - address of Pyth oracle account
* **price** - price multiplied by 10 to the power of _PRICE OFFSET_ equal to 8
* **last_update** - slot of last price update
* **twap** - stands for [Time-weighted average price](https://en.wikipedia.org/wiki/Time-weighted_average_price)
* **twac** - stands for Time-weighted average confidence
* **status** - status taken from oracle saved as [_PriceStatus_](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/pyth/src/pc.rs#L14-L19), token can be swapped only of status is equal to 1
* **confidence** - confidence in ten thousandth of percent (0 - perfect, 100 -> 0.01%, 10000 -> 1% accuracy)

Every collateral asset and every synthetic assets has to have corresponding _Asset_ but they can share it. For example BTC and xBTC will have common _Asset_ as they share a price.


### Collateral asset

Data of that can be used as a [collateral](/docs/technical/collateral) are stored inside a _Collateral_ structure:

    struct Collateral {
        pub asset_index: u8,
        pub collateral_address: Pubkey, 
        pub reserve_address: Pubkey,
        pub liquidation_fund: Pubkey,
        pub reserve_balance: u64,
        pub decimals: u8,
        pub collateral_ratio: u8,
    }

  * **asset_index** - index of corresponding [asset](#asset) used to get price
  * **collateral_address** - address of token used as a collateral
  * **reserve_address** - address of account where exchange keeps deposited tokens
  * **liquidation_fund** - address of account where liquidation penalty is kept until it is withdrawn
  * **reserve_balance** - amount of tokens in reserve account
  * **decimals** - amount of decimal places in token, same as in original token
  * **collateral_ratio** - coefficient of amount of collateral to amount of debt user can have on it


### Synthetic asset

Synthetic assets created by Synthetify keep their data inside this structure:

    struct Synthetic {
        pub asset_index: u8,
        pub asset_address: Pubkey,
        pub supply: u64,
        pub decimals: u8,
        pub max_supply: u64,
        pub settlement_slot: u64,
    }

* **asset_index** - index of corresponding [asset](#asset)
* **asset_address** - address of synthetic token
* **supply** - total amount of minted tokens
* **decimals** - amount of decimal places
* **max_supply** - limit of tokens that can be minted. It exists to increase safety of the platform (can be changed at any time by admin)
* **settlement_slot** - slot when an asset will have a [settlement](/docs/technical/minting#settlement) (never by default)