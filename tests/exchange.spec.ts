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
  SYNTHETIFY_ECHANGE_SEED,
  calculateAmountAfterFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync,
  calculateFee,
  calculateSwapTax,
  U64_MAX,
  eqDecimals,
  mulByDecimal
} from './utils'
import { createPriceFeed, getFeedData, setFeedTrading } from './oracleUtils'
import {
  ERRORS,
  percentToDecimal,
  sleep,
  SNY_DECIMALS,
  toDecimal,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { PriceStatus, Synthetic } from '../sdk/lib/exchange'
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
  let nonce: number
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
    const state = await exchange.getState()
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
    await sleep(10000)
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
  describe('#deposit()', async () => {
    it('Deposit collateral 1st', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(10 * 1e6) // Mint 10 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const userCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      // Minted amount
      assert.ok(userCollateralTokenAccountInfo.amount.eq(amount))
      const exchangeCollateralTokenAccountInfo = await collateralToken.getAccountInfo(snyReserve)
      // No previous deposits
      assert.ok(exchangeCollateralTokenAccountInfo.amount.eq(new BN(0)))
      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey,
        reserveAddress: snyReserve
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        snyReserve
      )

      // Increase by deposited amount
      assert.ok(exchangeCollateralTokenAccountInfoAfter.amount.eq(amount))

      const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(userExchangeAccountAfter.collaterals[0].amount.eq(amount))
      const assetListData = await exchange.getAssetsList(assetsList)
      assert.ok(assetListData.collaterals[0].reserveBalance.val.eq(amount))
    })
    it('Deposit collateral next', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

      const exchangeCollateralTokenAccountInfoBefore = await collateralToken.getAccountInfo(
        snyReserve
      )
      const assetListDataBefore = await exchange.getAssetsList(assetsList)

      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey,
        reserveAddress: snyReserve
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        snyReserve
      )
      // Increase by deposited amount
      assert.ok(
        exchangeCollateralTokenAccountInfoAfter.amount.eq(
          exchangeCollateralTokenAccountInfoBefore.amount.add(amount)
        )
      )

      const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)

      assert.ok(userExchangeAccountAfter.collaterals[0].amount.eq(amount))
      const assetListDataAfter = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetListDataAfter.collaterals[0].reserveBalance.val
          .sub(assetListDataBefore.collaterals[0].reserveBalance.val)
          .eq(amount)
      )
    })
    it('Deposit more than allowance', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const depositIx = await exchange.depositInstruction({
        amount: amount.mul(new BN(2)),
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey,
        reserveAddress: snyReserve
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(approveIx).add(depositIx),
          [wallet, accountOwner],
          connection
        ),
        ERRORS.ALLOWANCE
      )
    })
  })
  describe('#mint()', async () => {
    it('Mint #1', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const usdMintAmount = new BN(10 * 1e6)
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
      assert.ok(assetsListAfter.synthetics[0].supply.val.eq(usdMintAmount))

      // Increase user xusd balance
      const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
    })
    it('Mint #2', async () => {
      const collateralAmount = new BN(200 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      const exchangeStateBefore = await exchange.getState()
      const assetsListBefore = await exchange.getAssetsList(assetsList)
      const oldDebt = calculateDebt(assetsListBefore)
      const usdMintAmount = new BN(10 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      // Increase user debt
      // newShares = shares*mintedAmount/oldDebt
      const newShares = exchangeStateBefore.debtShares.mul(usdMintAmount).div(oldDebt)

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(newShares))

      // Increase exchange debt
      const exchangeStateAfter = await exchange.getState()
      assert.ok(exchangeStateAfter.debtShares.eq(exchangeStateBefore.debtShares.add(newShares)))

      // Increase asset supply
      const assetsListAfter = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetsListAfter.synthetics[0].supply.val.eq(
          assetsListBefore.synthetics[0].supply.val.add(usdMintAmount)
        )
      )

      // Increase user xusd balance
      const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
    })
    it('Mint over limit', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      snyReserve
      // Max is collateralAmount*price/10 -> 20*1e6
      const usdMintAmount = new BN(20 * 1e6).add(new BN(1))
      await assertThrowsAsync(
        exchange.mint({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: usdTokenAccount,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.MINT_LIMIT
      )
    })
  })
  describe('#withdraw()', async () => {
    let healthFactor: Decimal
    before(async () => {
      healthFactor = (await exchange.getState()).healthFactor
    })
    it('withdraw with no debt', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })

      // Get data before withdraw
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)

      const exchangeCollateralBalanceBefore = (await collateralToken.getAccountInfo(snyReserve))
        .amount

      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      const withdrawAmount = new BN(20 * 1e6)
      const assetListDataBefore = await exchange.getAssetsList(assetsList)

      // Withdraw
      await exchange.withdraw({
        reserveAccount: snyReserve,
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userCollateralAccount: userCollateralTokenAccount,
        signers: [accountOwner]
      })

      // Adding tokens to account on token
      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))

      // Removing tokens from reserves check
      const exchangeCollateralBalanceAfter = (await collateralToken.getAccountInfo(snyReserve))
        .amount
      assert.ok(
        exchangeCollateralBalanceAfter.eq(exchangeCollateralBalanceBefore.sub(withdrawAmount))
      )

      // Updating amount in assetList check
      const assetListDataAfter = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetListDataBefore.collaterals[0].reserveBalance.val
          .sub(assetListDataAfter.collaterals[0].reserveBalance.val)
          .eq(withdrawAmount)
      )

      // Updating exchange account check
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(
        exchangeAccountAfter.collaterals[0].amount.eq(
          exchangeAccountBefore.collaterals[0].amount.sub(withdrawAmount)
        )
      )
    })
    it('withdraw fully', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })

      // Get data before
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)

      const exchangeCollateralBalanceBefore = (await collateralToken.getAccountInfo(snyReserve))
        .amount

      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      const assetListDataBefore = await exchange.getAssetsList(assetsList)

      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      const withdrawAmount = collateralAmount

      // Withdraw
      await exchange.withdraw({
        reserveAccount: snyReserve,
        amount: U64_MAX,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userCollateralAccount: userCollateralTokenAccount,
        signers: [accountOwner]
      })

      // Adding tokens to account on token
      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))

      // Removing tokens from reserves
      const exchangeCollateralBalanceAfter = (await collateralToken.getAccountInfo(snyReserve))
        .amount
      assert.ok(
        exchangeCollateralBalanceAfter.eq(exchangeCollateralBalanceBefore.sub(withdrawAmount))
      )

      // Updating amount in assetList
      const assetListDataAfter = await exchange.getAssetsList(assetsList)
      assert.ok(
        assetListDataBefore.collaterals[0].reserveBalance.val
          .sub(assetListDataAfter.collaterals[0].reserveBalance.val)
          .eq(withdrawAmount)
      )

      // Updating exchange account check
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.head == 0)
    })
    it('withdraw over limit', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })

      // Withdraw over limit
      const withdrawAmount = collateralAmount.add(new BN(1000000))
      await assertThrowsAsync(
        exchange.withdraw({
          reserveAccount: snyReserve,
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount: userCollateralTokenAccount,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.WITHDRAW_LIMIT
      )
    })
    it('withdraw with debt', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })

      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))

      // We can mint max 20 * 1e6 * healthFactor
      const usdMintAmount = mulByDecimal(new BN(10 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      // Withdraw
      const withdrawAmount = new BN(50 * 1e6)
      await exchange.withdraw({
        reserveAccount: snyReserve,
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userCollateralAccount: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))

      // We cant withdraw anymore
      await assertThrowsAsync(
        exchange.withdraw({
          reserveAccount: snyReserve,
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount: userCollateralTokenAccount,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.WITHDRAW_LIMIT
      )
    })
  })
  describe('#swap()', async () => {
    let btcToken: Token
    let ethToken: Token
    let zeroMaxSupplyToken: Token
    let btcFeed: PublicKey
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
    it('Swap usd->btc->eth with 0% discount', async () => {
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
      // create usd account
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
        exchangeAccount,
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
        exchangeAccount,
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
    it('Swap usd->btc->eth with zero collateral', async () => {
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
        exchangeAccount,
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
        exchangeAccount,
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
    it('Swap usd->btc->eth with 3% discount', async () => {
      const collateralAmount = new BN(600 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)

      // We can mint max 60 * 1e6
      const usdMintAmount = mulByDecimal(new BN(60 * 1e6), healthFactor)
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
      assert.ok(eqDecimals(effectiveFee, percentToDecimal(0.291))) // discount 3%

      const usdSynthetic = assetsListData.synthetics[0]
      const usdAsset = assetsListData.assets[usdSynthetic.assetIndex]
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic
      const btcAsset = assetsListData.assets[btcSynthetic.assetIndex]
      const stateBeforeSwap = await exchange.getState()

      // 300$(IN value), 299.125$(OUT value)
      // expected fee 0.873$ -> 873 * 10^2
      // expected admin tax 0.1746$ -> 1746 *10^1
      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
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

      // 29.9125$(IN value), 29.824$(OUT value)
      // expected fee 0.087045$ ->  87045
      // expected admin tax ratio, additional swap tax reserve, additional xUSD supply:
      // 0.017409$ -> 17409
      await exchange.swap({
        amount: btcAmountOut,
        exchangeAccount,
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
    it('Swap usd->usd should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
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
      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: usdTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: assetsListData.synthetics[0].assetAddress,
          tokenIn: assetsListData.synthetics[0].assetAddress,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.WASH_TRADE
      )
    })
    it('Swap below minimum trade value should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // mint 10 * 1e6
      const usdMintAmount = mulByDecimal(new BN(10 * 1e6), healthFactor)
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
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic

      await assertThrowsAsync(
        exchange.swap({
          amount: new BN(50),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcSynthetic.assetAddress,
          tokenIn: assetsListData.synthetics[0].assetAddress,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.INSUFFICIENT_VALUE_TRADE
      )
    })
    it('Swap over max supply', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const zeroMaxSupplyTokenAccount = await zeroMaxSupplyToken.createAccount(
        accountOwner.publicKey
      )

      // We can mint max 2000 * 1e6
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const zeroMaxSupplyTokenAccountBefore = await zeroMaxSupplyToken.getAccountInfo(
        zeroMaxSupplyTokenAccount
      )
      assert.ok(zeroMaxSupplyTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const assetsListDataAfter = await exchange.getAssetsList(assetsList)
      const ethSynthetic = assetsListDataAfter.synthetics.find((a) =>
        a.assetAddress.equals(zeroMaxSupplyToken.publicKey)
      ) as Synthetic
      await assertThrowsAsync(
        exchange.swap({
          amount: new BN(1e6),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: zeroMaxSupplyTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: zeroMaxSupplyToken.publicKey,
          tokenIn: usdToken.publicKey,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.MAX_SUPPLY
      )
    })
    it('Swap more than balance should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
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
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic

      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount.add(new BN(1)),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcSynthetic.assetAddress,
          tokenIn: assetsListData.synthetics[0].assetAddress,
          signers: [accountOwner]
        }),
        ERRORS.ALLOWANCE
      )
    })
    it('swap on non tradable asset should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
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
      const btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic

      // mark asset out status as Unknown
      await setFeedTrading(oracleProgram, PriceStatus.Unknown, btcFeed)
      assert.ok((await getFeedData(oracleProgram, btcFeed)).status === PriceStatus.Unknown)

      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcSynthetic.assetAddress,
          tokenIn: assetsListData.synthetics[0].assetAddress,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.SWAP_UNAVAILABLE
      )

      // clean up: return status to trading
      await setFeedTrading(oracleProgram, PriceStatus.Trading, btcFeed)
      assert.ok((await getFeedData(oracleProgram, btcFeed)).status === PriceStatus.Trading)

      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcSynthetic.assetAddress,
        tokenIn: assetsListData.synthetics[0].assetAddress,
        signers: [accountOwner]
      })

      // mark asset in status as Halted
      await setFeedTrading(oracleProgram, PriceStatus.Halted, btcFeed)
      assert.ok((await getFeedData(oracleProgram, btcFeed)).status === PriceStatus.Halted)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)

      await assertThrowsAsync(
        exchange.swap({
          amount: new BN(1),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: ethTokenAccount,
          userTokenAccountIn: btcTokenAccount,
          tokenFor: ethToken.publicKey,
          tokenIn: btcSynthetic.assetAddress,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.SWAP_UNAVAILABLE
      )
      // clean up: return status to trading
      await setFeedTrading(oracleProgram, PriceStatus.Trading, btcFeed)
      assert.ok((await getFeedData(oracleProgram, btcFeed)).status === PriceStatus.Trading)
    })
  })
  describe('#burn()', async () => {
    const debtBurnAccuracy = new BN(10)

    it('Burn all debt', async () => {
      const collateralAmount = new BN(1000 * 1e6)
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
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await exchange.burn({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      // debtShares should be close to 0
      assert.ok(exchangeAccountAfter.debtShares.lt(debtBurnAccuracy))
    })
    it('Burn more than debt - should return rest', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const temp = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      // We can mint max 200 * 1e6 * healthFactor
      const healthFactor = (await exchange.getState()).healthFactor
      const usdMintAmount = mulByDecimal(new BN(200 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      // Transfer some USD
      const transferAmount = new BN(10 * 1e6)
      await usdToken.transfer(
        temp.usdTokenAccount,
        usdTokenAccount,
        temp.accountOwner,
        [],
        tou64(transferAmount)
      )
      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount.add(transferAmount)))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await exchange.burn({
        amount: usdMintAmount.add(transferAmount),
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })

      // We should end with transfered amount
      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      // amount should be close to transferAmount
      assert.ok(userUsdTokenAccountAfter.amount.lt(transferAmount.add(debtBurnAccuracy)))
      assert.ok(userUsdTokenAccountAfter.amount.gt(transferAmount.sub(debtBurnAccuracy)))

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
    })
    it('Burn without signer', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        usdTokenAccount,
        userCollateralTokenAccount,
        usdMintAmount
      } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await assertThrowsAsync(
        exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: []
        }),
        ERRORS.NO_SIGNERS
      )
    })
    // it('Burn wrong token', async () => {
    //   const collateralAmount = new BN(1000 * 1e6)
    //   const {
    //     accountOwner,
    //     exchangeAccount,
    //     usdTokenAccount,
    //     userCollateralTokenAccount,
    //     usdMintAmount
    //   } = await createAccountWithCollateralAndMaxMintUsd({
    //     reserveAddress: snyReserve,
    //     collateralToken,
    //     exchangeAuthority,
    //     exchange,
    //     collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
    //     amount: collateralAmount,
    //     usdToken
    //   })
    //   const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

    //   const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
    //   assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
    //   const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
    //   assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))
    //   const userBtcTokenAccount = await btcToken.getAccountInfo(btcTokenAccount)
    //   assert.ok(userBtcTokenAccount.amount.eq(new BN(0)))

    //   const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
    //   const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
    //   assert.ok(effectiveFee === 300) // discount 0%
    //   const assetsListData = await exchange.getAssetsList(assetsList)

    //   await exchange.swap({
    //     amount: usdMintAmount,
    //     exchangeAccount,
    //     owner: accountOwner.publicKey,
    //     userTokenAccountFor: btcTokenAccount,
    //     userTokenAccountIn: usdTokenAccount,
    //     tokenFor: btcToken.publicKey,
    //     tokenIn: usdToken.publicKey,
    //     signers: [accountOwner]
    //   })
    //   const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))
    //   const btcAmountOut = calculateAmountAfterFee(
    //     assetsListData.assets[0],
    //     btcAsset,
    //     effectiveFee,
    //     usdMintAmount
    //   )
    //   const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
    //   assert.ok(userBtcTokenAccountBefore.amount.eq(btcAmountOut))

    //   const burnIx = (await exchange.program.state.instruction.burn(btcAmountOut, {
    //     accounts: {
    //       exchangeAuthority: exchangeAuthority,
    //       usdToken: btcToken.publicKey,
    //       userTokenAccountBurn: btcTokenAccount,
    //       tokenProgram: TOKEN_PROGRAM_ID,
    //       exchangeAccount: exchangeAccount,
    //       owner: accountOwner.publicKey,
    //       assetsList: exchange.state.assetsList
    //     }
    //   })) as TransactionInstruction
    //   const updateIx = await exchange.updatePricesInstruction(exchange.state.assetsList)

    //   const approveIx = Token.createApproveInstruction(
    //     TOKEN_PROGRAM_ID,
    //     btcTokenAccount,
    //     exchange.exchangeAuthority,
    //     accountOwner.publicKey,
    //     [],
    //     tou64(btcAmountOut)
    //   )
    //   const updateTx = new Transaction().add(updateIx)
    //   const burnTx = new Transaction().add(approveIx).add(burnIx)
    //   // @ts-expect-error
    //   const txs = await exchange.processOperations([updateTx, burnTx])
    //   txs[1].partialSign(accountOwner)
    //   await connection.sendRawTransaction(txs[0].serialize(), {
    //     skipPreflight: true
    //   })
    //   await sleep(600)
    //   await assertThrowsAsync(
    //     sendAndConfirmRawTransaction(connection, txs[1].serialize(), {
    //       skipPreflight: true
    //     })
    //   )
    // })
  })
  describe('System Halted', async () => {
    it('#deposit()', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(10 * 1e6) // Mint 10 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        reserveAddress: snyReserve,
        owner: accountOwner.publicKey
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(approveIx).add(depositIx),
          [wallet, accountOwner],
          connection
        ),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
    })
    it('#mint()', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const usdMintAmount = new BN(5 * 1e6)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.mint({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: usdTokenAccount,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
    })
    it('#withdraw()', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: snyReserve,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })
      const withdrawAmount = new BN(20 * 1e6)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.withdraw({
          reserveAccount: snyReserve,
          userCollateralAccount: userCollateralTokenAccount,
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.withdraw({
        reserveAccount: snyReserve,
        userCollateralAccount: userCollateralTokenAccount,
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        signers: [accountOwner]
      })
    })
    it('#burn()', async () => {
      const healthFactor = (await exchange.getState()).healthFactor
      const collateralAmount = new BN(100 * 1e6)
        .div(healthFactor.val)
        .mul(new BN(10 ** healthFactor.scale))
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount,
        usdMintAmount,
        usdTokenAccount
      } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.burn({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })
    })
    it('#swap()', async () => {
      const btcToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const btcFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 50000,
        expo: -9
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
      await exchange.getState()

      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount,
        usdMintAmount,
        usdTokenAccount
      } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })

      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcToken.publicKey,
          tokenIn: usdToken.publicKey,
          signers: [accountOwner]
        }),
        ERRORS_EXCHANGE.HALTED
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: usdToken.publicKey,
        signers: [accountOwner]
      })
    })
  })
})
