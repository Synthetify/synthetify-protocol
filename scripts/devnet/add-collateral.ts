import { Provider } from '@project-serum/anchor'
import { NATIVE_MINT, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { sleep } from '@synthetify/sdk/lib/utils'
import { DEV_NET } from '@synthetify/sdk/src/network'
import { assertThrowsAsync } from '../../tests/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const TOKEN_MINT = NATIVE_MINT
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  console.log(assetsList.collaterals)
  const token = new Token(connection, TOKEN_MINT, TOKEN_PROGRAM_ID, DEVNET_ADMIN_ACCOUNT)
  const tokenInfo = await token.getMintInfo()
  const liquidationFund = await token.createAccount(exchange.exchangeAuthority)
  const reserveAccount = await token.createAccount(exchange.exchangeAuthority)
  console.log(console.log(assetsList.assets))

  await sleep(1000)
  const ix = await exchange.addCollateralInstruction({
    assetAddress: TOKEN_MINT,
    assetsList: state.assetsList,
    collateralRatio: 30,
    decimals: tokenInfo.decimals,
    feedAddress: assetsList.assets[3].feedAddress,
    liquidationFund,
    reserveAccount,
    reserveBalance: new BN(0)
  })
  await signAndSend(new Transaction().add(ix), [DEVNET_ADMIN_ACCOUNT], connection)
}
main()
