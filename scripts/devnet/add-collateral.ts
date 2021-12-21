import { Provider } from '@project-serum/anchor'
import { PublicKey, Transaction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { percentToDecimal, sleep, toDecimal } from '@synthetify/sdk/lib/utils'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { MINTER } from '../../migrations/minter'
import { createToken } from '../../tests/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const FEED_ADDRESS = new PublicKey('E4v1BBgoso9s64TQvmyownAVJbhbEPGyzA3qn4n46qj9')
const COLLATERAL_ADDRESS = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')
const COLLATERAL_RATIO = 50
// const DECIMALS = 8

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

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
  const reserveAccount = await token.createAccount(exchange.exchangeAuthority)

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
      new BN(20_000).mul(new BN(10 ** tokenInfo.decimals)),
      tokenInfo.decimals
    )
  })
  // await signAndSend(new Transaction().add(ix), [payer], connection)

  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  console.log(tx)
}
main()
