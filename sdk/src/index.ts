import { BN } from '@project-serum/anchor'
import { Exchange } from './exchange'
import { Network, DEV_NET, TEST_NET } from './network'
import {
  signAndSend,
  calculateLiquidation,
  addressToAssetSymbol,
  ORACLE_OFFSET,
  ACCURACY
} from './utils'
import { PublicKey, Transaction } from '@solana/web3.js'
export interface IWallet {
  signTransaction(tx: Transaction): Promise<Transaction>
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
  publicKey: PublicKey
}
export {
  BN,
  Network,
  Exchange,
  signAndSend,
  calculateLiquidation,
  addressToAssetSymbol,
  ORACLE_OFFSET,
  ACCURACY,
  DEV_NET,
  TEST_NET
}
