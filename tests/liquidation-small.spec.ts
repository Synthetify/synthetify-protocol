import * as anchor from '@project-serum/anchor'
import { Program, Provider } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert } from 'chai'
import { BN, calculateLiquidation, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  sleep,
  EXCHANGE_ADMIN,
  tou64,
  calculateDebt,
  SYNTHETIFY_EXCHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  tokenToUsdValue,
  assertThrowsAsync,
  U64_MAX,
  eqDecimals,
  createCollateralToken,
  mulByDecimal,
  createAccountWithCollateral
} from './utils'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { ERRORS, ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'
import { calculateUserMaxDebt, percentToDecimal, SNY_DECIMALS } from '@synthetify/sdk/lib/utils'
import { ORACLE_OFFSET } from '@synthetify/sdk'
import { Collateral } from '@synthetify/sdk/lib/exchange'

describe('liquidation', () => {
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
  let stakingFundAccount: PublicKey
  let snyReserve: PublicKey
  let snyLiquidationFund: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number

  let liquidator: Account
  let liquidatorUsdAccount: PublicKey
  let liquidatorCollateralAccount: PublicKey

  let snyCollateral: Collateral
  let btcToken: Token
  let btcReserve: PublicKey
  let btcTokenFeed: PublicKey

  const initialCollateralPrice = 2
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_EXCHANGE_SEED],
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
    snyReserve = await collateralToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

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
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchangeAdmin: EXCHANGE_ADMIN,
      exchange,
      snyReserve,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    await exchange.getState()
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)

    snyCollateral = (await exchange.getAssetsList(assetsList)).collaterals[0]
    const liquidatorData = await createAccountWithCollateralAndMaxMintUsd({
      usdToken,
      collateralToken,
      exchangeAuthority,
      exchange,
      reserveAddress: snyReserve,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: new BN(100000 * 10 ** SNY_DECIMALS) // give enough for liquidations
    })

    liquidator = liquidatorData.accountOwner
    liquidatorUsdAccount = liquidatorData.usdTokenAccount
    liquidatorCollateralAccount = liquidatorData.userCollateralTokenAccount
    await exchange.getState()

    // creating BTC
    const btc = await createCollateralToken({
      decimals: 10,
      price: 50000,
      collateralRatio: 10,
      exchange,
      exchangeAuthority,
      oracleProgram,
      connection,
      wallet
    })
    btcToken = btc.token
    btcReserve = btc.reserve
    btcTokenFeed = btc.feed
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    assert.ok(eqDecimals(state.penaltyToExchange, percentToDecimal(5)))
    assert.ok(eqDecimals(state.penaltyToLiquidator, percentToDecimal(5)))
    assert.ok(eqDecimals(state.liquidationRate, percentToDecimal(20)))
    assert.ok(state.liquidationBuffer === 2250)
  })
  describe('#liquidate()', async () => {
    afterEach(async () => {
      await setFeedPrice(oracleProgram, initialCollateralPrice, collateralTokenFeed)
    })
    beforeEach(async () => {
      // change liquidation buffer for sake of tests
      const newLiquidationBuffer = 0
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
    })
    it('max liquidate sub dolar debt', async () => {
      const collateralAmount = new BN(10 * 10 ** SNY_DECIMALS) // 20 USD
      const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      // We can mint max 200 * 1e6 * healthFactor
      const healthFactor = (await exchange.getState()).healthFactor
      const usdMintAmount = mulByDecimal(new BN(1 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      const assetsListData = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetsListData.assets[1].price.val.eq(
          new BN(10 ** ORACLE_OFFSET).muln(initialCollateralPrice)
        )
      )
      const newCollateralPrice = initialCollateralPrice / 20
      await setFeedPrice(oracleProgram, newCollateralPrice, collateralTokenFeed)
      // update prices
      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()
      const assetsListDataUpdated = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetsListDataUpdated.assets[1].price.val.eq(
          new BN(newCollateralPrice * 10 ** ORACLE_OFFSET)
        )
      )
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      assert.ok(userCollateralBalance.eq(collateralAmount))
      const collateralUsdValue = tokenToUsdValue(
        userCollateralBalance,
        assetsListDataUpdated.assets[assetsListDataUpdated.collaterals[0].assetIndex],
        assetsListDataUpdated.collaterals[0]
      )
      // mul ORACLE_OFFSET and div ORACLE_OFFSET because of rounding
      assert.ok(
        collateralUsdValue.eq(
          userCollateralBalance
            .mul(new BN(newCollateralPrice * 10 ** ORACLE_OFFSET))
            .div(new BN(10 ** ORACLE_OFFSET))
        )
      )
      const exchangeDebt = calculateDebt(assetsListDataUpdated)
      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListDataUpdated)
      assert.ok(userDebtBalance.eq(usdMintAmount))
      const collateral = assetsListDataUpdated.collaterals[0]
      const collateralAsset = assetsListDataUpdated.assets[collateral.assetIndex]
      const { collateralToExchange, collateralToLiquidator, maxAmount } = calculateLiquidation(
        userMaxDebt,
        userDebtBalance,
        state.penaltyToLiquidator,
        state.penaltyToExchange,
        state.liquidationRate,
        collateralAsset,
        collateral
      )
      const exchangeAccountDataBeforeCheck = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataBeforeCheck.liquidationDeadline.eq(U64_MAX))
      // change liquidation buffer for sake of test
      const newLiquidationBuffer = 10
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const updatedState = await exchange.getState()
      assert.ok((updatedState.liquidationBuffer = newLiquidationBuffer))
      // set account liquidation deadline
      await exchange.checkAccount(exchangeAccount)
      const slot = await connection.getSlot()
      const exchangeAccountDataAfterCheck = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataAfterCheck.liquidationDeadline.eqn(slot + newLiquidationBuffer))

      const liquidationFundAccountDataBefore = await collateralToken.getAccountInfo(
        collateral.liquidationFund
      )
      const liquidatorLiquidationAccountDataBefore = await collateralToken.getAccountInfo(
        liquidatorCollateralAccount
      )
      // wait for liquidation deadline
      await sleep(6000)

      // trigger liquidation
      await exchange.liquidate({
        exchangeAccount,
        signer: liquidator.publicKey,
        liquidationFund: collateral.liquidationFund,
        amount: U64_MAX,
        liquidatorCollateralAccount,
        liquidatorUsdAccount,
        reserveAccount: collateral.reserveAddress,
        signers: [liquidator]
      })
      await exchange.getState()
      const assetsListDataAfter = await exchange.getAssetsList(assetsList)
      await exchange.checkAccount(exchangeAccount)
      const exchangeAccountDataAfterLiquidation = await exchange.getExchangeAccount(exchangeAccount)
      // user debt should be reduced
      const userDebtBalanceAfter = await exchange.getUserDebtBalance(exchangeAccount)
      // Debt should be zero
      assert.ok(userDebtBalanceAfter.eq(new BN(0)))
      assert.ok(
        exchangeAccountDataAfterLiquidation.collaterals[0].amount.eq(
          exchangeAccountData.collaterals[0].amount
            .sub(collateralToExchange)
            .sub(collateralToLiquidator)
        )
      )
      const liquidationFundAccountData = await collateralToken.getAccountInfo(
        collateral.liquidationFund
      )
      // system account should get part of liquidation
      assert.ok(
        liquidationFundAccountData.amount.eq(
          liquidationFundAccountDataBefore.amount.add(collateralToExchange)
        )
      )
      const liquidatorLiquidationAccountData = await collateralToken.getAccountInfo(
        liquidatorCollateralAccount
      )
      // liquidator should get part of liquidation
      assert.ok(
        liquidatorLiquidationAccountData.amount.eq(
          liquidatorLiquidationAccountDataBefore.amount.add(collateralToLiquidator)
        )
      )
      const exchangeDebtAfter = calculateDebt(assetsListDataAfter)
      // debt of exchange should reduce
      assert.ok(exchangeDebtAfter.eq(exchangeDebt.sub(maxAmount)))
    })
  })
})
