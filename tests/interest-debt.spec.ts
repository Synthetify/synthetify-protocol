import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateral,
  skipTimestamps,
  assertThrowsAsync,
  U64_MAX,
  eqDecimals
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { calculateDebt, toDecimal } from '../sdk/lib/utils'
import { ORACLE_OFFSET, ACCURACY } from '@synthetify/sdk'
import { signAndSend } from '@synthetify/sdk'
import { ERRORS, ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'

describe('Interest debt accumulation', () => {
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
  let collateralAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let stakingFundAccount: PublicKey
  let snyReserve: PublicKey
  let accountOwner: PublicKey
  let exchangeAccount: PublicKey
  let expectedDebtInterest: BN
  let CollateralTokenMinter: Account = wallet
  let nonce: number

  let initialCollateralPrice = 2
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)
    snyReserve = await collateralToken.createAccount(exchangeAuthority)

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
      snyLiquidationFund,
      snyReserve,
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

    accountOwner = new Account().publicKey
    exchangeAccount = await exchange.createExchangeAccount(accountOwner)
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
  })
  describe('Accumulate debt interest', async () => {
    it('should initialized interest debt parameters', async () => {
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.debtInterestRate, toDecimal(new BN(10).pow(new BN(16)), 18)))
      assert.ok(eqDecimals(state.accumulatedDebtInterest, toDecimal(new BN(0), 6)))
    })
    it('should initialized assets list', async () => {
      const initTokensDecimals = 6
      const assetsListData = await exchange.getAssetsList(assetsList)
      // Length should be 2
      assert.ok(assetsListData.assets.length === 2)
      // Authority of list

      // Check feed address
      const snyAsset = assetsListData.assets[assetsListData.assets.length - 1]
      assert.ok(snyAsset.feedAddress.equals(collateralTokenFeed))

      // Check token address
      const snyCollateral = assetsListData.collaterals[assetsListData.collaterals.length - 1]
      assert.ok(snyCollateral.collateralAddress.equals(collateralToken.publicKey))

      // USD token address
      const usdAsset = assetsListData.assets[0]
      assert.ok(eqDecimals(usdAsset.price, toDecimal(new BN(10 ** ORACLE_OFFSET), ORACLE_OFFSET)))

      // xUSD checks
      const usdSynthetic = assetsListData.synthetics[assetsListData.synthetics.length - 1]
      assert.ok(usdSynthetic.assetAddress.equals(usdToken.publicKey))
      assert.ok(usdSynthetic.supply.scale === initTokensDecimals)
      assert.ok(usdSynthetic.maxSupply.scale === initTokensDecimals)
      assert.ok(usdSynthetic.maxSupply.val.eq(new BN('ffffffffffffffff', 16)))
    })
    it('should prepare base debt (mint debt)', async () => {
      const collateralAmount = new BN(500_000 * 10 ** ACCURACY)
      const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const usdMintAmount = new BN(50_000 * 10 ** ACCURACY)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      // Increase user debt
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(usdMintAmount))

      // Increase exchange debt
      const exchangeStateAfter = await exchange.getState()
      assert.ok(exchangeStateAfter.debtShares.eq(usdMintAmount))

      // Increase asset supply
      const assetsListAfter = await exchange.getAssetsList(assetsList)
      assert.ok(assetsListAfter.synthetics[0].supply.val.eq(usdMintAmount))

      // Increase user xusd balance
      const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
    })
    it('should increase interest debt', async () => {
      const assetsListBeforeAdjustment = await exchange.getAssetsList(assetsList)
      const debtBeforeAdjustment = calculateDebt(assetsListBeforeAdjustment)
      const timestampBeforeAdjustment = (await connection.getBlockTime(
        await connection.getSlot()
      )) as number
      // trigger debt adjustment without changing base debt and assets supply
      await skipTimestamps(60, connection)

      await exchange.checkAccount(exchangeAccount)
      const assetsListAfterAdjustment = await exchange.getAssetsList(assetsList)
      const stateAfterAdjustment = await exchange.getState()
      const debtAfterAdjustment = calculateDebt(assetsListAfterAdjustment)

      // real debt      50000.000951...$
      // expected debt  50000.000952   $
      expectedDebtInterest = new BN(952)
      // debt should be increased by debt interest
      assert.ok(debtAfterAdjustment.eq(debtBeforeAdjustment.add(expectedDebtInterest)))
      // xUSD supply should be increased by debt interest
      assert.ok(
        assetsListAfterAdjustment.synthetics[0].supply.val.eq(
          assetsListBeforeAdjustment.synthetics[0].supply.val.add(expectedDebtInterest)
        )
      )
      // accumulatedDebtInterest should be increased by debt interest
      assert.ok(stateAfterAdjustment.accumulatedDebtInterest.val.eq(expectedDebtInterest))
      // lastDebtAdjustment should be increased 60 = 1 adjustment (lastDebtAdjustment should always be multiple of 60 sec)
      assert.ok(stateAfterAdjustment.lastDebtAdjustment.gten(timestampBeforeAdjustment + 60))
      assert.ok(
        stateAfterAdjustment.lastDebtAdjustment.lt(new BN(timestampBeforeAdjustment).addn(120))
      )
    })
  })
  describe('withdraw accumulated interest debt', async () => {
    let adminUsdTokenAccount: PublicKey
    let firstWithdrawAmount: BN
    before(async () => {
      adminUsdTokenAccount = await usdToken.createAccount(new Account().publicKey)
    })
    it('withdraw accumulated interest debt should fail without admin signature', async () => {
      const accountOwner = new Account()
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: new BN(0),
        to: usdTokenAccount
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('admin should withdraw some accumulated interest debt', async () => {
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountBeforeWithdraw.amount.eqn(0))

      const accumulatedDebtInterestBeforeWithdraw = (await exchange.getState())
        .accumulatedDebtInterest
      assert.ok(accumulatedDebtInterestBeforeWithdraw.val.eq(expectedDebtInterest))

      firstWithdrawAmount = new BN(100)
      const ix = await exchange.withdrawAccumulatedDebtInterestInstruction({
        amount: firstWithdrawAmount,
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(firstWithdrawAmount))

      const accumulatedDebtInterestAfterWithdraw = (await exchange.getState())
        .accumulatedDebtInterest
      assert.ok(
        accumulatedDebtInterestAfterWithdraw.val.eq(expectedDebtInterest.sub(firstWithdrawAmount))
      )
    })
    it('should withdraw all swap tax', async () => {
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountBeforeWithdraw.amount.eq(firstWithdrawAmount))

      const accumulatedDebtInterestBeforeWithdraw = (await exchange.getState())
        .accumulatedDebtInterest
      assert.ok(
        accumulatedDebtInterestBeforeWithdraw.val.eq(expectedDebtInterest.sub(firstWithdrawAmount))
      )

      const toWithdrawTax = U64_MAX
      const ix = await exchange.withdrawAccumulatedDebtInterestInstruction({
        amount: toWithdrawTax,
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(expectedDebtInterest))

      const accumulatedDebtInterestAfterWithdraw = (await exchange.getState())
        .accumulatedDebtInterest
      assert.ok(accumulatedDebtInterestAfterWithdraw.val.eqn(0))
    })
    it('withdraw 0 accumulated interest debt should not have an effect', async () => {
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      const accumulatedDebtInterestBeforeWithdraw = (await exchange.getState())
        .accumulatedDebtInterest

      const ix = await exchange.withdrawAccumulatedDebtInterestInstruction({
        amount: new BN(0),
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(userUsdAccountBeforeWithdraw.amount))

      const accumulatedDebtInterestAfterWithdraw = (await exchange.getState())
        .accumulatedDebtInterest

      assert.ok(
        eqDecimals(accumulatedDebtInterestAfterWithdraw, accumulatedDebtInterestBeforeWithdraw)
      )
    })
    it('withdraw too much from accumulated interest debt should result failed', async () => {
      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: expectedDebtInterest.muln(2),
        to: adminUsdTokenAccount
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.INSUFFICIENT_AMOUNT_ADMIN_WITHDRAW
      )
    })
  })
})
