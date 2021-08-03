---
title: Account 

slug: /technical/account
---

### The Idea of Exchange
To use the platform user has to have an account. Inside the project it is called an _Exchange Account_.
It keeps user specific data such as deposited collaterals and staked amounts.

### Account Creation
Using SDK you can simply use: 
     
    const accountOwner = new Keypair()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

Where _exchange_ is an instance of Exchange singleton and _Keypair_ is part of [Solana's web3 package](https://solana-labs.github.io/solana-web3.js/).


The _exchangeAccount_ has a type of _PublicKey_, which is used as an address to data structure.
It can be passed to methods or used to fetch whole structure as follows: 

### Getting account data

Fetching an account is as simple as:

    const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)

This will asynchronously fetch data from blockchain and parse it to an object.

The original _ExchangeAccount_ structure is written in Rust and looks like this
[this](https://github.com/Synthetify/synthetify-protocol/blob/master/programs/exchange/src/lib.rs#L1454-L1463), 
but _exchangeAccountData_ will be an instance of:

    interface ExchangeAccount {
        owner: PublicKey
        version: number
        debtShares: BN
        liquidationDeadline: BN
        userStakingData: UserStaking
        head: number
        collaterals: Array<CollateralEntry>
    }

Most of fields here are method specific and will be explained closer in corresponding chapters.
For now the only important field is _owner_ - which identifies user that is... well the owner of the account.
