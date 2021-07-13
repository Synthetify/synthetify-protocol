---
title: Platform

slug: /platform
---

### Deposit

Deposit allows user to be a part of a collateral by locking their SNY tokens.

### Mint

Synthetic assets can be created by Stakers of the system and then exchanged on Synthetify exchange. Exchange of two different synthetic tokens is direct, even for pairs that do not exist on centralized exchanges e.g. xFTT -> xSRM instead of FTT -> USD -> SRM which results in much lower exchange fees and slippage.

### Mint limit

To ensure safety of the system each asset has a predefined but adjustable limit of the amount of tokens that can be created.

### Withdraw

SNY tokens can be transferred to user's wallet by withdraw.

### Burn

Synthetic tokens can be burned by Stakers to reduce their debt and free collateral tokens.

### Rewards

### Collateral

For now only SNY token can be a collateral, other assets will be added in the future.

### Collateral Ratio

Locked collateral to the value of minted tokens is called the collateral ratio.

### Liquidation

Liquidation means collateral decrease by asset burn. To ensure platform stability Stakers can be liquidated and part of their collateral will be transferred to Liquidators in exchange for paying back part of Staker debt. It takes place everytime overrunning the collateral ratio happens.

### Risk

The user can remove provided liquidity at any time. However there are few risks which affects locked assets.

#### Market risk

Market risk is a possibility to experience losses due to price change. Cryptocurrency market is very volatile. Even 15% APY could not cover sharp market movement price change.

#### Liquidity Risk

Liquidity risk is a potential issue especcialy on micro-cap assets. It could happen that exchanging earned asset will be obstructed because of illiquidity on the market.

#### Rewards Loss Risk

There are three stages of providing liquidity:

1. Subscribtion
2. Staking
3. Claiming.

In phase 1 and 3 there is no possibility to loss staked assets. Earning rewards takes place during stage 2. Staking phase takes two weeks. During this stage the user can freely withdraw its deposit. However burning is bounded with lossing all previousl earned rewards.

### Listing new assets

Adding new assets to Synthetify exchange requires existence of a reliable price oracle for this asset. Currently, Synthetify team controls what assets are listed on the exchange but in the future this decision will be moved to governance instance.

![Assets Exchange Symbolic Represantation](https://i.imgur.com/yT9BdQe.png)
