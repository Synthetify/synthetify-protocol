import { Provider } from '@project-serum/anchor'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Exchange, Network, signAndSend } from '@synthetify/sdk'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()

  const ix = await exchange.addNewAssetInstruction({
    assetsList: state.assetsList,
    assetFeedAddress: FEED_ADDRESS
  })
  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
}
main()
