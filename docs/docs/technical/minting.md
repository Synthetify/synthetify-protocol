---
title: Minting 

slug: /technical/minting
---

To mint synthetic assets user has to have [collateral](/docs/technical/collateral). 


## Debt

Debt is stored as *debt_shares* in [_ExchangeAccount_](/docs/technical/account). To convert it to actual amount total count of *debt_shares* from [state](http://localhost:3000/docs/technical/state#structure-of-state) and calculated total debt.

Total debt is calculated [here](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/exchange/src/math.rs#L12-L33) as a sum of all minted assets converted to USD.


### Interest rate 

Every time total debt is calculated interest rate is added to it. It's is compounded for every minute since *last_debt_adjustment* stored in [state](http://localhost:3000/docs/technical/state#structure-of-state). 


### Max debt

Maximum amount of debt user can have before it is liquidated.


### Mint limit

Maximum amount of tokens user can mint is their mint limit. It's calculated by multiplying [*max debt*](#max-debt) by [health factor](http://localhost:3000/docs/technical/state#structure-of-state)


## Settlement

Admin can set settlement slot (stored in [state](/docs/technical/state#structure-of-state)). When it is reached (or passed) settlement will be triggered.

### Settlement data

Data needed for settlement is stored in this structure:

    struct Settlement {
        pub bump: u8,
        pub reserve_address: Pubkey,
        pub token_in_address: Pubkey,
        pub token_out_address: Pubkey,
        pub decimals_in: u8,
        pub decimals_out: u8,
        pub ratio: u64,
    }

  * **bump** - used to [confirm address](https://docs.solana.com/developing/programming-model/calling-between-programs#hash-based-generated-program-addresses) of state passed to a method
  * **reserve_address** - account belonging to exchange where deposited collaterals are kept
  * **token_in_address** - token which was settled
  * **token_out_address** - token in which settlement will be pain (equal to xUSD token)
  * **decimals_in** - amount of decimal places in settled token
  * **decimals_out** - amount of decimal places in target token
  * **ratio** - ratio of prices of both tokens at moment of settlement (for xUSD just price of token)

### Swapping settled synthetic

[here](https://github.com/Synthetify/synthetify-protocol/blob/4c39873b86324348c40c9677fac15db4f6a48dce/programs/exchange/src/lib.rs#L1362-L1393)