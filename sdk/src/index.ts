import { BN, web3 } from '@project-serum/anchor'
import { Manager } from './manager'
import { Network } from './network'
export interface IWallet {
  signTransaction(tx: web3.Transaction): Promise<web3.Transaction>
  signAllTransactions(txs: web3.Transaction[]): Promise<web3.Transaction[]>
  publicKey: web3.PublicKey
}
export { BN, Manager, Network }
