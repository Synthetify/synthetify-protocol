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
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)

  const oldPriceFeed = assetsList.assets[assetsList.collaterals[0].assetIndex].feedAddress
  const newPriceFeed = new PublicKey('992moaMQKs32GKZ9dxi8keyM2bUmbrwBZpK4p2K6X5Vs')

  const ix = await exchange.setPriceFeedInstruction({
    assetsList: state.assetsList,
    oldPriceFeed,
    priceFeed: newPriceFeed
  })
  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
}
main()
