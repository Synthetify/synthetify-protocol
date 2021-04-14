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

const addressToAssetSymbol: { [key: string]: string } = {
  '23284Ux1oSVi6MgKaTHZy3Tn8vS8coQvCz6cGeBpYEMr': 'xUSD',
  EfCBcDQDyocoZ4cXynNDnphkVJrCykG6kQEKu1Z5JMZr: 'SNY',
  '8jdnZf6XPrV2hQsgbNMrCg4KV5pvq47LBuGMnoZFvTdC': 'xFTT',
  '4cCrZdrXM9AQkh27qNzwN9xvsaodgmnRXj3ZhnTd1ygL': 'xBTC',
  BwFTQeBH8g4ZxFxNsq1tWMeHMq4zE8Gr53QTZXS3pdMi: 'xSOL',
  AK2xnJHMGHitsmGMPnEmT7xi1SFJ3f3goiBof3Eb9B9r: 'xSRM',
  Cru7N6LbCX9A7dqYHwXiHaiZcdLj9XDEEY4W3jZCP9o6: 'xETH',
  '6t6EMBnCbQkPRrnwqJ9UCp5TU4XAwjF7RLnsUoXpCsQ3': 'xLINK',
  GKeUppzmkKpNawFbSRXyCu87yQRMt7ULowAPbMmqCCpR: 'xBNB',
  AMDe7a7VZTo5d9UmMpdEh6H6kVmyvo1BPWb2BiVdcyrP: 'xUSD',
  '681fXt5mXkcrztcmjDRwtG2McQ6rh1zaY4MVjVE23FRN': 'SNY',
  '2K8fxLMajRCSdjMY6xCPg8hXpswAYgsdYCxGLT72ByD9': 'xFTT',
  HmrgH46wwSityKa9x321DPA4sRmknEjNhjuJgMAxPuea: 'xBTC',
  G3P9upmKa8xuP6WnjRZ7yF46raYL7KEmK45sgPuc9kgM: 'xSOL',
  '8CmY67FG1syfMQxd68kY8GgEKRjvM4JPVeN29VqWEyNQ': 'xSRM',
  '6HWS9dMamPPnaHLnwZ9oWmY9SJ9Qw5icxGVXCPyqad4Z': 'xETH',
  HvAAn7hyD3KoWg3oDhBhg2xKoj4g1PgaGEga365vKRbJ: 'xLINK',
  '6KB7svk18HxokBYVaxQLz4SEvGGKeJ9Y2J26NHZ9wcdQ': 'xBNB'
}
