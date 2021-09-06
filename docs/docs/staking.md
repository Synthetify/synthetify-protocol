---
title: Staking

slug: /staking
---

### Staking View

Staking view includes three different parts:

- the top part provides general information about the user's situation:
  - Staked Value
  - Current Debt
  - Collateral Ratio
- the middle part contains assets managing activities
- the bottom part shows particular information about owned tokens.

![Staking view](https://i.imgur.com/ISd3pKL.png)

### Deposit

To [deposit](/docs/glossary#deposit), go to the Deposit tab

![Deposit-tab](https://i.imgur.com/5RbIzpY.png)

#### Choose amount

Fill the _Amount_ field. Use as much SNY as you want to deposit in collateral. On the right side, there is information about the amount of the selected asset available to deposit. Choosing _Max_ automatically fills the field with the maximum available SNY amount. Click _Deposit_ to send assets.

![Deposit-amount](https://i.imgur.com/Hk1IBT0.png)

#### Transaction approval

Next, your wallet wants you to confirm the transaction. Check whether all information is correct first. On the right side of the _Deposit_ button, you can see 'Depositing in progress'.

![Deposit-Transaction-approval](https://i.imgur.com/qpfZuc0.png)

#### Confirmation

If everything went smoothly, you can see that:

- Staked Value increased by the amount you deposited
- Collateral Ratio increased
- On the right of the _Deposit_ button, there is a green tick and message _Successfully deposited_
- On the bottom left of the site, you can see a green field _Successfully deposited collateral_ (not shown here)
- In section _Owned tokens_ amount of SNY tokens decreased by those you deposited.

![Deposit-Confirmation](https://i.imgur.com/R2q2uYA.png)

### Mint

To [mint](/docs/glossary#mint), go to the Mint tab.

![Mint-tab](https://i.imgur.com/bhlklSC.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to mint and click the _Mint_ button. If you want to mint the maximum available amount you can use the _Max_ button. As the amount you can mint can change in real-time due to price and [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a field with the amount of the selected asset available to mint.

![Mint-amount](https://i.imgur.com/CW2CwPi.png)

#### Transaction approval

Next, your wallet wants you to confirm the transaction. Check whether all information is correct first.

![Mint-Transaction-approval](https://i.imgur.com/zzkkRig.png)

#### Confirmation

If everything went smoothly, you should see that:

- Current Debt increased by the amount you minted
- Collateral Ratio decreased
- On the right of the _Mint_ button, there is a green tick and message _Successfully minted_
- On the bottom left of the site, you can see a green field _Successfully minted xUSD_ (not shown here)

![Mint-Confirmation](https://i.imgur.com/ttfW3iJ.png)

### Withdraw

To [withdraw](/docs/glossary#withdraw), go to Withdraw tab.

![Withdraw-tab](https://i.imgur.com/lA3sfBP.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to withdraw and click the_Withdraw_ button. If you want to withdraw the maximum available amount you can use the _Max_ button. As the amount you can withdraw can change in real-time due to price and [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a field with the amount of the selected asset available to withdraw.

![Withdraw-amount](https://i.imgur.com/GAEycMH.png)

#### Transaction approval

Next, your wallet wants you to confirm the transaction. Check whether all information is correct first. Until you approve the transaction, on the right side of _Withdraw_ button, you can see _Withdrawing in progress_.

![Withdraw-Transaction-approval](https://i.imgur.com/8cQOvIr.png)

#### Confirmation

If everything went smoothly, you should see that:

- Current Debt decreased by the amount you withdrew
- Collateral Ratio decreased
- On the right of _Withdraw_ button, there is a green tick and the message _Successfully withdrawn_
- In section _Owned tokens_ amount of SNY tokens increased by those you withdrew
- In the down-left corner of the site, you can see a green field _Successfully withdrew Collateral_.

![Mint-Confirmation](https://i.imgur.com/vMYyVPY.png)

### Burn

To [burn](/docs/glossary#burn), go to the Burn tab.

![Burn-tab](https://i.imgur.com/j6fXNrQ.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to burn and click the _Burn_ button. If you want to burn the maximum available amount you can use the _Max_ button. As the amount you can burn can change in real-time due to [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a field with the amount of the selected asset available to burn.

![Burn-amount](https://i.imgur.com/N0SghCc.png)

#### Transaction approval

Next, your wallet wants you to confirm the transaction. Check whether all information is correct first. Until you approve the transaction, on the right side of the _Burn_ button, you can see 'Burning in progress'.

![Burn-Transaction-approval](https://i.imgur.com/djLiDm7.png)

#### Confirmation

If everything went smoothly, you should see that:

- Current Debt decreased by the amount you burned
- Collateral Ratio increased
- On the right of the _Burn_ button, there is a green tick and a message _Successfully burned_
- In section _Owned tokens_ amount of SNY tokens decreased by those you burned
- On the bottom left of the site, you can see a green field _Successfully burned tokens_ (not shown here).

![Burn-Confirmation](https://i.imgur.com/Yq9hjNi.png)

### Rewards

On the platform, we introduced Liquidity Mining meaning Stakers can receive rewards in SNY tokens for creating liquidity on the platform by participating in the debt pool.
To participate in liquidity mining go to the _Rewards_ tab.
The liquidity mining process is a cycle consisting of three phases:

1. **Subscription phase** - in this phase you can receive points for taking part in the debt pool by Minting xUSD. Your number of points will change during this phase proportionally to the size of your debt.
2. **Staking phase** - in this phase, you enter with the number of points you had at the end of the previous phase and you can retain them by keeping your debt. The number of points will decrease when you Burn your xUSD.
3. **Claiming phase** - in this phase, you can claim your reward - an amount of SNY proportional to the number of points you had at the end of the previous phase. If you don't claim your rewards before the end of the phase your points will be voided.

![Rewards rounds diagram](https://i.imgur.com/T6uGYGC.png)

The amount of SNY you can receive as a reward is dependent on the number of points you have. Each phase lasts about two weeks. At any given time, there are three parallel rounds, each at a different phase. You can see them listed in the _Rewards_ tab as follows:

- _Next round_ - shows the round that is currently in the Subscription phase
- _Current round_ - shows the round that is currently in the Staking phase
- _Finished round_ - shows the round that is currently in the Claiming phase

![Rewards tab](https://i.imgur.com/9EEwYcd.png)

You can see the number of your points and SNY for each round next to the round in the table.
You can check the time at which the phase will end when you hover over the question mark on the left of each phase. To claim your rewards from the finished round click on the _Claim_ button in the left bottom corner. You should see the amount of SNY you received in the top right corner of the table. To transfer this amount to your account click on the _Withdraw_ button in the left bottom corner. At each step, you should approve the transaction in your Wallet extension. You should see that the number of SNY available in your account increased.

![Time of rounds and claiming](https://i.imgur.com/c6p5LoN.png)

### Something failed

If the connection to the wallet went wrong:

- Refresh the website
- Try to connect again.

If something else failed, you can see a red sign and a message that your action went wrong on the right of the button you clicked on, and each time a pop-up shows up in the down left corner. Follow with the following:

- Refresh the website
- Re-do _Connect to wallet_ step
- Try to re-do your action again.

If the above steps didn't help, please contact us on [Discord](https://discord.gg/Z9v9ez8u) or send an e-mail to support@synthetify.io with an applicable note.
