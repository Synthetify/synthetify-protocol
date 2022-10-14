import { Provider } from '@project-serum/anchor'
import { PublicKey, sendAndConfirmRawTransaction, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal, toDecimal } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
import { createToken } from '../../tests/utils'
require('dotenv').config()

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const ASSET_ADDRESS = new PublicKey('6MeoZEcUMhAB788YXTQN4x7K8MnwSt6RHWsLkuq9GJb2')
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const payer = provider.wallet.payer as Keypair
  console.log(payer)
  const exchange = await Exchange.build(connection, Network.MAIN, payer)
  const state = await exchange.getState()
  // const token = new Token(
  //   connection,
  //   new PublicKey('83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y'),
  //   TOKEN_PROGRAM_ID,
  //   payer
  // )
  const acc = new PublicKey('ALo2Rtb1XgzpVW7737Ys9Ro9zcGNobaHxR4ATadzDy6Y')
  // console.log('reserve')
  // console.log(acc.toString())
  // const token = await createToken({
  //   connection,
  //   payer: payer,
  //   mintAuthority: exchange.exchangeAuthority,
  //   decimals: DECIMALS
  // })
  const { oracleUpdateIx, settleIx, settlement } = await exchange.settleSynthetic({
    payer: payer.publicKey,
    settlementReserve: acc,
    tokenToSettle: ASSET_ADDRESS
  })
  console.log(settlement.toString())
  // console.log(serializeInstructionToBase64(ix))
  // const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  const tx = new Transaction().add(oracleUpdateIx).add(settleIx)
  const blockhash = await connection.getRecentBlockhash(Provider.defaultOptions().commitment)
  tx.recentBlockhash = blockhash.blockhash
  console.log('sign')
  tx.sign(payer)
  console.log('post sign')

  const rawTx = tx.serialize()
  console.log(await sendAndConfirmRawTransaction(connection, rawTx, Provider.defaultOptions()))
  // await signAndSend(new Transaction().add(oracleUpdateIx).add(settleIx), [payer], connection)

  // console.log(tx)
}
main()
