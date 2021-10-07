import { Provider } from '@project-serum/anchor'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { createToken } from '../../tests/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const COLLATERAL_TOKEN = new PublicKey('GeXDUSYeCVn5opXJ3pFzQguiHjqSXaEifSoEzHVTu1rW')
const SYNTHETIC_TOKEN = new PublicKey('6w9cNSAchLU4FSupCc2hMT3fkppABrZZPx6AZzojvzwe')
const limit = new BN(1_000).muln(1_000_000)

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  //@ts-expect-error
  const token = new Token(connection, COLLATERAL_TOKEN, TOKEN_PROGRAM_ID, provider.wallet.payer)
  const collateralReserve = await token.createAccount(exchange.exchangeAuthority)

  await sleep(1000)
  const { ix, swaplineAddress } = await exchange.createSwaplineInstruction({
    collateral: COLLATERAL_TOKEN,
    collateralReserve,
    synthetic: SYNTHETIC_TOKEN,
    limit
  })

  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)

  console.log(tx)
}
main()
