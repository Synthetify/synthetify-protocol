import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  tou64,
  SYNTHETIFY_EXCHANGE_SEED,
  createCollateralToken,
  eqDecimals,
  assertThrowsAsync,
  newAccountWithLamports,
  almostEqual,
  getSwapLineAmountOut
} from './utils'
import { createPriceFeed } from './oracleUtils'
import {
  calculateDebt,
  ERRORS_EXCHANGE,
  percentToDecimal,
  toDecimal
} from '@synthetify/sdk/lib/utils'
import { Collateral, Synthetic } from '@synthetify/sdk/lib/exchange'

describe('swap-line different decimal', () => {
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

  let initialCollateralPrice = 2

  before(async () => {
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)
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
      stakingRoundLength: 300,
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
    await exchange.getState()
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
  })

  describe('Create swap line', async () => {
    let syntheticToken: Token
    let collateralToken: Token
    const limit = new BN(10 ** 9)
    before(async () => {
      syntheticToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 9
      })
      const newAssetLimit = new BN(10).pow(new BN(18))
      const { feed, token } = await createCollateralToken({
        collateralRatio: 30,
        connection,
        decimals: 7,
        exchange,
        exchangeAuthority,
        oracleProgram,
        price: 211,
        wallet
      })
      collateralToken = token
      const addNativeSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: syntheticToken.publicKey,
        assetsList,
        maxSupply: newAssetLimit,
        priceFeed: feed
      })
      await signAndSend(new Transaction().add(addNativeSynthetic), [EXCHANGE_ADMIN], connection)
    })
    it('fail without admin signature', async () => {
      const limit = new BN(1000)

      const collateralReserve = await collateralToken.createAccount(exchangeAuthority)
      const { ix, swaplineAddress } = await exchange.createSwaplineInstruction({
        collateral: collateralToken.publicKey,
        collateralReserve,
        synthetic: syntheticToken.publicKey,
        limit
      })
      assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS_EXCHANGE.UNAUTHORIZED
      )
    })
    it('success', async () => {
      const state = await exchange.getState()

      const collateralReserve = await collateralToken.createAccount(exchangeAuthority)
      const assetsList = await exchange.getAssetsList(state.assetsList)
      const synthetic = assetsList.synthetics.find((s) =>
        s.assetAddress.equals(syntheticToken.publicKey)
      )
      const collateral = assetsList.collaterals.find((s) =>
        s.collateralAddress.equals(collateralToken.publicKey)
      )
      if (!synthetic || !collateral) {
        throw new Error('Synthetic not found')
      }
      const { ix, swaplineAddress } = await exchange.createSwaplineInstruction({
        collateral: collateralToken.publicKey,
        collateralReserve,
        synthetic: syntheticToken.publicKey,
        limit
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const swapLine = await exchange.getSwapline(swaplineAddress)
      assert.ok(swapLine.collateral.equals(collateralToken.publicKey))
      assert.ok(swapLine.limit.val.eq(limit))
      assert.ok(swapLine.synthetic.equals(syntheticToken.publicKey))
      assert.ok(swapLine.collateralReserve.equals(collateralReserve))
      assert.ok(swapLine.halted === false)
      assert.ok(eqDecimals(swapLine.fee, percentToDecimal(0.2)))
      assert.ok(eqDecimals(swapLine.balance, toDecimal(new BN(0), collateral.reserveBalance.scale)))
      assert.ok(
        eqDecimals(swapLine.accumulatedFee, toDecimal(new BN(0), collateral.reserveBalance.scale))
      )
    })
  })
  describe('Swap', async () => {
    let syntheticToken: Token
    let collateralToken: Token
    let swapLinePubkey: PublicKey
    const limit = new BN(10 ** 9)

    before(async () => {
      syntheticToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 9
      })
      const newAssetLimit = new BN(10).pow(new BN(18))
      const { feed, token } = await createCollateralToken({
        collateralRatio: 30,
        connection,
        decimals: 7,
        exchange,
        exchangeAuthority,
        oracleProgram,
        price: 211,
        wallet
      })
      collateralToken = token
      const addNativeSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: syntheticToken.publicKey,
        assetsList,
        maxSupply: newAssetLimit,
        priceFeed: feed
      })
      await signAndSend(new Transaction().add(addNativeSynthetic), [EXCHANGE_ADMIN], connection)
      const collateralReserve = await collateralToken.createAccount(exchangeAuthority)

      const { ix, swaplineAddress } = await exchange.createSwaplineInstruction({
        collateral: collateralToken.publicKey,
        collateralReserve,
        synthetic: syntheticToken.publicKey,
        limit
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      swapLinePubkey = swaplineAddress
    })
    it('swap native -> synthetic -> native -> withdraw fee ', async () => {
      const amountToSwap = 10 ** 9
      const ownerAccount = await newAccountWithLamports(connection)
      const userCollateralAccount = await collateralToken.createAccount(ownerAccount.publicKey)
      const userSyntheticAccount = await syntheticToken.createAccount(ownerAccount.publicKey)
      await collateralToken.mintTo(userCollateralAccount, wallet, [], amountToSwap)
      const state = await exchange.getState()

      const ix = await exchange.nativeToSynthetic({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        amount: new BN(amountToSwap),
        signer: ownerAccount.publicKey,
        userCollateralAccount,
        userSyntheticAccount
      })
      const approveIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        userCollateralAccount,
        exchange.exchangeAuthority,
        ownerAccount.publicKey,
        [],
        tou64(amountToSwap)
      )

      const assetsListBeforeNativeSwap = await exchange.getAssetsList(state.assetsList)
      // swap native to synthetic
      await signAndSend(new Transaction().add(approveIx).add(ix), [ownerAccount], connection)

      const swapLineAfterNativeSwap = await exchange.getSwapline(swapLinePubkey)
      const assetsListAfterNativeSwap = await exchange.getAssetsList(state.assetsList)

      assert.ok((await collateralToken.getAccountInfo(userCollateralAccount)).amount.eq(new BN(0)))

      const amountOut = new BN('99800000000') // 10^(9+outDecimals-inDecimals) * 99,8%
      const fee = new BN('2000000') // 10^9 * 0,2%

      const mintedAmount = (await syntheticToken.getAccountInfo(userSyntheticAccount)).amount
      const reserveAmountAfterNativeSwap = (
        await collateralToken.getAccountInfo(swapLineAfterNativeSwap.collateralReserve)
      ).amount
      console.log(`reserve amount after swap: ${reserveAmountAfterNativeSwap}`)
      // assets token transfer
      assert.ok(new BN(mintedAmount).eq(amountOut))
      assert.ok(new BN(reserveAmountAfterNativeSwap).eq(new BN(amountToSwap)))
      assert.ok(swapLineAfterNativeSwap.balance.val.eq(new BN(amountToSwap)))

      // assets fee increase
      assert.ok(swapLineAfterNativeSwap.accumulatedFee.val.eq(fee))

      const syntheticAfterNativeSwap = assetsListAfterNativeSwap.synthetics.find((synth) =>
        synth.assetAddress.equals(syntheticToken.publicKey)
      )
      const syntheticBeforeNativeSwap = assetsListBeforeNativeSwap.synthetics.find((synth) =>
        synth.assetAddress.equals(syntheticToken.publicKey)
      )
      if (syntheticBeforeNativeSwap === undefined || syntheticAfterNativeSwap === undefined) {
        throw new Error('Synthetic token not found')
      }
      // check synthetic supply
      assert.ok(
        syntheticAfterNativeSwap.swaplineSupply.val.eq(
          syntheticBeforeNativeSwap.swaplineSupply.val.add(amountOut)
        )
      )
      assert.ok(
        syntheticAfterNativeSwap.supply.val.eq(syntheticBeforeNativeSwap.supply.val.add(amountOut))
      )
      assert.ok(
        calculateDebt(assetsListBeforeNativeSwap).eq(calculateDebt(assetsListAfterNativeSwap))
      )

      // Try swap over limit
      assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS_EXCHANGE.SWAPLINE_LIMIT
      )

      // swap synthetic to native
      const nativeToSyntheticIX = await exchange.syntheticToNative({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        amount: amountOut,
        signer: ownerAccount.publicKey,
        userCollateralAccount,
        userSyntheticAccount
      })
      const syntheticApproveIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        userSyntheticAccount,
        exchange.exchangeAuthority,
        ownerAccount.publicKey,
        [],
        tou64(amountOut.toString())
      )
      await signAndSend(
        new Transaction().add(syntheticApproveIx).add(nativeToSyntheticIX),
        [ownerAccount],
        connection
      )
      const nativeAmountOut = new BN('996004000') // 998 * 10^6 * 99,8% = 996004 * 10^3
      const nativeFee = new BN('199600000') // 998 * 10^8 * 0,2% = 1996 * 10^5

      // assert synthetic token transfer
      assert.ok(
        new BN((await syntheticToken.getAccountInfo(userSyntheticAccount)).amount).eq(new BN(0))
      )

      // assert native token transfer
      assert.ok(
        nativeAmountOut.eq(
          new BN((await collateralToken.getAccountInfo(userCollateralAccount)).amount)
        )
      )
      assert.ok(
        new BN(reserveAmountAfterNativeSwap)
          .sub(nativeAmountOut)
          .eq(
            new BN(
              (
                await collateralToken.getAccountInfo(swapLineAfterNativeSwap.collateralReserve)
              ).amount
            )
          )
      )

      const swapLineAfterSyntheticSwap = await exchange.getSwapline(swapLinePubkey)
      assert.ok(
        swapLineAfterSyntheticSwap.balance.val.eq(
          swapLineAfterNativeSwap.balance.val.sub(nativeAmountOut)
        )
      )

      const assetsListAfterSyntheticSwap = await exchange.getAssetsList(state.assetsList)
      const syntheticAfterSyntheticSwap = assetsListAfterSyntheticSwap.synthetics.find((synth) =>
        synth.assetAddress.equals(syntheticToken.publicKey)
      )
      const syntheticBeforeSyntheticSwap = assetsListAfterNativeSwap.synthetics.find((synth) =>
        synth.assetAddress.equals(syntheticToken.publicKey)
      )
      if (syntheticAfterSyntheticSwap === undefined || syntheticBeforeSyntheticSwap === undefined) {
        throw new Error('Synthetic token not found')
      }

      // check synthetic supply
      assert.ok(
        syntheticAfterSyntheticSwap.swaplineSupply.val.eq(
          syntheticBeforeSyntheticSwap.swaplineSupply.val.sub(amountOut)
        )
      )
      assert.ok(
        syntheticAfterSyntheticSwap.supply.val.eq(
          syntheticBeforeSyntheticSwap.supply.val.sub(amountOut)
        )
      )
      // debt should not change
      assert.ok(
        calculateDebt(assetsListAfterSyntheticSwap).eq(calculateDebt(assetsListAfterNativeSwap))
      )

      // Try swap synthetic over swapline collateral balance
      const mintedSyntheticAmount = new BN(1)
      syntheticToken.mintTo(userSyntheticAccount, wallet, [], mintedSyntheticAmount)

      const nativeToSyntheticOverBalanceIX = await exchange.syntheticToNative({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        amount: mintedSyntheticAmount,
        signer: ownerAccount.publicKey,
        userCollateralAccount,
        userSyntheticAccount
      })
      const syntheticApproveOverBalanceIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        userSyntheticAccount,
        exchange.exchangeAuthority,
        ownerAccount.publicKey,
        [],
        tou64(amountOut.toString())
      )

      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(syntheticApproveOverBalanceIx).add(nativeToSyntheticOverBalanceIX),
          [ownerAccount],
          connection
        ),
        ERRORS_EXCHANGE.SWAPLINE_LIMIT
      )

      // Withdraw Fee
      const withdrawalAccount = await collateralToken.createAccount(exchangeAuthority)
      assert.ok((await collateralToken.getAccountInfo(withdrawalAccount)).amount.eq(new BN(0)))
      const withdrawalAmount = swapLineAfterSyntheticSwap.accumulatedFee.val
      // withdrawal IX
      const withdrawSwaplineFeeIX = await exchange.withdrawSwaplineFee({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        amount: withdrawalAmount,
        to: withdrawalAccount
      })
      // Try swap over limit
      assertThrowsAsync(
        signAndSend(new Transaction().add(withdrawSwaplineFeeIX), [wallet], connection),
        ERRORS_EXCHANGE.UNAUTHORIZED
      )
      await signAndSend(new Transaction().add(withdrawSwaplineFeeIX), [EXCHANGE_ADMIN], connection)
      // Fetch updated Swapline
      const swapLineAfterWithdrawalFee = await exchange.getSwapline(swapLinePubkey)
      // Withdrawal entire fee
      assert.ok(swapLineAfterWithdrawalFee.accumulatedFee.val.eq(new BN(0)))
      assert.ok(
        (await collateralToken.getAccountInfo(withdrawalAccount)).amount.eq(withdrawalAmount)
      )
    })
    it('set halted swapline', async () => {
      const haltedTrueIx = await exchange.setHaltedSwapline({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        halted: true
      })
      // fail without admin signature
      assertThrowsAsync(
        signAndSend(new Transaction().add(haltedTrueIx), [wallet], connection),
        ERRORS_EXCHANGE.UNAUTHORIZED
      )

      await signAndSend(new Transaction().add(haltedTrueIx), [EXCHANGE_ADMIN], connection)

      const swapLineHaltedTrue = await exchange.getSwapline(swapLinePubkey)
      assert.ok(swapLineHaltedTrue.halted === true)

      const haltedFalseIx = await exchange.setHaltedSwapline({
        collateral: collateralToken.publicKey,
        synthetic: syntheticToken.publicKey,
        halted: false
      })
      // fail without admin signature
      assertThrowsAsync(
        signAndSend(new Transaction().add(haltedFalseIx), [wallet], connection),
        ERRORS_EXCHANGE.UNAUTHORIZED
      )

      await signAndSend(new Transaction().add(haltedFalseIx), [EXCHANGE_ADMIN], connection)

      const swapLineHaltedFalse = await exchange.getSwapline(swapLinePubkey)
      assert.ok(swapLineHaltedFalse.halted === false)
    })
  })
})
