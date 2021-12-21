import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const COLLATERAL_ADDRESS = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')
const NEW_COLLATERAL_RATIO = 70
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const ix = await exchange.setCollateralRatio(
    COLLATERAL_ADDRESS,
    percentToDecimal(NEW_COLLATERAL_RATIO)
  )
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
