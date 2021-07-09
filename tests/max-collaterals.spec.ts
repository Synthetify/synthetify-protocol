import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  sleep,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  calculateDebt,
  SYNTHETIFY_ECHANGE_SEED,
  calculateAmountAfterFee,
  toEffectiveFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync,
  mulByPercentage,
  createCollateralToken
} from './utils'
import { createPriceFeed } from './oracleUtils'
import { ERRORS } from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'
import { Collateral } from '../sdk/lib/exchange'

const ASSET_LIMIT = 30

describe('max collaterals', () => {
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
      stakingFundAccount: stakingFundAccount
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )
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
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.accountVersion === 0)
  })
  it('fill assests', async () => {
    const tokenSpecificData = [
      { decimals: 8, price: 50000, limit: new BN(1e12) },
      { decimals: 4, price: 20, limit: new BN(1e8) },
      { decimals: 6, price: 2, limit: new BN(1e14) },
      { decimals: 4, price: 20, limit: new BN(1e8) },
      { decimals: 6, price: 8, limit: new BN(1e10) }
    ]
    for (let i = tokenSpecificData.length; i < ASSET_LIMIT - 2; i++) {
      tokenSpecificData.push({ decimals: 6, price: 2, limit: new BN(1e12) })
    }

    const assetsListBefore = exchange.getAssetsList(assetsList)
    assert.ok(tokenSpecificData.length == ASSET_LIMIT - 2)
    assert.ok((await assetsListBefore).assets.length)

    const tokens = await Promise.all(
      tokenSpecificData.map(async (specificData) => {
        createCollateralToken({
          exchange,
          exchangeAuthority,
          oracleProgram,
          connection,
          wallet,
          ...specificData
        })
      })
    )

    assert.ok(tokens.length == tokenSpecificData.length)
  })
})
