import { BN } from '@project-serum/anchor'
import { Manager, Asset } from './manager'
import { Exchange } from './exchange'
import { Network, DEV_NET, TEST_NET } from './network'
import { signAndSend, calculateLiquidation, addressToAssetSymbol } from './utils'
import { PublicKey, Transaction } from '@solana/web3.js'
export interface IWallet {
  signTransaction(tx: Transaction): Promise<Transaction>
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
  publicKey: PublicKey
}
export {
  BN,
  Manager,
  Network,
  Exchange,
  signAndSend,
  Asset,
  calculateLiquidation,
  addressToAssetSymbol,
  DEV_NET,
  TEST_NET
}
