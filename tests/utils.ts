import { BN, Program, web3 } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token, TOKEN_PROGRAM_ID, u64 } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import { Exchange, signAndSend } from '@synthetify/sdk'
import { Asset, AssetsList, Collateral } from '@synthetify/sdk/lib/exchange'
import { ORACLE_OFFSET, ACCURACY } from '@synthetify/sdk'
import { Decimal, Synthetic } from '@synthetify/sdk/src/exchange'
import { createPriceFeed } from './oracleUtils'
import { divUp, toDecimal, UNIFIED_PERCENT_SCALE } from '@synthetify/sdk/lib/utils'

export const SYNTHETIFY_ECHANGE_SEED = Buffer.from('Synthetify')
export const EXCHANGE_ADMIN = new Account()
export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const U64_MAX = new BN('18446744073709551615')

export const almostEqual = (num1: BN, num2: BN) => {
  return num1.sub(num2).abs().ltn(10)
}
export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const tokenToUsdValue = (amount: BN, asset: Asset, synthetic: Collateral) => {
  return amount
    .mul(asset.price.val)
    .div(new BN(10 ** (synthetic.reserveBalance.scale + ORACLE_OFFSET - ACCURACY)))
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.synthetics.reduce((acc, synthetic) => {
    const asset = assetsList.assets[synthetic.assetIndex]
    return acc.add(
      synthetic.supply.val
        .mul(asset.price.val)
        .div(new BN(10 ** (synthetic.supply.scale + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const calculateAmountAfterFee = (
  assetIn: Asset,
  assetFor: Asset,
  syntheticIn: Synthetic,
  syntheticFor: Synthetic,
  effectiveFee: Decimal,
  amount: BN
): BN => {
  const valueInUsd = assetIn.price.val
    .mul(amount)
    .div(new BN(10 ** (syntheticIn.supply.scale + ORACLE_OFFSET - ACCURACY)))
  const fee = valueInUsd.mul(effectiveFee.val).div(new BN(10 ** effectiveFee.scale))
  return usdToTokenAmount(assetFor, syntheticFor, valueInUsd.sub(fee))
}
export const calculateFee = (
  assetIn: Asset,
  syntheticIn: Synthetic,
  amountIn: BN,
  effectiveFee: Decimal
): BN => {
  const value = assetIn.price.val
    .mul(amountIn)
    .div(new BN(10).pow(new BN(syntheticIn.supply.scale + ORACLE_OFFSET - ACCURACY)))

  return value.mul(effectiveFee.val).div(new BN(10 ** effectiveFee.scale))
}
export const calculateSwapTax = (totalFee: BN, swapTax: Decimal): BN => {
  // swapTax 20 -> 20%
  return divUp(totalFee.mul(swapTax.val), new BN(10).pow(new BN(swapTax.scale)))
}
export const eqDecimals = (a: Decimal, b: Decimal) => {
  // swapTax 20 -> 20%
  if (a.scale !== b.scale) {
    return false
  }
  return a.val.eq(b.val)
}
export const usdToTokenAmount = (
  asset: Asset,
  token: Synthetic | Collateral,
  valueInUsd: BN
): BN => {
  let decimalDifference
  //@ts-expect-error
  if (token?.supply.scale) {
    //@ts-expect-error
    decimalDifference = token?.supply.scale - ACCURACY
  } else {
    //@ts-expect-error
    decimalDifference = token.reserveBalance.scale - ACCURACY
  }
  let amount
  if (decimalDifference < 0) {
    amount = valueInUsd
      .mul(new BN(10 ** ORACLE_OFFSET))
      .div(new BN(10 ** decimalDifference))
      .div(asset.price.val)
  } else {
    amount = valueInUsd.mul(new BN(10 ** (ORACLE_OFFSET + decimalDifference))).div(asset.price.val)
  }
  return amount
}
export const calculateValueInUsd = (asset: Asset, token: Synthetic | Collateral, amount: BN) => {
  return asset.price
    .mul(amount)
    .div(new BN(10).pow(new BN(token.decimals + ORACLE_OFFSET - ACCURACY)))
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
  const assetsList = await exchange.initializeAssetsList({
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
  const healthFactor = (await exchange.getState()).healthFactor
  const usdMintAmount = amount
    .div(new BN(5))
    .mul(healthFactor.val)
    .div(new BN(10 ** healthFactor.scale))

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
    expo: -8
  })
  const addAssetIx = await exchange.addNewAssetInstruction({
    assetsList,
    assetFeedAddress: oracleAddress
  })
  await signAndSend(new Transaction().add(addAssetIx), [wallet, EXCHANGE_ADMIN], connection)

  const reserveAccount = await collateralToken.createAccount(exchangeAuthority)
  const liquidationFund = await collateralToken.createAccount(exchangeAuthority)

  const reserveBalanceDecimal = toDecimal(new BN(0), decimals)
  const collateralRatioDecimal = toDecimal(new BN(collateralRatio), UNIFIED_PERCENT_SCALE)

  const addCollateralIx = await exchange.addCollateralInstruction({
    assetsList,
    assetAddress: collateralToken.publicKey,
    liquidationFund,
    reserveAccount,
    feedAddress: oracleAddress,
    collateralRatio: collateralRatioDecimal,
    reserveBalance: reserveBalanceDecimal
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
  } catch (e: any) {
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

export const skipToSlot = async (slot: number, connection: Connection): Promise<undefined> => {
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
): Promise<undefined> => {
  const startTimestamp = (await connection.getBlockTime(await connection.getSlot())) as number
  const finishedTimestamp = startTimestamp + timestampDiff
  while (true) {
    const currentTimestamp = (await connection.getBlockTime(await connection.getSlot())) as number
    if (currentTimestamp >= finishedTimestamp) return
    await sleep(400)
  }
}

export const mulByPercentage = (a: BN, percentage: BN) => {
  return a.mul(percentage).div(new BN(100))
}
export const mulByDecimal = (a: BN, b: Decimal) => {
  return a.mul(b.val).div(new BN(10 ** b.scale))
}

export const waitForBeggingOfASlot = async (connection: Connection) => {
  const startSlot = await connection.getSlot()
  while (startSlot == (await connection.getSlot())) {}
}
