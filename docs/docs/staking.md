---
title: Staking

slug: /staking
---

### Staking View

Staking view includes three different parts:

- the top part provides general information about user's situation:
  - Staked Value
  - Debt status
- the middle part contains assets managing activities
- the bottom part shows information about staked and owned synthetic tokens.

![Staking view](/img/docs/stakingView.png)

### Deposit

To [deposit](/docs/glossary#deposit), go to the Deposit tab

![Deposit-tab](/img/docs/deposit.png)

#### Choose amount

Firstly, choose a token you want to deposit and then fill the _Amount_ field with a number of tokens you want to deposit. On the right side, there is information about the amount of the selected asset available to deposit. Choosing _Max_ automatically fills the label with the maximum available amount. Click _Deposit_ to deposit assets.

![Deposit-amount](/img/docs/depositAmount.png)

#### Transaction approval

Next, your wallet requires you to confirm the transaction. Check whether all information is correct. On the right from the _Deposit_ button, you can see 'Depositing in progress'.

![Deposit-Transaction-approval](/img/docs/depositTransaction.png)

#### Confirmation

If everything went smoothly, you can see that:

- Staked value increased by the amount you deposited
- On the right from the _Deposit_ button, there is a green tick and message _Successfully deposited_
- On the bottom left of the site, you can see a green field _Collateral deposited successfully_ (not shown here)
- In section _Deposit_ , click on the drop down list _SNY_. Amount of tokens decreased by those you deposited.

![Deposit-Confirmation](/img/docs/depositConfirmation.png)

### Mint

To [mint](/docs/glossary#mint), go to the Mint tab.

![Mint-tab](/img/docs/mint.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to mint and click the _Mint_ button. If you want to mint the maximum available amount, you can use the _Max_ button. As the amount you can mint can change in real-time due to price and [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation, the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a label with the amount of the selected asset available to mint.

![Mint-amount](/img/docs/mintAmount.png)

#### Transaction approval

Next, your wallet requires you to confirm the transaction. Check whether all information is correct.

![Mint-Transaction-approval](/img/docs/mintTransaction.png)

#### Confirmation

If everything went smoothly, you should see that:

- Current Debt increased by the amount you minted
- On the right from the _Mint_ button, there is a green tick and message _Successfully minted_
- On the bottom left of the site, you can see a green field _xUSD successfully minted_ (not shown here)

![Mint-Confirmation](/img/docs/mintConfirmation.png)

### Withdraw

To [withdraw](/docs/glossary#withdraw), go to Withdraw tab.

![Withdraw-tab](/img/docs/withdraw.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to withdraw and click the _Withdraw_ button. If you want to withdraw the maximum available amount, you can use the _Max_ button. As the amount you can withdraw can change in real-time due to price and [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation, the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a label with the amount of the selected asset available to withdraw.

![Withdraw-amount](/img/docs/withdrawAmount.png)

#### Transaction approval

Next, your wallet requires you to confirm the transaction. Check whether all information is correct. Until you approve the transaction, on the right from _Withdraw_ button, you can see _Withdrawing in progress_.

![Withdraw-Transaction-approval](/img/docs/withdrawTransaction.png)

#### Confirmation

If everything went smoothly, you should see that:

- Staked value decreased by the amount you have withdrawn
- On the right from _Withdraw_ button, there is a green tick and the message _Successfully withdrawn_
- In section _Staked_, amount of SNY tokens increased by those you have withdrawn
- In the down-left corner of the site, you can see a green field _Collateral withdrawn successfully_.

![Mint-Confirmation](/img/docs/withdrawConfirmation.png)

### Burn

To [burn](/docs/glossary#burn), go to the Burn tab.

![Burn-tab](/img/docs/burn.png)

#### Choose amount

Fill the _Amount_ field with the amount you want to burn and click the _Burn_ button. If you want to burn the maximum available amount, you can use the _Max_ button. As the amount you can burn can change in real-time due to [debt pool](https://docs.synthetify.io/docs/glossary#dept) fluctuation, the field will just show _Max_ instead of precise amount and calculate it on the blockchain. On the right side, there is a label with the amount of the selected asset available to burn.

![Burn-amount](/img/docs/burnAmount.png)

#### Transaction approval

Next, your wallet requires you to confirm the transaction. Check whether all information is correct. Until you approve the transaction, on the right from the _Burn_ button, you can see 'Burning in progress'.

![Burn-Transaction-approval](/img/docs/burnTransaction.png)

#### Confirmation

If everything went smoothly, you should see that:

- Current Debt decreased by the amount you burned
- On the right from the _Burn_ button, there is a green tick and a message _Successfully burned_
- In section _Synthetic_, amount of xUSD tokens decreased by those you burned
- On the bottom left of the site, you can see a green field _Tokens burnt successfully_ (not shown here).

![Burn-Confirmation](/img/docs/burnConfirmation.png)

### Rewards

In the platform, we introduced liquidity mining, meaning stakers can receive rewards in SNY tokens for creating liquidity in the platform by participating in the debt pool.
To participate in liquidity mining go to the _Rewards_ tab.
The liquidity mining process is a cycle consisting of three phases:

1. **Subscription phase** - in this phase you can receive pro rata shares for taking part in the debt pool by minting xUSD. Your reward will change during this phase proportionally to the size of your debt in comparison to whole debt pool.
2. **Staking phase** - in this phase you enter with the number of points you had at the end of the previous phase and you can retain them by keeping your debt at the same level. The number of points will decrease when you Burn your xUSD.
3. **Claiming phase** - in this phase you can claim your reward - an amount of SNY proportional pro rata shares you had at the end of the previous phase. If you don't claim your rewards before the end of the phase, your reward will be discarded.

![Rewards rounds diagram](https://i.imgur.com/T6uGYGC.png)

Each phase lasts about a week. At any given time, there are three parallel rounds, each at a different phase. You can see them listed in the _Rewards_ tab as follows:

- _Subscription Round_ - shows the round that is currently in the Subscription phase
- _Staking round_ - shows the round that is currently in the Staking phase
- _Claiming round_ - shows the round that is currently in the Claiming phase

![Rewards tab](/img/docs/rewards.png)

You can see number of SNY tokens you are going to be given for each round next to the round's name.
You can check each round's time when you hover over the icon on the left from each phase's name. To claim your rewards from the finished round, click on the _Claim_ button in the right bottom corner. You should see the amount of SNY you received in the top right corner of the section. To transfer this amount to your account click on the _Withdraw_ button in the left right corner. At each step, you should approve the transaction in your wallet's extension. You should see that the number of SNY available in your account increased.

![Time of rounds and claiming](/img/docs/rewardsHover.png)

Method of calculating APY:

APR = weekly_reward_value/debt_pool_value\*52

APY = (APR/52+1)^52-1

52 is number of weeks, cause APY is weekly

### Something failed

If the connection to the wallet could not be established:

- Refresh the website
- Try to connect again.

If something else failed, you can see a red sign and a message that your action went wrong on the right from the button you clicked on, and each time a pop-up shows up in the bottom left corner. Try to:

- Refresh the website
- Re-do _Connect to wallet_ step
- Try to redo your action.

If the above steps didn't help, please contact us on [Discord](https://discord.gg/Z9v9ez8u) or send an e-mail to support@synthetify.io with an applicable note.
