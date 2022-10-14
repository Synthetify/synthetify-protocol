import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'
import { SWAPLINE_MAP } from '@synthetify/sdk/lib/utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  const TARGET = new PublicKey('AnvTVPS1GkVBGhQ4dAQxF9BezqUGtYbTbH8UU2kbL4Lu')
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  for (let index = 0; index < 5; index++) {
    const line = SWAPLINE_MAP[Network.MAIN][index]
    const swapline = await exchange.getSwapline(
      (
        await exchange.getSwaplineAddress(line.synthetic, line.collateral)
      ).swaplineAddress
    )
    console.log(line.collateral.toString())
    // if (line.collateral.toString() === 'So11111111111111111111111111111111111111112') {
    //   continue
    // }
    const token = new Token(connection, line.collateral, TOKEN_PROGRAM_ID, payer)
    const acc = await token.getOrCreateAssociatedAccountInfo(TARGET)
    console.log(acc.address.toString())
    console.log(acc.owner.toString())
    const ix = await exchange.withdrawSwaplineFee({
      amount: swapline.accumulatedFee.val,
      collateral: line.collateral,
      synthetic: line.synthetic,
      to: acc.address
    })
    console.log(serializeInstructionToBase64(ix))
    // const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  }
}
main()
