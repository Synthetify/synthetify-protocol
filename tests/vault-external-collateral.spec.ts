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
import { createPriceFeed, getFeedData, setFeedPrice, setFeedTrading } from './oracleUtils'
import {
  decimalToPercent,
  divUp,
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

describe('vaults external collateral', () => {
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
  let invtPriceFeed: PublicKey
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let invtToken: Token
  let invtTokenDecimal: number
  let invtInitPrice = 3
  let invtVaultReserve: PublicKey
  let invtVaultLiquidationFund: PublicKey
  let userInvtTokenAccount: PublicKey
  let userXusdTokenAccount: PublicKey
  let invtUserCollateralAmount: BN
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

    invtPriceFeed = await createPriceFeed({
      oracleProgram,
      initPrice: invtInitPrice,
      expo: -6
    })
    invtToken = await createToken({
      connection,
      payer: wallet,
      decimals: 6,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    invtTokenDecimal = (await invtToken.getMintInfo()).decimals
    invtVaultReserve = await invtToken.createAccount(exchangeAuthority)
    invtVaultLiquidationFund = await invtToken.createAccount(exchangeAuthority)

    const assetsListData = await exchange.getAssetsList(assetsList)
    const xusd = assetsListData.synthetics[0]
    maxBorrow = { val: new BN(1_000_000_000), scale: xusd.maxSupply.scale }
  })
  describe('#createVault', async () => {
    let assetsListData: AssetsList
    let xusd: Synthetic
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
      openFee = percentToDecimal(1)
      debtInterestRate = toScale(percentToDecimal(7), INTEREST_RATE_DECIMALS)
      collateralRatio = percentToDecimal(50)
      liquidationRatio = percentToDecimal(50)
      liquidationThreshold = percentToDecimal(60)
      liquidationPenaltyExchange = percentToDecimal(5)
      liquidationPenaltyLiquidator = percentToDecimal(5)
      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: invtVaultReserve,
        collateral: invtToken.publicKey,
        collateralPriceFeed: invtPriceFeed,
        liquidationFund: invtVaultLiquidationFund,
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

    it('create invt/xusd vault should failed due to admin signature', async () => {
      await assertThrowsAsync(
        signAndSend(new Transaction().add(createVaultIx), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should create invt/xusd vault', async () => {
      const timestamp = (await connection.getBlockTime(await connection.getSlot())) as number
      await signAndSend(new Transaction().add(createVaultIx), [EXCHANGE_ADMIN], connection)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )

      assert.ok(eqDecimals(vault.collateralAmount, toDecimal(new BN(0), invtTokenDecimal)))
      assert.ok(vault.synthetic.equals(xusd.assetAddress))
      assert.ok(vault.collateral.equals(invtToken.publicKey))
      assert.ok(vault.collateralReserve.equals(invtVaultReserve))
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
    it('create invt/xusd vault should fail cause there can only be one vault per synthetic/collateral pair', async () => {
      await assertThrowsAsync(
        signAndSend(new Transaction().add(createVaultIx), [EXCHANGE_ADMIN], connection)
      )
    })
  })
  describe('#createVaultEntry', async () => {
    it('should create vault entry on invt/xusd vault', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      const { ix } = await exchange.createVaultEntryInstruction({
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)

      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const { vaultAddress } = await exchange.getVaultAddress(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      assert.ok(vaultEntry.owner.equals(accountOwner.publicKey))
      assert.ok(vaultEntry.vault.equals(vaultAddress))
      assert.ok(eqDecimals(vaultEntry.syntheticAmount, toDecimal(new BN(0), xusd.maxSupply.scale)))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, toDecimal(new BN(0), invtTokenDecimal)))
      assert.ok(
        eqDecimals(
          vaultEntry.lastAccumulatedInterestRate,
          toScale(percentToDecimal(100), INTEREST_RATE_DECIMALS)
        )
      )
    })
    it('create invt/xusd vault entry should fail cause there can only be one vault entry per user', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      const { ix } = await exchange.createVaultEntryInstruction({
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [accountOwner], connection))
    })
  })
  describe('#depositVault', async () => {
    it('should perform 1st deposit to invt/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      userInvtTokenAccount = await invtToken.createAccount(accountOwner.publicKey)
      invtUserCollateralAmount = new BN(10).pow(new BN(invtTokenDecimal)).muln(100) // mint 100 INVT
      await invtToken.mintTo(userInvtTokenAccount, wallet, [], tou64(invtUserCollateralAmount))

      const userInvtTokenAccountInfo = await invtToken.getAccountInfo(userInvtTokenAccount)
      const invtVaultReserveTokenAccountInfo = await invtToken.getAccountInfo(invtVaultReserve)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )

      const expectedCollateralAmount = toDecimal(new BN(0), invtTokenDecimal)

      // balances before deposit
      assert.ok(userInvtTokenAccountInfo.amount.eq(invtUserCollateralAmount))
      assert.ok(invtVaultReserveTokenAccountInfo.amount.eq(new BN(0)))

      // vault collateral should be empty
      assert.ok(eqDecimals(vault.collateralAmount, expectedCollateralAmount))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, expectedCollateralAmount))

      const vaultDepositTx = await exchange.vaultDepositTransaction({
        amount: invtUserCollateralAmount,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userInvtTokenAccount,
        reserveAddress: invtVaultReserve,
        collateralToken: invtToken,
        vaultType
      })
      await signAndSend(new Transaction().add(vaultDepositTx), [accountOwner], connection)

      const userInvtTokenAccountInfoAfterDeposit = await invtToken.getAccountInfo(
        userInvtTokenAccount
      )
      const invtVaultReserveTokenAccountInfoAfterDeposit = await invtToken.getAccountInfo(
        invtVaultReserve
      )
      const vaultAfterDeposit = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterDeposit = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const expectedCollateralAmountAfterDeposit = toDecimal(
        invtUserCollateralAmount,
        invtTokenDecimal
      )

      // change balances after deposit
      assert.ok(userInvtTokenAccountInfoAfterDeposit.amount.eq(new BN(0)))
      assert.ok(invtVaultReserveTokenAccountInfoAfterDeposit.amount.eq(invtUserCollateralAmount))

      // vault and vault entry collateral
      assert.ok(
        eqDecimals(vaultAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
      assert.ok(
        eqDecimals(vaultEntryAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
    })
    it('should perform 2st deposit to invt/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      userInvtTokenAccount = await invtToken.createAccount(accountOwner.publicKey)
      const depositAmount = new BN(10).pow(new BN(invtTokenDecimal)).muln(50) // mint 50 INVT
      await invtToken.mintTo(userInvtTokenAccount, wallet, [], tou64(depositAmount))

      const userInvtTokenAccountInfo = await invtToken.getAccountInfo(userInvtTokenAccount)
      const invtVaultReserveTokenAccountInfo = await invtToken.getAccountInfo(invtVaultReserve)
      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const expectedCollateralAmount = toDecimal(invtUserCollateralAmount, invtTokenDecimal)

      // balances before deposit
      assert.ok(userInvtTokenAccountInfo.amount.eq(depositAmount))
      assert.ok(invtVaultReserveTokenAccountInfo.amount.eq(invtUserCollateralAmount))

      // vault and vault entry before deposit
      assert.ok(eqDecimals(vault.collateralAmount, expectedCollateralAmount))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, expectedCollateralAmount))

      const vaultDepositTx = await exchange.vaultDepositTransaction({
        amount: depositAmount,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userInvtTokenAccount,
        reserveAddress: invtVaultReserve,
        collateralToken: invtToken,
        vaultType
      })
      await signAndSend(new Transaction().add(vaultDepositTx), [accountOwner], connection)

      invtUserCollateralAmount = invtUserCollateralAmount.add(depositAmount)
      const userInvtTokenAccountInfoAfterDeposit = await invtToken.getAccountInfo(
        userInvtTokenAccount
      )
      const invtVaultReserveTokenAccountInfoAfterDeposit = await invtToken.getAccountInfo(
        invtVaultReserve
      )
      const vaultAfterDeposit = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterDeposit = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const expectedVaultDecimal = toDecimal(invtUserCollateralAmount, vault.collateralAmount.scale)

      // change balances
      assert.ok(userInvtTokenAccountInfoAfterDeposit.amount.eq(new BN(0)))
      assert.ok(invtVaultReserveTokenAccountInfoAfterDeposit.amount.eq(invtUserCollateralAmount))

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

      const vaultBorrowTx = await exchange.borrowVaultTransaction({
        amount: new BN(233 * 10 ** 6), // 223 XUSD
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusd.assetAddress,
        to: userXusdTokenAccount,
        collateralPriceFeed: invtPriceFeed,
        vaultType
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(vaultBorrowTx), [accountOwner], connection),
        ERRORS_EXCHANGE.USER_BORROW_LIMIT
      )
    })
    it('should borrow xusd from invt/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
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

      borrowAmount = invtUserCollateralAmount.muln(
        (decimalToPercent(vault.collateralRatio) - 20) / 100
      )

      const vaultBorrowTx = await exchange.borrowVaultTransaction({
        amount: borrowAmount,
        owner: accountOwner.publicKey,
        to: userXusdTokenAccount,
        collateral: invtToken.publicKey,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusd.assetAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(vaultBorrowTx), [accountOwner], connection)
      borrowAmount = borrowAmount.add(mulUpByUnifiedPercentage(borrowAmount, vault.openFee))

      const vaultAfterBorrow = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterBorrow = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
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

      const vault = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )

      const changeVaultBorrowLimitIx = await exchange.setVaultMaxBorrowInstruction(
        toDecimal(new BN(1e2), vault.maxBorrow.scale),
        {
          collateral: invtToken.publicKey,
          synthetic: xusd.assetAddress,
          vaultType
        }
      )
      await signAndSend(
        new Transaction().add(changeVaultBorrowLimitIx),
        [EXCHANGE_ADMIN],
        connection
      )

      const vaultBorrowTx = await exchange.borrowVaultTransaction({
        amount: new BN(1),
        owner: accountOwner.publicKey,
        to: userXusdTokenAccount,
        collateral: invtToken.publicKey,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusd.assetAddress,
        vaultType
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(vaultBorrowTx), [accountOwner], connection),
        ERRORS_EXCHANGE.VAULT_BORROW_LIMIT
      )

      // clean after test - return to previous max borrow
      const cleanUpTx = await exchange.setVaultMaxBorrowInstruction(maxBorrow, {
        collateral: invtToken.publicKey,
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

      const withdrawAmount = invtUserCollateralAmount.addn(1)
      const userInvtTokenAccountInfoBefore = await invtToken.getAccountInfo(userInvtTokenAccount)
      const invtVaultReserveTokenAccountInfoBefore = await invtToken.getAccountInfo(
        invtVaultReserve
      )
      const vaultBefore = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const withdrawTx = await exchange.withdrawVaultTransaction({
        amount: withdrawAmount,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        reserveAddress: invtVaultReserve,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userInvtTokenAccount,
        vaultType
      })
      await assertThrowsAsync(
        signAndSend(withdrawTx, [accountOwner], connection),
        ERRORS_EXCHANGE.VAULT_WITHDRAW_LIMIT
      )
      const userInvtTokenAccountInfoAfter = await invtToken.getAccountInfo(userInvtTokenAccount)
      const invtVaultReserveTokenAccountInfoAfter = await invtToken.getAccountInfo(invtVaultReserve)
      const vaultAfter = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      assert.ok(userInvtTokenAccountInfoBefore.amount.eq(userInvtTokenAccountInfoAfter.amount))
      assert.ok(
        invtVaultReserveTokenAccountInfoBefore.amount.eq(
          invtVaultReserveTokenAccountInfoAfter.amount
        )
      )
      assert.ok(eqDecimals(vaultBefore.collateralAmount, vaultAfter.collateralAmount))
      assert.ok(eqDecimals(vaultEntryBefore.collateralAmount, vaultEntryAfter.collateralAmount))
    })
    it('should withdraw some invt from invt/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const vaultBeforeWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryBeforeWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )

      const toWithdraw = new BN(1e6).muln(10) // 10 INVT
      const userInvtTokenAccountBeforeWithdraw = await invtToken.getAccountInfo(
        userInvtTokenAccount
      )
      const withdrawTx = await exchange.withdrawVaultTransaction({
        amount: toWithdraw,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        reserveAddress: invtVaultReserve,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userInvtTokenAccount,
        vaultType
      })
      await signAndSend(withdrawTx, [accountOwner], connection)

      const vaultAfterWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const userInvtTokenAccountAfterWithdraw = await invtToken.getAccountInfo(userInvtTokenAccount)
      assert.ok(
        toWithdraw.eq(
          userInvtTokenAccountAfterWithdraw.amount.sub(userInvtTokenAccountBeforeWithdraw.amount)
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
    it('should withdraw rest of available collateral', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      const withdrawAmount = new BN('ffffffffffffffff', 16)
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const vaultBefore = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const userInvtTokenAccountBefore = await invtToken.getAccountInfo(userInvtTokenAccount)
      const vaultInvtTokenAccountBefore = await invtToken.getAccountInfo(invtVaultReserve)
      const withdrawTx = await exchange.withdrawVaultTransaction({
        amount: withdrawAmount,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        reserveAddress: invtVaultReserve,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userInvtTokenAccount,
        vaultType
      })
      await signAndSend(withdrawTx, [accountOwner], connection)
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const vaultAfter = await exchange.getVaultForPair(
        xusd.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const userInvtTokenAccountAfter = await invtToken.getAccountInfo(userInvtTokenAccount)
      const vaultInvtTokenAccountAfter = await invtToken.getAccountInfo(invtVaultReserve)
      // WHAT'S WRONG WITH THAT - collateral price != synthetic price
      const collateralRatioInverse = new BN(
        1 / (decimalToPercent(vaultAfter.collateralRatio) / 100)
      )
      const minCollateralized = divUp(
        vaultEntryAfter.syntheticAmount.val.mul(collateralRatioInverse),
        new BN(invtInitPrice)
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
        expectedWithdraw.eq(userInvtTokenAccountAfter.amount.sub(userInvtTokenAccountBefore.amount))
      )
      assert.ok(
        expectedWithdraw.eq(
          vaultInvtTokenAccountBefore.amount.sub(vaultInvtTokenAccountAfter.amount)
        )
      )
    })
  })
  describe('#repayVault', async () => {
    it('should repay xusd from invt/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBefore = assetsListData.synthetics[0]

      const vaultBeforeRepay = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryBeforeRepay = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountBeforeRepay = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const repayAmount = vaultEntryBeforeRepay.syntheticAmount.val.divn(2)

      const repayTx = await exchange.repayVaultTransaction({
        amount: repayAmount,
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusdBefore.assetAddress,
        userTokenAccountRepay: userXusdTokenAccount,
        vaultType
      })
      await signAndSend(repayTx, [accountOwner], connection)

      const xusdAfter = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const vaultAfterRepay = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterRepay = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
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

      // CREATE ACCOUNT THAT WILL SEND SYNTHETIC NEEDED TO REPAY VAULT
      {
        const repayingAccount = Keypair.generate()
        const repayingInvtTokenAccount = await invtToken.createAccount(repayingAccount.publicKey)
        const repayingCollateralAmount = new BN(1000 * 10 ** 6) // 1000 INVT

        await Promise.all([
          connection.requestAirdrop(repayingAccount.publicKey, 10e9),
          invtToken.createAccount(repayingAccount.publicKey)
        ])

        await invtToken.mintTo(
          repayingInvtTokenAccount,
          wallet,
          [],
          tou64(repayingCollateralAmount)
        )

        const { ix: createVaultEntryIx } = await exchange.createVaultEntryInstruction({
          owner: repayingAccount.publicKey,
          collateral: invtToken.publicKey,
          synthetic: xusdBefore.assetAddress,
          vaultType
        })
        await signAndSend(new Transaction().add(createVaultEntryIx), [repayingAccount], connection)

        const vaultDepositTx = await exchange.vaultDepositTransaction({
          amount: repayingCollateralAmount,
          owner: repayingAccount.publicKey,
          collateral: invtToken.publicKey,
          synthetic: xusdBefore.assetAddress,
          userCollateralAccount: repayingInvtTokenAccount,
          reserveAddress: invtVaultReserve,
          collateralToken: invtToken,
          vaultType
        })
        await signAndSend(vaultDepositTx, [repayingAccount], connection)

        const borrowVaultTx = await exchange.borrowVaultTransaction({
          amount: new BN(100 * 10 ** 6), // 100 INVT,
          owner: repayingAccount.publicKey,
          to: userXusdTokenAccount,
          collateral: invtToken.publicKey,
          collateralPriceFeed: invtPriceFeed,
          synthetic: xusdBefore.assetAddress,
          vaultType
        })
        await signAndSend(borrowVaultTx, [repayingAccount], connection)
      }

      const vaultBefore = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const userXusdTokenAccountBefore = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const maxRepayAmount = vaultEntryBefore.syntheticAmount.val

      const repayVaultTx = await exchange.repayVaultTransaction({
        amount: maxRepayAmount.addn(1),
        owner: accountOwner.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusdBefore.assetAddress,
        userTokenAccountRepay: userXusdTokenAccount,
        vaultType
      })
      await signAndSend(repayVaultTx, [accountOwner], connection)

      const xusdAfter = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const vaultAfter = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
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
  describe('Liquidation flow', async () => {
    const liquidator = Keypair.generate()
    let liquidatorInvtTokenAccount: PublicKey
    let liquidatorXusdTokenAccount: PublicKey
    let ownerDebtAmount: BN

    it('should borrow max', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBeforeBorrow = assetsListData.synthetics[0]

      const userXusdTokenAccountBeforeBorrow = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const vaultBeforeBorrow = await exchange.getVaultForPair(
        xusdBeforeBorrow.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryBeforeBorrow = await exchange.getVaultEntryForOwner(
        xusdBeforeBorrow.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )

      const borrowVaultTx = await exchange.borrowVaultTransaction({
        amount: U64_MAX,
        owner: accountOwner.publicKey,
        to: userXusdTokenAccount,
        collateral: invtToken.publicKey,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusdBeforeBorrow.assetAddress,
        vaultType
      })
      await signAndSend(borrowVaultTx, [accountOwner], connection)

      const xusdAfterBorrow = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const userXusdTokenAccountAfterBorrow = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const vaultAfterBorrow = await exchange.getVaultForPair(
        xusdBeforeBorrow.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const vaultEntryAfterBorrow = await exchange.getVaultEntryForOwner(
        xusdBeforeBorrow.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )

      // debt   = 4782028 xusd
      // borrow = 4734681 xusd (debt/(1+open_fee)
      const expectedDebtAmount = new BN(4782028)
      const expectedBorrowAmount = new BN(4734681)
      ownerDebtAmount = expectedDebtAmount

      // vault after borrow
      assert.ok(
        vaultAfterBorrow.mintAmount.val.eq(vaultBeforeBorrow.mintAmount.val.add(expectedDebtAmount))
      )
      // vault entry after borrow
      assert.ok(
        vaultEntryAfterBorrow.syntheticAmount.val.eq(
          vaultEntryBeforeBorrow.syntheticAmount.val.add(expectedDebtAmount)
        )
      )
      // synthetic supply after borrow
      assert.ok(xusdAfterBorrow.supply.val.eq(xusdBeforeBorrow.supply.val.add(expectedDebtAmount)))
      assert.ok(
        xusdAfterBorrow.borrowedSupply.val.eq(
          xusdBeforeBorrow.borrowedSupply.val.add(expectedDebtAmount)
        )
      )
      // user synthetic balance after borrow
      assert.ok(
        userXusdTokenAccountAfterBorrow.amount.eq(
          userXusdTokenAccountBeforeBorrow.amount.add(expectedBorrowAmount)
        )
      )
    })
    it('prepare liquidator', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBefore = assetsListData.synthetics[0]

      const [invtTokenAccount, xusdTokenAccount] = await Promise.all([
        invtToken.createAccount(liquidator.publicKey),
        xusdToken.createAccount(liquidator.publicKey),
        connection.requestAirdrop(liquidator.publicKey, 10e9)
      ])
      liquidatorInvtTokenAccount = invtTokenAccount
      liquidatorXusdTokenAccount = xusdTokenAccount

      const invtTokenAmount = tou64(2000 * 10 ** 6) // 2000 INVT
      await invtToken.mintTo(liquidatorInvtTokenAccount, wallet, [], invtTokenAmount)

      const { ix: createVaultEntryIx } = await exchange.createVaultEntryInstruction({
        owner: liquidator.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusdBefore.assetAddress,
        vaultType
      })
      await signAndSend(new Transaction().add(createVaultEntryIx), [liquidator], connection)
      const vaultDepositTx = await exchange.vaultDepositTransaction({
        amount: invtTokenAmount,
        owner: liquidator.publicKey,
        collateral: invtToken.publicKey,
        synthetic: xusdBefore.assetAddress,
        userCollateralAccount: liquidatorInvtTokenAccount,
        reserveAddress: invtVaultReserve,
        collateralToken: invtToken,
        vaultType
      })
      await signAndSend(vaultDepositTx, [liquidator], connection)

      const borrowVaultTx = await exchange.borrowVaultTransaction({
        amount: new BN(ownerDebtAmount),
        owner: liquidator.publicKey,
        to: liquidatorXusdTokenAccount,
        collateral: invtToken.publicKey,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusdBefore.assetAddress,
        vaultType
      })
      await signAndSend(borrowVaultTx, [liquidator], connection)
    })
    it('liquidate', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusdBefore = assetsListData.synthetics[0]

      const vaultBefore = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const ownerVaultEntryBefore = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const liquidatorCollateralAccountBefore = await invtToken.getAccountInfo(
        liquidatorInvtTokenAccount
      )
      const liquidatorSyntheticAccountBefore = await xusdToken.getAccountInfo(
        liquidatorXusdTokenAccount
      )
      const liquidationFundBefore = await invtToken.getAccountInfo(invtVaultLiquidationFund)

      const liquidateVaultInstruction = await exchange.liquidateVaultInstruction({
        amount: U64_MAX,
        collateral: invtToken.publicKey,
        collateralReserve: invtVaultReserve,
        liquidationFund: invtVaultLiquidationFund,
        collateralPriceFeed: invtPriceFeed,
        synthetic: xusdBefore.assetAddress,
        liquidator: liquidator.publicKey,
        liquidatorCollateralAccount: liquidatorInvtTokenAccount,
        liquidatorSyntheticAccount: liquidatorXusdTokenAccount,
        owner: accountOwner.publicKey,
        vaultType
      })

      const approveIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        liquidatorXusdTokenAccount,
        exchange.exchangeAuthority,
        liquidator.publicKey,
        [],
        tou64(U64_MAX)
      )

      // owner is safe
      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(approveIx).add(liquidateVaultInstruction),
          [liquidator],
          connection
        ),
        ERRORS_EXCHANGE.INVALID_LIQUIDATION
      )

      const newInvtPrice = 2
      await setFeedPrice(oracleProgram, newInvtPrice, invtPriceFeed)

      // successfully liquidate
      await signAndSend(
        new Transaction().add(approveIx).add(liquidateVaultInstruction),
        [liquidator],
        connection
      )

      const xusdAfter = (await exchange.getAssetsList(assetsList)).synthetics[0]
      const vaultAfter = await exchange.getVaultForPair(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        vaultType
      )
      const ownerVaultEntryAfter = await exchange.getVaultEntryForOwner(
        xusdBefore.assetAddress,
        invtToken.publicKey,
        accountOwner.publicKey,
        vaultType
      )
      const liquidatorCollateralAccountAfter = await invtToken.getAccountInfo(
        liquidatorInvtTokenAccount
      )
      const liquidatorSyntheticAccountAfter = await xusdToken.getAccountInfo(
        liquidatorXusdTokenAccount
      )
      const liquidationFundAfter = await invtToken.getAccountInfo(invtVaultLiquidationFund)

      const expectedBurnedAmount = ownerDebtAmount.divn(2)
      // const collateralToLiquidator = expectedBurnedAmount.divn(newInvtPrice)
      const baseTransferredCollateral = expectedBurnedAmount.divn(newInvtPrice)
      const expectedCollateralPenaltyToLiquidator = divUp(
        baseTransferredCollateral.muln(5),
        new BN(100)
      )
      const expectedCollateralTransferToLiquidator = baseTransferredCollateral.add(
        expectedCollateralPenaltyToLiquidator
      )
      const expectedCollateralToExchange = expectedCollateralPenaltyToLiquidator.subn(1)

      // Liquidator should receive collateral
      assert.ok(
        liquidatorCollateralAccountBefore.amount
          .add(expectedCollateralTransferToLiquidator)
          .eq(liquidatorCollateralAccountAfter.amount)
      )
      // Liquidator should repay synthetic
      assert.ok(
        liquidatorSyntheticAccountAfter.amount.eq(
          liquidatorSyntheticAccountBefore.amount.sub(expectedBurnedAmount)
        )
      )
      // Liquidation fund should receive collateral
      assert.ok(
        liquidationFundAfter.amount.eq(
          liquidationFundBefore.amount.add(expectedCollateralToExchange)
        )
      )
      // Vault should adjust collateral and synthetic amounts
      assert.ok(
        vaultAfter.collateralAmount.val.eq(
          vaultBefore.collateralAmount.val
            .sub(expectedCollateralTransferToLiquidator)
            .sub(expectedCollateralToExchange)
        )
      )
      assert.ok(vaultAfter.mintAmount.val.eq(vaultBefore.mintAmount.val.sub(expectedBurnedAmount)))
      // Vault entry should adjust collateral and synthetic amounts

      assert.ok(
        ownerVaultEntryAfter.collateralAmount.val.eq(
          ownerVaultEntryBefore.collateralAmount.val
            .sub(expectedCollateralTransferToLiquidator)
            .sub(expectedCollateralToExchange)
        )
      )
      assert.ok(
        ownerVaultEntryAfter.syntheticAmount.val.eq(
          ownerVaultEntryBefore.syntheticAmount.val.sub(expectedBurnedAmount)
        )
      )

      // Synthetic should be burned so supply should decrease
      assert.ok(xusdAfter.supply.val.eq(xusdBefore.supply.val.sub(expectedBurnedAmount)))
      assert.ok(
        xusdAfter.borrowedSupply.val.eq(xusdBefore.borrowedSupply.val.sub(expectedBurnedAmount))
      )
    })
    it('withdraw liquidation penalty by admin', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]

      const account = Keypair.generate()
      const penaltyTargetAccount = await invtToken.createAccount(account.publicKey)

      const withdrawTargetAmountBefore = (await invtToken.getAccountInfo(penaltyTargetAccount))
        .amount
      const vaultLiquidationFundAmountBefore = (
        await invtToken.getAccountInfo(invtVaultLiquidationFund)
      ).amount

      const withdrawVaultLiquidationPenaltyIx =
        await exchange.withdrawVaultLiquidationPenaltyInstruction({
          amount: vaultLiquidationFundAmountBefore,
          collateral: invtToken.publicKey,
          synthetic: xusd.assetAddress,
          liquidationFund: invtVaultLiquidationFund,
          to: penaltyTargetAccount,
          vaultType
        })

      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(withdrawVaultLiquidationPenaltyIx),
          [liquidator],
          connection
        ),
        ERRORS.SIGNATURE
      )

      await signAndSend(
        new Transaction().add(withdrawVaultLiquidationPenaltyIx),
        [EXCHANGE_ADMIN],
        connection
      )

      const withdrawTargetAmountAfter = (await invtToken.getAccountInfo(penaltyTargetAccount))
        .amount
      const vaultLiquidationFundAmountAfter = (
        await invtToken.getAccountInfo(invtVaultLiquidationFund)
      ).amount

      // liquidation balances
      assert.isFalse(vaultLiquidationFundAmountBefore.eqn(0))
      assert.ok(vaultLiquidationFundAmountAfter.eqn(0))

      // transfer
      assert.ok(
        withdrawTargetAmountBefore
          .add(vaultLiquidationFundAmountBefore)
          .eq(withdrawTargetAmountAfter)
      )
    })
  })
})
