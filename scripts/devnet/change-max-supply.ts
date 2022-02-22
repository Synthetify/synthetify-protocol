import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal, toDecimal } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
require('dotenv').config()

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const ASSET_ADDRESS = new PublicKey('Fr3W7NPVvdVbwMcHgA7Gx2wUxP43txdsn3iULJGFbKz9')
const NEW_MAX_COLLATERAL_AMOUNT = new BN(80000)
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const payer = provider.wallet.payer as Account

  const exchange = await Exchange.build(connection, Network.MAIN, payer)
  const state = await exchange.getState()
  const token = new Token(connection, ASSET_ADDRESS, TOKEN_PROGRAM_ID, payer)
  const assetsList = await exchange.getAssetsList(state.assetsList)

  const tokenInfo = await token.getMintInfo()
  const ix = await exchange.setAssetMaxSupplyInstruction({
    assetAddress: ASSET_ADDRESS,
    newMaxSupply: toDecimal(
      NEW_MAX_COLLATERAL_AMOUNT.mul(new BN(10 ** tokenInfo.decimals)),
      tokenInfo.decimals
    )
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // await signAndSend(new Transaction().add(ix), [payer], connection)

  // console.log(tx)
}
main()
