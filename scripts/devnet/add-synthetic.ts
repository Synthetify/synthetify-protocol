import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { createToken } from '../../tests/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('45rTB9ezDcTX5tMZx2uJUBbBEqAWDhXykYbBfaSWUXvD')
const DECIMALS = 6
const MAX_SUPPLY = new BN(1_000_000)
const main = async () => {
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  // const token = await createToken({
  //   connection,
  //   payer: payer,
  //   mintAuthority: exchange.exchangeAuthority,
  //   decimals: DECIMALS
  // })
  // console.log('token', token.publicKey.toBase58())
  const ix = await exchange.addSyntheticInstruction({
    assetsList: state.assetsList,
    maxSupply: MAX_SUPPLY.mul(new BN(10).pow(new BN(DECIMALS))),
    priceFeed: FEED_ADDRESS,
    assetAddress: new PublicKey('FXe7K4EtThAzsu7dphLBKtbjFwE3AeMaFC7kwVd3ifhS')
  })
  console.log(serializeInstructionToBase64(ix))
  // const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // console.log(tx)
}
main()
