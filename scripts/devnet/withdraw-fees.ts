import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'
import { SWAPLINE_MAP } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { U64_MAX } from '../../tests/utils'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
const provider = Provider.local('https://ssc-dao.genesysgo.net', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  // const token = new Token(
  //   connection,
  //   assetsList.synthetics[0].assetAddress,
  //   TOKEN_PROGRAM_ID,
  //   payer
  // )
  const TARGET = new PublicKey('EfvgivprPpxStccDCdGBVSyfpYW6GYQBCEpQmwckzdgT')
  const oracleix = await exchange.updatePricesInstruction(state.assetsList)
  // console.log(
  //   new Transaction()
  //     .add(oracleix)
  //     .serialize({ requireAllSignatures: false, verifySignatures: false }).byteLength
  // )
  // console.log(serializeInstructionToBase64(oracleix))

  // const ix = await exchange.withdrawAccumulatedDebtInterestInstruction({
  //   amount: U64_MAX,
  //   to: TARGET
  // })
  // console.log(serializeInstructionToBase64(ix))

  // const ix2 = await exchange.withdrawSwapTaxInstruction({
  //   amount: U64_MAX,
  //   to: TARGET
  // })
  // console.log(serializeInstructionToBase64(ix2))
}
main()
