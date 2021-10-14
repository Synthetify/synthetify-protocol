---
title: Solana

slug: /solana
---

Solana is an open-source blockchain project. Its architecture is based on Proof of History. The main assumption of its architecture is to prove the existence of a combination of software algorithms set and blockchain implementation which removes software as a performance bottleneck.

Solana has a mechanism for time synchronization. All nodes elect one node, which will be a leader providing a universal source of time for all of them in a decentralized network, which means that transactions need less time to be verified.

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

- The highest transactions per second rate. Using PoH allows Solana blockchain to currently handle over 50 000 transactions per second. It means that it is faster than Visa.
- Fast confirmation with the average time of 0.4s.
- Low transaction cost with the average fee per transaction of 0.00025$
- Perpetual oracles updating, which pushes updates to the blockchain in a sub-seconds interval eliminating arbitrage.
- No front running, meaning that each transaction has its timestamp, which disables the decision on the order, in which transactions get recorded onto the blockchain.
- No sharding, meaning that there is no security risk being less vulnerable to consensus attacks.
