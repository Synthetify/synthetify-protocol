---
title: Introduction 

slug: /technical-overview
---

Synthetify consists of two main parts: [protocol program](#smart-contract) and [SDK](#sdk).
Both of them are in single public repository on our [Github](https://github.com/Synthetify/synthetify-protocol).
Most methods have their equivalent in both of them.

## Smart contract
This is the core of the project. It's written in [Rust](https://www.rust-lang.org/)
using [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html)
and running on [Solana](https://solana.com/) blockchain.


## SDK
This part is written in **typescript** and is a wrapper for the smart contract.
It takes care of heavy-lifting such as signing transaction and storing constant addresses writing code easier.

