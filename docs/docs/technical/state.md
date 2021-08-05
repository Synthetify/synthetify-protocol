---
title: State

slug: /technical/state 
---

## Program data

Protocol needs a place to store persistent data. 
Most of it is stored inside _State_ structure that is passed to methods via _context_.

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
        pub swap_tax: u8,
        pub pool_fee: u64,
        pub liquidation_rate: u8,
        pub penalty_to_liquidator: u8,
        pub penalty_to_exchange: u8,
        pub liquidation_buffer: u32,
        pub account_version: u8,
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
  * **assets_list** - address used to confirm correctness of [asset list](/docs/technical/minting#)
  * **health_factor** - coefficient of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) (1% - 100%)
  * **max_delay** - maximum amount of slots a price can be outdated by
  * **fee** - amount of fee payed on swap in thousandths of percent (300 amounts to 0.3%)
  * **swap_tax** - percentage of fee going to the pool (see below)
  * **pool_fee** - part of total amount of charged tax, not used as for right now
  * **liquidation_rate** - part of user debt repaid on [liquidation](/docs/technical/liquidation)
  * **penalty_to_liquidator** - penalty on liquidation going to user that is liquidating
  * **penalty_to_exchange** - liquidation penalty going to liquidation fund
  * **liquidation_buffer** - amount of blocks between exceeding [max debt](/docs/glossary/max-debt)
  * **account_version** - version of state structure
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

* **initialized** - _false_ at creation, set to _true_ at initialization
* **head...** - indexes of corresponding arrays, points to last element, used as length
* **assets** - 
* **collaterals** - 
* **synthetics** - 

#### Asset

Synthetify uses [Pyth oracles](https://pyth.network/) to get accurate prices of all assets. It keeps them in one place for ease of use. Data related to price is kept inside _Asset_ structure: 

    pub struct Asset {
        pub feed_address: Pubkey,
        pub price: u64,
        pub last_update: u64,
        pub confidence: u32,
    }

* **feed_address** - address of Pyth oracle account
* **price** - price multiplied by 10 to the power of _PRICE OFFSET_ equal to 8
* **last_update** - slot of last price update
* **confidence** - confidence in ten thousandth of percent (0 - perfect, 100 -> 0.01%, 10000 -> 1% accuracy)

Every collateral asset and every synthetic assets has to have corresponding _Asset_ but they can share it. For example BTC and xBTC will have common _Asset_ as they share a price.


#### Collateral

Assets that can be used as a [collateral](/docs/technical/collateral) are stored a a _Collateral_:
