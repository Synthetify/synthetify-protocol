import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const COLLATERAL_ADDRESS = new PublicKey('XYZ')
const NEW_COLLATERAL_RATIO = 20
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const ix = await exchange.setCollateralRatio(COLLATERAL_ADDRESS, NEW_COLLATERAL_RATIO)
  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
}
main()
