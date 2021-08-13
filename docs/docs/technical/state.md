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
        pub health_factor: Decimal,
        pub max_delay: u32,
        pub fee: Decimal,
        pub swap_tax_ratio: Decimal,
        pub swap_tax_reserve: Decimal,
        pub liquidation_rate: Decimal,
        pub penalty_to_liquidator: Decimal,
        pub penalty_to_exchange: Decimal,
        pub liquidation_buffer: u32,
        pub debt_interest_rate: Decimal,
        pub accumulated_debt_interest: Decimal,
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
  * **health_factor** - coefficient of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) as a [decimal](#decimal)
  * **max_delay** - maximum amount of slots a price can be outdated by
  * **fee** - amount of fee payed on swap as a percentage
  * **swap_tax_ratio** - percentage of fee going to the _tax reserve_
  * **swap_tax_reserve** - part of total amount of charged tax, can be withdrawn by admin
  * **liquidation_rate** - part of user debt repaid on [liquidation](/docs/technical/collateral#liquidation)
  * **penalty_to_liquidator** - penalty on liquidation going to user that is liquidating
  * **penalty_to_exchange** - liquidation penalty going to liquidation fund
  * **liquidation_buffer** - amount of blocks between exceeding [max debt](/docs/glossary/max-debt)
  * **debt_interest_rate** - interest rate charged on debt (yearly percentage, charged minutely)
  * **accumulated_debt_interest** - total amount charged as interest
  * **last_debt_adjustment** - timestamp of last charge of interest
  * **staking** - structure with all data needed for staking. Details are [here](/docs/technical/staking)
  * **bump** - used to [confirm address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method


### Initialization and changes

State is initialized [here](https://github.com/Synthetify/synthetify-protocol/blob/c643113f47b65b947a55bfe80193570e96d3ccba/programs/exchange/src/lib.rs#L2035-L2056).
It can later be changed using admin methods signed by the admin.


## Assets

To work platform needs to store data about all assets it is. Here data about decimal places, addresses and prices are aggregated.

### Structure of _AssetsList_

Data related to assets is kept inside AssetsList:

    struct AssetsList {
        pub head_assets: u8,
        pub head_collaterals: u8,
        pub head_synthetics: u8,
        pub assets: [Asset; 255],
        pub collaterals: [Collateral; 255],
        pub synthetics: [Synthetic; 255],
    }

First three are indexes of corresponding arrays, points to last element, used as length. Next three keep data and are described below:


### Asset

Synthetify uses [Pyth oracles](https://pyth.network/) to get accurate prices of all assets. It keeps them in one place for ease of use. Data related to price is kept inside _Asset_ structure: 

    pub struct Asset {
        pub feed_address: Pubkey,
        pub price: Decimal,
        pub last_update: u64,
        pub twap: Decimal,
        pub twac: Decimal,
        pub status: u8,
        pub confidence: Decimal,
    }

* **feed_address** - address of Pyth oracle account
* **price** - price multiplied by 10 to the power of _PRICE OFFSET_ equal to 8
* **last_update** - slot of last price update
* **twap** - stands for [Time-weighted average price](https://en.wikipedia.org/wiki/Time-weighted_average_price)
* **twac** - stands for Time-weighted average confidence
* **status** - status taken from oracle saved as [_PriceStatus_](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/pyth/src/pc.rs#L14-L19), token can be swapped only of status is equal to 1
* **confidence** - confidence of price in USD

Every collateral asset and every synthetic assets has to have corresponding _Asset_ but they can share it. For example BTC and xBTC will have common _Asset_ as they share a price.


### Collateral asset

Data of that can be used as a [collateral](/docs/technical/collateral) are stored inside a _Collateral_ structure:

    struct Collateral {
        pub asset_index: u8,
        pub collateral_address: Pubkey, 
        pub reserve_address: Pubkey,
        pub liquidation_fund: Pubkey,
        pub reserve_balance: Decimal,
        pub collateral_ratio: Decimal,
    }

  * **asset_index** - index of corresponding [asset](#asset) used to get price
  * **collateral_address** - address of token used as a collateral
  * **reserve_address** - address of account where exchange keeps deposited tokens
  * **liquidation_fund** - address of account where liquidation penalty is kept until it is withdrawn
  * **reserve_balance** - amount of tokens in reserve account
  * **collateral_ratio** - coefficient of collateral to debt user can have


### Synthetic asset

Synthetic assets created by Synthetify keep their data inside this structure:

    struct Synthetic {
        pub asset_index: u8,
        pub asset_address: Pubkey,
        pub supply: Decimal,
        pub max_supply: Decimal,
        pub settlement_slot: u64,
    }

* **asset_index** - index of corresponding [asset](#asset)
* **asset_address** - address of synthetic token
* **supply** - total amount of minted tokens
* **max_supply** - limit of tokens that can be minted. It exists to increase safety of the platform (can be changed by the admin)
* **settlement_slot** - slot when an asset will have a [settlement](/docs/technical/minting#settlement) (never by default)

## Decimal
In many places in synthetify code there is a need for numbers with decimal places. Tokens have them, percentages can be saved as them as well as interest rate. To avoid floating point numbers _Decimal_ was created.

### Implementation

    pub struct Decimal {
        pub val: u128,
        pub scale: u8,
    }

  Here _val_ is the value of decimal. _Scale_ can be interpreted as a position of a dot in decimal notation. _Val_ can be divided by 10 to the power of _scale_ to get a regular number. 

  To make _Decimal_ easier to use it also contains a few methods [defined here](https://github.com/Synthetify/synthetify-protocol/blob/master/programs/exchange/src/decimal.rs). Simple math methods like _add_ and _div_ with their rounding up counterparts where needed like *mul_up*. It also contains few factory methods like *from_price* and *from_percent*.


Inside SDK _Decimal_ is stored as a simple object of the following interface:

    interface Decimal {
        val: BN
        scale: number
    }