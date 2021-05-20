import { BN, Provider } from '@synthetify/anchor'
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
export const ORACLE_OFFSET = 6
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
  '5Hm3K6nNUJ8gBQTQhLBb8ZHC8BupaED6mkws3vXPuHyH': 'xBTC',
  HPxzYx1doGTbwJx6AJmtsx1iN53v6sV2nPy7VgeA5aJ7: 'xSOL',
  '2HnwLrUhdkUg7zLmC2vaU9gVppkLo9WMPHyJK49h9SRa': 'xSRM',
  //Dev
  DxhLVejvWF8uCLcgPsKfayt2mmgHnytgc2pVumFFeuej: 'xUSD',
  xgwaHfCWHauuPhpsGeehq8bnTDwFbZXK69QwXPuUjne: 'SNY',
  E1yHuofUuZyXx1P8nDLY1VcVy5H6iv616kKWhDUhwNjh: 'xBTC',
  '3BP9o1GWyhpvJGUbNiY6kJGLMi1t7ACtBBLaqJHVFyGo': 'xSOL',
  '2rUKfgRuMKUEpnKdAH1Kwktq8kBDFm93MXhKccyvCxG3': 'xSRM'
}
