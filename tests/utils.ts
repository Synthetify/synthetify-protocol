import { BN, Program, web3 } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token, TOKEN_PROGRAM_ID, u64 } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import { Exchange, signAndSend } from '@synthetify/sdk'
import { Asset, AssetsList, Collateral } from '@synthetify/sdk/lib/exchange'
import { Synthetic } from '@synthetify/sdk/src/exchange'
import { createPriceFeed } from './oracleUtils'

export const SYNTHETIFY_ECHANGE_SEED = Buffer.from('Synthetify')
export const EXCHANGE_ADMIN = new Account()
export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 8
export const ACCURACY = 6
export const U64_MAX = new BN('18446744073709551615')

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const tokenToUsdValue = (amount: BN, asset: Asset, synthetic: Collateral) => {
  return amount.mul(asset.price).div(new BN(10 ** (synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.synthetics.reduce((acc, synthetic) => {
    const asset = assetsList.assets[synthetic.assetIndex]
    return acc.add(
      synthetic.supply
        .mul(asset.price)
        .div(new BN(10 ** (synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const toEffectiveFee = (fee: number, userCollateralBalance: BN) => {
  // decimals of token = 6
  const ONE_SNY = new BN(1000000)
  let discount = 0
  switch (true) {
    case userCollateralBalance.lt(ONE_SNY.muln(100)):
      discount = 0
      break
    case userCollateralBalance.lt(ONE_SNY.muln(200)):
      discount = 1
      break

    case userCollateralBalance.lt(ONE_SNY.muln(500)):
      discount = 2
      break
    case userCollateralBalance.lt(ONE_SNY.muln(1000)):
      discount = 3
      break
    case userCollateralBalance.lt(ONE_SNY.muln(2000)):
      discount = 4
      break
    case userCollateralBalance.lt(ONE_SNY.muln(5000)):
      discount = 5
      break
    case userCollateralBalance.lt(ONE_SNY.muln(10000)):
      discount = 6
      break
    case userCollateralBalance.lt(ONE_SNY.muln(25000)):
      discount = 7
      break
    case userCollateralBalance.lt(ONE_SNY.muln(50000)):
      discount = 8
      break
    case userCollateralBalance.lt(ONE_SNY.muln(100000)):
      discount = 9
      break
    case userCollateralBalance.lt(ONE_SNY.muln(250000)):
      discount = 10
      break
    case userCollateralBalance.lt(ONE_SNY.muln(500000)):
      discount = 11
      break
    case userCollateralBalance.lt(ONE_SNY.muln(1000000)):
      discount = 12
      break
    case userCollateralBalance.lt(ONE_SNY.muln(2000000)):
      discount = 13
      break
    case userCollateralBalance.lt(ONE_SNY.muln(5000000)):
      discount = 14
      break
    case userCollateralBalance.lt(ONE_SNY.muln(10000000)):
      discount = 15
      break
  }
  return Math.ceil(fee - (fee * discount) / 100)
}
export const calculateAmountAfterFee = (
  assetIn: Asset,
  assetFor: Asset,
  syntheticIn: Synthetic,
  syntheticFor: Synthetic,
  effectiveFee: number,
  amount: BN
): BN => {
  const amountOutBeforeFee = assetIn.price.mul(amount).div(assetFor.price)
  let decimalDifference = syntheticFor.decimals - syntheticIn.decimals
  let scaledAmountBeforeFee
  if (decimalDifference < 0) {
    const decimalChange = new BN(10).pow(new BN(-decimalDifference))
    scaledAmountBeforeFee = amountOutBeforeFee.div(decimalChange)
  } else {
    const decimalChange = new BN(10).pow(new BN(decimalDifference))
    scaledAmountBeforeFee = amountOutBeforeFee.mul(decimalChange)
  }
  return scaledAmountBeforeFee.sub(scaledAmountBeforeFee.muln(effectiveFee).div(new BN(100000)))
}
export const calculateFee = (
  assetFrom: Asset,
  syntheticFrom: Synthetic,
  amountFrom: BN,
  asset: Asset,
  synthetic: Synthetic,
  amount: BN
): BN => {
  const valueFrom = assetFrom.price
    .mul(amountFrom)
    .div(new BN(10).pow(new BN(syntheticFrom.decimals + ORACLE_OFFSET - ACCURACY)))
  const value = asset.price
    .mul(amount)
    .div(new BN(10).pow(new BN(synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
  return valueFrom.sub(value)
}
export const calculateSwapTax = (totalFee: BN, swapTax: number): BN => {
  // swapTax 20 -> 20%
  return totalFee.muln(swapTax).divn(100)
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
  const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
    await createAccountWithCollateral({
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
  const { accountOwner, exchangeAccount, userCollateralTokenAccount } =
    await createAccountWithCollateral({
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
  collateralRatio: number
}
export const createCollateralToken = async ({
  exchange,
  exchangeAuthority,
  oracleProgram,
  connection,
  wallet,
  price,
  decimals,
  collateralRatio
}: ICreateCollaterToken): Promise<{
  token: Token
  feed: PublicKey
  reserve: PublicKey
  liquidationFund: PublicKey
}> => {
  const { assetsList } = await exchange.getState()

  const collateralToken = await createToken({
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
  const addAssetIx = await exchange.addNewAssetInstruction({
    assetsList,
    assetFeedAddress: oracleAddress
  })
  await signAndSend(new Transaction().add(addAssetIx), [wallet, EXCHANGE_ADMIN], connection)

  const reserveAccount = await collateralToken.createAccount(exchangeAuthority)
  const liquidationFund = await collateralToken.createAccount(exchangeAuthority)

  const addCollateralIx = await exchange.addCollateralInstruction({
    assetsList,
    assetAddress: collateralToken.publicKey,
    liquidationFund,
    reserveAccount,
    feedAddress: oracleAddress,
    collateralRatio,
    reserveBalance: new BN(0),
    decimals
  })
  await signAndSend(new Transaction().add(addCollateralIx), [wallet, EXCHANGE_ADMIN], connection)

  return {
    token: collateralToken,
    feed: oracleAddress,
    reserve: reserveAccount,
    liquidationFund
  }
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
      const regex = new RegExp(`${word}$`)
      if (!regex.test(err)) {
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

export const skipTimestamps = async (
  timestampDiff: number,
  connection: Connection
): Promise<null> => {
  const startTimestamp = await connection.getBlockTime(await connection.getSlot())
  const finishedTimestamp = startTimestamp + timestampDiff
  while (true) {
    const currentTimestamp = await connection.getBlockTime(await connection.getSlot())
    if (currentTimestamp >= finishedTimestamp) return
    await sleep(400)
  }
}

export const mulByPercentage = (a: BN, percentage: BN) => {
  return a.mul(percentage).div(new BN(100))
}

export const waitForBeggingOfASlot = async (connection: Connection) => {
  const startSlot = await connection.getSlot()
  while (startSlot == (await connection.getSlot())) {}
}
