import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Manager, Network } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  ASSETS_MANAGER_ADMIN,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  SYNTHETIFY_ECHANGE_SEED,
  createAccountWithCollateralAndMaxMintUsd
} from './utils'
import { createPriceFeed } from './oracleUtils'

describe('isolated exchange burn', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgram.programId)
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
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

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
      nonce,
      amountPerRound: new BN(100),
      stakingRoundLength: 300,
      stakingFundAccount: stakingFundAccount
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      manager,
      exchangeAuthority,
      exchangeProgram.programId
    )
  })
  it('Burn all debt', async () => {
    const collateralAmount = new BN(1000 * 1e6)
    const {
      accountOwner,
      exchangeAccount,
      userCollateralTokenAccount
    } = await createAccountWithCollateral({
      collateralAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })
    // create usd account
    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
    // We can mint max 200 * 1e6
    const usdMintAmount = new BN(200 * 1e6)
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
    assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
  })
  it('Burn more than debt - should return rest', async () => {
    const collateralAmount = new BN(1000 * 1e6)
    const temp = await createAccountWithCollateralAndMaxMintUsd({
      collateralAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount,
      usdToken
    })
    const {
      accountOwner,
      exchangeAccount,
      userCollateralTokenAccount
    } = await createAccountWithCollateral({
      collateralAccount,
      collateralToken,
      exchangeAuthority,
      exchange,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: collateralAmount
    })
    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
    // We can mint max 200 * 1e6
    const usdMintAmount = new BN(200 * 1e6)
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
