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
  tou64,
  createAccountWithCollateral,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd,
  U64_MAX,
  mulByDecimal
} from './utils'
import { createPriceFeed } from './oracleUtils'

describe('isolated exchange burn', () => {
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
  let stakingFundAccount: PublicKey
  let snyReserve: PublicKey
  let snyLiquidationFund: PublicKey
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
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    snyReserve = await collateralToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)

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
  })
  it('Burn all debt', async () => {
    const collateralAmount = new BN(1000 * 1e6)
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
    // We can mint max 200 * 1e6
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
      amount: U64_MAX,
      exchangeAccount,
      owner: accountOwner.publicKey,
      userTokenAccountBurn: usdTokenAccount,
      signers: [accountOwner]
    })
    const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
    assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))
    const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
    assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
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
    const { accountOwner, exchangeAccount } = await createAccountWithCollateral({
      reserveAddress: snyReserve,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })
    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
    // We can mint max 200 * 1e6
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
    assert.ok(userUsdTokenAccountAfter.amount.eq(transferAmount))
    const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
    assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
  })
})
