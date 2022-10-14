import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal, toDecimal } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
require('dotenv').config()

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const ASSET_ADDRESS = new PublicKey('6MeoZEcUMhAB788YXTQN4x7K8MnwSt6RHWsLkuq9GJb2')
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const payer = provider.wallet.payer as Account

  const exchange = await Exchange.build(connection, Network.MAIN, payer)
  const state = await exchange.getState()

  const ix = await exchange.setSettlementSlotInstruction(ASSET_ADDRESS, new BN(122498700))
  console.log(serializeInstructionToBase64(ix))
  // const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // await signAndSend(new Transaction().add(ix), [payer], connection)

  // console.log(tx)
}
main()
