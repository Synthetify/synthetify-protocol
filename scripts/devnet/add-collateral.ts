import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { createToken } from '../../tests/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { serializeInstructionToBase64 } from '@solana/spl-governance'

const provider = Provider.local('https://ssc-dao.genesysgo.net', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('Bt1hEbY62aMriY1SyQqbeZbm8VmSbQVGBFzSzMuVNWzN')
const COLLATERAL_ADDRESS = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj')
const COLLATERAL_RATIO = 70
// const DECIMALS = 8

const main = async () => {
  const connection = provider.connection
  //@ts-expect-error
  const payer = provider.wallet.payer as Account
  const exchange = await Exchange.build(connection, Network.MAIN, payer)
  const state = await exchange.getState()
  const assetsList = await exchange.getAssetsList(state.assetsList)
  // const token = await createToken({
  //   connection,
  //   payer: payer,
  //   mintAuthority: MINTER.publicKey,
  //   decimals: DECIMALS
  // })
  const token = new Token(connection, COLLATERAL_ADDRESS, TOKEN_PROGRAM_ID, payer)
  const tokenInfo = await token.getMintInfo()
  const liquidationFund = await token.createAccount(exchange.exchangeAuthority)
  console.log(liquidationFund.toString())
  const reserveAccount = await token.createAccount(exchange.exchangeAuthority)
  console.log(reserveAccount.toString())

  await sleep(1000)
  const ix = await exchange.addCollateralInstruction({
    assetAddress: token.publicKey,
    assetsList: state.assetsList,
    collateralRatio: percentToDecimal(COLLATERAL_RATIO),
    feedAddress: FEED_ADDRESS,
    liquidationFund,
    reserveAccount,
    reserveBalance: toDecimal(new BN(0), tokenInfo.decimals),
    maxCollateral: toDecimal(
      new BN(1_000_000).mul(new BN(10 ** tokenInfo.decimals)),
      tokenInfo.decimals
    )
  })
  console.log(serializeInstructionToBase64(ix))
  // await signAndSend(new Transaction().add(ix), [payer], connection)

  // const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  // console.log(tx)
}
main()
