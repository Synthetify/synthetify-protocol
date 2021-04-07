import { Provider, web3 } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'

export const DEFAULT_PUBLIC_KEY = new web3.PublicKey(0)

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
