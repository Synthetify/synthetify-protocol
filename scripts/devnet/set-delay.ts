import { Provider } from '@project-serum/anchor'
import { NATIVE_MINT, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: false
})
const NEW_ADMIN = new PublicKey('Gk7yoeFWGmXzTv8mST8WR1FyW4sJU5m2q7Dfvs3v2gzg')
const main = async () => {
  const connection = provider.connection
  // const ledgerWallet = await getLedgerWallet()
  // const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()

  await sleep(1000)
  const ix = await exchange.setMaxDelayInstruction(10)
  // await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // @ts-expect-error
  await signAndSend(new Transaction().add(ix), [provider.wallet.payer as Account], connection)
}
main()
