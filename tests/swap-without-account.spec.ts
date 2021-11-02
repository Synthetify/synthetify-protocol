import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  calculateDebt,
  SYNTHETIFY_EXCHANGE_SEED,
  calculateAmountAfterFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync,
  calculateFee,
  calculateSwapTax,
  U64_MAX,
  eqDecimals,
  mulByDecimal
} from './utils'
import { createPriceFeed, getFeedData, setConfidence, setFeedTrading } from './oracleUtils'
import {
  ERRORS,
  percentToDecimal,
  sleep,
  SNY_DECIMALS,
  toDecimal,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { Asset, PriceStatus, Synthetic } from '../sdk/lib/exchange'
import { Decimal } from '@synthetify/sdk/src/exchange'

describe('exchange', () => {
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
  let snyReserve: PublicKey
  let snyLiquidationFund: PublicKey
  let stakingFundAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let btcFeed: PublicKey
  let nonce: number
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_EXCHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2
      // expo: -6
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
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addresses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 0)

    assert.ok(eqDecimals(state.fee, percentToDecimal(0.3)))
    // assert.ok(state.swapTaxRatio === 20)
    assert.ok(eqDecimals(state.swapTaxReserve, toDecimal(new BN(0), SNY_DECIMALS)))
    // console.log(state.debtInterestRate)
    // console.log(percentToDecimal(1))
    // assert.ok(eqDecimals(state.debtInterestRate, percentToDecimal(1)))
    assert.ok(eqDecimals(state.accumulatedDebtInterest, toDecimal(new BN(0), XUSD_DECIMALS)))
    assert.ok(state.debtShares.eq(new BN(0)))
  })
  it('Account Creation', async () => {
    const accountOwner = new Account().publicKey
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner)

    const userExchangeAccount = await exchange.getExchangeAccount(exchangeAccount)
    // Owner of account
    assert.ok(userExchangeAccount.owner.equals(accountOwner))
    // Initial values
    assert.ok(userExchangeAccount.debtShares.eq(new BN(0)))
    assert.ok(userExchangeAccount.version === 0)
    assert.ok(userExchangeAccount.collaterals.length === 0)
  })
  describe('#swap()', async () => {
    let btcToken: Token
    let ethToken: Token
    let zeroMaxSupplyToken: Token
    let healthFactor: Decimal

    before(async () => {
      healthFactor = (await exchange.getState()).healthFactor

      btcToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      btcFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 50000,
        expo: -9
      })
      ethToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const zeroMaxSupplyTokenFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 20,
        expo: -4
      })
      zeroMaxSupplyToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const ethFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2000,
        expo: -8
      })
      const newAssetLimit = new BN(10).pow(new BN(18))

      const addBtcIx = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: btcFeed
      })
      await signAndSend(new Transaction().add(addBtcIx), [EXCHANGE_ADMIN], connection)
      const addBtcSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: btcToken.publicKey,
        assetsList,
        maxSupply: newAssetLimit,
        priceFeed: btcFeed
      })
      await signAndSend(new Transaction().add(addBtcSynthetic), [EXCHANGE_ADMIN], connection)
      const addEthIx = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: ethFeed
      })
      await signAndSend(new Transaction().add(addEthIx), [EXCHANGE_ADMIN], connection)
      const addEthSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: ethToken.publicKey,
        assetsList,
        maxSupply: newAssetLimit,
        priceFeed: ethFeed
      })
      await signAndSend(new Transaction().add(addEthSynthetic), [EXCHANGE_ADMIN], connection)
      const addZeroMaxSupplyTokenIx = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: zeroMaxSupplyTokenFeed
      })
      await signAndSend(
        new Transaction().add(addZeroMaxSupplyTokenIx),
        [EXCHANGE_ADMIN],
        connection
      )
      const addZeroMaxSupplySynthetic = await exchange.addSyntheticInstruction({
        assetAddress: zeroMaxSupplyToken.publicKey,
        assetsList,
        maxSupply: new BN(0),
        priceFeed: zeroMaxSupplyTokenFeed
      })
      await signAndSend(
        new Transaction().add(addZeroMaxSupplySynthetic),
        [EXCHANGE_ADMIN],
        connection
      )
    })
    it('Swap usd->btc->eth (without exchange account)', async () => {
      const collateralAmount = new BN(90 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      //   create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)

      // We can mint max 9 * 1e6
      const usdMintAmount = mulByDecimal(new BN(9 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await exchange.getAssetsList(assetsList)
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(eqDecimals(effectiveFee, percentToDecimal(0.3))) // discount 0%
      const stateBeforeSwap = await exchange.getState()
      assert.ok(stateBeforeSwap.swapTaxReserve.val.eq(new BN(0))) // pull fee should equals 0 before swaps

      // 4.5$(IN value), 4.4865$(OUT value)
      // expected fee 0.0135$ -> 135 * 10^2
      // expected admin tax 0.0027$ -> 27 * 10^2
      await exchange.swap({
        amount: usdMintAmount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: assetsListData.synthetics[0].assetAddress,
        signers: [accountOwner]
      })
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic
      const btcAsset = assetsListData.assets[btcSynthetic.assetIndex]
      const usdSynthetic = assetsListData.synthetics[0]
      const usdAsset = assetsListData.assets[usdSynthetic.assetIndex]
      const btcAmountOut = calculateAmountAfterFee(
        usdAsset,
        btcAsset,
        usdSynthetic,
        btcSynthetic,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(btcAmountOut))

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))

      const stateAfterSwap = await exchange.getState()
      const assetsListDataAfterSwap = await exchange.getAssetsList(assetsList)
      const totalFee = calculateFee(usdAsset, usdSynthetic, usdMintAmount, effectiveFee)
      const adminTax = calculateSwapTax(totalFee, exchange.state.swapTaxRatio)
      // check swapTaxReserve was increased by admin swap tax
      assert.ok(stateAfterSwap.swapTaxReserve.val.eq(adminTax))
      // supply should be equals supply before swap minus minted usd amount plus admin swap tax
      assert.ok(
        assetsListDataAfterSwap.synthetics[0].supply.val.eq(
          assetsListData.synthetics[0].supply.val.sub(usdMintAmount).add(adminTax)
        )
      )
      const ethSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(ethToken.publicKey)
      ) as Synthetic
      const ethAsset = assetsListData.assets[ethSynthetic.assetIndex]

      const userEthTokenAccountBefore = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountBefore.amount.eq(new BN(0)))

      // 4.4865$(IN value), 4.472$(OUT value)
      // expected fee 0,013459$ -> 13459
      // expected admin tax ratio, additional swap tax reserve, additional xUSD supply:
      // 0,002691$ -> 2691
      await exchange.swap({
        amount: btcAmountOut,
        owner: accountOwner.publicKey,
        userTokenAccountFor: ethTokenAccount,
        userTokenAccountIn: btcTokenAccount,
        tokenFor: ethToken.publicKey,
        tokenIn: btcToken.publicKey,
        signers: [accountOwner]
      })

      const ethAmountOut = calculateAmountAfterFee(
        btcAsset,
        ethAsset,
        btcSynthetic,
        ethSynthetic,
        effectiveFee,
        btcAmountOut
      )
      const userEthTokenAccountAfter = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountAfter.amount.eq(ethAmountOut))

      const stateAfterSecondSwap = await exchange.getState()
      const assetsListDataAfterSecondSwap = await exchange.getAssetsList(assetsList)
      const totalFeeSecondSwap = calculateFee(btcAsset, btcSynthetic, btcAmountOut, effectiveFee)
      const adminTaxSecondSwap = calculateSwapTax(totalFeeSecondSwap, exchange.state.swapTaxRatio)
      // check swapTaxReserve was increased by admin swap tax
      assert.ok(
        stateAfterSecondSwap.swapTaxReserve.val.eq(
          adminTaxSecondSwap.add(stateAfterSwap.swapTaxReserve.val)
        )
      )
      // supply should be equals supply before swap plus admin swap tax
      assert.ok(
        assetsListDataAfterSecondSwap.synthetics[0].supply.val.eq(
          assetsListDataAfterSwap.synthetics[0].supply.val.add(adminTaxSecondSwap)
        )
      )
    })
    it('Swap usd->btc->eth (without exchange account)', async () => {
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: new BN(0)
        })
      const collateralAmount = new BN(1000 * 1e6)
      const temp = await createAccountWithCollateral({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccountTemp = await usdToken.createAccount(temp.accountOwner.publicKey)
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)
      // We can mint max 200 * 1e6
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount: temp.exchangeAccount,
        owner: temp.accountOwner.publicKey,
        to: usdTokenAccountTemp,
        signers: [temp.accountOwner]
      })
      const userUsdTokenAccountPreTransfer = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountPreTransfer.amount.eq(new BN(0)))

      await usdToken.transfer(
        usdTokenAccountTemp,
        usdTokenAccount,
        temp.accountOwner,
        [],
        tou64(usdMintAmount)
      )

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await exchange.getAssetsList(assetsList)
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      assert.ok(userCollateralBalance.eq(new BN(0)))
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(eqDecimals(effectiveFee, percentToDecimal(0.3))) // discount 0%

      const usdSynthetic = assetsListData.synthetics[0]
      const usdAsset = assetsListData.assets[usdSynthetic.assetIndex]
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic
      const btcAsset = assetsListData.assets[btcSynthetic.assetIndex]
      const stateBeforeSwap = await exchange.getState()

      // 100$(IN value), 99.7$(OUT value)
      // expected fee 0.3$ -> 3 * 10^5
      // expected admin tax 0.06$ -> 6 * 10^4
      await exchange.swap({
        amount: usdMintAmount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: usdSynthetic.assetAddress,
        signers: [accountOwner]
      })

      const btcAmountOut = calculateAmountAfterFee(
        usdAsset,
        btcAsset,
        usdSynthetic,
        btcSynthetic,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(btcAmountOut))

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))

      const stateAfterSwap = await exchange.getState()
      const assetsListDataAfterSwap = await exchange.getAssetsList(assetsList)
      const totalFee = calculateFee(usdAsset, usdSynthetic, usdMintAmount, effectiveFee)
      const adminTax = calculateSwapTax(totalFee, exchange.state.swapTaxRatio)
      // check swapTaxReserve was increased by admin swap tax
      assert.ok(
        stateAfterSwap.swapTaxReserve.val.eq(stateBeforeSwap.swapTaxReserve.val.add(adminTax))
      )
      // supply should be equals supply before swap minus minted usd amount plus admin swap tax
      assert.ok(
        assetsListDataAfterSwap.synthetics[0].supply.val.eq(
          assetsListData.synthetics[0].supply.val.sub(usdMintAmount).add(adminTax)
        )
      )
      const ethSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(ethToken.publicKey)
      ) as Synthetic
      const ethAsset = assetsListData.assets[ethSynthetic.assetIndex]

      const userEthTokenAccountBefore = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountBefore.amount.eq(new BN(0)))

      // 99.7$(IN value), 99.402$(OUT value)
      // expected fee 0.2991$ ->  2991 * 10^2
      // expected admin tax ratio, additional swap tax reserve, additional xUSD supply:
      // 0.05982$ -> 5982 * 10^1
      await exchange.swap({
        amount: btcAmountOut,
        owner: accountOwner.publicKey,
        userTokenAccountFor: ethTokenAccount,
        userTokenAccountIn: btcTokenAccount,
        tokenFor: ethToken.publicKey,
        tokenIn: btcToken.publicKey,
        signers: [accountOwner]
      })

      const ethAmountOut = calculateAmountAfterFee(
        btcAsset,
        ethAsset,
        btcSynthetic,
        ethSynthetic,
        effectiveFee,
        btcAmountOut
      )
      const userEthTokenAccountAfter = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountAfter.amount.eq(ethAmountOut))

      const stateAfterSecondSwap = await exchange.getState()
      const assetsListDataAfterSecondSwap = await exchange.getAssetsList(assetsList)
      const totalFeeSecondSwap = calculateFee(btcAsset, btcSynthetic, btcAmountOut, effectiveFee)
      const adminTaxSecondSwap = calculateSwapTax(totalFeeSecondSwap, exchange.state.swapTaxRatio)
      // check swapTaxReserve was increased by admin swap tax
      assert.ok(
        stateAfterSecondSwap.swapTaxReserve.val.eq(
          stateAfterSwap.swapTaxReserve.val.add(adminTaxSecondSwap)
        )
      )
      // supply should be equals supply before swap plus admin swap tax
      assert.ok(
        assetsListDataAfterSecondSwap.synthetics[0].supply.val.eq(
          assetsListDataAfterSwap.synthetics[0].supply.val.add(adminTaxSecondSwap)
        )
      )
    })
  })
})
