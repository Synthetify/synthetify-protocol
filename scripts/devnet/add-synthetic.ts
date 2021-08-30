import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { createToken } from '../../tests/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const DECIMALS = 6
const MAX_SUPPLY = new BN(1000000)
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const token = await createToken({
    connection,
    payer: DEVNET_ADMIN_ACCOUNT,
    mintAuthority: exchange.exchangeAuthority,
    decimals: DECIMALS
  })
  const ix = await exchange.addSyntheticInstruction({
    assetsList: state.assetsList,
    decimals: DECIMALS,
    maxSupply: MAX_SUPPLY,
    priceFeed: FEED_ADDRESS,
    assetAddress: token.publicKey
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
