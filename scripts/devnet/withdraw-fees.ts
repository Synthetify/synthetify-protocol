import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'
import { SWAPLINE_MAP } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { U64_MAX } from '../../tests/utils'
const provider = Provider.local('https://ssc-dao.genesysgo.net', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  const token = new Token(
    connection,
    assetsList.synthetics[0].assetAddress,
    TOKEN_PROGRAM_ID,
    payer
  )
  const acc = await token.getOrCreateAssociatedAccountInfo(ledgerWallet.pubKey!)
  const ix = await exchange.withdrawAccumulatedDebtInterestInstruction({
    amount: U64_MAX,
    to: acc.address
  })
  const ix2 = await exchange.withdrawSwapTaxInstruction({
    amount: U64_MAX,
    to: acc.address
  })
  const tx = await signAndSendLedger(new Transaction().add(ix).add(ix2), connection, ledgerWallet)
}
main()
