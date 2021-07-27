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
  assertThrowsAsync,
  DEFAULT_PUBLIC_KEY,
  U64_MAX,
  tou64,
  createAccountWithCollateral,
  skipTimestamps
} from './utils'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { ERRORS } from '@synthetify/sdk/src/utils'
import { Collateral } from '../sdk/lib/exchange'
import { ERRORS_EXCHANGE } from '../sdk/lib/utils'

describe('interest debt', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
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
  let liquidationAccount: PublicKey
  let stakingFundAccount: PublicKey
  let reserveAccount: PublicKey
  let accountOwner: PublicKey
  let exchangeAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number
  let startTimestamp: BN
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
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
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

    accountOwner = new Account().publicKey
    exchangeAccount = await exchange.createExchangeAccount(accountOwner)
    startTimestamp = (await exchange.getState()).lastDebtAdjustment
  })
  it('Initialize state', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.healthFactor === 50)
    assert.ok(state.maxDelay === 0)
    assert.ok(state.fee === 300)
    assert.ok(state.swapTax === 20)
    assert.ok(state.poolFee.eq(new BN(0)))
    assert.ok(state.debtInterestRate === 10)
    assert.ok(state.accumulatedDebtInterest.eq(new BN(0)))
    assert.ok(state.liquidationRate === 20)
    assert.ok(state.penaltyToLiquidator === 5)
    assert.ok(state.penaltyToExchange === 5)
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.eq(new BN(0)))
  })
  // it('Initialize assets', async () => {
  //   const initTokensDecimals = 6
  //   const assetsListData = await exchange.getAssetsList(assetsList)
  //   // Length should be 2
  //   assert.ok(assetsListData.assets.length === 2)
  //   // Authority of list

  //   // Check feed address
  //   const snyAsset = assetsListData.assets[assetsListData.assets.length - 1]
  //   assert.ok(snyAsset.feedAddress.equals(collateralTokenFeed))
  //   assert.ok(snyAsset.price.eq(new BN(0)))

  //   // Check token address
  //   const snyCollateral = assetsListData.collaterals[assetsListData.collaterals.length - 1]
  //   assert.ok(snyCollateral.collateralAddress.equals(collateralToken.publicKey))

  //   // USD token address
  //   const usdAsset = assetsListData.assets[0]
  //   assert.ok(usdAsset.price.eq(new BN(1e6)))

  //   // xUSD checks
  //   const usdSynthetic = assetsListData.synthetics[assetsListData.synthetics.length - 1]
  //   assert.ok(usdSynthetic.assetAddress.equals(usdToken.publicKey))
  //   assert.ok(usdSynthetic.decimals === initTokensDecimals)
  //   assert.ok(usdSynthetic.maxSupply.eq(new BN('ffffffffffffffff', 16)))
  // })
  // possible needed: #setLiquidationBuffer(), #setLiquidationRate(), #setLiquidationPenalties()
  it('Account Creation', async () => {
    // const accountOwner = new Account().publicKey
    // const exchangeAccount = await exchange.createExchangeAccount(accountOwner)
    const userExchangeAccount = await exchange.getExchangeAccount(exchangeAccount)

    // Owner of account
    assert.ok(userExchangeAccount.owner.equals(accountOwner))
    // Initial values
    assert.ok(userExchangeAccount.debtShares.eq(new BN(0)))
    assert.ok(userExchangeAccount.version === 0)
    assert.ok(userExchangeAccount.collaterals.length === 0)
  })
  it('Deposit collateral', async () => {
    const accountOwner = new Account()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

    const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
    const amount = new anchor.BN(300_000 * 1e6) // 300 000 SNY
    await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
    const userCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
      userCollateralTokenAccount
    )

    // Collateral amount
    assert.ok(userCollateralTokenAccountInfo.amount.eq(amount))
    const exchangeCollateralTokenAccountInfo = await collateralToken.getAccountInfo(reserveAccount)
    // No previous deposits
    assert.ok(exchangeCollateralTokenAccountInfo.amount.eq(new BN(0)))
    const depositIx = await exchange.depositInstruction({
      amount,
      exchangeAccount,
      userCollateralAccount: userCollateralTokenAccount,
      owner: accountOwner.publicKey,
      reserveAddress: reserveAccount
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
      reserveAccount
    )

    // Increase by deposited amount
    assert.ok(exchangeCollateralTokenAccountInfoAfter.amount.eq(amount))

    const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
    assert.ok(userExchangeAccountAfter.collaterals[0].amount.eq(amount))
    const assetListData = await exchange.getAssetsList(assetsList)
    assert.ok(assetListData.collaterals[0].reserveBalance.eq(amount))
  })
  it('Mint', async () => {
    const collateralAmount = new anchor.BN(300_000 * 1e6)
    const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
      reserveAddress: reserveAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })
    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

    const usdMintAmount = new BN(10_000 * 1e6) // 10 000 USD
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
  describe('Debt compounding', async () => {
    it('mint base debt', async () => {
      skipTimestamps(60, connection)
    })
  })
})
