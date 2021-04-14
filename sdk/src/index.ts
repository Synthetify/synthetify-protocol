import { BN } from '@project-serum/anchor'
import { Manager, Asset } from './manager'
import { Exchange } from './exchange'
import { Network } from './network'
import { signAndSend, calculateLiquidation } from './utils'
import { PublicKey, Transaction } from '@solana/web3.js'
export interface IWallet {
  signTransaction(tx: Transaction): Promise<Transaction>
  signAllTransactions(txs: Transaction[]): Promise<Transaction[]>
  publicKey: PublicKey
}
export { BN, Manager, Network, Exchange, signAndSend, Asset, calculateLiquidation }
