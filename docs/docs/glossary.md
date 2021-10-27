---
title: Glossary

slug: /glossary
---

### Deposit

Deposit takes tokens from user's wallet and adds them to user's account as [collateral](#collateral)

### Debt

Minting tokens adds debt to account representing a share of the debt pool. As total debt can change, the debt of a user can as well.

### Max debt

After user debt exceeds max debt, user can be [liquidated](#liquidation)

### Mint

Synthetic assets can be created by stakers of the platform and then exchanged on Synthetify exchange. Exchange of two different synthetic assets is direct, even for pairs that do not exist on centralized exchanges e.g. xFTT -> xSRM instead of FTT -> USD -> SRM, which results in lower exchange fees and no slippage.

### Mint limit

Maximum amount you can mint is calculated from [collateral](#collateral). To ensure the safety of the platform, each asset has a predefined, but adjustable, limit of the amount of tokens that can be created.

### Withdraw

Deposited collateral can be transferred to the user's wallet by withdrawal.

### Burn

Synthetic tokens can be burned by stakers to reduce their debt and free collateral tokens.

### Rewards

For participating in the debt pool, you get SNY tokens. More details [here](/docs/staking#rewards).

### Collateral

Deposited tokens become collateral. It is stored inside an account and allows a user to [mint](#mint) tokens and to have debt. You can find more about collateral [here](/docs/technical/collateral)

### Collateral Ratio

User's locked collateral in relation to value of user's minted tokens is called a collateral ratio.

### Liquidation

Liquidation means a collateral decrease by asset burn. To ensure platform stability, a staker can be liquidated and part of their collateral will be transferred to a liquidator in exchange for paying back part of the staker's debt. It takes place every time overrunning the collateral ratio occurs.

### Risk

A user can remove provided liquidity at any time. However, there are a few risks that can affect locked assets.

#### Market risk

Market risk is a possibility to experience losses due to price change. The cryptocurrency market is very volatile. Even 15% APY could not cover sharp change in asset's price.

#### Liquidity Risk

Liquidity risk is a potential issue, especially of micro-cap assets. It could happen that assets obtained by exchange will be obstructed due to low liquidity on the market.

#### Rewards Loss Risk

There are three stages of providing liquidity:

1. Subscription
2. Staking
3. Claiming.

Every stage lasts about a week by default. In the subscription phase, users are given time to decide how much assets they want to mint. The more one mints, the greater pro rata shares holds and are given better reward as result. Afterwards, a staking round starts. If a user mint more assets during this round, they do not receive more shares, however they can lose those by burning their assets. In the last round, a user is entitled to claim their reward, which is calculated basing on pro rata shares held at the end of the staking round.

### Listing new assets

Adding new assets to Synthetify exchange requires an existence of a reliable price oracle for this asset. Currently, the Synthetify team manage which assets are listed in the exchange, but in the future, this decision will be moved to the governance instance.

![Assets Exchange Symbolic Representation](https://i.imgur.com/yT9BdQe.png)
