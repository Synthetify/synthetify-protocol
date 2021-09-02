import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  assetsList.collaterals.forEach((c) => {
    console.log(c.collateralAddress.toString())
    console.log(c.maxCollateral.val.toString())
  })
}
main()
