import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateral,
  skipTimestamps
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { calculateDebt } from '../sdk/lib/utils'

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
      stakingFundAccount: stakingFundAccount
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
  })
  it('should initialized interest debt parameters', async () => {
    const state = await exchange.getState()
    assert.ok(state.debtInterestRate === 10)
    assert.ok(state.accumulatedDebtInterest.eq(new BN(0)))
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
    assert.ok(snyAsset.price.eq(new BN(0)))

    // Check token address
    const snyCollateral = assetsListData.collaterals[assetsListData.collaterals.length - 1]
    assert.ok(snyCollateral.collateralAddress.equals(collateralToken.publicKey))

    // USD token address
    const usdAsset = assetsListData.assets[0]
    assert.ok(usdAsset.price.eq(new BN(1e6)))

    // xUSD checks
    const usdSynthetic = assetsListData.synthetics[assetsListData.synthetics.length - 1]
    assert.ok(usdSynthetic.assetAddress.equals(usdToken.publicKey))
    assert.ok(usdSynthetic.decimals === initTokensDecimals)
    assert.ok(usdSynthetic.maxSupply.eq(new BN('ffffffffffffffff', 16)))
  })
  it('should prepare base debt (mint debt)', async () => {
    const collateralAmount = new BN(500_000 * 1e6)
    const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
      reserveAddress: snyReserve,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })
    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

    const usdMintAmount = new BN(50_000 * 1e6)
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
    assert.ok(assetsListAfter.synthetics[0].supply.eq(usdMintAmount))

    // Increase user xusd balance
    const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
    assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
  })
  it('should increase interest debt', async () => {
    const assetsListBeforeAdjustment = await exchange.getAssetsList(assetsList)
    const debtBeforeAdjustment = calculateDebt(assetsListBeforeAdjustment)
    // trigger debt adjustment without changing base debt and assets supply
    await skipTimestamps(61, connection)

    await exchange.checkAccount(exchangeAccount)
    const assetsListAfterAdjustment = await exchange.getAssetsList(assetsList)
    const stateAfterAdjustment = await exchange.getState()
    const debtAfterAdjustment = calculateDebt(assetsListAfterAdjustment)

    // real debt      50000.000951...$
    // expected debt  50000.000952   $
    const expectedDebtInterest = new BN(952)
    assert.ok(debtAfterAdjustment.eq(debtBeforeAdjustment.add(expectedDebtInterest)))
    assert.ok(
      assetsListAfterAdjustment.synthetics[0].supply.eq(
        assetsListBeforeAdjustment.synthetics[0].supply.add(expectedDebtInterest)
      )
    )
    assert.ok(stateAfterAdjustment.accumulatedDebtInterest.eq(expectedDebtInterest))
  })
})
