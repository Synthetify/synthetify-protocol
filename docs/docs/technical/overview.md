---
title: Overview 

slug: /technical/overview
---

Synthetify consists of two main parts: [smart contract](#protocol-program) and [SDK](#sdk).
Both of them are in a single public [repository](https://github.com/Synthetify/synthetify-protocol) on [our Github](https://github.com/Synthetify). Most methods and data structures have their equivalent in both of them.

## Protocol Program
This is the core of the project. It's written in [**Rust**](https://www.rust-lang.org/)
using [**Anchor**](https://project-serum.github.io/anchor/getting-started/introduction.html)
and running on [**Solana**](https://solana.com/) blockchain.
It uses [Pyth](https://pyth.network/) to get price data.

As it is where the magic happens it will be the focus of this documentation.


## SDK
This part is written in typescript as an [npm package](https://www.npmjs.com/package/@synthetify/sdk) and is a wrapper for the smart contract.
It takes care of low-level aspects such as signing transactions and storing constant addresses making writing client code easier.

Data structures are mapped exactly with the only change being type and case.
Methods called by a user have a corresponding method that creates instructions, adds them to transaction, signs, and sends it.
All methods (including ones used only by admin) have corresponding methods that return just the instruction.
