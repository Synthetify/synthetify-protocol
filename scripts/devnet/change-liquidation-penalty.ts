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
const PENALTY_TO_EXCHANGE = 1
const PENALTY_TO_LIQUIDATOR = 8
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  // @ts-expect-error
  const payer = provider.wallet.payer as Account

  const exchange = await Exchange.build(connection, Network.MAIN, payer)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)

  const ix = await exchange.setLiquidationPenaltiesInstruction({
    penaltyToExchange: percentToDecimal(PENALTY_TO_EXCHANGE),
    penaltyToLiquidator: percentToDecimal(PENALTY_TO_LIQUIDATOR)
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // await signAndSend(new Transaction().add(ix), [payer], connection)

  // console.log(tx)
}
main()
