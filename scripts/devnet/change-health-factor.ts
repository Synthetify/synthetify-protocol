import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)

  const ix = await exchange.setHealthFactorInstruction(new BN(90))

  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)

  const state = await exchange.getState()
  console.log(state.healthFactor)
}
main()
