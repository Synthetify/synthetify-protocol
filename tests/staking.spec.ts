import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network } from '@synthetify/sdk'
import { toDecimal } from '@synthetify/sdk/lib/utils'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  tou64,
  SYNTHETIFY_EXCHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  createAccountWithMultipleCollaterals,
  skipToSlot,
  createCollateralToken,
  eqDecimals,
  mulByDecimal,
  waitForBeggingOfASlot
} from './utils'
import { createPriceFeed } from './oracleUtils'

describe('staking', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let stakingFundAccount: PublicKey
  let reserveAddress: PublicKey
  let snyLiquidationFund: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number

  const amountPerRound = toDecimal(new BN(100), 6)
  const stakingRoundLength = 20

  let initialCollateralPrice = 2
  let nextRoundStart: BN

  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_EXCHANGE_SEED],
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
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    reserveAddress = await collateralToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      nonce,
      amountPerRound: new BN(100),
      stakingRoundLength,
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

    const data = await createAssetsList({
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchangeAdmin: EXCHANGE_ADMIN,
      exchange,
      snyReserve: reserveAddress,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    const state = await exchange.getState()

    nextRoundStart = state.staking.nextRound.start
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addresses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 0)
    assert.ok(eqDecimals(state.fee, toDecimal(new BN(300), 5)))
    assert.ok(state.liquidationBuffer === 2250)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.staking.fundAccount.equals(stakingFundAccount))
    assert.ok(eqDecimals(state.staking.amountPerRound, amountPerRound))
    assert.ok(state.staking.roundLength === stakingRoundLength)
  })
  describe('Staking', async () => {
    it('test flow', async () => {
      const slot = await connection.getSlot()
      assert.ok(nextRoundStart.gtn(slot))
      const collateralAmount = new BN(1000 * 1e6)
      const { accountOwner, exchangeAccount, usdTokenAccount, userCollateralTokenAccount } =
        await createAccountWithCollateralAndMaxMintUsd({
          reserveAddress: reserveAddress,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount,
          usdToken
        })

      const healthFactor = (await exchange.getState()).healthFactor

      assert.ok(
        (await exchange.getExchangeAccount(exchangeAccount)).userStakingData.nextRoundPoints.eq(
          mulByDecimal(new BN(200 * 1e6), healthFactor)
        )
      )
      assert.ok(nextRoundStart.gtn(await connection.getSlot()))
      // Wait for start of new round
      await skipToSlot(nextRoundStart.toNumber(), connection)
      // Burn should reduce next round stake
      const amountBurn = mulByDecimal(new BN(100 * 1e6), healthFactor)
      await exchange.burn({
        amount: amountBurn,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })
      assert.ok(nextRoundStart.toNumber() < (await connection.getSlot()))
      const exchangeAccountDataAfterBurn = await exchange.getExchangeAccount(exchangeAccount)

      const amountScaledByHealth = mulByDecimal(new BN(100 * 1e6), healthFactor)

      assert.ok(
        exchangeAccountDataAfterBurn.userStakingData.nextRoundPoints.eq(amountScaledByHealth)
      )
      assert.ok(
        exchangeAccountDataAfterBurn.userStakingData.currentRoundPoints.eq(amountScaledByHealth)
      )
      // Wait for round to end
      const secondRound = nextRoundStart.toNumber() + 1 + stakingRoundLength
      await skipToSlot(secondRound, connection)
      // Claim rewards
      await exchange.claimRewards(exchangeAccount)
      const state = await exchange.getState()
      assert.ok(state.staking.finishedRound.allPoints.eq(amountScaledByHealth))
      assert.ok(state.staking.currentRound.allPoints.eq(amountScaledByHealth))
      assert.ok(state.staking.nextRound.allPoints.eq(amountScaledByHealth))

      assert.ok(eqDecimals(state.staking.finishedRound.amount, amountPerRound))
      const exchangeAccountDataRewardClaim = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataRewardClaim.userStakingData.finishedRoundPoints.eq(new BN(0)))

      assert.ok(
        (await collateralToken.getAccountInfo(userCollateralTokenAccount)).amount.eq(new BN(0))
      )
      // Mint reward
      await collateralToken.mintTo(
        stakingFundAccount,
        CollateralTokenMinter,
        [],
        tou64(amountPerRound.val)
      )
      await exchange.withdrawRewards({
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccount: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      assert.ok(
        (await collateralToken.getAccountInfo(userCollateralTokenAccount)).amount.eq(
          exchangeAccountDataRewardClaim.userStakingData.amountToClaim.val
        )
      )

      const { exchangeAccount: exchangeAccount2nd } =
        await createAccountWithCollateralAndMaxMintUsd({
          reserveAddress,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount,
          usdToken
        })
      const exchangeAccount2ndData = await exchange.getExchangeAccount(exchangeAccount2nd)
      assert.ok(
        exchangeAccount2ndData.userStakingData.nextRoundPoints.eq(
          mulByDecimal(new BN(200 * 1e6), healthFactor)
        )
      )

      // Wait for nextRound to end
      await skipToSlot(secondRound + stakingRoundLength, connection)

      await exchange.claimRewards(exchangeAccount)
      await exchange.claimRewards(exchangeAccount2nd)
      assert.ok(
        (await exchange.getExchangeAccount(exchangeAccount)).userStakingData.amountToClaim.val.eq(
          new BN(100)
        )
      )
      assert.ok(
        (
          await exchange.getExchangeAccount(exchangeAccount2nd)
        ).userStakingData.amountToClaim.val.eq(new BN(0))
      )
      // Wait for nextRound to end
      await skipToSlot(secondRound + 2 * stakingRoundLength, connection)
      await exchange.claimRewards(exchangeAccount), await exchange.claimRewards(exchangeAccount2nd)

      const exchangeAccountDataAfterRewards = await exchange.getExchangeAccount(exchangeAccount)
      const exchangeAccount2ndDataAfterRewards = await exchange.getExchangeAccount(
        exchangeAccount2nd
      )

      assert.ok(exchangeAccountDataAfterRewards.userStakingData.amountToClaim.val.eq(new BN(133)))
      assert.ok(exchangeAccount2ndDataAfterRewards.userStakingData.amountToClaim.val.eq(new BN(66)))
    })
    it('with multiple collaterals', async () => {
      const { token: btcToken, reserve: btcReserve } = await createCollateralToken({
        exchange,
        exchangeAuthority,
        oracleProgram,
        connection,
        wallet,
        price: 2,
        decimals: 8,
        collateralRatio: 50
      })

      const collateralAmount = new BN(20 * 1e8)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithMultipleCollaterals({
          reserveAddress: reserveAddress,
          otherReserveAddress: btcReserve,
          collateralToken,
          otherToken: btcToken,
          exchangeAuthority,
          exchange,
          mintAuthority: CollateralTokenMinter.publicKey,
          amountOfCollateralToken: collateralAmount,
          amountOfOtherToken: collateralAmount
        })

      // Minting using both collaterals
      const healthFactor = (await exchange.getState()).healthFactor
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const firstRoundStart = nextRoundStart.addn(4 * stakingRoundLength)
      await skipToSlot(firstRoundStart.toNumber(), connection)
      assert.ok(
        (await exchange.getExchangeAccount(exchangeAccount)).userStakingData.nextRoundPoints.eq(
          new BN(0)
        )
      )

      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      assert.ok(
        (await exchange.getExchangeAccount(exchangeAccount)).userStakingData.nextRoundPoints.eq(
          mulByDecimal(new BN(200 * 1e6), healthFactor)
        )
      )

      const secondRoundStart = firstRoundStart.addn(stakingRoundLength)
      assert.ok(secondRoundStart.gtn(await connection.getSlot()))
      await skipToSlot(secondRoundStart.toNumber(), connection)

      // Burn should reduce next round stake
      const remainingAmount = usdMintAmount.div(new BN(2))
      await exchange.burn({
        amount: remainingAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })
      assert.ok(nextRoundStart.toNumber() < (await connection.getSlot()))
      const exchangeAccountDataAfterBurn = await exchange.getExchangeAccount(exchangeAccount)

      assert.ok(exchangeAccountDataAfterBurn.userStakingData.nextRoundPoints.eq(remainingAmount))
      assert.ok(exchangeAccountDataAfterBurn.userStakingData.currentRoundPoints.eq(remainingAmount))

      // Wait for round to end
      const thirdRoundStart = secondRoundStart.addn(stakingRoundLength + 2)
      await skipToSlot(thirdRoundStart.toNumber(), connection)

      // Claim rewards
      await exchange.claimRewards(exchangeAccount)
      const state = await exchange.getState()

      assert.ok(state.staking.finishedRound.amount.val.eq(amountPerRound.val))
      const exchangeAccountDataRewardClaim = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataRewardClaim.userStakingData.finishedRoundPoints.eq(new BN(0)))

      assert.ok(
        (await collateralToken.getAccountInfo(userCollateralTokenAccount)).amount.eq(new BN(0))
      )
      // Mint reward
      await collateralToken.mintTo(
        stakingFundAccount,
        CollateralTokenMinter,
        [],
        tou64(amountPerRound.val)
      )
      await waitForBeggingOfASlot(connection)
      await exchange.withdrawRewards({
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccount: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      assert.ok(
        (await collateralToken.getAccountInfo(userCollateralTokenAccount)).amount.eq(
          exchangeAccountDataRewardClaim.userStakingData.amountToClaim.val
        )
      )
    })
  })
})
