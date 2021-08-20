import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  tou64,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  skipToSlot,
  mulByPercentage,
  mulByDecimal
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { ExchangeAccount } from '../sdk/lib/exchange'

describe('staking with multiple users', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let collateralAccount: PublicKey
  let liquidationAccount: PublicKey
  let stakingFundAccount: PublicKey
  let reserveAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number

  const amountPerRound = new BN(100)
  const stakingRoundLength = 30
  const amountOfAccounts = 10

  let initialCollateralPrice = 2
  let nextRoundStart: BN

  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: initialCollateralPrice,
      expo: -6
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    reserveAccount = await collateralToken.createAccount(exchangeAuthority)
    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
      snyReserve: reserveAccount,
      snyLiquidationFund: liquidationAccount,
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
      nonce,
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount,
      exchangeAuthority: exchangeAuthority
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )
    const state = await exchange.getState()
    nextRoundStart = state.staking.nextRound.start
  })
  describe('Multi user staking', async () => {
    it('test flow', async () => {
      const slot = await connection.getSlot()
      assert.ok(nextRoundStart.gtn(slot))

      const collateralAmount = new BN(1000 * 1e6)

      // Creating accounts
      const usersAccounts = await Promise.all(
        [...Array(amountOfAccounts).keys()].map(() =>
          createAccountWithCollateralAndMaxMintUsd({
            reserveAddress: reserveAccount,
            collateralToken,
            exchangeAuthority,
            exchange,
            collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
            amount: collateralAmount,
            usdToken
          })
        )
      )

      // const usersAccounts = await Promise.all(usersAccountsPromises)
      const healthFactor = (await exchange.getState()).healthFactor

      // Checking points for each user after first round
      const nextRoundPointsCorrectness = await Promise.all(
        usersAccounts.map(async (user) =>
          (
            await exchange.getExchangeAccount(user.exchangeAccount)
          ).userStakingData.nextRoundPoints.eq(mulByDecimal(new BN(200 * 1e6), healthFactor))
        )
      )

      assert.ok(nextRoundPointsCorrectness.every((i) => i))

      // Wait for start of new round
      await skipToSlot(nextRoundStart.toNumber(), connection)

      // Burn should reduce next round stake
      const amountBurn = mulByDecimal(new BN(100 * 1e6), healthFactor)
      const amountScaledByHealth = amountBurn // half of amount before burn

      for (let user of usersAccounts) {
        await exchange.burn({
          amount: amountBurn,
          exchangeAccount: user.exchangeAccount,
          owner: user.accountOwner.publicKey,
          userTokenAccountBurn: user.usdTokenAccount,
          signers: [user.accountOwner]
        })

        // Check if burn worked
        const exchangeAccountDataAfterBurn = await exchange.getExchangeAccount(user.exchangeAccount)
        assert.ok(
          exchangeAccountDataAfterBurn.userStakingData.nextRoundPoints.eq(amountScaledByHealth)
        )
        assert.ok(
          exchangeAccountDataAfterBurn.userStakingData.currentRoundPoints.eq(amountScaledByHealth)
        )
      }

      // Wait for round to end
      await skipToSlot(nextRoundStart.add(new BN(stakingRoundLength)).toNumber(), connection)

      // Claim rewards
      await Promise.all(usersAccounts.map((user) => exchange.claimRewards(user.exchangeAccount)))

      const state = await exchange.getState()
      const expectedAllPointAmount = amountScaledByHealth.muln(amountOfAccounts)
      assert.ok(state.staking.finishedRound.allPoints.eq(expectedAllPointAmount))
      assert.ok(state.staking.currentRound.allPoints.eq(expectedAllPointAmount))
      assert.ok(state.staking.nextRound.allPoints.eq(expectedAllPointAmount))

      assert.ok(state.staking.finishedRound.amount.val.eq(amountPerRound))

      let rewardClaims: ExchangeAccount[] = []

      for (let user of usersAccounts) {
        const exchangeAccountDataRewardClaim = await exchange.getExchangeAccount(
          user.exchangeAccount
        )
        rewardClaims.push(exchangeAccountDataRewardClaim)
        assert.ok(exchangeAccountDataRewardClaim.userStakingData.finishedRoundPoints.eq(new BN(0)))

        assert.ok(
          (await collateralToken.getAccountInfo(user.userCollateralTokenAccount)).amount.eq(
            new BN(0)
          )
        )
      }
      // Mint reward
      await collateralToken.mintTo(
        stakingFundAccount,
        CollateralTokenMinter,
        [],
        tou64(amountPerRound)
      )

      await Promise.all(
        usersAccounts.map(async (user, index) => {
          await exchange.withdrawRewards({
            exchangeAccount: user.exchangeAccount,
            owner: user.accountOwner.publicKey,
            userTokenAccount: user.userCollateralTokenAccount,
            signers: [user.accountOwner]
          })
          assert.ok(
            (await collateralToken.getAccountInfo(user.userCollateralTokenAccount)).amount.eq(
              rewardClaims[index].userStakingData.amountToClaim.val
            )
          )
        })
      )

      // Wait for round to end
      await skipToSlot(nextRoundStart.add(new BN(2 * stakingRoundLength)).toNumber(), connection)

      await Promise.all(
        usersAccounts.map(async (user) => {
          await exchange.claimRewards(user.exchangeAccount)
        })
      )

      const exchangeAccounts = await Promise.all(
        usersAccounts.map(async (user) => exchange.getExchangeAccount(user.exchangeAccount))
      )

      for (let account of exchangeAccounts)
        account.userStakingData.amountToClaim.val.eq(new BN(100))

      // Wait for round to end
      await skipToSlot(nextRoundStart.add(new BN(3 * stakingRoundLength)).toNumber(), connection)

      // Claiming rewards
      await Promise.all(
        usersAccounts.map(async (user) => {
          await exchange.claimRewards(user.exchangeAccount)
        })
      )

      // Getting user data
      const exchangeAccountsDataAfterRewards = await Promise.all(
        usersAccounts.map(async (user) => exchange.getExchangeAccount(user.exchangeAccount))
      )

      // Checking if claimed amount is correct
      const expectedAmountToClaim = amountPerRound
        .div(new BN(amountOfAccounts))
        .add(amountPerRound.div(new BN(amountOfAccounts)))

      for (let account of exchangeAccountsDataAfterRewards)
        assert.ok(account.userStakingData.amountToClaim.val.eq(expectedAmountToClaim))
    })
  })
})
