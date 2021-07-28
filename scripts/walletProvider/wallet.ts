import { WalletProviderFactory } from './factory'
import { DERIVATION_PATH } from './localStorage'
import { LedgerWalletProvider } from './ledger'
import { Provider } from '@project-serum/anchor'
import {
  Transaction,
  Connection,
  ConfirmOptions,
  sendAndConfirmRawTransaction
} from '@solana/web3.js'

export const getLedgerWallet = async (): Promise<LedgerWalletProvider> => {
  const args = {
    onDisconnect: () => {
      console.log('disconnected')
    },
    derivationPath: DERIVATION_PATH.bip44Root
  }
  const wallet = WalletProviderFactory.getProvider(args) as LedgerWalletProvider

  await wallet.init()
  return wallet
}

export const signAndSendLedger = async (
  tx: Transaction,
  connection: Connection,
  wallet: LedgerWalletProvider,
  opts?: ConfirmOptions
) => {
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment || Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.feePayer = wallet.pubKey

  const signedTx = (await wallet.signTransaction(tx)) as Transaction
  const rawTx = signedTx.serialize()
  return await sendAndConfirmRawTransaction(connection, rawTx, opts || Provider.defaultOptions())
}
