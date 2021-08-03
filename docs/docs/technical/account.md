---
title: Exchange Account 

slug: /technical/account
---

### The Idea of Exchange Account
To use the platform user has to have an account. Inside the project it is called an _Exchange Account_.
It keeps user specific data such as deposited collaterals and staked amounts.


### Structure of Account

The structure is defined like this:

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

Which respectively are responsible for
* **owner** - public key belonging to owner of the account
* **version** - version of the structure, when it changes old accounts will be migrated to the new one
* **debt_shares** - amount of user debt shares, when divided by all shares allows to calculate debt. More on that [here](/docs/technical/minting#debt)
* **liquidation_deadline** - [slot](https://docs.solana.com/terminology#slot) when user can be [liquidated](/docs/technical/liquidation)
* **user_staking_data** - all data that are needed for [staking](/docs/technical/staking)
* **bump** - this is used with 
[generation of program addresses](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses)
* **head** - amount of deposited collaterals, used as length of array next field
* **collaterals** - array of [collaterals](/docs/technical/collaterals) owned by account, up to 32 at the same time

### Account Creation

Function creating Exchange Account is defined 
[here](https://github.com/Synthetify/synthetify-protocol/blob/ef5e4a65e3009e8a957d3382fc67d3b721115af8/programs/exchange/src/lib.rs#L24-L33) 
, it takes a single argument of bump (u8) and following _Context_

    pub struct CreateExchangeAccount<'info> {
        #[account(init,seeds = [b"accountv1", admin.key.as_ref(), &[bump]], payer=payer )]
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub admin: AccountInfo<'info>,
        #[account(mut, signer)]
        pub payer: AccountInfo<'info>,
        pub rent: Sysvar<'info, Rent>,
        pub system_program: AccountInfo<'info>,
    }

The __#[account(...)]__ parts is a [constraint](https://project-serum.github.io/anchor/tutorials/tutorial-2.html#defining-a-program) 
implemented by [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html).


* **exchange_account** - this is address of account, constrains make sure it is uninitialized, of the right version and correctness of _bump_
* **admin** - 


Using SDK you can simply use: 
     
    const exchangeAccount = await exchange.createExchangeAccount(ownersPublicKey)

Where _exchange_ is an instance of Exchange singleton and _ownersPublicKey_ has type of _PublicKey_, which is part of [Solana's web3 package](https://solana-labs.github.io/solana-web3.js/).


The _exchangeAccount_ has a type of _PublicKey_, which is used as an address to data structure.
It can be passed to methods or used to fetch whole structure as follows: 

### Getting account data

Fetching an account is as simple as:

    const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)

This will asynchronously fetch data from blockchain and parse it to an 
[object](https://github.com/Synthetify/synthetify-protocol/blob/ef5e4a65e3009e8a957d3382fc67d3b721115af8/sdk/src/exchange.ts#L1187-L1195).