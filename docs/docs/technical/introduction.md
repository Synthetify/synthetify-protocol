---
title: Introduction 

slug: /technical/introduction
---

Synthetify consists of two main parts: [smart contract](#protocol-program) and [SDK](#sdk).
Both of them are in single public repository on our [Github](https://github.com/Synthetify/synthetify-protocol).
Most methods have their equivalent in both of them.

## Protocol Program
This is the core of the project. It's written in [Rust](https://www.rust-lang.org/)
using [Anchor](https://project-serum.github.io/anchor/getting-started/introduction.html)
and running on [Solana](https://solana.com/) blockchain.


## SDK
This part is written in **typescript** and is a wrapper for the smart contract.
It takes care of most low-level aspects such as signing transaction and storing constant addresses making writing code easier.

