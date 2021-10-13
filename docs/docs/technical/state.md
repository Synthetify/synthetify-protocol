---
title: State

slug: /technical/state
---

## Program data

The protocol needs a place to store persistent data. Most of it is stored inside the _State_ structure, that is passed to methods just like any other account.

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
        pub exchange_authority: Pubkey,
        pub bump: u8,
        pub padding: [u8; 1620],
    }

Respectively, these fields are :

- **admin** - pubkey of the admin. Only admin can modify state using setters
- **halted** - if set to _true_, access to methods is blocked
- **nonce** - one of the seeds of the _exchangeAuthority_. Used to sign transactions
- **debt_shares** - total amount of _debt shares_. Together with user _debt shares_, it allows calculating debt. More on that [here](/docs/technical/synthetics#debt)
- **assets_list** - address used to confirm the correctness of [asset list](/docs/technical/state#structure-of-assetslist) passed to a method
- **health_factor** - ratio of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) as a [decimal](#decimal)
- **max_delay** - maximum amount of [slots](https://docs.solana.com/terminology#slot) a price can be outdated by
- **fee** - percentage paid as a fee on swap
- **swap_tax_ratio** - percentage of the fee going to the _tax reserve_
- **swap_tax_reserve** - part of the total amount of charged tax. Can be withdrawn by admin
- **liquidation_rate** - part of user's debt repaid on [liquidation](/docs/technical/collateral#liquidation)
- **penalty_to_liquidator** - penalty on liquidation going to the user that is liquidating
- **penalty_to_exchange** - liquidation penalty going to liquidation fund
- **liquidation_buffer** - number of blocks between exceeding [max debt](/docs/glossary/max-debt) and liquidation
- **debt_interest_rate** - amount of interest rate charged on debt (yearly percentage, charged minutely)
- **accumulated_debt_interest** - total amount charged as interest
- **last_debt_adjustment** - timestamp of the last charge of interest
- **staking** - structure with all data needed for staking. Details are [here](/docs/technical/staking)
- **exchange_authority** - pubkey belonging to the exchange, used to sign transactions
- **bump** - used to [confirm the address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method
- **padding** - used as padding to reserve space up to 2kB for future use

The state is initialized [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L180-L239). It can be changed later using admin methods signed by the admin.

## Assets

All assets used in the platform are stored here. Data about prices comes from [Pyth](https://pyth.network/) and is aggregated here. It also keeps data about decimal point's placing, addresses of tokens and total supply.

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

The first three are indexes of corresponding arrays, pointing to the last element and used as length. The next three keep data and are described below:

### Asset

Synthetify uses [Pyth oracles](https://pyth.network/) to get accurate prices of all assets and stores them in one place for ease of use. Data related to the prices is kept inside _Asset_ structure:

    pub struct Asset {
        pub feed_address: Pubkey,
        pub price: Decimal,
        pub last_update: u64,
        pub twap: Decimal,
        pub twac: Decimal,
        pub status: u8,
        pub confidence: Decimal,
    }

- **feed_address** - address of Pyth oracle account
- **price** - price multiplied by 10 to the power of _PRICE OFFSET_ equaling 8
- **last_update** - the slot of the last price update
- **twap** - stands for [Time-weighted average price](https://en.wikipedia.org/wiki/Time-weighted_average_price)
- **twac** - stands for Time-weighted average confidence
- **status** - status taken from oracle and saved as [_PriceStatus_](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/pyth/src/pc.rs#L14-L19). Tokens can be swapped only if status is equal to 1
- **confidence** - confidence of price in USD

Every collateral and synthetic asset has to have a corresponding _Asset_ but they can share it. For example, BTC and xBTC will have common _Asset_ as they share the same price.

### Collateral asset

Data representing [collateral](/docs/technical/collateral) is stored inside a _Collateral_ structure:

    pub struct Collateral {
        pub asset_index: u8,
        pub collateral_address: Pubkey,
        pub reserve_address: Pubkey,
        pub liquidation_fund: Pubkey,
        pub reserve_balance: Decimal,
        pub collateral_ratio: Decimal,
        pub max_collateral: Decimal,
    }

- **asset_index** - index of the corresponding [asset](#asset) used to get its price
- **collateral_address** - address of a token used as collateral
- **reserve_address** - address of an account, where the exchange keeps deposited tokens
- **liquidation_fund** - address of an account, where [liquidation](/docs/technical/collateral#liquidation) penalty is kept until it is withdrawn
- **reserve_balance** - amount of tokens in the reserve account
- **collateral_ratio** - ratio of collateral to debt user can have
- **max_collateral** - maximum amount that can be used as collateral

### Synthetic asset

Synthetic assets created by Synthetify keep their data inside this structure:

    pub struct Synthetic {
        pub asset_index: u8,
        pub asset_address: Pubkey,
        pub supply: Decimal,
        pub max_supply: Decimal,
        pub borrowed_supply: Decimal,
        pub swapline_supply: Decimal,
    p   ub settlement_slot: u64,
    }

- **asset_index** - index of the corresponding [asset](#asset)
- **asset_address** - address of the synthetic token
- **supply** - total amount of minted tokens
- **max_supply** - limit of tokens that can be minted. It exists to increase safety of the platform (can be changed by the admin)
- **borrowed_supply** - amount of tokens minted using [vaults](/docs/technical/vaults)
- **swapline_supply** - amount of tokens swapped using the [swapline](/docs/technical/swapline)
- **settlement_slot** - slot, when an asset will have a [settlement](/docs/technical/minting#settlement) (never by default)

### _AssetsList_ inside SDK

AssetsList can be fetched by using:

    await exchange.getAssetsList(assetsList)

Where the _exchange_ is an instance of _Exchange_ singleton. The argument of the _assetsList_ is PublicKey, which can be found in the state. The whole structure is similar, but arrays are trimmed to the correct length.

## Decimal

In many places in the Synthetify code, there is a need for numbers with decimal point, ie. fractions of tokens, the interest rate percentage. To avoid floating point numbers _Decimal_ was created.

### Implementation

    pub struct Decimal {
        pub val: u128,
        pub scale: u8,
    }

Here _val_ is the value of the decimal. _Scale_ can be interpreted as a position of the point in decimal notation. _Val_ can be divided by 10 to the power of _scale_ to get a regular number.

To make _Decimal_ easier to use it also contains a few methods [defined here](https://github.com/Synthetify/synthetify-protocol/blob/master/programs/exchange/src/decimal.rs), ie. simple math methods like _add_ and _div_ and their rounding up counterparts like _mul_up_. It also contains few factory methods like _from_price_ and _from_percent_.

Inside SDK, _Decimal_ is stored as a simple object of the following interface:

    interface Decimal {
        val: BN
        scale: number
    }
