import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction
} from '@solana/web3.js'
import { assert, expect } from 'chai'
import { BN, calculateLiquidation, Exchange, Manager, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createPriceFeed,
  createToken,
  sleep,
  ORACLE_ADMIN,
  ASSETS_MANAGER_ADMIN,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  DEFAULT_PUBLIC_KEY,
  ORACLE_OFFSET,
  ACCURACY,
  calculateDebt,
  SYNTHETIFY_ECHANGE_SEED,
  calculateAmountAfterFee,
  toEffectiveFee,
  createAccountWithCollateralAndMaxMintUsd,
  tokenToUsdValue
} from './utils'

describe('liquidation', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgram.programId)
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let collateralAccount: PublicKey
  let liquidationAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number

  let liquidator: Account
  let liquidatorUsdAccount: PublicKey
  let liquidatorCollateralAccount: PublicKey

  let initialCollateralPrice = new BN(2 * 1e4)
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: initialCollateralPrice
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)

    const data = await createAssetsList({
      exchangeAuthority,
      assetsAdmin: ASSETS_MANAGER_ADMIN,
      collateralToken,
      collateralTokenFeed,
      connection,
      manager,
      wallet
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      manager,
      exchangeAuthority,
      exchangeProgram.programId
    )
    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
      collateralAccount,
      liquidationAccount,
      collateralToken: collateralToken.publicKey,
      nonce
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      manager,
      exchangeAuthority,
      exchangeProgram.programId
    )
    const liquidatorData = await createAccountWithCollateralAndMaxMintUsd({
      usdToken,
      collateralAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: new BN(1000 * 1e6)
    })
    liquidator = liquidatorData.accountOwner
    liquidatorUsdAccount = liquidatorData.usdTokenAccount
    liquidatorCollateralAccount = liquidatorData.userCollateralTokenAccount
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.liquidationAccount.equals(liquidationAccount))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 10)
    assert.ok(state.fee === 300)
    assert.ok(state.liquidationPenalty === 15)
    assert.ok(state.liquidationThreshold === 200)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.debtShares.gt(new BN(0)))
    assert.ok(state.collateralShares.gt(new BN(0)))
  })
  it('#liquidate()', async () => {
    const collateralAmount = new BN(1000 * 1e6)
    const {
      accountOwner,
      exchangeAccount,
      userCollateralTokenAccount,
      usdMintAmount
    } = await createAccountWithCollateralAndMaxMintUsd({
      collateralAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      usdToken,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })

    const assetsListData = await manager.getAssetsList(assetsList)
    assert.ok(assetsListData.assets[1].price.eq(initialCollateralPrice))

    const newCollateralPrice = initialCollateralPrice.div(new BN(5))
    await oracleProgram.rpc.setPrice(newCollateralPrice, {
      accounts: {
        admin: ORACLE_ADMIN.publicKey,
        priceFeed: collateralTokenFeed
      },
      signers: [ORACLE_ADMIN]
    })
    // update prices
    await manager.updatePrices(assetsList)
    const state = await exchange.getState()

    const assetsListDataUpdated = await manager.getAssetsList(assetsList)
    assert.ok(assetsListDataUpdated.assets[1].price.eq(newCollateralPrice))

    const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
    assert.ok(userCollateralBalance.eq(collateralAmount))
    const collateralUsdValue = tokenToUsdValue(
      userCollateralBalance,
      assetsListDataUpdated.assets[1]
    )
    assert.ok(
      collateralUsdValue.eq(userCollateralBalance.mul(newCollateralPrice).div(new BN(10 ** 4)))
    )
    const exchangeDebt = calculateDebt(assetsListDataUpdated)
    const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
    assert.ok(userDebtBalance.eq(usdMintAmount))
    const { maxBurnUsd, systemRewardUsd, userRewardUsd } = calculateLiquidation(
      collateralUsdValue,
      userDebtBalance,
      state.collateralizationLevel,
      state.liquidationPenalty
    )
    // trigger liquidation
    await exchange.liquidate({
      exchangeAccount,
      allowanceAmount: maxBurnUsd,
      signer: liquidator.publicKey,
      userCollateralAccount: liquidatorCollateralAccount,
      userUsdAccount: liquidatorUsdAccount,
      signers: [liquidator]
    })
    await exchange.getState()
    const assetsListDataAfter = await manager.getAssetsList(assetsList)

    // user debt should be reduced
    const userDebtBalanceAfter = await exchange.getUserDebtBalance(exchangeAccount)
    assert.ok(userDebtBalanceAfter.eq(userDebtBalance.sub(maxBurnUsd)))

    const userCollateralBalanceAfter = await exchange.getUserCollateralBalance(exchangeAccount)
    const collateralUsdValueAfter = tokenToUsdValue(
      userCollateralBalanceAfter,
      assetsListDataAfter.assets[1]
    )
    // user collateral should be reduced
    assert.ok(
      collateralUsdValueAfter.eq(collateralUsdValue.sub(systemRewardUsd).sub(userRewardUsd))
    )
    const sytemLiquidationAccountData = await collateralToken.getAccountInfo(liquidationAccount)
    const sytemLiquidationValue = sytemLiquidationAccountData.amount
      .mul(assetsListDataAfter.assets[1].price)
      .addn(10 ** 4 - 1) // round up
      .div(new BN(10 ** 4))

    // system account should get part of liquidation
    assert.ok(sytemLiquidationValue.eq(systemRewardUsd))
    const liquidatorLiquidationAccountData = await collateralToken.getAccountInfo(
      liquidatorCollateralAccount
    )

    const liquidatorLiquidationValue = liquidatorLiquidationAccountData.amount
      .mul(assetsListDataAfter.assets[1].price)
      .addn(10 ** 4 - 1) // round up
      .div(new BN(10 ** 4))
    // liquidator should get part of liquidation
    assert.ok(liquidatorLiquidationValue.eq(userRewardUsd))

    // user collateral should reduce by amount transfered out
    assert.ok(
      userCollateralBalanceAfter.eq(
        userCollateralBalance
          .sub(sytemLiquidationAccountData.amount)
          .sub(liquidatorLiquidationAccountData.amount)
      )
    )
    const exchangeDebtAfter = calculateDebt(assetsListDataAfter)
    // debt of exchange should reduce
    assert.ok(exchangeDebtAfter.eq(exchangeDebt.sub(maxBurnUsd)))
  })
})
