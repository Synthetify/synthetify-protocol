import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { percentToDecimal } from '@synthetify/sdk/lib/utils'
const provider = Provider.local('https://rpc.nightly.app:8899', {
  // preflightCommitment: 'max',
  skipPreflight: true,
  commitment: 'recent'
})
const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  console.log(state.accumulatedDebtInterest.val.toString())
  console.log(state.swapTaxReserve.val.toString())
  // console.log(state.exchangeAuthority.toString())
  const assetsList = await exchange.getAssetsList(state.assetsList)
  const address = new PublicKey('Bz6zbmbZn2ERVsLq4gUCgqLJCTdWYS1iN59EdSbNoPZv')
  const acc = await exchange.getExchangeAccount(address)
  // console.log(acc.collaterals)
  // console.log(
  //   assetsList.collaterals.forEach((a) => {
  //     console.log(a.reserveBalance.val.toString())
  //     console.log(a.maxCollateral.val.toString())
  //   })
  // )
  // const line = SWAPLINE_MAP[Network.MAIN][0]
  // const swapline = await exchange.getSwapline(
  //   (
  //     await exchange.getSwaplineAddress(line.synthetic, line.collateral)
  //   ).swaplineAddress
  // )
  // console.log(swapline.accumulatedFee.val.toString())

  // assetsList.collaterals.forEach((c) => {
  //   console.log(c.collateralAddress.toString())
  //   console.log(c.maxCollateral.val.toString())
  //   console.log(c.collateralRatio.val.toString())
  // })
}
main()
