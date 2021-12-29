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
  mulUpByUnifiedPercentage
} from './utils'
import { createPriceFeed, getFeedData, setFeedTrading } from './oracleUtils'
import {
  decimalToPercent,
  ERRORS,
  INTEREST_RATE_DECIMALS,
  percentToDecimal,
  SNY_DECIMALS,
  toDecimal,
  toScale,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { Asset, AssetsList, Collateral, PriceStatus, Synthetic } from '../sdk/lib/exchange'
import { Decimal, OracleType } from '@synthetify/sdk/src/exchange'

describe('vaults', () => {
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
  let usdcPriceFeed: PublicKey
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let usdcToken: Token
  let usdcVaultReserve: PublicKey
  let usdcVaultLiquidationFund: PublicKey
  let userUsdcTokenAccount: PublicKey
  let userXusdTokenAccount: PublicKey
  let allUserCollateralAmount: BN
  let borrowAmount: BN
  let maxBorrow: Decimal
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
    const xusd = assetsListData.synthetics[0]
    maxBorrow = { val: new BN(1_000_000_000), scale: xusd.maxSupply.scale }
  })
  describe('#createVault', async () => {
    let assetsListData: AssetsList
    let xusd: Synthetic
    let usdc: Collateral
    let debtInterestRate: Decimal
    let openFee: Decimal
    let collateralRatio: Decimal
    let liquidationRatio: Decimal
    let liquidationThreshold: Decimal
    let liquidationPenaltyExchange: Decimal
    let liquidationPenaltyLiquidator: Decimal
    let createVaultIx: TransactionInstruction
    before(async () => {
      assetsListData = await exchange.getAssetsList(assetsList)
      xusd = assetsListData.synthetics[0]
      usdc = assetsListData.collaterals[1]
      openFee = percentToDecimal(1)
      debtInterestRate = toScale(percentToDecimal(7), INTEREST_RATE_DECIMALS)
      collateralRatio = percentToDecimal(80)
      liquidationRatio = percentToDecimal(50)
      liquidationThreshold = percentToDecimal(90)
      liquidationPenaltyExchange = percentToDecimal(5)
      liquidationPenaltyLiquidator = percentToDecimal(5)
      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: usdcVaultReserve,
        collateral: usdc.collateralAddress,
        collateralPriceFeed: usdcPriceFeed,
        liquidationFund: usdcVaultLiquidationFund,
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
      assert.ok(
        eqDecimals(
          vault.accumulatedInterestRate,
          toScale(percentToDecimal(100), INTEREST_RATE_DECIMALS)
        )
      )
      assert.ok(eqDecimals(vault.mintAmount, toDecimal(new BN(0), XUSD_DECIMALS)))
      assert.ok(eqDecimals(vault.maxBorrow, maxBorrow))
      assert.ok(almostEqual(vault.lastUpdate, new BN(timestamp), new BN(5)))
      assert.ok(vault.oracleType === OracleType.Pyth)
    })
    it('create usdc/xusd vault should fail cause there can only be one vault per synthetic/collateral pair', async () => {
      await assertThrowsAsync(
        signAndSend(new Transaction().add(createVaultIx), [EXCHANGE_ADMIN], connection)
      )
    })
  })
  describe('#createVaultEntry', async () => {
    it('should create vault entry on usdc/xusd vault', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const { ix } = await exchange.createVaultEntryInstruction({
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)

      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const { vaultAddress } = await exchange.getVaultAddress(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      assert.ok(vaultEntry.owner.equals(accountOwner.publicKey))
      assert.ok(vaultEntry.vault.equals(vaultAddress))
      assert.ok(eqDecimals(vaultEntry.syntheticAmount, toDecimal(new BN(0), xusd.maxSupply.scale)))
      assert.ok(
        eqDecimals(vaultEntry.collateralAmount, toDecimal(new BN(0), usdc.reserveBalance.scale))
      )
      assert.ok(
        eqDecimals(
          vaultEntry.lastAccumulatedInterestRate,
          toScale(percentToDecimal(100), INTEREST_RATE_DECIMALS)
        )
      )
    })
    it('create usdc/xusd vault entry should fail cause there can only be one vault entry per user', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const { ix } = await exchange.createVaultEntryInstruction({
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [accountOwner], connection))
    })
  })
  describe('#depositVault', async () => {
    it('should perform 1st deposit to usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      userUsdcTokenAccount = await usdcToken.createAccount(accountOwner.publicKey)
      allUserCollateralAmount = new BN(10).pow(new BN(usdc.reserveBalance.scale)).muln(100) // mint 100 USD
      await usdcToken.mintTo(userUsdcTokenAccount, wallet, [], tou64(allUserCollateralAmount))

      const userUsdcTokenAccountInfo = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const usdcVaultReserveTokenAccountInfo = await usdcToken.getAccountInfo(usdcVaultReserve)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )

      const expectedCollateralAmount = toDecimal(new BN(0), usdc.reserveBalance.scale)

      // balances before deposit
      assert.ok(userUsdcTokenAccountInfo.amount.eq(allUserCollateralAmount))
      assert.ok(usdcVaultReserveTokenAccountInfo.amount.eq(new BN(0)))

      // vault collateral should be empty
      assert.ok(eqDecimals(vault.collateralAmount, expectedCollateralAmount))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, expectedCollateralAmount))

      await exchange.vaultDeposit({
        amount: allUserCollateralAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        reserveAddress: usdcVaultReserve,
        collateralToken: usdcToken,
        signers: [accountOwner],
        vaultType
      })

      const userUsdcTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        userUsdcTokenAccount
      )
      const usdcVaultReserveTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        usdcVaultReserve
      )
      const vaultAfterDeposit = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfterDeposit = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const expectedCollateralAmountAfterDeposit = toDecimal(
        allUserCollateralAmount,
        usdc.reserveBalance.scale
      )

      // change balances after deposit
      assert.ok(userUsdcTokenAccountInfoAfterDeposit.amount.eq(new BN(0)))
      assert.ok(usdcVaultReserveTokenAccountInfoAfterDeposit.amount.eq(allUserCollateralAmount))

      // vault and vault entry collateral
      assert.ok(
        eqDecimals(vaultAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
      assert.ok(
        eqDecimals(vaultEntryAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
    })
    it('should perform 2st deposit to usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      userUsdcTokenAccount = await usdcToken.createAccount(accountOwner.publicKey)
      const depositAmount = new BN(10).pow(new BN(usdc.reserveBalance.scale)).muln(50) // mint 50 USD
      await usdcToken.mintTo(userUsdcTokenAccount, wallet, [], tou64(depositAmount))

      const userUsdcTokenAccountInfo = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const usdcVaultReserveTokenAccountInfo = await usdcToken.getAccountInfo(usdcVaultReserve)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const expectedCollateralAmount = toDecimal(allUserCollateralAmount, usdc.reserveBalance.scale)

      // balances before deposit
      assert.ok(userUsdcTokenAccountInfo.amount.eq(depositAmount))
      assert.ok(usdcVaultReserveTokenAccountInfo.amount.eq(allUserCollateralAmount))

      // vault and vault entry before deposit
      assert.ok(eqDecimals(vault.collateralAmount, expectedCollateralAmount))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, expectedCollateralAmount))

      await exchange.vaultDeposit({
        amount: depositAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        reserveAddress: usdcVaultReserve,
        collateralToken: usdcToken,
        signers: [accountOwner],
        vaultType
      })

      allUserCollateralAmount = allUserCollateralAmount.add(depositAmount)
      const userUsdcTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        userUsdcTokenAccount
      )
      const usdcVaultReserveTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        usdcVaultReserve
      )
      const vaultAfterDeposit = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfterDeposit = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const expectedVaultDecimal = toDecimal(allUserCollateralAmount, vault.collateralAmount.scale)

      // change balances
      assert.ok(userUsdcTokenAccountInfoAfterDeposit.amount.eq(new BN(0)))
      assert.ok(usdcVaultReserveTokenAccountInfoAfterDeposit.amount.eq(allUserCollateralAmount))

      // vault and vault entry collateral
      assert.ok(eqDecimals(vaultAfterDeposit.collateralAmount, expectedVaultDecimal))
      assert.ok(eqDecimals(vaultEntryAfterDeposit.collateralAmount, expectedVaultDecimal))
    })
  })
  describe('#borrowVault', async () => {
    before(async () => {
      userXusdTokenAccount = await xusdToken.createAccount(accountOwner.publicKey)
    })
    it('borrow over user limit should failed', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      await assertThrowsAsync(
        exchange.borrowVault({
          amount: allUserCollateralAmount.addn(1),
          owner: accountOwner.publicKey,
          to: userXusdTokenAccount,
          collateral: usdc.collateralAddress,
          collateralPriceFeed: usdcPriceFeed,
          synthetic: xusd.assetAddress,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.USER_BORROW_LIMIT
      )
    })
    it('should borrow xusd from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const borrowAmountBeforeBorrow = toDecimal(new BN(0), xusd.supply.scale)

      // vault before borrow
      assert.ok(eqDecimals(vault.mintAmount, borrowAmountBeforeBorrow))
      // vault entry before borrow
      assert.ok(eqDecimals(vaultEntry.syntheticAmount, borrowAmountBeforeBorrow))
      // synthetic supply before borrow
      assert.ok(eqDecimals(xusd.supply, borrowAmountBeforeBorrow))
      assert.ok(eqDecimals(xusd.borrowedSupply, borrowAmountBeforeBorrow))

      borrowAmount = allUserCollateralAmount.muln(
        (decimalToPercent(vault.collateralRatio) - 20) / 100
      )

      await exchange.borrowVault({
        amount: borrowAmount,
        owner: accountOwner.publicKey,
        to: userXusdTokenAccount,
        collateral: usdc.collateralAddress,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusd.assetAddress,
        signers: [accountOwner],
        vaultType
      })
      borrowAmount = borrowAmount.add(mulUpByUnifiedPercentage(borrowAmount, vault.openFee))

      const vaultAfterBorrow = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfterBorrow = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const xusdAfterBorrow = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const expectedBorrowAmount = toDecimal(borrowAmount, xusd.supply.scale)

      // vault after borrow
      assert.ok(eqDecimals(vaultAfterBorrow.mintAmount, expectedBorrowAmount))
      // vault entry after borrow
      assert.ok(eqDecimals(vaultEntryAfterBorrow.syntheticAmount, expectedBorrowAmount))
      // synthetic supply after borrow
      assert.ok(eqDecimals(xusdAfterBorrow.supply, expectedBorrowAmount))
      assert.ok(eqDecimals(xusdAfterBorrow.borrowedSupply, expectedBorrowAmount))
    })
    it('borrow over vault limit should failed', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )

      const changeVaultBorrowLimitIx = await exchange.setVaultMaxBorrowInstruction(
        toDecimal(new BN(1e2), vault.maxBorrow.scale),
        {
          collateral: usdc.collateralAddress,
          synthetic: xusd.assetAddress,
          vaultType
        }
      )
      await signAndSend(
        new Transaction().add(changeVaultBorrowLimitIx),
        [EXCHANGE_ADMIN],
        connection
      )

      await assertThrowsAsync(
        exchange.borrowVault({
          amount: new BN(1),
          owner: accountOwner.publicKey,
          to: userXusdTokenAccount,
          collateral: usdc.collateralAddress,
          collateralPriceFeed: usdcPriceFeed,
          synthetic: xusd.assetAddress,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.VAULT_BORROW_LIMIT
      )

      // clean after test - return to previous max borrow
      const cleanUpTx = await exchange.setVaultMaxBorrowInstruction(maxBorrow, {
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(cleanUpTx), [EXCHANGE_ADMIN], connection)
    })
  })
  describe('#withdrawVault', async () => {
    // withdraw without updating oracle price is impossible, because synthetic (xusd) has a fixed price
    it('withdraw over limit should failed', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const withdrawAmount = allUserCollateralAmount.addn(1)

      const userUsdcTokenAccountInfoBefore = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const usdcVaultReserveTokenAccountInfoBefore = await usdcToken.getAccountInfo(
        usdcVaultReserve
      )
      const vaultBefore = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )

      const withdrawIx = await exchange.withdrawVaultInstruction({
        amount: withdrawAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        reserveAddress: usdcVaultReserve,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        vaultType
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(withdrawIx), [accountOwner], connection),
        ERRORS_EXCHANGE.VAULT_WITHDRAW_LIMIT
      )
      const userUsdcTokenAccountInfoAfter = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const usdcVaultReserveTokenAccountInfoAfter = await usdcToken.getAccountInfo(usdcVaultReserve)
      const vaultAfter = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      assert.ok(userUsdcTokenAccountInfoBefore.amount.eq(userUsdcTokenAccountInfoAfter.amount))
      assert.ok(
        usdcVaultReserveTokenAccountInfoBefore.amount.eq(
          usdcVaultReserveTokenAccountInfoAfter.amount
        )
      )
      assert.ok(eqDecimals(vaultBefore.collateralAmount, vaultAfter.collateralAmount))
      assert.ok(eqDecimals(vaultEntryBefore.collateralAmount, vaultEntryAfter.collateralAmount))
    })
    it('should withdraw usdc from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vaultBeforeWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryBeforeWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const toWithdraw = new BN(1e6).muln(10)
      const userUsdcTokenAccountBeforeWithdraw = await usdcToken.getAccountInfo(
        userUsdcTokenAccount
      )

      const withdrawIx = await exchange.withdrawVaultInstruction({
        amount: toWithdraw,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        reserveAddress: usdcVaultReserve,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        vaultType
      })
      await signAndSend(new Transaction().add(withdrawIx), [accountOwner], connection)

      const vaultAfterWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfterWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const userUsdcTokenAccountAfterWithdraw = await usdcToken.getAccountInfo(userUsdcTokenAccount)

      assert.ok(
        toWithdraw.eq(
          userUsdcTokenAccountAfterWithdraw.amount.sub(userUsdcTokenAccountBeforeWithdraw.amount)
        )
      )
      assert.ok(
        toWithdraw.eq(
          vaultBeforeWithdraw.collateralAmount.val.sub(vaultAfterWithdraw.collateralAmount.val)
        )
      )
      assert.ok(
        toWithdraw.eq(
          vaultEntryBeforeWithdraw.collateralAmount.val.sub(
            vaultEntryAfterWithdraw.collateralAmount.val
          )
        )
      )
    })
    it('should withdraw rest of collateral', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]
      const withdrawAmount = new BN('ffffffffffffffff', 16)

      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const vaultBefore = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const userUsdcTokenAccountBefore = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const vaultUsdcTokenAccountBefore = await usdcToken.getAccountInfo(usdcVaultReserve)

      const withdrawIx = await exchange.withdrawVaultInstruction({
        amount: withdrawAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        reserveAddress: usdcVaultReserve,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        vaultType
      })
      await signAndSend(new Transaction().add(withdrawIx), [accountOwner], connection)

      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const vaultAfter = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const userUsdcTokenAccountAfter = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const vaultUsdcTokenAccountAfter = await usdcToken.getAccountInfo(usdcVaultReserve)

      const minCollateralized = vaultEntryAfter.syntheticAmount.val.divn(
        decimalToPercent(vaultAfter.collateralRatio) / 100
      )
      const expectedWithdraw = vaultEntryBefore.collateralAmount.val.sub(minCollateralized)

      // collateral amount should be equals min collateralized
      assert.ok(minCollateralized.eq(vaultAfter.collateralAmount.val))
      assert.ok(minCollateralized.eq(vaultEntryAfter.collateralAmount.val))

      // expected withdraw amount
      assert.ok(
        expectedWithdraw.eq(vaultBefore.collateralAmount.val.sub(vaultAfter.collateralAmount.val))
      )
      assert.ok(
        expectedWithdraw.eq(
          vaultEntryBefore.collateralAmount.val.sub(vaultEntryAfter.collateralAmount.val)
        )
      )

      // check transfer between accounts
      assert.ok(
        expectedWithdraw.eq(userUsdcTokenAccountAfter.amount.sub(userUsdcTokenAccountBefore.amount))
      )
      assert.ok(
        expectedWithdraw.eq(
          vaultUsdcTokenAccountBefore.amount.sub(vaultUsdcTokenAccountAfter.amount)
        )
      )
    })
  })
  describe('#repayVault', async () => {
    it('should repay xusd from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBefore = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vaultBeforeRepay = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryBeforeRepay = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountBeforeRepay = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const repayAmount = vaultEntryBeforeRepay.syntheticAmount.val.divn(2)

      await exchange.repayVault({
        amount: repayAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusdBefore.assetAddress,
        userTokenAccountRepay: userXusdTokenAccount,
        signers: [accountOwner],
        vaultType
      })

      const xusdAfter = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const vaultAfterRepay = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfterRepay = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountAfterRepay = await xusdToken.getAccountInfo(userXusdTokenAccount)

      // check account balance
      assert.ok(
        repayAmount.eq(
          userXusdTokenAccountBeforeRepay.amount.sub(userXusdTokenAccountAfterRepay.amount)
        )
      )
      // check vault
      assert.ok(repayAmount.eq(vaultBeforeRepay.mintAmount.val.sub(vaultAfterRepay.mintAmount.val)))
      // check vault entry
      assert.ok(
        repayAmount.eq(
          vaultEntryBeforeRepay.syntheticAmount.val.sub(vaultEntryAfterRepay.syntheticAmount.val)
        )
      )
      // check synthetic supply
      assert.ok(repayAmount.eq(xusdBefore.supply.val.sub(xusdAfter.supply.val)))
      // check synthetic borrowed supply
      assert.ok(repayAmount.eq(xusdBefore.borrowedSupply.val.sub(xusdAfter.borrowedSupply.val)))
    })
    it('repay over limit should repay rest of borrowed synthetic', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBefore = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      // CREATE ACCOUNT THAT WILL SEND SYNTHETIC NEEDED TO REPAY VAULT
      {
        const repayingAccount = Keypair.generate()
        const repayingUsdcTokenAccount = await usdcToken.createAccount(repayingAccount.publicKey)
        const repayingCollateralAmount = new BN(1000 * 10 ** 6) // 1000 USDC

        await Promise.all([
          connection.requestAirdrop(repayingAccount.publicKey, 10e9),
          usdcToken.createAccount(repayingAccount.publicKey)
        ])

        await usdcToken.mintTo(
          repayingUsdcTokenAccount,
          wallet,
          [],
          tou64(repayingCollateralAmount)
        )

        const { ix: createVaultEntryIx } = await exchange.createVaultEntryInstruction({
          owner: repayingAccount.publicKey,
          collateral: usdc.collateralAddress,
          synthetic: xusdBefore.assetAddress,
          vaultType
        })
        await signAndSend(new Transaction().add(createVaultEntryIx), [repayingAccount], connection)

        await exchange.vaultDeposit({
          amount: repayingCollateralAmount,
          owner: repayingAccount.publicKey,
          collateral: usdc.collateralAddress,
          synthetic: xusdBefore.assetAddress,
          userCollateralAccount: repayingUsdcTokenAccount,
          reserveAddress: usdcVaultReserve,
          collateralToken: usdcToken,
          signers: [repayingAccount],
          vaultType
        })

        await exchange.borrowVault({
          amount: new BN(100 * 10 ** 6), // 100 USDC,
          owner: repayingAccount.publicKey,
          to: userXusdTokenAccount,
          collateral: usdc.collateralAddress,
          collateralPriceFeed: usdcPriceFeed,
          synthetic: xusdBefore.assetAddress,
          signers: [repayingAccount],
          vaultType
        })
      }

      const vaultBefore = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountBefore = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const maxRepayAmount = vaultEntryBefore.syntheticAmount.val

      await exchange.repayVault({
        amount: maxRepayAmount.addn(1),
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusdBefore.assetAddress,
        userTokenAccountRepay: userXusdTokenAccount,
        signers: [accountOwner],
        vaultType
      })

      const xusdAfter = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const vaultAfter = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        vaultType
      )
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountAfter = await xusdToken.getAccountInfo(userXusdTokenAccount)

      const expectedUserSyntheticSupply = userXusdTokenAccountBefore.amount.sub(maxRepayAmount)
      const expectedUserBorrowedSupply = toDecimal(new BN(0), xusdBefore.supply.scale)
      const expectedGlobalBorrowedSupply = toDecimal(
        vaultBefore.mintAmount.val.sub(maxRepayAmount),
        xusdBefore.supply.scale
      )

      assert.ok(eqDecimals(vaultEntryAfter.syntheticAmount, expectedUserBorrowedSupply))
      assert.ok(userXusdTokenAccountAfter.amount.eq(expectedUserSyntheticSupply))
      assert.ok(eqDecimals(vaultAfter.mintAmount, expectedGlobalBorrowedSupply))
      assert.ok(eqDecimals(xusdAfter.borrowedSupply, expectedGlobalBorrowedSupply))
      assert.ok(eqDecimals(xusdAfter.supply, expectedGlobalBorrowedSupply))
    })
  })
  describe('#setHalted (exchange)', async () => {
    let xusdAssetAddress: PublicKey
    let usdcCollateralAddress: PublicKey
    let newAccountOwner: Keypair

    before(async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      xusdAssetAddress = assetsListData.synthetics[0].assetAddress
      usdcCollateralAddress = assetsListData.collaterals[1].collateralAddress
      newAccountOwner = Keypair.generate()

      const ixHalt = await exchange.setHaltedInstruction(true)
      await connection.requestAirdrop(newAccountOwner.publicKey, 10e9)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
    })
    it('create vault entry should failed', async () => {
      const { ix } = await exchange.createVaultEntryInstruction({
        owner: newAccountOwner.publicKey,
        collateral: usdcCollateralAddress,
        synthetic: xusdAssetAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [newAccountOwner], connection),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('deposit from vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.vaultDeposit({
          amount: new BN(0),
          owner: accountOwner.publicKey,
          collateral: usdcCollateralAddress,
          synthetic: xusdAssetAddress,
          userCollateralAccount: userUsdcTokenAccount,
          reserveAddress: usdcVaultReserve,
          collateralToken: usdcToken,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('borrow from vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.borrowVault({
          amount: allUserCollateralAmount.addn(1),
          owner: accountOwner.publicKey,
          to: userXusdTokenAccount,
          collateral: usdcCollateralAddress,
          collateralPriceFeed: usdcPriceFeed,
          synthetic: xusdAssetAddress,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('withdraw from vault entry should failed', async () => {
      const ix = await exchange.withdrawVaultInstruction({
        amount: new BN(0),
        owner: accountOwner.publicKey,
        collateral: usdcCollateralAddress,
        reserveAddress: usdcVaultReserve,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusdAssetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        vaultType
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [accountOwner], connection),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('repay from vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.repayVault({
          amount: new BN(0),
          owner: accountOwner.publicKey,
          collateral: usdcCollateralAddress,
          synthetic: xusdAssetAddress,
          userTokenAccountRepay: userXusdTokenAccount,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
  })
  describe('#setVaultHalted', async () => {
    let xusdAssetAddress: PublicKey
    let usdcCollateralAddress: PublicKey
    let newAccountOwner: Keypair

    before(async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      xusdAssetAddress = assetsListData.synthetics[0].assetAddress
      usdcCollateralAddress = assetsListData.collaterals[1].collateralAddress
      newAccountOwner = Keypair.generate()

      await connection.requestAirdrop(newAccountOwner.publicKey, 10e9)
      const ixHalt = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const ixVaultHalt = await exchange.setVaultHaltedInstruction({
        collateral: usdcCollateralAddress,
        synthetic: xusdAssetAddress,
        halted: true,
        vaultType
      })
      await signAndSend(new Transaction().add(ixVaultHalt), [EXCHANGE_ADMIN], connection)
    })
    it('create vault entry should failed', async () => {
      const { ix } = await exchange.createVaultEntryInstruction({
        owner: newAccountOwner.publicKey,
        collateral: usdcCollateralAddress,
        synthetic: xusdAssetAddress,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [newAccountOwner], connection),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('deposit to vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.vaultDeposit({
          amount: new BN(0),
          owner: accountOwner.publicKey,
          collateral: usdcCollateralAddress,
          synthetic: xusdAssetAddress,
          userCollateralAccount: userUsdcTokenAccount,
          reserveAddress: usdcVaultReserve,
          collateralToken: usdcToken,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('borrow from vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.borrowVault({
          amount: new BN(1),
          owner: accountOwner.publicKey,
          to: userXusdTokenAccount,
          collateral: usdcCollateralAddress,
          collateralPriceFeed: usdcPriceFeed,
          synthetic: xusdAssetAddress,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('withdraw to vault entry should failed', async () => {
      const ix = await exchange.withdrawVaultInstruction({
        amount: new BN(0),
        owner: accountOwner.publicKey,
        collateral: usdcCollateralAddress,
        reserveAddress: usdcVaultReserve,
        collateralPriceFeed: usdcPriceFeed,
        synthetic: xusdAssetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        vaultType
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [accountOwner], connection),
        ERRORS_EXCHANGE.HALTED
      )
    })
    it('repay to vault entry should failed', async () => {
      await assertThrowsAsync(
        exchange.repayVault({
          amount: new BN(0),
          owner: accountOwner.publicKey,
          collateral: usdcCollateralAddress,
          synthetic: xusdAssetAddress,
          userTokenAccountRepay: userXusdTokenAccount,
          signers: [accountOwner],
          vaultType
        }),
        ERRORS_EXCHANGE.HALTED
      )
    })
  })
})
