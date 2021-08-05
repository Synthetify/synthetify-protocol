import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  EXCHANGE_ADMIN,
  tou64,
  SYNTHETIFY_ECHANGE_SEED,
  assertThrowsAsync,
  mulByPercentage,
  createCollateralToken,
  createToken,
  waitForBeggingOfASlot
} from './utils'
import { createPriceFeed } from './oracleUtils'

// limited by MTU size
const ASSET_LIMIT = 30 // >=20 splits transaction
// limited by smart contract array size
const HARD_LIMIT = 255

describe('max collaterals', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let usdToken: Token
  let xbtcToken: Token
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let stakingFundAccount: PublicKey
  let nonce: number
  let tokens: Token[] = []
  let reserves: PublicKey[] = []
  let healthFactor: BN

  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    const collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2
    })

    const snyToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey
    })
    const snyReserve = await snyToken.createAccount(exchangeAuthority)
    const snyLiquidationFund = await snyToken.createAccount(exchangeAuthority)
    stakingFundAccount = await snyToken.createAccount(exchangeAuthority)

    tokens.push(snyToken)
    reserves.push(snyReserve)
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
      collateralToken: snyToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange,
      snyReserve,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    usdToken = data.usdToken
    tokens.push(usdToken)
    reserves.push(await usdToken.createAccount(exchangeAuthority))

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

    healthFactor = new BN((await exchange.getState()).healthFactor)
    const createCollateralProps = {
      exchange,
      exchangeAuthority,
      oracleProgram,
      connection,
      wallet
    }

    // creating BTC
    const {
      token: btcToken,
      reserve: btcReserve,
      feed
    } = await createCollateralToken({
      decimals: 10,
      price: 50000,
      collateralRatio: 10,
      ...createCollateralProps
    })
    tokens.push(btcToken)
    reserves.push(btcReserve)
    xbtcToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: exchangeAuthority,
      decimals: 8
    })
    const addBtcSynthetic = await exchange.addSyntheticInstruction({
      assetAddress: xbtcToken.publicKey,
      assetsList,
      decimals: 8,
      maxSupply: new BN(10).pow(new BN(16)),
      priceFeed: feed
    })
    await signAndSend(new Transaction().add(addBtcSynthetic), [wallet, EXCHANGE_ADMIN], connection)
    const assetsListBefore = await exchange.getAssetsList(assetsList)
    assert.ok((await assetsListBefore).assets.length)

    // creating tokens asynchronously so it doesn't take 2 minutes (downside is random order)
    const createdTokens = await Promise.all(
      [...Array(ASSET_LIMIT - 3).keys()].map(() =>
        createCollateralToken({
          decimals: 6,
          price: 2,
          collateralRatio: 50,
          ...createCollateralProps
        })
      )
    )

    // sorting to match order
    const assetsListAfter = await exchange.getAssetsList(assetsList)
    const sortedTokens = assetsListAfter.collaterals
      .slice(2)
      .map(({ collateralAddress }) =>
        createdTokens.find((i) => i.token.publicKey.equals(collateralAddress))
      )
    assert.ok(sortedTokens.every((token) => token != undefined))
    assert.ok(
      sortedTokens.every((data, i) =>
        assetsListAfter.collaterals[i + 2].collateralAddress.equals(
          data?.token?.publicKey as PublicKey
        )
      )
    )

    tokens = tokens.concat(sortedTokens.map((i) => i?.token as Token))
    reserves = reserves.concat(sortedTokens.map((i) => i?.reserve as PublicKey))
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
  })
  it('Initialize tokens', async () => {
    assert.equal(tokens.length, ASSET_LIMIT)
    assert.equal(reserves.length, ASSET_LIMIT)

    const assetsListData = await exchange.getAssetsList(assetsList)
    assert.equal(assetsListData.headAssets, ASSET_LIMIT)
    assert.equal(assetsListData.headCollaterals, ASSET_LIMIT - 1)
    assert.equal(assetsListData.headSynthetics, 2)
  })
  it('deposit', async () => {
    const accountOwner = new Account()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

    await waitForBeggingOfASlot(connection)
    await Promise.all(
      tokens.slice(2, 12).map(async (collateralToken, index) => {
        const reserveAccount = reserves[index + 2]

        const userCollateralTokenAccount = await collateralToken.createAccount(
          accountOwner.publicKey
        )
        const amount = new anchor.BN(10 * 1e6)
        await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

        // Deposit
        await exchange.deposit({
          amount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount: userCollateralTokenAccount,
          reserveAccount,
          collateralToken,
          exchangeAuthority,
          signers: [wallet, accountOwner]
        })

        // Check saldos
        const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
          reserveAccount
        )
        assert.ok(exchangeCollateralTokenAccountInfoAfter.amount.eq(amount))

        const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
        assert.ok(userExchangeAccountAfter.collaterals[index].amount.eq(amount))
        const assetListData = await exchange.getAssetsList(assetsList)
        assert.ok(assetListData.collaterals[index + 1].reserveBalance.eq(amount))
      })
    )
  })
  it('mint', async () => {
    const accountOwner = new Account()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

    // Deposit collaterals
    // btc collateral: 50000 * 0,001 * 0,1 = 5
    // other collaterals: 5 * 2 * 10 * 0,5 = 50
    await Promise.all(
      tokens.slice(2, 8).map(async (collateralToken, index) => {
        const tokenIndex = index + 2

        const userCollateralTokenAccount = await collateralToken.createAccount(
          accountOwner.publicKey
        )
        const amount = new BN(10 * 1e6)
        await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

        await exchange.deposit({
          amount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount: userCollateralTokenAccount,
          reserveAccount: reserves[tokenIndex],
          collateralToken: tokens[tokenIndex],
          exchangeAuthority,
          signers: [wallet, accountOwner]
        })
      })
    )

    assert.ok((await exchange.getExchangeAccount(exchangeAccount)).debtShares.eq(new BN(0)))

    const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
    const mintAmount = mulByPercentage(new BN(55 * 1e4), healthFactor)

    // Mint xUSD
    await exchange.mint({
      amount: mintAmount,
      exchangeAccount,
      owner: accountOwner.publicKey,
      to: usdTokenAccount,
      signers: [accountOwner]
    })

    // Check saldo and debt shares
    const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
    assert.ok(!exchangeAccountAfter.debtShares.eq(new BN(0)))
    assert.ok(await (await usdToken.getAccountInfo(usdTokenAccount)).amount.eq(mintAmount))
  })
  it('withdraw', async () => {
    const accountOwner = new Account()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)
    const amount = new BN(10 * 1e6)
    const listOffset = 3

    // Withdraw tokens
    await waitForBeggingOfASlot(connection)
    await Promise.all(
      tokens.slice(listOffset, listOffset + 5).map(async (collateralToken, index) => {
        const tokenIndex = index + listOffset
        const userCollateralAccount = await collateralToken.createAccount(accountOwner.publicKey)

        await collateralToken.mintTo(userCollateralAccount, wallet, [], tou64(amount))

        await waitForBeggingOfASlot(connection)
        await exchange.deposit({
          amount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount,
          reserveAccount: reserves[tokenIndex],
          collateralToken,
          exchangeAuthority,
          signers: [wallet, accountOwner]
        })

        await waitForBeggingOfASlot(connection)
        await exchange.withdraw({
          amount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userCollateralAccount,
          reserveAccount: reserves[tokenIndex],
          signers: [accountOwner]
        })

        const collateralAccountData = await collateralToken.getAccountInfo(userCollateralAccount)
        assert.ok(collateralAccountData.amount.eq(amount))
      })
    )

    assert.equal((await exchange.getExchangeAccount(exchangeAccount)).head, 0)
  })
  it('swap', async () => {
    const accountOwner = new Account()
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)
    const collateralAmount = new BN(1e13)

    const userCollateralTokenAccount = await tokens[2].createAccount(accountOwner.publicKey)
    await tokens[2].mintTo(userCollateralTokenAccount, wallet, [], tou64(collateralAmount))

    // Deposit
    await exchange.deposit({
      amount: collateralAmount,
      exchangeAccount,
      owner: accountOwner.publicKey,
      userCollateralAccount: userCollateralTokenAccount,
      reserveAccount: reserves[2],
      collateralToken: tokens[2],
      exchangeAuthority,
      signers: [wallet, accountOwner]
    })

    // Mint
    const amount = mulByPercentage(new BN(1e12), healthFactor)
    const userTokenAccountIn = await usdToken.createAccount(accountOwner.publicKey)
    await exchange.mint({
      amount,
      exchangeAccount,
      owner: accountOwner.publicKey,
      to: userTokenAccountIn,
      signers: [accountOwner]
    })

    // Swap
    const userTokenAccountFor = await xbtcToken.createAccount(accountOwner.publicKey)
    await exchange.swap({
      amount,
      exchangeAccount,
      owner: accountOwner.publicKey,
      userTokenAccountFor,
      userTokenAccountIn,
      tokenFor: xbtcToken.publicKey,
      tokenIn: usdToken.publicKey,
      signers: [accountOwner]
    })

    assert.ok((await usdToken.getAccountInfo(userTokenAccountIn)).amount.eq(new BN(0)))
    const { amount: amountFor } = await xbtcToken.getAccountInfo(userTokenAccountFor)
    assert.ok(!amountFor.eq(new BN(0)))
  })
  it('creating assets over limit', async () => {
    HARD_LIMIT - ASSET_LIMIT

    await Promise.all(
      [...Array(HARD_LIMIT - ASSET_LIMIT).keys()].map(() =>
        createCollateralToken({
          exchange,
          exchangeAuthority,
          oracleProgram,
          connection,
          wallet,
          price: 1,
          decimals: 6,
          collateralRatio: 50
        })
      )
    )

    await assertThrowsAsync(
      createCollateralToken({
        exchange,
        exchangeAuthority,
        oracleProgram,
        connection,
        wallet,
        price: 1,
        decimals: 6,
        collateralRatio: 50
      })
    )
  })
})
