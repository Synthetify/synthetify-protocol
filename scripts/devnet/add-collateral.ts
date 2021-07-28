import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { sleep } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { createToken } from '../../tests/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const COLLATERAL_RATIO = 30
const DECIMALS = 6

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  const token = await createToken({
    connection,
    payer: DEVNET_ADMIN_ACCOUNT,
    mintAuthority: MINTER.publicKey,
    decimals: DECIMALS
  })
  const tokenInfo = await token.getMintInfo()
  const liquidationFund = await token.createAccount(exchange.exchangeAuthority)
  const reserveAccount = await token.createAccount(exchange.exchangeAuthority)
  console.log(console.log(assetsList.assets))

  await sleep(1000)
  const ix = await exchange.addCollateralInstruction({
    assetAddress: token.publicKey,
    assetsList: state.assetsList,
    collateralRatio: COLLATERAL_RATIO,
    decimals: tokenInfo.decimals,
    feedAddress: FEED_ADDRESS,
    liquidationFund,
    reserveAccount,
    reserveBalance: new BN(0)
  })
  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
}
main()
