---
title: Account Creation 

slug: /technical/account
---

## The Idea
To use the platform user has to have an account. Inside the project it is called _ExchangeAccount_.
It keeps user specific data such as deposited collaterals and staking data

### Account Creation
Using SDK you can simply use: 
     
    const accountOwner = new Keypair()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

Where _exchange_ is an instance of Exchange singleton. 
The _exchangeAccount_ will be a PublicKey type, which u can pass to method or use to fetch account data like that: 

### Getting account data

    

    