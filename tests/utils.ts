import { BN, Program, web3 } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token, TOKEN_PROGRAM_ID, u64 } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import { Exchange, signAndSend } from '@synthetify/sdk'
import { Asset, AssetsList, Collateral } from '@synthetify/sdk/lib/exchange'
import assert from 'assert'
import { createPriceFeed } from './oracleUtils'

export const SYNTHETIFY_ECHANGE_SEED = Buffer.from('Synthetify')
export const EXCHANGE_ADMIN = new Account()
export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 6
export const ACCURACY = 6
export const U64_MAX = new BN('18446744073709551615')

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const tokenToUsdValue = (amount: BN, asset: Asset) => {
  return amount
    .mul(asset.price)
    .div(new BN(10 ** (asset.synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.assets.reduce((acc, asset) => {
    return acc.add(
      asset.synthetic.supply
        .mul(asset.price)
        .div(new BN(10 ** (asset.synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const toEffectiveFee = (fee: number, userCollateralBalance: BN) => {
  // decimals of token = 6
  // we want discounts start from 2000 -> 4000 ...
  const scaledBalance = userCollateralBalance.div(new BN(10 ** (6 + 3)))
  if (scaledBalance.eq(new BN(0))) {
    return fee
  } else {
    const discount = Math.log2(scaledBalance.toNumber())
    if (discount > 20) {
      return Math.ceil(fee - (fee * 20) / 100)
    } else {
      return Math.ceil(fee - (fee * discount) / 100)
    }
  }
}
export const calculateAmountAfterFee = (
  assetIn: Asset,
  assetFor: Asset,
  effectiveFee: number,
  amount: BN
) => {
  const amountOutBeforeFee = assetIn.price.mul(amount).div(assetFor.price)
  const decimal_change = 10 ** (assetFor.synthetic.decimals - assetIn.synthetic.decimals)
  if (decimal_change < 1) {
    return amountOutBeforeFee
      .sub(amountOutBeforeFee.mul(new BN(effectiveFee)).div(new BN(100000)))
      .div(new BN(1 / decimal_change))
  } else {
    return amountOutBeforeFee
      .sub(amountOutBeforeFee.mul(new BN(effectiveFee)).div(new BN(100000)))
      .mul(new BN(decimal_change))
  }
}
interface ICreateToken {
  connection: Connection
  payer: Account
  mintAuthority: PublicKey
  decimals?: number
}
export const createToken = async ({
  connection,
  payer,
  mintAuthority,
  decimals = 6
}: ICreateToken) => {
  const token = await Token.createMint(
    connection,
    payer,
    mintAuthority,
    null,
    decimals,
    TokenInstructions.TOKEN_PROGRAM_ID
  )
  return token
}
export interface ICreateAssetsList {
  exchange: Exchange
  collateralTokenFeed: PublicKey
  exchangeAuthority: PublicKey
  snyReserve: PublicKey
  snyLiquidationFund: PublicKey
  collateralToken: Token
  connection: Connection
  wallet: Account
  assetsSize?: number
}
export type AddNewAssetResult = {
  assetAddress: PublicKey
  feedAddress: PublicKey
}
export interface IAddNewAssets {
  exchange: Exchange
  oracleProgram: Program
  connection: Connection
  wallet: Account
  assetsList: PublicKey
  newAssetDecimals: number
  newAssetLimit: BN
  newAssetsNumber?: number
}
export const createAssetsList = async ({
  exchange,
  collateralToken,
  collateralTokenFeed,
  connection,
  wallet,
  exchangeAuthority,
  snyLiquidationFund,
  snyReserve
}: ICreateAssetsList) => {
  const usdToken = await createToken({
    connection,
    payer: wallet,
    mintAuthority: exchangeAuthority
  })
  const assetsList = await exchange.createAssetsList()
  await exchange.initializeAssetsList({
    assetsList,
    collateralToken: collateralToken.publicKey,
    collateralTokenFeed,
    usdToken: usdToken.publicKey,
    snyReserve,
    snyLiquidationFund
  })
  return { assetsList, usdToken }
}
export const addNewAssets = async ({
  connection,
  wallet,
  oracleProgram,
  exchange,
  assetsList,
  newAssetDecimals,
  newAssetLimit,
  newAssetsNumber = 1
}: IAddNewAssets) => {
  let newAssetsResults: Array<{ assetAddress: PublicKey; feedAddress: PublicKey }> = []
  for (var newAssetNumber = 0; newAssetNumber < newAssetsNumber; newAssetNumber++) {
    const newToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey,
      decimals: newAssetDecimals
    })
    const newTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2
    })

    await exchange.addNewAsset({
      assetsAdmin: EXCHANGE_ADMIN,
      assetsList,
      maxSupply: newAssetLimit,
      tokenAddress: newToken.publicKey,
      tokenDecimals: newAssetDecimals,
      tokenFeed: newTokenFeed
    })
    newAssetsResults.push({
      assetAddress: newToken.publicKey,
      feedAddress: newTokenFeed
    })
  }
  return newAssetsResults
}

export const newAccountWithLamports = async (connection, lamports = 1e10) => {
  const account = new web3.Account()

  let retries = 30
  await connection.requestAirdrop(account.publicKey, lamports)
  for (;;) {
    await sleep(500)
    // eslint-disable-next-line eqeqeq
    if (lamports == (await connection.getBalance(account.publicKey))) {
      return account
    }
    if (--retries <= 0) {
      break
    }
  }
  throw new Error(`Airdrop of ${lamports} failed`)
}
export interface IAccountWithCollateral {
  exchange: Exchange
  collateralTokenMintAuthority: PublicKey
  exchangeAuthority: PublicKey
  collateralToken: Token
  amount: BN
  reserveAddress: PublicKey
}
export interface IAccountWithMultipleCollaterals {
  exchange: Exchange
  exchangeAuthority: PublicKey
  mintAuthority: PublicKey
  collateralToken: Token
  otherToken: Token
  reserveAddress: PublicKey
  otherReserveAddress: PublicKey
  amountOfCollateralToken: BN
  amountOfOtherToken: BN
}
export interface IAccountWithCollateralandMint {
  exchange: Exchange
  collateralTokenMintAuthority: PublicKey
  exchangeAuthority: PublicKey
  collateralToken: Token
  usdToken: Token
  amount: BN
  reserveAddress: PublicKey
}
export const createAccountWithCollateral = async ({
  exchange,
  collateralTokenMintAuthority,
  collateralToken,
  reserveAddress,
  exchangeAuthority,
  amount
}: IAccountWithCollateral) => {
  const accountOwner = await newAccountWithLamports(exchange.connection)
  const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)
  const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
  await collateralToken.mintTo(
    userCollateralTokenAccount,
    collateralTokenMintAuthority,
    [],
    tou64(amount)
  )
  const depositIx = await exchange.depositInstruction({
    amount: amount,
    exchangeAccount,
    userCollateralAccount: userCollateralTokenAccount,
    owner: accountOwner.publicKey,
    reserveAddress: reserveAddress
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
    [accountOwner],
    exchange.connection
  )

  return { accountOwner, exchangeAccount, userCollateralTokenAccount }
}
export const createAccountWithMultipleCollaterals = async ({
  exchange,
  mintAuthority,
  collateralToken,
  otherToken,
  reserveAddress,
  otherReserveAddress,
  exchangeAuthority,
  amountOfCollateralToken,
  amountOfOtherToken
}: IAccountWithMultipleCollaterals) => {
  const {
    accountOwner,
    exchangeAccount,
    userCollateralTokenAccount
  } = await createAccountWithCollateral({
    amount: amountOfCollateralToken,
    reserveAddress,
    collateralToken,
    collateralTokenMintAuthority: mintAuthority,
    exchange,
    exchangeAuthority
  })

  const userOtherTokenAccount = await otherToken.createAccount(accountOwner.publicKey)
  await otherToken.mintTo(userOtherTokenAccount, mintAuthority, [], tou64(amountOfOtherToken))

  const depositIx = await exchange.depositInstruction({
    amount: amountOfOtherToken,
    exchangeAccount,
    userCollateralAccount: userOtherTokenAccount,
    owner: accountOwner.publicKey,
    reserveAddress: otherReserveAddress
  })
  const approveIx = Token.createApproveInstruction(
    otherToken.programId,
    userOtherTokenAccount,
    exchangeAuthority,
    accountOwner.publicKey,
    [],
    tou64(amountOfOtherToken)
  )
  await signAndSend(
    new Transaction().add(approveIx).add(depositIx),
    [accountOwner],
    exchange.connection
  )

  return {
    accountOwner,
    exchangeAccount,
    userCollateralTokenAccount,
    userOtherTokenAccount
  }
}
export const createAccountWithCollateralAndMaxMintUsd = async ({
  exchange,
  collateralTokenMintAuthority,
  collateralToken,
  exchangeAuthority,
  amount,
  usdToken,
  reserveAddress
}: IAccountWithCollateralandMint) => {
  const {
    accountOwner,
    exchangeAccount,
    userCollateralTokenAccount
  } = await createAccountWithCollateral({
    amount,
    reserveAddress,
    collateralToken,
    collateralTokenMintAuthority,
    exchange,
    exchangeAuthority
  })
  // create usd account
  const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

  // Price of token is 2$ and collateral ratio 1000%
  const healthFactor = new BN((await exchange.getState()).healthFactor)
  const usdMintAmount = amount.div(new BN(5)).mul(healthFactor).div(new BN(100))

  await exchange.mint({
    amount: usdMintAmount,
    exchangeAccount,
    owner: accountOwner.publicKey,
    to: usdTokenAccount,
    signers: [accountOwner]
  })
  return {
    accountOwner,
    exchangeAccount,
    userCollateralTokenAccount,
    usdTokenAccount,
    usdMintAmount
  }
}

interface ICreateCollaterToken {
  exchange: Exchange
  exchangeAuthority: PublicKey
  oracleProgram: Program
  connection: Connection
  wallet: Account
  price: number
  decimals: number
  limit: BN
}
export const createCollateralToken = async ({
  exchange,
  exchangeAuthority,
  oracleProgram,
  connection,
  wallet,
  price,
  decimals,
  limit
}: ICreateCollaterToken): Promise<{
  token: Token
  feed: PublicKey
  reserve: PublicKey
  liquidationFund: PublicKey
}> => {
  const state = await exchange.getState()

  const newToken = await createToken({
    connection,
    payer: wallet,
    mintAuthority: wallet.publicKey,
    decimals: decimals
  })

  const oracleAddress = await createPriceFeed({
    oracleProgram,
    initPrice: price,
    expo: -decimals
  })
  await exchange.addNewAsset({
    assetsAdmin: EXCHANGE_ADMIN,
    assetsList: state.assetsList,
    maxSupply: limit,
    tokenAddress: newToken.publicKey,
    tokenDecimals: decimals,
    tokenFeed: oracleAddress
  })

  const reserveAddress = await newToken.createAccount(exchangeAuthority)
  const liquidationFund = await newToken.createAccount(exchangeAuthority)

  const collateralStruct: Collateral = {
    isCollateral: true,
    collateralAddress: newToken.publicKey,
    reserveAddress,
    liquidationFund,
    reserveBalance: new BN(0),
    collateralRatio: 50,
    decimals: decimals
  }

  const ix = await exchange.setAsCollateralInstruction({
    collateral: collateralStruct,
    assetsList: state.assetsList,
    collateralFeed: oracleAddress
  })
  await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

  return { token: newToken, feed: oracleAddress, reserve: reserveAddress, liquidationFund }
}

export async function assertThrowsAsync(fn: Promise<any>, word?: string) {
  try {
    await fn
  } catch (e) {
    let err
    if (e.code) {
      err = '0x' + e.code.toString(16)
    } else {
      err = e.toString()
    }
    if (word) {
      if (err.indexOf(word) === -1) {
        console.log(err)
        throw new Error('Invalid Error message')
      }
    }
    return
  }
  throw new Error('Function did not throw error')
}

export const skipToSlot = async (slot: number, connection: Connection): Promise<null> => {
  const startSlot = await connection.getSlot()

  // Checks if given slot hasn't already passed
  if (startSlot == slot) throw 'already at this slot '

  if (startSlot > slot) throw 'slot has already passed'

  // Wait for slot
  while (true) {
    if ((await connection.getSlot()) >= slot) return

    await sleep(400)
  }
}

export const mulByPercentage = (a: BN, percentage: BN) => {
  return a.mul(percentage).div(new BN(100))
}
