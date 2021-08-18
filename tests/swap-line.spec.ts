import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  tou64,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  createAccountWithMultipleCollaterals,
  skipToSlot,
  createCollateralToken,
  eqDecimals,
  mulByDecimal,
  waitForBeggingOfASlot,
  assertThrowsAsync,
  newAccountWithLamports,
  almostEqual,
  getSwapLineAmountOut
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { Collateral } from '@synthetify/sdk/lib/exchange'
import {
  calculateDebt,
  ERRORS_EXCHANGE,
  percentToDecimal,
  toDecimal
} from '@synthetify/sdk/lib/utils'

describe('swap-line', () => {
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

  before(async () => {
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)
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

    const data = await createAssetsList({
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange,
      snyReserve: reserveAddress,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
      nonce,
      amountPerRound: amountPerRound.val,
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
  })

  describe('Create swap line', async () => {
    it('success', async () => {
      const state = await exchange.getState()
      const limit = new BN(1000)
      const assetsList = await exchange.getAssetsList(state.assetsList)
      const synthetic = assetsList.synthetics[0].assetAddress
      const collateral = assetsList.collaterals[0]
      const collateralReserve = await usdToken.createAccount(exchangeAuthority)
      const { ix, swapLineAddress } = await exchange.createSwapLineInstruction({
        collateral: collateral.collateralAddress,
        collateralReserve,
        synthetic,
        limit
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const swapLine = await exchange.getSwapLine(swapLineAddress)
      assert.ok(swapLine.collateral.equals(collateral.collateralAddress))
      assert.ok(swapLine.limit.val.eq(limit))
      assert.ok(swapLine.synthetic.equals(synthetic))
      assert.ok(swapLine.collateralReserve.equals(collateralReserve))
      assert.ok(eqDecimals(swapLine.fee, percentToDecimal(1)))
      assert.ok(eqDecimals(swapLine.balance, toDecimal(new BN(0), collateral.reserveBalance.scale)))
      assert.ok(
        eqDecimals(swapLine.accumulatedFee, toDecimal(new BN(0), collateral.reserveBalance.scale))
      )
    })
    it('fail without admin signature', async () => {
      const limit = new BN(1000)

      const state = await exchange.getState()
      const assetsList = await exchange.getAssetsList(state.assetsList)
      const synthetic = assetsList.synthetics[0].assetAddress
      const collateral = assetsList.collaterals[0]
      const collateralReserve = await usdToken.createAccount(exchangeAuthority)
      const { ix, swapLineAddress } = await exchange.createSwapLineInstruction({
        collateral: collateral.collateralAddress,
        collateralReserve,
        synthetic,
        limit
      })
      assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS_EXCHANGE.UNAUTHORIZED
      )
    })
  })
  describe.only('Swap', async () => {
    let syntheticToken: Token
    let collateralToken: Token
    let swapLinePubkey: PublicKey
    const limit = new BN(10 ** 9)

    before(async () => {
      syntheticToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const newAssetLimit = new BN(10).pow(new BN(18))
      const { feed, token } = await createCollateralToken({
        collateralRatio: 50,
        connection,
        decimals: 6,
        exchange,
        exchangeAuthority,
        oracleProgram,
        price: 2,
        wallet
      })
      collateralToken = token
      const addNativeSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: syntheticToken.publicKey,
        assetsList,
        decimals: (await syntheticToken.getMintInfo()).decimals,
        maxSupply: newAssetLimit,
        priceFeed: feed
      })
      await signAndSend(new Transaction().add(addNativeSynthetic), [EXCHANGE_ADMIN], connection)
      const collateralReserve = await collateralToken.createAccount(exchangeAuthority)

      const { ix, swapLineAddress } = await exchange.createSwapLineInstruction({
        collateral: collateralToken.publicKey,
        collateralReserve,
        synthetic: syntheticToken.publicKey,
        limit
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      swapLinePubkey = swapLineAddress
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
      const approveIx = await Token.createApproveInstruction(
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

      const swapLineAfterNativeSwap = await exchange.getSwapLine(swapLinePubkey)
      const assetsListAfterNativeSwap = await exchange.getAssetsList(state.assetsList)

      assert.ok(
        await (await collateralToken.getAccountInfo(userCollateralAccount)).amount.eq(new BN(0))
      )

      const { amountOut, fee } = await getSwapLineAmountOut({
        amountIn: new BN(amountToSwap),
        fee: swapLineAfterNativeSwap.fee,
        inDecimals: (await collateralToken.getMintInfo()).decimals,
        outDecimals: (await syntheticToken.getMintInfo()).decimals
      })
      const mintedAmount = (await syntheticToken.getAccountInfo(userSyntheticAccount)).amount
      const reserveAmountAfterNativeSwap = (
        await collateralToken.getAccountInfo(swapLineAfterNativeSwap.collateralReserve)
      ).amount
      // assets toten transfer
      assert.ok(almostEqual(mintedAmount, amountOut))
      assert.ok(almostEqual(reserveAmountAfterNativeSwap, new BN(amountToSwap)))
      assert.ok(almostEqual(swapLineAfterNativeSwap.balance.val, new BN(amountToSwap)))

      // assets fee increase
      assert.ok(almostEqual(swapLineAfterNativeSwap.accumulatedFee.val, fee))
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
      // debt should not change
      assert.ok(
        almostEqual(
          calculateDebt(assetsListBeforeNativeSwap),
          calculateDebt(assetsListAfterNativeSwap)
        )
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
      const syntheticApproveIx = await Token.createApproveInstruction(
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
      const { amountOut: nativeAmountOut, fee: nativeFee } = await getSwapLineAmountOut({
        amountIn: amountOut,
        fee: swapLineAfterNativeSwap.fee,
        inDecimals: (await syntheticToken.getMintInfo()).decimals,
        outDecimals: (await collateralToken.getMintInfo()).decimals
      })
      // assert synthetic token transfer
      assert.ok(
        almostEqual((await syntheticToken.getAccountInfo(userSyntheticAccount)).amount, new BN(0))
      )
      // assert native token transfer
      assert.ok(
        almostEqual(
          (await collateralToken.getAccountInfo(userCollateralAccount)).amount,
          nativeAmountOut
        )
      )
      assert.ok(
        almostEqual(
          (await collateralToken.getAccountInfo(swapLineAfterNativeSwap.collateralReserve)).amount,
          new BN(reserveAmountAfterNativeSwap).sub(nativeAmountOut)
        )
      )
      const swapLineAfterSyntheticSwap = await exchange.getSwapLine(swapLinePubkey)
      assert.ok(
        almostEqual(
          swapLineAfterSyntheticSwap.balance.val,
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
        almostEqual(
          calculateDebt(assetsListAfterSyntheticSwap),
          calculateDebt(assetsListAfterNativeSwap)
        )
      )

      // Withdraw Fee
      const withdrawalAccount = await collateralToken.createAccount(exchangeAuthority)
      assert.ok(
        await (await collateralToken.getAccountInfo(withdrawalAccount)).amount.eq(new BN(0))
      )
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
      const swapLineAfterWithdrawalFee = await exchange.getSwapLine(swapLinePubkey)
      // Withdrawal entire fee
      assert.ok(swapLineAfterWithdrawalFee.accumulatedFee.val.eq(new BN(0)))
      assert.ok(
        await (await collateralToken.getAccountInfo(withdrawalAccount)).amount.eq(withdrawalAmount)
      )
    })
  })
})
