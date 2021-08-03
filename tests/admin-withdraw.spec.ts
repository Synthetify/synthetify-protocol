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
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateral,
  mulByPercentage,
  calculateAmountAfterFee,
  calculateFee,
  calculateSwapTax,
  assertThrowsAsync,
  U64_MAX
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { ERRORS, ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { Asset, Synthetic } from '@synthetify/sdk/src/exchange'

describe('admin', () => {
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
  let liquidationAccount: PublicKey
  let stakingFundAccount: PublicKey
  let reserveAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number
  const stakingRoundLength = 10
  const amountPerRound = new BN(100)

  let initialCollateralPrice = 2
  before(async () => {
    const [_exchangeAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _exchangeAuthority
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
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    reserveAccount = await collateralToken.createAccount(exchangeAuthority)

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
      snyLiquidationFund: liquidationAccount,
      snyReserve: reserveAccount,
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
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )
  })
  it('should initialized interest debt and swap tax parameters', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.healthFactor === 50)
    assert.ok(state.fee === 300)
    assert.ok(state.swapTaxRatio === 20)
    assert.ok(state.swapTaxReserve.eq(new BN(0)))
    assert.ok(state.debtInterestRate === 10)
    assert.ok(state.accumulatedDebtInterest.eq(new BN(0)))
  })
  describe('#withdrawSwapTax()', async () => {
    let healthFactor: BN
    let usdAsset: Asset
    let usdSynthetic: Synthetic
    let btcAsset: Asset
    let btcSynthetic: Synthetic
    let btcToken: Token
    let totalFee: BN
    let swapTax: BN
    let adminUsdTokenAccount: PublicKey
    let firstWithdrawTaxAmount: BN
    before(async () => {
      healthFactor = new BN((await exchange.getState()).healthFactor)
      btcToken = await createToken({
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
      await signAndSend(new Transaction().add(addBtcIx), [wallet, EXCHANGE_ADMIN], connection)
      const addBtcSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: btcToken.publicKey,
        assetsList,
        decimals: 8,
        maxSupply: newAssetLimit,
        priceFeed: btcFeed
      })
      await signAndSend(
        new Transaction().add(addBtcSynthetic),
        [wallet, EXCHANGE_ADMIN],
        connection
      )
      adminUsdTokenAccount = await usdToken.createAccount(new Account().publicKey)
    })
    it('swap should increase swap tax reserves', async () => {
      const collateralAmount = new BN(90 * 1e6)
      const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
        await createAccountWithCollateral({
          reserveAddress: reserveAccount,
          collateralToken,
          exchangeAuthority,
          exchange,
          collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
          amount: collateralAmount
        })

      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 9 * 1e6
      const usdMintAmount = mulByPercentage(new BN(9 * 1e6), healthFactor)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      const userCollateralTokenAccountBeforeSwap = (
        await collateralToken.getAccountInfo(userCollateralTokenAccount)
      ).amount
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralTokenAccountBeforeSwap)

      const assetsListData = await exchange.getAssetsList(assetsList)

      await exchange.swap({
        exchangeAccount,
        amount: usdMintAmount,
        owner: accountOwner.publicKey,
        userTokenAccountIn: usdTokenAccount,
        userTokenAccountFor: btcTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: assetsListData.synthetics[0].assetAddress,
        signers: [accountOwner]
      })
      usdSynthetic = assetsListData.synthetics[0]
      btcSynthetic = assetsListData.synthetics.find((a) =>
        a.assetAddress.equals(btcToken.publicKey)
      ) as Synthetic
      usdAsset = assetsListData.assets[usdSynthetic.assetIndex]
      btcAsset = assetsListData.assets[btcSynthetic.assetIndex]

      const btcAmountOut = calculateAmountAfterFee(
        usdAsset,
        btcAsset,
        usdSynthetic,
        btcSynthetic,
        effectiveFee,
        usdMintAmount
      )
      totalFee = calculateFee(
        usdAsset,
        usdSynthetic,
        usdMintAmount,
        btcAsset,
        btcSynthetic,
        btcAmountOut
      )
      swapTax = calculateSwapTax(totalFee, exchange.state.swapTaxRatio)
    })
    it('withdraw swap tax should fail without admin signature', async () => {
      const accountOwner = new Account()
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: new BN(0),
        to: usdTokenAccount
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should withdraw some swap tax', async () => {
      // admin xUSD balance should be 0
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountBeforeWithdraw.amount.eqn(0))

      // swapTaxReserve should be equals swap tax
      const swapTaxReserveBeforeWithdraw = (await exchange.getState()).swapTaxReserve
      assert.ok(swapTaxReserveBeforeWithdraw.eq(swapTax))

      // withdraw 1/10 swap tax
      firstWithdrawTaxAmount = swapTax.divn(10)
      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: firstWithdrawTaxAmount,
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

      // admin xUSD balance should be increased by swap tax
      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(firstWithdrawTaxAmount))

      // swapTaxReserve should be decreased by toWithdrawTax
      const swapTaxReserveAfterWithdraw = (await exchange.getState()).swapTaxReserve
      assert.ok(swapTaxReserveAfterWithdraw.eq(swapTax.sub(firstWithdrawTaxAmount)))
    })
    it('should withdraw all swap tax', async () => {
      // admin xUSD balance should equals firstWithdrawTaxAmount
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountBeforeWithdraw.amount.eq(firstWithdrawTaxAmount))

      // swapTaxReserve should be equals swap tax minus firstWithdrawTaxAmount
      const swapTaxReserveBeforeWithdraw = (await exchange.getState()).swapTaxReserve
      assert.ok(swapTaxReserveBeforeWithdraw.eq(swapTax.sub(firstWithdrawTaxAmount)))

      // withdraw rest of swap tax
      const toWithdrawTax = U64_MAX
      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: toWithdrawTax,
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

      // admin xUSD balance should be equals all swap tax
      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(swapTax))

      // swapTaxReserve should be 0
      const swapTaxReserveAfterWithdraw = (await exchange.getState()).swapTaxReserve
      assert.ok(swapTaxReserveAfterWithdraw.eqn(0))
    })
    it('withdraw 0 swap tax should not have an effect', async () => {
      const userUsdAccountBeforeWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      const swapTaxReserveBeforeWithdraw = (await exchange.getState()).swapTaxReserve

      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: new BN(0),
        to: adminUsdTokenAccount
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

      // admin xUSD balance should be equals all swap tax
      const userUsdAccountAfterWithdraw = await usdToken.getAccountInfo(adminUsdTokenAccount)
      assert.ok(userUsdAccountAfterWithdraw.amount.eq(userUsdAccountBeforeWithdraw.amount))

      // swapTaxReserve should be 0
      const swapTaxReserveAfterWithdraw = (await exchange.getState()).swapTaxReserve
      assert.ok(swapTaxReserveAfterWithdraw.eq(swapTaxReserveBeforeWithdraw))
    })
    it('withdraw too much from admin tax reserve should result failed', async () => {
      const ix = await exchange.withdrawSwapTaxInstruction({
        amount: swapTax.muln(2),
        to: adminUsdTokenAccount
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.INSUFFICIENT_AMOUNT_ADMIN_WITHDRAW
      )
    })
  })
})
