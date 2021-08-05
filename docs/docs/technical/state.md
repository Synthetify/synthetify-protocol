---
title: State

slug: /technical/state 
---

State is a regular account that keeps various data needed for the program. It is structured like this:

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
  * **admin** - pubkey of admin, only admin can modify some of state's fields using setters
  * **halted** - if set to _true_ access to methods is blocked
  * **nonce** - one of signer seeds, used to sign transactions
  * **debt_shares** - sum of all debt shares, together with user debt shares allows to calculate debt 
  * **assets_list** - address used to confirm correctness of [asset list](/docs/technical/minting#)
  * **health_factor** - coefficient of [mint limit](/docs/glossary#mint-limit) to [max debt](/docs/glossary#max-debt) (1% - 100%)
  * **max_delay** - maximum amount of slots a price can be outdated by
  * **fee** - fee payed on swap in thousandths of percent (300 amounts to 0.3%)
  * **swap_tax** - percentage of fee going to pool (see below)
  * **pool_fee** - part of tax in xUSD, not used as for right now
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