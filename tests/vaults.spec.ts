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
  SYNTHETIFY_ECHANGE_SEED,
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
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let usdcToken: Token
  let usdcVaultReserve: PublicKey
  let userUsdcTokenAccount: PublicKey
  let userXusdTokenAccount: PublicKey
  let collateralAmount: BN
  let borrowAmount: BN
  const accountOwner = Keypair.generate()

  before(async () => {
    await connection.requestAirdrop(accountOwner.publicKey, 10e9)
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)

    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
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

    const data = await createAssetsList({
      exchangeAuthority,
      collateralToken: snyToken,
      collateralTokenFeed: snyTokenFeed,
      connection,
      wallet,
      exchange,
      snyReserve,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    xusdToken = data.usdToken

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
    usdcToken = token
    usdcVaultReserve = await usdcToken.createAccount(exchangeAuthority)
  })
  describe('#createVault', async () => {
    it('create usdc/xusd vault should failed due to admin signature', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]
      const debtInterestRate = percentToDecimal(5)
      const collateralRatio = percentToDecimal(80)
      const liquidationRatio = percentToDecimal(50)
      const liquidationThreshold = percentToDecimal(90)
      const liquidationPenaltyExchange = percentToDecimal(5)
      const liquidationPenaltyLiquidator = percentToDecimal(5)
      const maxBorrow = { val: new BN(1_000_000_000), scale: xusd.maxSupply.scale }

      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: usdcVaultReserve,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        debtInterestRate,
        collateralRatio,
        maxBorrow,
        liquidationPenaltyExchange,
        liquidationPenaltyLiquidator,
        liquidationThreshold,
        liquidationRatio
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should create usdc/xusd vault', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]
      const debtInterestRate = percentToDecimal(5)
      const collateralRatio = percentToDecimal(80)
      const liquidationRatio = percentToDecimal(50)
      const liquidationThreshold = percentToDecimal(90)
      const liquidationPenaltyExchange = percentToDecimal(5)
      const liquidationPenaltyLiquidator = percentToDecimal(5)

      const maxBorrow = { val: new BN(1_000_000_000), scale: xusd.maxSupply.scale }

      const { ix } = await exchange.createVaultInstruction({
        collateralReserve: usdcVaultReserve,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        debtInterestRate,
        collateralRatio,
        maxBorrow,
        liquidationPenaltyExchange,
        liquidationPenaltyLiquidator,
        liquidationThreshold,
        liquidationRatio
      })
      const timestamp = (await connection.getBlockTime(await connection.getSlot())) as number
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const vault = await exchange.getVaultForPair(xusd.assetAddress, usdc.collateralAddress)

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
        synthetic: xusd.assetAddress
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)

      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const { vaultAddress } = await exchange.getVaultAddress(
        xusd.assetAddress,
        usdc.collateralAddress
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
  })
  describe('#depositVault', async () => {
    it('should deposit to usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      userUsdcTokenAccount = await usdcToken.createAccount(accountOwner.publicKey)
      collateralAmount = new BN(10).pow(new BN(usdc.reserveBalance.scale)).muln(100) // mint 100 USD
      await usdcToken.mintTo(userUsdcTokenAccount, wallet, [], tou64(collateralAmount))

      const userUsdcTokenAccountInfo = await usdcToken.getAccountInfo(userUsdcTokenAccount)
      const usdcVaultReserveTokenAccountInfo = await usdcToken.getAccountInfo(usdcVaultReserve)
      const vault = await exchange.getVaultForPair(xusd.assetAddress, usdc.collateralAddress)
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )

      assert.ok(userUsdcTokenAccountInfo.amount.eq(collateralAmount))
      assert.ok(usdcVaultReserveTokenAccountInfo.amount.eq(new BN(0)))

      // vault collateral should be empty
      const expectedCollateralAmount = toDecimal(new BN(0), usdc.reserveBalance.scale)
      assert.ok(eqDecimals(vault.collateralAmount, expectedCollateralAmount))
      assert.ok(eqDecimals(vaultEntry.collateralAmount, expectedCollateralAmount))

      await exchange.vaultDeposit({
        amount: collateralAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount,
        reserveAddress: usdcVaultReserve,
        collateralToken: usdcToken,
        signers: [accountOwner]
      })

      const userUsdcTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        userUsdcTokenAccount
      )
      const usdcVaultReserveTokenAccountInfoAfterDeposit = await usdcToken.getAccountInfo(
        usdcVaultReserve
      )
      const vaultAfterDeposit = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryAfterDeposit = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const expectedCollateralAmountAfterDeposit = toDecimal(
        collateralAmount,
        usdc.reserveBalance.scale
      )

      // swap balances
      assert.ok(userUsdcTokenAccountInfoAfterDeposit.amount.eq(new BN(0)))
      assert.ok(usdcVaultReserveTokenAccountInfoAfterDeposit.amount.eq(collateralAmount))

      // deposit to vault
      assert.ok(
        eqDecimals(vaultAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
      assert.ok(
        eqDecimals(vaultEntryAfterDeposit.collateralAmount, expectedCollateralAmountAfterDeposit)
      )
    })
  })
  describe('#borrowVault', async () => {
    it('should borrow xusd from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      userXusdTokenAccount = await xusdToken.createAccount(accountOwner.publicKey)
      const vault = await exchange.getVaultForPair(xusd.assetAddress, usdc.collateralAddress)
      const vaultEntry = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const borrowAmountBeforeBorrow = toDecimal(new BN(0), xusd.supply.scale)
      // vault before borrow
      assert.ok(eqDecimals(vault.mintAmount, borrowAmountBeforeBorrow))
      // vault entry before borrow
      assert.ok(eqDecimals(vaultEntry.syntheticAmount, borrowAmountBeforeBorrow))
      // synthetic supply before borrow
      assert.ok(eqDecimals(xusd.supply, borrowAmountBeforeBorrow))
      assert.ok(eqDecimals(xusd.borrowedSupply, borrowAmountBeforeBorrow))

      borrowAmount = collateralAmount.muln((decimalToPercent(vault.collateralRatio) - 20) / 100)

      await exchange.borrowVault({
        amount: borrowAmount,
        owner: accountOwner.publicKey,
        to: userXusdTokenAccount,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        signers: [accountOwner]
      })

      const vaultAfterBorrow = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryAfterBorrow = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
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
  })
  describe('#withdrawVault', async () => {
    it('should withdraw usdc from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vaultBeforeWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryBeforeWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const toWithdraw = new BN(1e6).muln(10)
      const userUsdcTokenAccountBeforeWithdraw = await usdcToken.getAccountInfo(
        userUsdcTokenAccount
      )

      const ix = await exchange.withdrawVaultInstruction({
        amount: toWithdraw,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        userCollateralAccount: userUsdcTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [accountOwner], connection)

      const vaultAfterWithdraw = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryAfterWithdraw = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
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
  })
  describe('#repayVault', async () => {
    it('should repay xusd from usdc/xusd vault entry', async () => {
      const assetsListData = await exchange.getAssetsList(assetsList)
      const xusd = assetsListData.synthetics[0]
      const usdc = assetsListData.collaterals[1]

      const vaultBeforeRepay = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryBeforeRepay = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const userXusdTokenAccountBeforeRepay = await xusdToken.getAccountInfo(userXusdTokenAccount)
      const repayAmount = vaultEntryBeforeRepay.syntheticAmount.val.divn(2)

      await exchange.repayVault({
        amount: repayAmount,
        owner: accountOwner.publicKey,
        collateral: usdc.collateralAddress,
        synthetic: xusd.assetAddress,
        userTokenAccountRepay: userXusdTokenAccount,
        signers: [accountOwner]
      })

      const vaultAfterRepay = await exchange.getVaultForPair(
        xusd.assetAddress,
        usdc.collateralAddress
      )
      const vaultEntryAfterRepay = await exchange.getVaultEntryForOwner(
        xusd.assetAddress,
        usdc.collateralAddress,
        accountOwner.publicKey
      )
      const userXusdTokenAccountAfterRepay = await xusdToken.getAccountInfo(userXusdTokenAccount)

      assert.ok(
        repayAmount.eq(
          userXusdTokenAccountBeforeRepay.amount.sub(userXusdTokenAccountAfterRepay.amount)
        )
      )
      assert.ok(repayAmount.eq(vaultBeforeRepay.mintAmount.val.sub(vaultAfterRepay.mintAmount.val)))
      assert.ok(
        repayAmount.eq(
          vaultEntryBeforeRepay.syntheticAmount.val.sub(vaultEntryAfterRepay.syntheticAmount.val)
        )
      )
    })
  })
})
