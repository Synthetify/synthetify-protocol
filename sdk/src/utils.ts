import { BN, Provider, web3 } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'
import { AssetsList } from './manager'

export const DEFAULT_PUBLIC_KEY = new web3.PublicKey(0)
export const ORACLE_OFFSET = 4
export const ACCURACY = 6

export const signAndSend = async (
  tx: web3.Transaction,
  signers: web3.Account[],
  connection: web3.Connection,
  opts?: web3.ConfirmOptions
) => {
  tx.setSigners(...signers.map((s) => s.publicKey))
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment || Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.partialSign(...signers)
  const rawTx = tx.serialize()
  return await web3.sendAndConfirmRawTransaction(
    connection,
    rawTx,
    opts || Provider.defaultOptions()
  )
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
