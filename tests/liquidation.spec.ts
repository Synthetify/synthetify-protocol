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
  ORACLE_OFFSET,
  calculateDebt,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  tokenToUsdValue,
  assertThrowsAsync,
  U64_MAX
} from './utils'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { ERRORS, ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'
import { calculateUserCollateral, calculateUserMaxDebt } from '@synthetify/sdk/lib/utils'

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

    const data = await createAssetsList({
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange,
      snyReserve,
      snyLiquidationFund
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

    const liquidatorData = await createAccountWithCollateralAndMaxMintUsd({
      usdToken,
      collateralToken,
      exchangeAuthority,
      exchange,
      reserveAddress: snyReserve,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: new BN(100000 * 1e6) // give enough for liquidations
    })

    liquidator = liquidatorData.accountOwner
    liquidatorUsdAccount = liquidatorData.usdTokenAccount
    liquidatorCollateralAccount = liquidatorData.userCollateralTokenAccount
    const state = await exchange.getState()
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 0)
    assert.ok(state.fee === 300)
    assert.ok(state.penaltyToExchange === 5)
    assert.ok(state.penaltyToLiquidator === 5)
    assert.ok(state.liquidationRate === 20)
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.gt(new BN(0)))
  })
  describe.only('#liquidate()', async () => {
    afterEach(async () => {
      await setFeedPrice(oracleProgram, initialCollateralPrice, collateralTokenFeed)
    })
    beforeEach(async () => {
      // change liquidation buffor for sake of tests
      const newLiquidationBuffer = 0
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
    })
    it('should liquidate', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const { exchangeAccount, usdMintAmount } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        usdToken,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const assetsListData = await exchange.getAssetsList(assetsList)
      assert.ok(assetsListData.assets[1].price.eq(new BN(initialCollateralPrice * 1e6)))

      const newCollateralPrice = initialCollateralPrice / 5
      await setFeedPrice(oracleProgram, newCollateralPrice, collateralTokenFeed)

      // update prices
      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()

      const assetsListDataUpdated = await exchange.getAssetsList(assetsList)
      assert.ok(assetsListDataUpdated.assets[1].price.eq(new BN(newCollateralPrice * 1e6)))

      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      assert.ok(userCollateralBalance.eq(collateralAmount))
      const collateralUsdValue = tokenToUsdValue(
        userCollateralBalance,
        assetsListDataUpdated.assets[1]
      )

      assert.ok(
        collateralUsdValue.eq(
          userCollateralBalance
            .mul(new BN(newCollateralPrice * 1e6))
            .div(new BN(10 ** ORACLE_OFFSET))
        )
      )
      const exchangeDebt = calculateDebt(assetsListDataUpdated)
      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListDataUpdated)

      assert.ok(userDebtBalance.eq(usdMintAmount))
      const collateralAsset = assetsListDataUpdated.assets[1]
      const {
        collateralToExchange,
        collateralToLiquidator,
        maxAmount,
        seizedInToken
      } = calculateLiquidation(
        userMaxDebt,
        userDebtBalance,
        state.penaltyToLiquidator,
        state.penaltyToExchange,
        state.liquidationRate,
        collateralAsset
      )
      // trigger liquidation without marking account
      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: maxAmount,
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: [liquidator]
        }),
        ERRORS_EXCHANGE.LIQUIDATION_DEADLINE
      )
      const exchangeAccountDataBeforeCheck = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataBeforeCheck.liquidationDeadline.eq(U64_MAX))

      // change liquidation buffor for sake of test
      const newLiquidationBuffer = 10
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const updatedState = await exchange.getState()
      assert.ok((updatedState.liquidationBuffer = newLiquidationBuffer))

      // set account liquidation deadline
      await exchange.checkAccount(exchangeAccount)
      const slot = await connection.getSlot()
      const exchangeAccountDataAfterCheck = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountDataAfterCheck.liquidationDeadline.eqn(slot + newLiquidationBuffer))

      // trigger liquidation without waiting for liquidation deadline
      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: maxAmount,
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: [liquidator]
        }),
        ERRORS_EXCHANGE.LIQUIDATION_DEADLINE
      )
      // wait for liquidation deadline
      await sleep(6000)
      // trigger liquidation
      await exchange.liquidate({
        exchangeAccount,
        signer: liquidator.publicKey,
        liquidationFund: collateralAsset.collateral.liquidationFund,
        amount: maxAmount,
        liquidatorCollateralAccount,
        liquidatorUsdAccount,
        reserveAccount: collateralAsset.collateral.reserveAddress,
        signers: [liquidator]
      })

      await exchange.getState()
      const assetsListDataAfter = await exchange.getAssetsList(assetsList)

      await exchange.checkAccount(exchangeAccount)
      const exchangeAccountDataAfterLiquidation = await exchange.getExchangeAccount(exchangeAccount)

      // user debt should be reduced
      const userDebtBalanceAfter = await exchange.getUserDebtBalance(exchangeAccount)
      assert.ok(userDebtBalanceAfter.eq(userDebtBalance.sub(maxAmount)))
      assert.ok(
        exchangeAccountDataAfterLiquidation.collaterals[0].amount.eq(
          exchangeAccountData.collaterals[0].amount
            .sub(collateralToExchange)
            .sub(collateralToLiquidator)
        )
      )

      const liquidationFundAccountData = await collateralToken.getAccountInfo(
        collateralAsset.collateral.liquidationFund
      )

      // system account should get part of liquidation
      assert.ok(liquidationFundAccountData.amount.eq(collateralToExchange))
      const liquidatorLiquidationAccountData = await collateralToken.getAccountInfo(
        liquidatorCollateralAccount
      )

      // liquidator should get part of liquidation
      assert.ok(liquidatorLiquidationAccountData.amount.eq(collateralToLiquidator))

      const exchangeDebtAfter = calculateDebt(assetsListDataAfter)
      // debt of exchange should reduce
      assert.ok(exchangeDebtAfter.eq(exchangeDebt.sub(maxAmount)))

      // Withdraw liquidation penalty
      const withdrawPenaltyDestination = await collateralToken.createAccount(exchangeAuthority)

      const withdrawPenaltyIx = await exchangeProgram.state.instruction.withdrawLiquidationPenalty(
        liquidationFundAccountData.amount,
        {
          accounts: {
            admin: EXCHANGE_ADMIN.publicKey,
            exchangeAuthority: exchangeAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
            liquidationFund: collateralAsset.collateral.liquidationFund,
            to: withdrawPenaltyDestination,
            assetsList: assetsList
          }
        }
      )
      // Fail without admin signature
      await assertThrowsAsync(
        signAndSend(new Transaction().add(withdrawPenaltyIx), [wallet], connection),
        ERRORS.SIGNATURE
      )
      await signAndSend(
        new Transaction().add(withdrawPenaltyIx),
        [wallet, EXCHANGE_ADMIN],
        connection
      )
      assert.ok(
        (
          await collateralToken.getAccountInfo(collateralAsset.collateral.liquidationFund)
        ).amount.eq(new BN(0))
      )
      assert.ok(
        (await collateralToken.getAccountInfo(withdrawPenaltyDestination)).amount.eq(
          liquidationFundAccountData.amount
        )
      )
    })
    it('check halted', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const { exchangeAccount } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        usdToken,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const newCollateralPrice = initialCollateralPrice / 5
      await setFeedPrice(oracleProgram, newCollateralPrice, collateralTokenFeed)

      // update prices
      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()

      const assetsListDataUpdated = await exchange.getAssetsList(assetsList)

      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListDataUpdated)
      const collateralAsset = assetsListDataUpdated.assets[1]

      const { maxAmount } = calculateLiquidation(
        userMaxDebt,
        userDebtBalance,
        state.penaltyToLiquidator,
        state.penaltyToExchange,
        state.liquidationRate,
        collateralAsset
      )
      // change liquidation buffor for sake of test
      const newLiquidationBuffer = 10
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

      // set account liquidation deadline
      await exchange.checkAccount(exchangeAccount)

      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: maxAmount,
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: [liquidator]
        }),
        ERRORS_EXCHANGE.LIQUIDATION_DEADLINE
      )
      // wait for liquidation deadline
      await sleep(6000)
      // halt program
      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // trigger liquidation halted
      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: maxAmount,
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: [liquidator]
        }),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ixUnlock = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ixUnlock), [wallet, EXCHANGE_ADMIN], connection)
      const stateUnlocked = await exchange.getState()
      assert.ok(stateUnlocked.halted === false)

      // trigger liquidation
      await exchange.liquidate({
        exchangeAccount,
        signer: liquidator.publicKey,
        liquidationFund: collateralAsset.collateral.liquidationFund,
        amount: maxAmount,
        liquidatorCollateralAccount,
        liquidatorUsdAccount,
        reserveAccount: collateralAsset.collateral.reserveAddress,
        signers: [liquidator]
      })
    })
    it('fail without signer', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const { exchangeAccount, usdMintAmount } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        usdToken,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const newCollateralPrice = initialCollateralPrice / 5
      await setFeedPrice(oracleProgram, newCollateralPrice, collateralTokenFeed)
      // update prices
      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()

      const assetsListDataUpdated = await exchange.getAssetsList(assetsList)

      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      assert.ok(userCollateralBalance.eq(collateralAmount))

      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListDataUpdated)
      const collateralAsset = assetsListDataUpdated.assets[1]

      const { maxAmount } = calculateLiquidation(
        userMaxDebt,
        userDebtBalance,
        state.penaltyToLiquidator,
        state.penaltyToExchange,
        state.liquidationRate,
        collateralAsset
      )
      // trigger liquidation
      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: maxAmount,
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: []
        }),
        ERRORS.NO_SIGNERS
      )
    })
    it('fail liquidate safe user', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const { exchangeAccount, usdMintAmount } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        usdToken,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const assetsListData = await exchange.getAssetsList(assetsList)
      assert.ok(assetsListData.assets[1].price.eq(new BN(initialCollateralPrice * 1e6)))

      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()

      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListData)
      const collateralAsset = assetsListData.assets[1]

      await assertThrowsAsync(
        exchange.liquidate({
          exchangeAccount,
          signer: liquidator.publicKey,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          amount: new BN(100),
          liquidatorCollateralAccount,
          liquidatorUsdAccount,
          reserveAccount: collateralAsset.collateral.reserveAddress,
          signers: [liquidator]
        }),
        ERRORS_EXCHANGE.LIQUIDATION_DEADLINE
      )
    })
    it.only('fail wrong asset list', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const { exchangeAccount, usdMintAmount } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        usdToken,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const newCollateralPrice = initialCollateralPrice / 5
      await setFeedPrice(oracleProgram, newCollateralPrice, collateralTokenFeed)
      // update prices
      await exchange.updatePrices(assetsList)
      const state = await exchange.getState()
      const assetsListData = await exchange.getAssetsList(assetsList)

      const userDebtBalance = await exchange.getUserDebtBalance(exchangeAccount)
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      const userMaxDebt = calculateUserMaxDebt(exchangeAccountData, assetsListData)
      const collateralAsset = assetsListData.assets[1]

      const { maxAmount } = calculateLiquidation(
        userMaxDebt,
        userDebtBalance,
        state.penaltyToLiquidator,
        state.penaltyToExchange,
        state.liquidationRate,
        collateralAsset
      )

      const updateIx = await exchange.updatePricesInstruction(exchange.state.assetsList)

      const fakeAssetList = await createAssetsList({
        exchangeAuthority,
        collateralToken,
        collateralTokenFeed,
        connection,
        wallet,
        exchange,
        snyReserve,
        snyLiquidationFund
      })
      const liquidateIx = (await exchange.program.state.instruction.liquidate(maxAmount, {
        accounts: {
          exchangeAuthority: exchange.exchangeAuthority,
          assetsList: fakeAssetList.assetsList,
          tokenProgram: TOKEN_PROGRAM_ID,
          exchangeAccount: exchangeAccount,
          signer: liquidator.publicKey,
          usdToken: assetsListData.assets[0].synthetic.assetAddress,
          liquidatorUsdAccount: liquidatorUsdAccount,
          liquidatorCollateralAccount: liquidatorCollateralAccount,
          liquidationFund: collateralAsset.collateral.liquidationFund,
          reserveAccount: collateralAsset.collateral.reserveAddress
        }
      })) as TransactionInstruction
      const approveIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        liquidatorUsdAccount,
        exchange.exchangeAuthority,
        liquidator.publicKey,
        [],
        tou64(maxAmount)
      )
      const liquidateTx = new Transaction().add(updateIx).add(approveIx).add(liquidateIx)
      const blockhash = await connection.getRecentBlockhash(Provider.defaultOptions().commitment)
      const txs = [liquidateTx]
      txs.forEach((tx) => {
        tx.feePayer = exchange.wallet.publicKey
        tx.recentBlockhash = blockhash.blockhash
      })
      exchange.wallet.signAllTransactions(txs)
      txs[0].partialSign(liquidator)
      const promisesTx = txs.map((tx) => sendAndConfirmRawTransaction(connection, tx.serialize()))
      await assertThrowsAsync(Promise.all(promisesTx), ERRORS_EXCHANGE.INVALID_ASSETS_LIST)
    })
  })
})
