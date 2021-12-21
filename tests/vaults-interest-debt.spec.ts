import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  sleep,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  calculateDebt,
  SYNTHETIFY_EXCHANGE_SEED,
  calculateAmountAfterFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync,
  mulByPercentage,
  createCollateralToken,
  calculateFee,
  calculateSwapTax,
  U64_MAX,
  eqDecimals,
  mulByDecimal,
  almostEqual,
  skipTimestamps
} from './utils'
import { createPriceFeed, getFeedData, setFeedTrading } from './oracleUtils'
import {
  decimalToPercent,
  ERRORS,
  fromPercentToInterestRate,
  INTEREST_RATE_DECIMALS,
  percentToDecimal,
  SNY_DECIMALS,
  toDecimal,
  toScale,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { Collateral, PriceStatus, Synthetic } from '../sdk/lib/exchange'
import { Decimal } from '@synthetify/sdk/src/exchange'
import { ORACLE_OFFSET } from '@synthetify/sdk'

describe('Vault interest borrow accumulation', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program
  //@ts-ignore
  const wallet = provider.wallet.payer as Account

  let snyToken: Token
  let xsolToken: Token
  let assetsList: PublicKey
  let snyTokenFeed: PublicKey
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let btcToken: Token
  let btcVaultReserve: PublicKey
  let btcVaultLiquidationFund: PublicKey
  let userBtcTokenAccount: PublicKey
  let userXsolTokenAccount: PublicKey
  let btcUserCollateralAmount: BN
  let xsolBorrowAmount: BN
  let xsol: Synthetic
  let btc: Collateral
  let btcPriceFeed: PublicKey
  const accountOwner = Keypair.generate()

  before(async () => {
    await connection.requestAirdrop(accountOwner.publicKey, 10e9)
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)

    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_EXCHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce

    exchangeAuthority = _mintAuthority
    snyTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2,
      expo: -6
    })
    snyToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    snyReserve = await snyToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await snyToken.createAccount(exchangeAuthority)
    stakingFundAccount = await snyToken.createAccount(exchangeAuthority)

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
      collateralToken: snyToken,
      collateralTokenFeed: snyTokenFeed,
      connection,
      wallet,
      exchangeAdmin: EXCHANGE_ADMIN,
      exchange,
      snyReserve,
      snyLiquidationFund
    })
    assetsList = data.assetsList

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    await exchange.getState()

    // create BTC collateral token
    const { token, feed } = await createCollateralToken({
      decimals: 8,
      price: 47857,
      collateralRatio: 65,
      connection,
      exchange,
      exchangeAuthority,
      oracleProgram,
      wallet
    })
    btcPriceFeed = feed
    btcToken = token

    btcVaultReserve = await btcToken.createAccount(exchangeAuthority)
    btcVaultLiquidationFund = await btcToken.createAccount(exchangeAuthority)

    xsolToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: exchangeAuthority,
      decimals: 9
    })
    const xsolFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 67,
      expo: -ORACLE_OFFSET
    })

    const xsolAsset = await exchange.addNewAssetInstruction({
      assetsList,
      assetFeedAddress: xsolFeed
    })
    await signAndSend(new Transaction().add(xsolAsset), [EXCHANGE_ADMIN], connection)

    const addXsolSynthetic = await exchange.addSyntheticInstruction({
      assetAddress: xsolToken.publicKey,
      assetsList,
      maxSupply: new BN(10).pow(new BN(18)),
      priceFeed: xsolFeed
    })
    await signAndSend(new Transaction().add(addXsolSynthetic), [EXCHANGE_ADMIN], connection)
  })
  describe('Prepare vault entry', async () => {
    before(async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      xsol = assetsListData.synthetics[1]
      btc = assetsListData.collaterals[1]
    })

    it('create btc/xsol vault', async () => {
      const debtInterestRate = fromPercentToInterestRate(7)
      const collateralRatio = percentToDecimal(65)
      const liquidationRatio = percentToDecimal(50)
      const liquidationThreshold = percentToDecimal(90)
      const liquidationPenaltyExchange = percentToDecimal(5)
      const liquidationPenaltyLiquidator = percentToDecimal(5)
      const maxBorrow = { val: new BN(10).pow(new BN(16)), scale: xsol.maxSupply.scale }
      const openFee = percentToDecimal(1)

      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: btcVaultReserve,
        collateral: btc.collateralAddress,
        liquidationFund: btcVaultLiquidationFund,
        collateralPriceFeed: btcPriceFeed,
        synthetic: xsol.assetAddress,
        debtInterestRate,
        collateralRatio,
        openFee,
        maxBorrow,
        liquidationPenaltyExchange,
        liquidationPenaltyLiquidator,
        liquidationThreshold,
        liquidationRatio
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
    })
    it('create btc/xsol vault entry', async () => {
      const { ix } = await exchange.createVaultEntryInstruction({
        owner: accountOwner.publicKey,
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)
    })
    it('should deposit btc collateral', async () => {
      userBtcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      btcUserCollateralAmount = new BN(10).pow(new BN(btc.reserveBalance.scale)).muln(2) // 2 BTC
      await btcToken.mintTo(userBtcTokenAccount, wallet, [], tou64(btcUserCollateralAmount))

      await exchange.vaultDeposit({
        amount: btcUserCollateralAmount,
        owner: accountOwner.publicKey,
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress,
        userCollateralAccount: userBtcTokenAccount,
        reserveAddress: btcVaultReserve,
        collateralToken: btcToken,
        signers: [accountOwner]
      })
    })
    it('should borrow xsol synthetic', async () => {
      userXsolTokenAccount = await xsolToken.createAccount(accountOwner.publicKey)
      xsolBorrowAmount = new BN(10).pow(new BN(xsol.supply.scale)).mul(new BN(831)) // 831 xsol

      await exchange.borrowVault({
        amount: xsolBorrowAmount,
        owner: accountOwner.publicKey,
        to: userXsolTokenAccount,
        collateral: btc.collateralAddress,
        collateralPriceFeed: btcPriceFeed,
        synthetic: xsol.assetAddress,
        signers: [accountOwner]
      })
    })
  })
  describe('accumulate debt interest', async () => {
    const adjustmentPeriod = 60

    it('should increase synthetic supply', async () => {
      const assetsListDataBefore = await exchange.getAssetsList(assetsList)
      const xsolBefore = assetsListDataBefore.synthetics[1]
      const vaultBefore = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xsol.assetAddress,
        btc.collateralAddress,
        accountOwner.publicKey
      )

      await skipTimestamps(adjustmentPeriod, connection)

      const triggerIx = await exchange.triggerVaultEntryDebtAdjustmentInstruction({
        owner: accountOwner.publicKey,
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress
      })
      await signAndSend(new Transaction().add(triggerIx), [EXCHANGE_ADMIN], connection)

      // supply before adjustment
      // 831 XSOL

      // new supply
      // real     831.0001106735... XSOL
      // expected 831.000110674 XSOL

      // accumulatedInterestRate
      // real     1.0000001331811263318...
      // expected 1.000000133181126331

      const expectedSupplyIncrease = toDecimal(new BN(110674), xsolBefore.supply.scale)
      const expectedNewSupply = toDecimal(
        xsolBorrowAmount.add(expectedSupplyIncrease.val),
        xsolBefore.supply.scale
      )
      const expectedAccumulatedInterestRate = toDecimal(
        new BN(10).pow(new BN(18)).add(new BN(133181126331)),
        INTEREST_RATE_DECIMALS
      )

      const assetsListDataAfter = await exchange.getAssetsList(assetsList)
      const xsolAfter = assetsListDataAfter.synthetics[1]
      const vaultAfter = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xsol.assetAddress,
        btc.collateralAddress,
        accountOwner.publicKey
      )

      // check vault
      assert.ok(eqDecimals(vaultAfter.mintAmount, expectedNewSupply))
      assert.ok(vaultAfter.lastUpdate.eq(vaultBefore.lastUpdate.addn(adjustmentPeriod)))
      assert.ok(eqDecimals(vaultAfter.accumulatedInterest, expectedSupplyIncrease))
      assert.ok(eqDecimals(vaultAfter.accumulatedInterestRate, expectedAccumulatedInterestRate))
      assert.ok(
        eqDecimals(vaultBefore.accumulatedInterest, toDecimal(new BN(0), xsolAfter.supply.scale))
      )
      assert.ok(eqDecimals(vaultBefore.accumulatedInterestRate, fromPercentToInterestRate(100)))

      // check vault entry
      assert.ok(
        eqDecimals(vaultEntryAfter.lastAccumulatedInterestRate, expectedAccumulatedInterestRate)
      )
      assert.ok(eqDecimals(vaultEntryAfter.syntheticAmount, expectedNewSupply))
      assert.ok(vaultEntryBefore.syntheticAmount.val.eq(xsolBorrowAmount))

      // check synthetic supply
      assert.ok(xsolBefore.supply.val.eq(xsolBorrowAmount))
      assert.ok(xsolBefore.borrowedSupply.val.eq(xsolBorrowAmount))
      assert.ok(eqDecimals(xsolAfter.supply, expectedNewSupply))
      assert.ok(eqDecimals(xsolAfter.borrowedSupply, expectedNewSupply))
    })
  })
  describe('Withdraw accumulated debt interest from vault', async () => {
    const firstWithdrawAmount = new BN(5_000)
    let adminXsolTokenAccount

    before(async () => {
      adminXsolTokenAccount = await xsolToken.createAccount(EXCHANGE_ADMIN.publicKey)
    })
    it('should fail without admin signature', async () => {
      const ix = await exchange.withdrawVaultAccumulatedInterestInstruction({
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress,
        to: adminXsolTokenAccount,
        amount: firstWithdrawAmount
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('withdraw over limit should fail', async () => {
      const vault = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const overLimit = vault.accumulatedInterest.val.add(new BN(1))

      const ix = await exchange.withdrawVaultAccumulatedInterestInstruction({
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress,
        to: adminXsolTokenAccount,
        amount: overLimit
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.INSUFFICIENT_AMOUNT_ADMIN_WITHDRAW
      )
    })
    it('should withdraw some accumulated interest from vault', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xsolBefore = assetsListData.synthetics[1]

      const vaultBefore = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)

      const ix = await exchange.withdrawVaultAccumulatedInterestInstruction({
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress,
        to: adminXsolTokenAccount,
        amount: firstWithdrawAmount
      })

      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const xsolAdminAccountInfo = await xsolToken.getAccountInfo(adminXsolTokenAccount)
      const xsolAfter = assetsListData.synthetics[1]
      const expectedVaultAccumulatedInterestAfter = toDecimal(
        vaultBefore.accumulatedInterest.val.sub(firstWithdrawAmount),
        vaultBefore.accumulatedInterest.scale
      )

      // check vault accumulated interest
      assert.ok(eqDecimals(vaultAfter.accumulatedInterest, expectedVaultAccumulatedInterestAfter))

      // check admin balance
      assert.ok(xsolAdminAccountInfo.amount.eq(firstWithdrawAmount))

      // supply should not change
      assert.ok(eqDecimals(vaultAfter.mintAmount, vaultBefore.mintAmount))
      assert.ok(eqDecimals(xsolBefore.supply, xsolAfter.supply))
      assert.ok(eqDecimals(xsolBefore.borrowedSupply, xsolAfter.borrowedSupply))
    })
    it('should withdraw rest of accumulated interest from vault', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xsolBefore = assetsListData.synthetics[1]

      const vaultBefore = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const xsolAdminAccountInfoBefore = await xsolToken.getAccountInfo(adminXsolTokenAccount)
      const toWithdraw = new BN('ffffffffffffffff', 16)

      const ix = await exchange.withdrawVaultAccumulatedInterestInstruction({
        collateral: btc.collateralAddress,
        synthetic: xsol.assetAddress,
        to: adminXsolTokenAccount,
        amount: toWithdraw
      })

      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(xsol.assetAddress, btc.collateralAddress)
      const xsolAdminAccountInfoAfter = await xsolToken.getAccountInfo(adminXsolTokenAccount)
      const xsolAfter = assetsListData.synthetics[1]
      const expectedAdminBalance = xsolAdminAccountInfoBefore.amount.add(
        vaultBefore.accumulatedInterest.val
      )
      const expectedVaultAccumulatedInterestAfter = toDecimal(
        new BN(0),
        vaultBefore.accumulatedInterest.scale
      )

      // check vault accumulated interest
      assert.ok(eqDecimals(vaultAfter.accumulatedInterest, expectedVaultAccumulatedInterestAfter))

      // check admin balance
      assert.ok(xsolAdminAccountInfoAfter.amount.eq(expectedAdminBalance))

      // supply should not change
      assert.ok(eqDecimals(vaultAfter.mintAmount, vaultBefore.mintAmount))
      assert.ok(eqDecimals(xsolBefore.supply, xsolAfter.supply))
      assert.ok(eqDecimals(xsolBefore.borrowedSupply, xsolAfter.borrowedSupply))
    })
  })
})
