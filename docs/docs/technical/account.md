---
title: Exchange Account 

slug: /technical/account
---

### The Idea of Exchange Account
The platform needs a place to keep user-specific data. Inside the project, it is called an _Exchange Account_. It stores data such as deposited collaterals and rewards for staking.


### Structure of Account

The data structure is defined like this:

    struct ExchangeAccount {
        // 1412
        pub owner: Pubkey,                      // 32
        pub version: u8,                        // 1
        pub debt_shares: u64,                   // 8
        pub liquidation_deadline: u64,          // 8
        pub user_staking_data: UserStaking,     // 49
        pub bump: u8,                           // 1
        pub head: u8,                           // 1
        pub collaterals: [CollateralEntry; 32], // 1312
    }

* **owner** - public key belonging to the owner of the account, one owner will have only one account
* **version** - version of the structure, when it changes old accounts will be migrated to the new one
* **debt_shares** - number of user debt shares, used to calculate debt. More on that [here](/docs/technical/synthetics#debt)
* **liquidation_deadline** - [slot](https://docs.solana.com/terminology#slot) when a user can be [liquidated](/docs/technical/collateral#liquidation)
* **user_staking_data** - all data that are needed for [staking](/docs/technical/staking)
* **bump** - used with the [generation of program addresses](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses)
* **head** - index pointing to last of used fields in collaterals array
* **collaterals** - an array of [collaterals](/docs/technical/collateral) owned by account, up to 32 different at the same time

### Account Creation

Function creating _Exchange Account_ is defined [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L33-L43), it takes a single argument of bump (u8) and the following _Context_

    pub struct CreateExchangeAccount<'info> {
        #[account(init,seeds = [b"accountv1", owner.key.as_ref(), &[bump]], payer=payer )]
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
        #[account(mut, signer)]
        pub payer: AccountInfo<'info>,
        pub rent: Sysvar<'info, Rent>,
        pub system_program: AccountInfo<'info>,
    }

The __#[account(...)]__ parts is a [constraint](https://project-serum.github.io/anchor/tutorials/tutorial-2.html#defining-a-program) 
implemented by [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html).

* **exchange_account** - address of the account, constrains make sure it is uninitialized, of the right version and correctness of _bump_
* **owner** - public key belonging to the owner of the account
* **payer** - account that pays for the creation of account
* **rent** - a data structure relating to [rent](https://docs.solana.com/developing/programming-model/accounts#rent), used by Solana
* **system_program** - Solana's [_System Program_](https://docs.solana.com/developing/runtime-facilities/programs#system-program) needed to create an account


### Interacting using SDK

Creating an account is as simple as:

    const exchangeAccount = await exchange.createExchangeAccount(ownersPublicKey)

Where _exchange_ is an instance of Exchange singleton and _ownersPublicKey_ has a type of _PublicKey_, which is part of 
[Solana's web3 package](https://solana-labs.github.io/solana-web3.js/).


The _exchangeAccount_ has a type of _PublicKey_, which is used as an address to a data structure.
It can be passed to methods or used to fetch the whole structure as follows: 

    const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)

This will asynchronously fetch data from the blockchain and parse it to an 
[object](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/sdk/src/exchange.ts#L1764-L1772).