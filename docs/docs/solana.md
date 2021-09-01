---
title: Solana

slug: /solana
---

Solana is an open source blockchain project. Its architecture is based on Proof of History. The main assumption of its architecture is to prove existence of combination software algorithms set and blockchain implementation which removes software as a performance bottleneck.

Solana has a mechanism for time synchronization. All nodes elect the one node leader, which provides universal source of time for all of them in a decentralized network, which means that transactions need less time to be verified.

For more information, please see its official [documentation](https://docs.solana.com/introduction).

![Solana Labs](https://i.imgur.com/xsqEZiK.jpg)

### Solana innovations

- Proof of History - a clock before consensus
- Tower BFT4 - a PoH - optimized version of PBFT
- Turbine - a block propagation protocol
- Gulf Stream - mempool-less transaction forwarding protocol
- Sealevel - world's first parallel smart contracts run-time
- Pipelining - transaction processing unit for validation
- Cloudbreak - horizontally-scaled accounts database
- Archivers - distributed ledger storage

### Why Solana?

- The highest transactions/second rate. Using PoH allows Solana blockchain to currently handle over 50 000 transactions per second. It means that it is faster than Visa.
- Fast confirmation. The average time is 0.4s.
- Low transaction cost. The average fee per transaction is 0.00025$
- Perpetual oracles updating, push updates to the blockchain in sub-seconds interval, which eliminates arbitrage.
- No front running - each transaction has its own timestamp, which disables the decision on the order in which transactions get recorded onto the blockchain.
- No sharding - no security risk. Less vulnerable to consensus attacks.
