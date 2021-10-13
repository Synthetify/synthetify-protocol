---
title: Staking

slug: /technical/staking
---

For participating in the debt pool users can get rewards.

## Staking structure

Data about staking rounds is kept inside state in _Staking_ struct:

    struct Staking {
        pub fund_account: Pubkey,
        pub round_length: u32,
        pub amount_per_round: Decimal,
        pub finished_round: StakingRound,
        pub current_round: StakingRound,
        pub next_round: StakingRound,
    }

- **fund_account** - account, where rewards are deposited
- **round_length** - length of a round in [slots](https://docs.solana.com/terminology#slot)
- **amount_per_round** - the amount of SNY as a reward to divide between stakers
- **finished_round** - _round_, when a user can claim their points
- **current_round** - _round_, when user reduces debt. Their points are reduced as well
- **next_round** - _round_, when points are set to amount of debt shares

### Staking Round

Staking round keeps data about single round. All three of them are in continuous rotation, just as [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/utils.rs#L35-L125)

    pub struct StakingRound {
        pub start: u64,
        pub amount: Decimal,
        pub all_points: u64,
    }

- **start** - [slot](https://docs.solana.com/terminology#slot) when the round starts
- **amount** - the amount of tokens to divide between stakers
- **all_points** - total points (debt_shares for next_round)

## User Staking

User's staking rounds points are updated [here](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/utils.rs#L126-L145). They are also updated [in mint](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L349-L350) and [in burn](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L660-L685).

    pub struct UserStaking {
        pub amount_to_claim: Decimal,
        pub finished_round_points: u64,
        pub current_round_points: u64,
        pub next_round_points: u64,
        pub last_update: u64,
    }

- **amount_to_claim** - the amount of SNY that can be withdrawn
- **finished_round_points** - points in finished round
- **current_round_points** - the amount of points in the current round
- **next_round_points** - the amount of points in the next round
- **last_update** - last slot, when staking data was updated

## Claim

While the claiming round lasts, user can claim their rewards. Currently, it does not require a signer, so can be called by anybody. When claimed rewards are added to _amount_to_claim_, they can be withdrawn.

    pub struct ClaimRewards<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_account** - account with [user's data](/docs/technical/account#structure-of-account)

## Withdraw rewards

User can withdraw its claimed rewards using [this](https://github.com/Synthetify/synthetify-protocol/blob/8bd95bc1f4f31f8e774b2b02d1866abbe35404a5/programs/exchange/src/lib.rs#L1010-L1045) function. It transfers claimed amount to specified account as SNY tokens. Method takes a following context:

    struct WithdrawRewards<'info> {
        pub state: Loader<'info, State>,
        pub exchange_account: Loader<'info, ExchangeAccount>,
        pub owner: AccountInfo<'info>,
        pub exchange_authority: AccountInfo<'info>,
        pub token_program: AccountInfo<'info>,
        pub user_token_account: Account<'info, TokenAccount>,
        pub staking_fund_account: Account<'info, TokenAccount>,
    }

- **state** - account with [data of the program](/docs/technical/state)
- **exchange_account** - account with [user's data](/docs/technical/account#structure-of-account)
- **owner** - the owner of the _exchange account_
- **exchange_authority** - pubkey of the exchange program
- **token_program** - address of Solana's [_Token Program_](https://spl.solana.com/token)
- **user_token_account** - users account on
- **staking_fund_account** - account, from which tokens will be transferred, the same as in [_Staking_](/docs/technical/staking#staking-structure) struct
