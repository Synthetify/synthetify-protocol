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
  almostEqual
} from './utils'
import { createPriceFeed, getFeedData, setFeedTrading } from './oracleUtils'
import {
  decimalToPercent,
  ERRORS,
  percentToDecimal,
  SNY_DECIMALS,
  toDecimal,
  toScale,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import {
  ERRORS_EXCHANGE,
  fromPercentToInterestRate,
  toEffectiveFee
} from '@synthetify/sdk/src/utils'
import { Collateral, PriceStatus, Synthetic } from '../sdk/lib/exchange'
import { Decimal, OracleType } from '@synthetify/sdk/src/exchange'

describe('ADMIN VAULTS', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program
  //@ts-ignore
  const wallet = provider.wallet.payer as Account

  let snyToken: Token
  let xusdToken: Token
  let assetsList: PublicKey
  let snyTokenFeed: PublicKey
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let usdcToken: Token
  let usdcPriceFeed: PublicKey
  let usdcVaultReserve: PublicKey
  let usdcVaultLiquidationFund: PublicKey
  let syntheticAddress: PublicKey
  let collateralAddress: PublicKey
  const accountOwner = Keypair.generate()
  const vaultType = 0

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
    xusdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    await exchange.getState()

    // create USDC collateral token
    const { feed, token } = await createCollateralToken({
      collateralRatio: 50,
      connection,
      decimals: 6,
      exchange,
      exchangeAuthority,
      oracleProgram,
      price: 1,
      wallet
    })
    usdcPriceFeed = feed
    usdcToken = token
    usdcVaultReserve = await usdcToken.createAccount(exchangeAuthority)
    usdcVaultLiquidationFund = await usdcToken.createAccount(exchangeAuthority)

    const assetsListData = await exchange.getAssetsList(assetsList)
    syntheticAddress = assetsListData.synthetics[0].assetAddress
    collateralAddress = assetsListData.collaterals[1].collateralAddress
  })
  describe('#createVault', async () => {
    let assetsListData
    let xusd: Synthetic
    let usdc: Collateral
    let openFee: Decimal
    let debtInterestRate: Decimal
    let collateralRatio: Decimal
    let liquidationRatio: Decimal
    let liquidationThreshold: Decimal
    let liquidationPenaltyExchange: Decimal
    let liquidationPenaltyLiquidator: Decimal
    let maxBorrow: Decimal
    let createVaultIx: TransactionInstruction
    before(async () => {
      assetsListData = await exchange.getAssetsList(assetsList)
      xusd = assetsListData.synthetics[0]
      usdc = assetsListData.collaterals[1]
      openFee = percentToDecimal(1)
      debtInterestRate = fromPercentToInterestRate(7)
      collateralRatio = percentToDecimal(80)
      liquidationRatio = percentToDecimal(50)
      liquidationThreshold = percentToDecimal(90)
      liquidationPenaltyExchange = percentToDecimal(5)
      liquidationPenaltyLiquidator = percentToDecimal(5)
      maxBorrow = toDecimal(new BN(1_000_000_000), xusd.maxSupply.scale)
      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: usdcVaultReserve,
        collateral: usdc.collateralAddress,
        liquidationFund: usdcVaultLiquidationFund,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusd.assetAddress,
        openFee,
        debtInterestRate,
        collateralRatio,
        maxBorrow,
        liquidationPenaltyExchange,
        liquidationPenaltyLiquidator,
        liquidationThreshold,
        liquidationRatio,
        oracleType: OracleType.Pyth,
        vaultType
      })
      createVaultIx = ix
    })

    it('create usdc/xusd vault should failed due to admin signature', async () => {
      await assertThrowsAsync(
        signAndSend(new Transaction().add(createVaultIx), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should create usdc/xusd vault', async () => {
      const timestamp = (await connection.getBlockTime(await connection.getSlot())) as number
      await signAndSend(new Transaction().add(createVaultIx), [EXCHANGE_ADMIN], connection)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )

      assert.ok(eqDecimals(vault.collateralAmount, toDecimal(new BN(0), usdc.reserveBalance.scale)))
      assert.ok(vault.synthetic.equals(xusd.assetAddress))
      assert.ok(vault.collateral.equals(usdc.collateralAddress))
      assert.ok(vault.collateralReserve.equals(usdcVaultReserve))
      assert.ok(eqDecimals(vault.collateralRatio, collateralRatio))
      assert.ok(eqDecimals(vault.debtInterestRate, debtInterestRate))
      assert.ok(eqDecimals(vault.liquidationRatio, liquidationRatio))
      assert.ok(eqDecimals(vault.liquidationThreshold, liquidationThreshold))
      assert.ok(eqDecimals(vault.liquidationPenaltyExchange, liquidationPenaltyExchange))
      assert.ok(eqDecimals(vault.liquidationPenaltyLiquidator, liquidationPenaltyLiquidator))
      assert.ok(eqDecimals(vault.accumulatedInterest, toDecimal(new BN(0), XUSD_DECIMALS)))
      assert.ok(eqDecimals(vault.accumulatedInterestRate, fromPercentToInterestRate(100)))
      assert.ok(eqDecimals(vault.mintAmount, toDecimal(new BN(0), XUSD_DECIMALS)))
      assert.ok(eqDecimals(vault.maxBorrow, maxBorrow))
      assert.ok(almostEqual(vault.lastUpdate, new BN(timestamp), new BN(5)))
    })
  })
  describe('#triggerVaultEntryDebtAdjustmentInstruction', async () => {
    before(async () => {
      const { ix } = await exchange.createVaultEntryInstruction({
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        owner: accountOwner.publicKey,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)
    })
    it('should failed without admin signature', async () => {
      const ix = await exchange.triggerVaultEntryDebtAdjustmentInstruction({
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        owner: accountOwner.publicKey,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [accountOwner], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should trigger vault entry', async () => {
      const ix = await exchange.triggerVaultEntryDebtAdjustmentInstruction({
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        owner: accountOwner.publicKey,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
    })
  })
  describe('#setVaultHalted', async () => {
    it('should failed without admin signature', async () => {
      const ix = await exchange.setVaultHaltedInstruction({
        halted: true,
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
    })
    it('should set vault halted', async () => {
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )

      const ix = await exchange.setVaultHaltedInstruction({
        halted: true,
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.halted, vaultBefore.halted)
      assert.equal(vaultAfter.halted, true)
    })
  })
  describe('#setVaultDebtInterestRate', async () => {
    it('should failed without admin signature', async () => {
      const debtInterestRate = fromPercentToInterestRate(30)

      const ix = await exchange.setVaultDebtInterestRateInstruction(debtInterestRate, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should set vault debt interest rate', async () => {
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      const debtInterestRate = fromPercentToInterestRate(30)

      const ix = await exchange.setVaultDebtInterestRateInstruction(debtInterestRate, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.debtInterestRate, vaultBefore.debtInterestRate)
      assert.ok(eqDecimals(vaultAfter.debtInterestRate, debtInterestRate))
    })
    it('should fail cause out of range parameter', async () => {
      const debtInterestRate = fromPercentToInterestRate(201)

      const ix = await exchange.setVaultDebtInterestRateInstruction(debtInterestRate, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
  })
  describe('#setVaultLiquidationThreshold', async () => {
    it('should failed without admin signature', async () => {
      const liquidationThreshold = percentToDecimal(70)

      const ix = await exchange.setVaultLiquidationThresholdInstruction(liquidationThreshold, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail cause out of range parameter', async () => {
      const liquidationThreshold = percentToDecimal(101)

      const ix = await exchange.setVaultLiquidationThresholdInstruction(liquidationThreshold, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should fail cause liquidation threshold is smaller than collateral ratio ', async () => {
      const liquidationThreshold = percentToDecimal(10)

      const ix = await exchange.setVaultLiquidationThresholdInstruction(liquidationThreshold, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should set vault liquidation threshold', async () => {
      const liquidationThreshold = percentToDecimal(85)
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      const ix = await exchange.setVaultLiquidationThresholdInstruction(liquidationThreshold, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.liquidationThreshold, vaultBefore.liquidationThreshold)
      assert.ok(eqDecimals(vaultAfter.liquidationThreshold, liquidationThreshold))
    })
  })
  describe('#setVaultSetLiquidationRatio', async () => {
    it('should failed without admin signature', async () => {
      const liquidationRatio = percentToDecimal(25)

      const ix = await exchange.setVaultSetLiquidationRatioInstruction(liquidationRatio, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail cause out of range parameter', async () => {
      const liquidationRatio = percentToDecimal(101)

      const ix = await exchange.setVaultSetLiquidationRatioInstruction(liquidationRatio, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should set vault liquidation ratio', async () => {
      const liquidationRatio = percentToDecimal(25)
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )

      const ix = await exchange.setVaultSetLiquidationRatioInstruction(liquidationRatio, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.liquidationRatio, vaultBefore.liquidationRatio)
      assert.ok(eqDecimals(vaultAfter.liquidationRatio, liquidationRatio))
    })
  })
  describe('#setVaultLiquidationPenaltyLiquidator', async () => {
    it('should failed without admin signature', async () => {
      const liquidationPenaltyLiquidator = percentToDecimal(15)

      const ix = await exchange.setVaultLiquidationPenaltyLiquidatorInstruction(
        liquidationPenaltyLiquidator,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail cause out of range parameter', async () => {
      const liquidationPenaltyLiquidator = percentToDecimal(21)

      const ix = await exchange.setVaultLiquidationPenaltyLiquidatorInstruction(
        liquidationPenaltyLiquidator,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should set vault liquidation penalty liquidator', async () => {
      const liquidationPenaltyLiquidator = percentToDecimal(15)
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )

      const ix = await exchange.setVaultLiquidationPenaltyLiquidatorInstruction(
        liquidationPenaltyLiquidator,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(
        vaultAfter.liquidationPenaltyLiquidator,
        vaultBefore.liquidationPenaltyLiquidator
      )
      assert.ok(eqDecimals(vaultAfter.liquidationPenaltyLiquidator, liquidationPenaltyLiquidator))
    })
  })
  describe('#setVaultLiquidationPenaltyExchange', async () => {
    it('should failed without admin signature', async () => {
      const liquidationPenaltyExchange = percentToDecimal(15)

      const ix = await exchange.setVaultLiquidationPenaltyLiquidatorInstruction(
        liquidationPenaltyExchange,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail cause out of range parameter', async () => {
      const liquidationPenaltyExchange = percentToDecimal(21)

      const ix = await exchange.setVaultLiquidationPenaltyLiquidatorInstruction(
        liquidationPenaltyExchange,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should set vault liquidation penalty exchange', async () => {
      const liquidationPenaltyExchange = percentToDecimal(15)
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )

      const ix = await exchange.setVaultLiquidationPenaltyExchangeInstruction(
        liquidationPenaltyExchange,
        {
          collateral: collateralAddress,
          synthetic: syntheticAddress,
          vaultType
        }
      )
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.liquidationPenaltyExchange, vaultBefore.liquidationPenaltyExchange)
      assert.ok(eqDecimals(vaultAfter.liquidationPenaltyExchange, liquidationPenaltyExchange))
    })
  })
  describe('#setVaultMaxBorrow', async () => {
    it('should failed without admin signature', async () => {
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      const maxBorrow = toDecimal(new BN(1e9), vaultBefore.maxBorrow.scale)

      const ix = await exchange.setVaultMaxBorrowInstruction(maxBorrow, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail cause invalid max borrow scale', async () => {
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      const maxBorrow = toDecimal(new BN(1e9), vaultBefore.maxBorrow.scale - 1)

      const ix = await exchange.setVaultMaxBorrowInstruction(maxBorrow, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
    it('should set vault max borrow', async () => {
      const vaultBefore = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      const maxBorrow = toDecimal(new BN(1e9), vaultBefore.maxBorrow.scale)

      const ix = await exchange.setVaultMaxBorrowInstruction(maxBorrow, {
        collateral: collateralAddress,
        synthetic: syntheticAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const vaultAfter = await exchange.getVaultForPair(
        syntheticAddress,
        collateralAddress,
        vaultType
      )
      assert.notEqual(vaultAfter.maxBorrow, vaultBefore.maxBorrow)
      assert.ok(eqDecimals(vaultAfter.maxBorrow, maxBorrow))
    })
  })
})
