import { Provider } from '@project-serum/anchor'
import { NATIVE_MINT, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: false
})
const FEED_ADDRESS = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const TOKEN_MINT = NATIVE_MINT
const main = async () => {
  const connection = provider.connection
  const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  const token = new Token(connection, TOKEN_MINT, TOKEN_PROGRAM_ID, DEVNET_ADMIN_ACCOUNT)
  const tokenInfo = await token.getMintInfo()
  const liquidationFund = await token.createAccount(exchange.exchangeAuthority)
  const reserveAccount = await token.createAccount(exchange.exchangeAuthority)

  await sleep(1000)
  const ix = await exchange.addCollateralInstruction({
    assetAddress: TOKEN_MINT,
    assetsList: state.assetsList,
    collateralRatio: percentToDecimal(30),
    feedAddress: assetsList.assets[3].feedAddress,
    liquidationFund,
    reserveAccount,
    reserveBalance: toDecimal(new BN(0), tokenInfo.decimals),
    maxCollateral: toDecimal(new BN(0), tokenInfo.decimals)
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
