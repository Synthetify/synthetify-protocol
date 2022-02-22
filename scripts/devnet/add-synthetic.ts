import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { createToken } from '../../tests/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('FsSM3s38PX9K7Dn6eGzuE29S2Dsk1Sss1baytTQdCaQj')
const DECIMALS = 9
const MAX_SUPPLY = new BN(5_000_000)
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const token = await createToken({
    connection,
    payer: payer,
    mintAuthority: exchange.exchangeAuthority,
    decimals: DECIMALS
  })
  console.log('token', token.publicKey.toBase58())
  const ix = await exchange.addSyntheticInstruction({
    assetsList: state.assetsList,
    maxSupply: MAX_SUPPLY.mul(new BN(10).pow(new BN(DECIMALS))),
    priceFeed: FEED_ADDRESS,
    assetAddress: token.publicKey
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
