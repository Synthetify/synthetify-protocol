---
title: Overview 

slug: /technical/overview
---

Synthetify consists of two main parts: [smart contract](#protocol-program) and [SDK](#sdk).
Both of them are in single public [repository](https://github.com/Synthetify/synthetify-protocol) 
on our [Github](https://github.com/Synthetify).
Most methods have their equivalent in both of them.

## Protocol Program
This is the core of the project. It's written in [Rust](https://www.rust-lang.org/)
using [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html)
and running on [Solana](https://solana.com/) blockchain.
It uses [Pyth](https://pyth.network/) to get price data.



## SDK
This part is written in **typescript** and is a wrapper for the smart contract.
It takes care of low-level aspects such as signing transaction and storing constant addresses making writing client code easier.
