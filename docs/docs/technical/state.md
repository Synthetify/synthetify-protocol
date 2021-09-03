---
title: State

slug: /technical/state 
---

## Program data

The protocol needs a place to store persistent data. Most of it is stored inside the _State_ structure that is passed to methods just like any other account.

### Structure of state

State is structured like this:

    pub struct State {
        // 2048
        pub admin: Pubkey,                      // 32
        pub halted: bool,                       // 1
        pub nonce: u8,                          // 1
        pub debt_shares: u64,                   // 8
        pub assets_list: Pubkey,                // 32
        pub health_factor: Decimal,             // 17 In % 1-100% modifier for debt
        pub max_delay: u32,                     // 4  In slots delay between last oracle update 100 blocks ~ 1 min
        pub fee: Decimal,                       // 17 In % default fee per swap
        pub swap_tax_ratio: Decimal,            // 17 In % range 0-20%
        pub swap_tax_reserve: Decimal,          // 17 Amount on tax from swap
        pub liquidation_rate: Decimal,          // 17 Percentage of debt repay in liquidation
        pub penalty_to_liquidator: Decimal,     // 17 In % range 0-25%
        pub penalty_to_exchange: Decimal,       // 17 In % range 0-25%
        pub liquidation_buffer: u32,            // 4  Time given user to fix collateralization ratio (in slots)
        pub debt_interest_rate: Decimal,        // 17 In % range 0-20%
        pub accumulated_debt_interest: Decimal, // 17 Accumulated debt interest
        pub last_debt_adjustment: i64,          // 8
        pub staking: Staking,                   // 152
        pub exchange_authority: Pubkey,         // 32
        pub bump: u8,                           // 1
        pub padding: [u8; 1620],                // 1620 (2048 - 428) reserved for future use
    }

Respectively these fields are used for:
  * **admin** - the pubkey of admin, only admin can modify state using setters
  * **halted** - if set to _true_ access to methods is blocked
  * **nonce** - one of the seeds of the _exchangeAuthority_, used to sign transactions
  * **debt_shares** - the total amount of _debt shares_, together with user _debt shares_ allows calculating debt, more on that [here](/docs/technical/synthetics#debt)
  * **assets_list** - address used to confirm the correctness of [asset list](/docs/technical/state#structure-of-assetslist) passed to a method
  * **health_factor** - coefficient of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) as a [decimal](#decimal)
  * **max_delay** - the maximum amount of [slots](https://docs.solana.com/terminology#slot) a price can be outdated by
  * **fee** - the percentage paid as a fee on swap
  * **swap_tax_ratio** - the percentage of the fee going to the _tax reserve_
  * **swap_tax_reserve** - part of the total amount of charged tax, can be withdrawn by admin
  * **liquidation_rate** - part of user debt repaid on [liquidation](/docs/technical/collateral#liquidation)
  * **penalty_to_liquidator** - penalty on liquidation going to the user that is liquidating
  * **penalty_to_exchange** - liquidation penalty going to liquidation fund
  * **liquidation_buffer** - the number of blocks between exceeding [max debt](/docs/glossary/max-debt) and liquidation
  * **debt_interest_rate** - the amount of interest rate charged on debt (yearly percentage, charged minutely)
  * **accumulated_debt_interest** - the total amount charged as interest
  * **last_debt_adjustment** - timestamp of the last charge of interest
  * **staking** - structure with all data needed for staking. Details are [here](/docs/technical/staking)
  * **exchange_authority** - the pubkey belonging to the exchange, used to sign transactions
  * **bump** - used to [confirm the address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method
  * **padding** - used as padding to reserve space up to 2kB for future use


The state is initialized [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L180-L239). It can later be changed using admin methods signed by the admin.


## Assets

All assets used in the platform are stored here. Data about prices comes from [Pyth](https://pyth.network/) but is aggregated here. It also keeps data about decimal places and addresses of tokens and total supply.

### Structure of _AssetsList_

Data related to assets is kept inside AssetsList:

    struct AssetsList {
        // 93333
        pub head_assets: u8,                // 1
        pub head_collaterals: u8,           // 1
        pub head_synthetics: u8,            // 1
        pub assets: [Asset; 255],           // 27795
        pub collaterals: [Collateral; 255], // 37740
        pub synthetics: [Synthetic; 255],   // 27795
    }

The first three are indexes of corresponding arrays, points to the last element, used as length. The next three keep data and are described below:


### Asset

Synthetify uses [Pyth oracles](https://pyth.network/) to get accurate prices of all assets and stores them in one place for ease of use. Data related to price is kept inside _Asset_ structure: 

    pub struct Asset {
        // 109
        pub feed_address: Pubkey, // 32 Pyth oracle account address
        pub price: Decimal,       // 17
        pub last_update: u64,     // 8
        pub twap: Decimal,        // 17
        pub twac: Decimal,        // 17 unused
        pub status: u8,           // 1
        pub confidence: Decimal,  // 17 unused
    }

* **feed_address** - address of Pyth oracle account
* **price** - price multiplied by 10 to the power of _PRICE OFFSET_ equal to 8
* **last_update** - the slot of the last price update
* **twap** - stands for [Time-weighted average price](https://en.wikipedia.org/wiki/Time-weighted_average_price)
* **twac** - stands for Time-weighted average confidence
* **status** - status, taken from oracle saved as [_PriceStatus_](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/pyth/src/pc.rs#L14-L19), token can be swapped only of status is equal to 1
* **confidence** - confidence of price in USD

Every collateral and synthetic asset has to have a corresponding _Asset_ but they can share it. For example, BTC and xBTC will have common _Asset_ as they share a price.


### Collateral asset

Data of that can be used as a [collateral](/docs/technical/collateral) are stored inside a _Collateral_ structure:

    pub struct Collateral {
        // 148
        pub asset_index: u8,            // 1
        pub collateral_address: Pubkey, // 32
        pub reserve_address: Pubkey,    // 32
        pub liquidation_fund: Pubkey,   // 32
        pub reserve_balance: Decimal,   // 17
        pub collateral_ratio: Decimal,  // 17
        pub max_collateral: Decimal,    // 17
    }

  * **asset_index** - index of the corresponding [asset](#asset) used to get price
  * **collateral_address** - address of token used as a collateral
  * **reserve_address** - address of account where exchange keeps deposited tokens
  * **liquidation_fund** - address of account where [liquidation](/docs/technical/collateral#liquidation) penalty is kept until it is withdrawn
  * **reserve_balance** - the amount of tokens in the reserve account
  * **collateral_ratio** - coefficient of collateral to debt user can have
  * **max_collateral** - maximum amount that can be used as a collateral


### Synthetic asset

Synthetic assets created by Synthetify keep their data inside this structure:

    pub struct Synthetic {
        // 109
        pub asset_index: u8,          // 1
        pub asset_address: Pubkey,    // 32
        pub supply: Decimal,          // 17
        pub max_supply: Decimal,      // 17
        pub borrowed_supply: Decimal, // 17
        pub swapline_supply: Decimal, // 17
        pub settlement_slot: u64,     // 8
    }

* **asset_index** - index of the corresponding [asset](#asset)
* **asset_address** - address of the synthetic token
* **supply** - the total amount of minted tokens
* **max_supply** - limit of tokens that can be minted. It exists to increase the safety of the platform (can be changed by the admin)
* **borrowed_supply** - the amount of tokens minted using [vaults](/docs/technical/vaults)
* **swapline_supply** - the amount of tokens swapped using the [swapline](/docs/technical/swapline)
* **settlement_slot** - slot when an asset will have a [settlement](/docs/technical/minting#settlement) (never by default)


### _AssetsList_ inside SDK

Assets List can be fetched by using: 

    await exchange.getAssetsList(assetsList)

Where the _exchange_ is an instance of _Exchange_ singleton. The argument of _assetsList_ is PublicKey, which can be found in the state. The whole structure is similar, but arrays are trimmed to the correct length.


## Decimal
In many places in synthetify code, there is a need for numbers with decimal places. Tokens have them, percentages can be saved as them as well as the interest rate. To avoid floating point numbers _Decimal_ was created.

### Implementation

    pub struct Decimal {
        pub val: u128,
        pub scale: u8,
    }

  Here _val_ is the value of the decimal. _Scale_ can be interpreted as a position of a dot in decimal notation. _Val_ can be divided by 10 to the power of _scale_ to get a regular number. 

  To make _Decimal_ easier to use it also contains a few methods [defined here](https://github.com/Synthetify/synthetify-protocol/blob/master/programs/exchange/src/decimal.rs). Simple math methods like _add_ and _div_ with their rounding up counterparts where they were needed like *mul_up*. It also contains few factory methods like *from_price* and *from_percent*.


Inside SDK _Decimal_ is stored as a simple object of the following interface:

    interface Decimal {
        val: BN
        scale: number
    }