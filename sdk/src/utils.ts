import { BN, Provider } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'
import {
  PublicKey,
  Transaction,
  Connection,
  ConfirmOptions,
  sendAndConfirmRawTransaction,
  Account
} from '@solana/web3.js'
import { Asset, AssetsList, Collateral, ExchangeAccount } from './exchange'

export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 8
export const ACCURACY = 6
// hex code must be at the end of message
export enum ERRORS {
  SIGNATURE = 'Error: Signature verification failed',
  SIGNER = 'Error: unknown signer',
  PANICKED = 'Program failed to complete',
  SERIALIZATION = '0xa4',
  ALLOWANCE = 'custom program error: 0x1',
  NO_SIGNERS = 'Error: No signers'
}
export enum ERRORS_EXCHANGE {
  UNAUTHORIZED = '0x12c',
  NOT_SYNTHETIC_USD = '0x12d',
  OUTDATED_ORACLE = '0x12e',
  MINT_LIMIT = '0x12f',
  WITHDRAW_LIMIT = '0x130',
  COLLATERAL_ACCOUNT_ERROR = '0x131',
  SYNTHETIC_COLLATERAL = '0x132',
  INVALID_ASSETS_LIST = '0x133',
  INVALID_LIQUIDATION = '0x134',
  INVALID_SIGNER = '0x135',
  WASH_TRADE = '0x136',
  EXCHANGE_LIQUIDATION_ACCOUNT = '0x137',
  LIQUIDATION_DEADLINE = '0x138',
  HALTED = '0x139',
  NO_REWARDS = '0x13a',
  FUND_ACCOUNT_ERROR = '0x13b',
  ACCOUNT_VERSION = '0x13c',
  INITIALIZED = '0x13d',
  UNINITIALIZED = '0x13e',
  NO_ASSET_FOUND = '0x13f',
  MAX_SUPPLY = '0x140',
  NOT_COLLATERAL = '0x141',
  ALREADY_COLLATERAL = '0x142',
  INSUFFICIENT_VALUE_TRADE = '0x143'
}
export const signAndSend = async (
  tx: Transaction,
  signers: Account[],
  connection: Connection,
  opts?: ConfirmOptions
) => {
  tx.setSigners(...signers.map((s) => s.publicKey))
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment || Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.partialSign(...signers)
  const rawTx = tx.serialize()
  return await sendAndConfirmRawTransaction(connection, rawTx, opts || Provider.defaultOptions())
}

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const divUp = (a: BN, b: BN) => {
  return a.add(b.subn(1)).div(b)
}
export const calculateLiquidation = (
  maxDebt: BN,
  debtValue: BN,
  penaltyToLiquidator: number,
  penaltyToExchange: number,
  liquidationRate: number,
  asset: Asset,
  collateral: Collateral
) => {
  if (maxDebt.gt(debtValue)) {
    throw new Error('Account is safe')
  }
  const maxAmount = debtValue.muln(liquidationRate).divn(100)
  const seizedCollateralInUsd = divUp(
    maxAmount.muln(penaltyToExchange + penaltyToLiquidator),
    new BN(100)
  ).add(maxAmount)

  const seizedInToken = seizedCollateralInUsd
    .mul(new BN(10).pow(new BN(collateral.decimals + ORACLE_OFFSET - ACCURACY)))
    .div(asset.price)

  const collateralToExchange = divUp(
    seizedInToken.muln(penaltyToExchange),
    new BN(100).addn(penaltyToExchange).addn(penaltyToLiquidator)
  )
  const collateralToLiquidator = seizedInToken.sub(collateralToExchange)
  return { seizedInToken, maxAmount, collateralToExchange, collateralToLiquidator }
}

export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.synthetics.reduce(
    (acc, synthetic) =>
      acc.add(
        synthetic.supply
          .mul(assetsList.assets[synthetic.assetIndex].price)
          .div(new BN(10 ** (synthetic.decimals + ORACLE_OFFSET - ACCURACY)))
      ),
    new BN(0)
  )
}
export const calculateUserCollateral = (
  exchangeAccount: ExchangeAccount,
  assetsList: AssetsList
) => {
  return exchangeAccount.collaterals.reduce((acc, entry) => {
    const collateral = assetsList.collaterals[entry.index]
    return acc.add(
      entry.amount
        .mul(assetsList.assets[collateral.assetIndex].price)
        .div(new BN(10 ** (collateral.decimals + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const calculateUserMaxDebt = (exchangeAccount: ExchangeAccount, assetsList: AssetsList) => {
  return exchangeAccount.collaterals.reduce((acc, entry) => {
    const collateral = assetsList.collaterals[entry.index]
    const asset = assetsList.assets[collateral.assetIndex]
    return acc.add(
      entry.amount
        .mul(asset.price)
        .muln(collateral.collateralRatio)
        .divn(100)
        .div(new BN(10 ** (collateral.decimals + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const addressToAssetSymbol: { [key: string]: string } = {
  //Local
  '8V8JuSxR4SCSbqp2f74w7Kiv93FBbqfmPQGSJ1x2MPYi': 'xUSD',
  qB6GZSkKLWkkPEzraDdroAVvMFWyvvw9PWP71PKfAsm: 'SNY',
  '5Hm3K6nNUJ8gBQTQhLBb8ZHC8BupaED6mkws3vXPuHyH': 'xBTC',
  HPxzYx1doGTbwJx6AJmtsx1iN53v6sV2nPy7VgeA5aJ7: 'xSOL',
  '2HnwLrUhdkUg7zLmC2vaU9gVppkLo9WMPHyJK49h9SRa': 'xSRM',
  //Dev
  Sp7hoXrvaBA42RLsmFshjAmFT3CZemVDm5WGhsy18Cz: 'xUSD',
  EUdH9pgy4GtgYb42sj9MjiRW5i4s7HaEAbcNzwRhuaYa: 'SNY',
  '5JvEdz8xUTb3UYCQ6XuWVbpcGTAmrpESmhDQ86kCz5ur': 'xBTC',
  '8zGRx7MVmJxWgRbqZxkUg1GCz3gXNm3ivNVGYoU6Rduf': 'xSOL',
  '2CMihX9gxt51Z868cGUYjsrjYvDLjrr5wX3FNZ9CLnBX': 'xSRM',
  So11111111111111111111111111111111111111112: 'WSOL'
}
