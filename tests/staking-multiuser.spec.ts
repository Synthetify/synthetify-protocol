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
  skipToSlot
} from './utils'
import { createPriceFeed } from './oracleUtils'

describe('liquidation', () => {
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
    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
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
      collateralAccount,
      liquidationAccount,
      collateralToken: collateralToken.publicKey,
      nonce,
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount
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
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.liquidationAccount.equals(liquidationAccount))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 0)
    assert.ok(state.fee === 300)
    assert.ok(state.liquidationPenalty === 15)
    assert.ok(state.liquidationThreshold === 200)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.collateralShares.eq(new BN(0)))
    assert.ok(state.staking.fundAccount.equals(stakingFundAccount))
    assert.ok(state.staking.amountPerRound.eq(amountPerRound))
    assert.ok(state.staking.roundLength === stakingRoundLength)
  })
  describe.only('Multi user staking', async () => {
    it('test flow', async () => {
      const slot = await connection.getSlot()
      assert.ok(nextRoundStart.gtn(slot))

      const collateralAmount = new BN(1000 * 1e6)

      // Creates promises for users (for asynchronicity )
      let usersAccountsPromises = []

      for (let i = 0; i < amountOfAccounts; i++)
        usersAccountsPromises.push(
          (async () =>
            await createAccountWithCollateralAndMaxMintUsd({
              collateralAccount,
              collateralToken,
              exchangeAuthority,
              exchange,
              collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
              amount: collateralAmount,
              usdToken
            }))()
        )

      //Resolving promises
      const usersAccounts = await Promise.all(usersAccountsPromises)

      // Checking points for each user after first round
      const nextRoundPointsCorrectness = await Promise.all(
        usersAccounts.map(async (user) =>
          (
            await exchange.getExchangeAccount(user.exchangeAccount)
          ).userStakingData.nextRoundPoints.eq(new BN(200 * 1e6))
        )
      )

      assert.ok(nextRoundPointsCorrectness.every((i) => i))

      // Wait for start of new round
      await skipToSlot(nextRoundStart.toNumber(), connection)

      // Burn should reduce next round stake
      const amountBurn = new BN(100 * 1e6)

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
          exchangeAccountDataAfterBurn.userStakingData.nextRoundPoints.eq(new BN(100 * 1e6))
        )
        assert.ok(
          exchangeAccountDataAfterBurn.userStakingData.currentRoundPoints.eq(new BN(100 * 1e6))
        )
      }

      // Wait for round to end
      await skipToSlot(nextRoundStart.add(new BN(stakingRoundLength)).toNumber(), connection)

      // Claim rewards
      await Promise.all(usersAccounts.map((user) => exchange.claimRewards(user.exchangeAccount)))

      const state = await exchange.getState()
      assert.ok(state.staking.finishedRound.allPoints.eq(new BN(100 * 1e6 * amountOfAccounts)))
      assert.ok(state.staking.currentRound.allPoints.eq(new BN(100 * 1e6 * amountOfAccounts)))
      assert.ok(state.staking.nextRound.allPoints.eq(new BN(100 * 1e6 * amountOfAccounts)))

      assert.ok(state.staking.finishedRound.amount.eq(amountPerRound))

      let rewardClaims = []

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
              rewardClaims[index].userStakingData.amountToClaim
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

      for (let account of exchangeAccounts) account.userStakingData.amountToClaim.eq(new BN(100))

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
        assert.ok(account.userStakingData.amountToClaim.eq(expectedAmountToClaim))
    })
  })
})
