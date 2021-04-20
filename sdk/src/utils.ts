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
import { AssetsList } from './manager'

export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 4
export const ACCURACY = 6

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
export const calculateLiquidation = (
  collateralValue: BN,
  debtValue: BN,
  targetCollateralRatio: number,
  liquidationPenalty: number
) => {
  const penalty = new BN(liquidationPenalty)
  const ratio = new BN(targetCollateralRatio)

  const maxBurnUsd = debtValue
    .mul(ratio)
    .sub(collateralValue.mul(new BN(100)))
    .div(ratio.sub(new BN(100).add(penalty)))

  const penaltyToSystem = penalty.div(new BN(5))
  const penaltyToUser = penalty.sub(penaltyToSystem)

  const userRewardUsd = maxBurnUsd.mul(new BN(100).add(penaltyToUser)).div(new BN(100))
  const systemRewardUsd = maxBurnUsd
    .mul(penaltyToSystem)
    .addn(100 - 1) // round up
    .div(new BN(100))

  return { userRewardUsd, systemRewardUsd, maxBurnUsd }
}

export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.assets.reduce(
    (acc, asset) =>
      acc.add(
        asset.supply.mul(asset.price).div(new BN(10 ** (asset.decimals + ORACLE_OFFSET - ACCURACY)))
      ),
    new BN(0)
  )
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const addressToAssetSymbol: { [key: string]: string } = {
  //Local
  '8V8JuSxR4SCSbqp2f74w7Kiv93FBbqfmPQGSJ1x2MPYi': 'xUSD',
  qB6GZSkKLWkkPEzraDdroAVvMFWyvvw9PWP71PKfAsm: 'SNY',
  '6txDFBT7v5uoLewnTCPYvBW25GLgr1d9eYQt3RTD9bdF': 'xFTT',
  '5Hm3K6nNUJ8gBQTQhLBb8ZHC8BupaED6mkws3vXPuHyH': 'xBTC',
  HPxzYx1doGTbwJx6AJmtsx1iN53v6sV2nPy7VgeA5aJ7: 'xSOL',
  '2HnwLrUhdkUg7zLmC2vaU9gVppkLo9WMPHyJK49h9SRa': 'xSRM',
  AKEJVWRH8QM19mP6gKrqjfm2rPTZrcqTiiWNKpoKxk8q: 'xETH',
  DYX3sKjcjNfHuoGLADVFotf8vDhThqxsPSmByKZN81sA: 'xLINK',
  '9hDKBnkbK7byYUm4Tp3ZMmTLA5XPt5UWfnLPj8HQWUEg': 'xBNB',
  //Dev
  '6MqktZ7WefkTsn8srqEZrEtrHj1PJThGDuzbNe8Wjse3': 'xUSD',
  '9KYPJcrigssYzkLzpE3weFs1cL72tggNfvSWHKqTPGtD': 'SNY',
  D1t8kTSEUpTYn38Experuzsk3n4QFrYJ2c5iMcjVMYfT: 'xFTT',
  AzfGYFf3VcPS4zrjAfG91ECKaJQfRdzrQVqGz88Pz87z: 'xBTC',
  CoSzn9ZW969ZDMP7uQqVSpAW9ePbNDysxKuaGtVviX1f: 'xSOL',
  '3n7SqGBseVYgB3QMKamdsw1ZtWtvp3bGyS4SBk1TfqVh': 'xSRM',
  '8z5ascp94u4Wno2C4qdmpdbtcW8LTHvMS6RNaLafkB48': 'xETH',
  '8yeGX9NUQYngmmhpdQxoNEoVoPNscm2CHp8a64pt1dph': 'xLINK',
  '7DrczWjz3JDBGC4oi4Q83fVvsk6DBN3H7sGtQNrq4rMg': 'xBNB',
  //Test
  E6veqGUAd4j8C11T6Ff5DcZFFLeqAaZpZG3WQZN26Ft8: 'xUSD',
  EPoHm2d65wk3LUzPzfeM8MSwUwAafdKdTvkCzJH1cae4: 'SNY',
  '9QRSeqGoX351YUkxBQUYBaMcyLSeJhMMwSgRqX9zxkjm': 'xFTT',
  '9RgnKMEQoY3w4B4zqSb7gPYSjj1P3Lqo6aYeGtv6Hvnq': 'xBTC',
  '2XwrHo52bDwjxm3GgjEMNRCAnTb5rBZWKgRzJtKbc1Hw': 'xSOL',
  '7ZdvrP3SLLBXXg1T5ao8mQejzjKSRE8pcbRwsBmRnLjx': 'xSRM',
  EG3N6hWLSS5HsToCH99utgdE2KT5XSvHFfa2p8KAAQNe: 'xETH',
  DFN8k5NM61oVEfhWnS6gNzYqEVUYpFpRkhMFJU1gfdUP: 'xLINK',
  '5FEq1XT454fYjCL7DQQdKMuxBxbtjr6vunLqX8zEg8gZ': 'xBNB'
}
