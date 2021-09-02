import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal, toDecimal } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const COLLATERAL_ADDRESS = new PublicKey('oBNJxzeq1bkmSyULuqQoQtyHQMh8st8yfm4e7WqoJky')
const NEW_MAX_COLLATERAL_AMOUNT = new BN(200000)
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  await exchange.getState()
  const token = new Token(connection, COLLATERAL_ADDRESS, TOKEN_PROGRAM_ID, DEVNET_ADMIN_ACCOUNT)
  const tokenInfo = await token.getMintInfo()
  const ix = await exchange.setMaxCollateral(
    COLLATERAL_ADDRESS,
    toDecimal(NEW_MAX_COLLATERAL_AMOUNT.mul(new BN(10 ** tokenInfo.decimals)), tokenInfo.decimals)
  )
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
