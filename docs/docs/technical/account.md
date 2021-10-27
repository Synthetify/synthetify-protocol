---
title: Exchange Account

slug: /technical/account
---

### The Idea of Exchange Account

The platform needs a place to keep user-specific data. Inside the project, it is called an _Exchange Account_. It stores data such as deposited collaterals and rewards for staking.

### Structure of Account

The data structure is defined as:

    struct ExchangeAccount {
        pub owner: Pubkey,
        pub version: u8,
        pub debt_shares: u64,
        pub liquidation_deadline: u64,
        pub user_staking_data: UserStaking,
        pub bump: u8,
        pub head: u8,
        pub collaterals: [CollateralEntry; 32],
    }

- **owner** - public key belonging to the owner of the account. One owner can have only one account
- **version** - version of the structure. When it changes, old accounts migrates to a new one
- **debt_shares** - number of user's debt shares. Used to calculate debt. More about it [here](/docs/technical/synthetics#debt)
- **liquidation_deadline** - [slot](https://docs.solana.com/terminology#slot) when a user can be [liquidated](/docs/technical/collateral#liquidation)
- **user_staking_data** - all data that are needed for [staking](/docs/technical/staking)
- **bump** - seed used to ensure the generated address doesn't collide with any other existing one
- **head** - index pointing to the last used fields in collaterals array
- **collaterals** - an array of [collaterals](/docs/technical/collateral) owned by account, having up to 32 different ones at the same time.

### Account Creation

Function creating _Exchange Account_ is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L33-L43). It takes a single argument of bump (u8) and the following _Context_:

    pub struct CreateExchangeAccount<'info> {
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub admin: AccountInfo<'info>,
        pub payer: AccountInfo<'info>,
        pub rent: Sysvar<'info, Rent>,
        pub system_program: AccountInfo<'info>,
    }

}

The **#[account(...)]** parts are [constraints](https://project-serum.github.io/anchor/tutorials/tutorial-2.html#defining-a-program)
implemented in [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html).

- **exchange_account** - address of the account. Constrains make sure it is uninitialized, has correct version and _bump_
- **admin** - public key belonging to the owner of the account
- **payer** - account that pays for the creation of the account
- **rent** - a data structure related to [rent](https://docs.solana.com/developing/programming-model/accounts#rent), used by Solana
- **system_program** - Solana's [_System Program_](https://docs.solana.com/developing/runtime-facilities/programs#system-program) needed to create an account

### Interacting using SDK

Creating an account requires using only a single statement:

    const exchangeAccount = await exchange.createExchangeAccount(ownersPublicKey)

Where the _exchange_ is an instance of Exchange singleton and _ownersPublicKey_ has a type of _PublicKey_, which is part of
[Solana's web3 package](https://solana-labs.github.io/solana-web3.js/).

The _exchangeAccount_ has a type of _PublicKey_, which is used as an address to a data structure.
It can be passed to methods or used to fetch the whole structure. An example:

    const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)

This will asynchronously fetch data from the blockchain and parse it to an
[object](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/sdk/src/exchange.ts#L1764-L1772).
