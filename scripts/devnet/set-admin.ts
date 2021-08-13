import { Provider } from '@project-serum/anchor'
import { NATIVE_MINT, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: false
})
const NEW_ADMIN = new PublicKey('6PxpYuwN3BnYDAzVsdVkCUQfBuQcqqcQTXWo9iqd6VDQ')
const main = async () => {
  const connection = provider.connection
  const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()

  await sleep(1000)
  const ix = await exchange.setAdmin(NEW_ADMIN)
  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
}
main()
