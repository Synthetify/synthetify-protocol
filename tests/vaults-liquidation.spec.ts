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
import { Collateral, PriceStatus, Synthetic } from '@synthetify/sdk/lib/exchange'
import { Decimal } from '@synthetify/sdk/src/exchange'

describe('vaults', () => {
  console.log(1)
  const provider = anchor.Provider.local(undefined, { commitment: 'single', skipPreflight: true })
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
  let collateralAmount: BN
  let borrowAmount: BN
  const accountOwner = Keypair.generate()

  before(async () => {
    // await connection.requestAirdrop(accountOwner.publicKey, 10e9)
    // await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)
    console.log(2)

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
    console.log(3)

    snyToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    console.log(4)

    snyReserve = await snyToken.createAccount(exchangeAuthority)
    console.log(4)

    snyLiquidationFund = await snyToken.createAccount(exchangeAuthority)
    console.log(4)

    stakingFundAccount = await snyToken.createAccount(exchangeAuthority)
    console.log(5)

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )
    console.log(6)

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

    console.log(7)

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
  it('should create usdc/xusd vault', async () => {
    const assetsListData = await exchange.getAssetsList(assetsList)
    const xusd = assetsListData.synthetics[0]
    const usdc = assetsListData.collaterals[1]
    const debtInterestRate = percentToDecimal(5)
    const collateralRatio = percentToDecimal(80)
    const liquidationRatio = percentToDecimal(90)
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
