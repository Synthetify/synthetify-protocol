import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const ix = await exchange.setHealthFactorInstruction(new BN(90))
  await signAndSend(new Transaction().add(ix), [DEVNET_ADMIN_ACCOUNT], connection)
  const state = await exchange.getState()
  console.log(state.healthFactor)
}
main()
