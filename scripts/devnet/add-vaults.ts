import { BN, Provider } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { Exchange, Network } from '@synthetify/sdk'
import { INTEREST_RATE_DECIMALS, percentToDecimal, toScale } from '@synthetify/sdk/src/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
// @ts-expect-error
const wallet = provider.wallet.payer as Account
const connection = provider.connection

const sny = new PublicKey('91qzpKj8nwYkssvG52moAtUUiWV5w4CuHwhkPQtBWTDE')
const xusd = new PublicKey('76qqFEokX3VgTxXX8dZYkDMijFtoYbJcxZZU4DgrDnUF')

const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  await exchange.getState()

  const maxBorrow = { val: new BN(100_000_000_000), scale: 6 } // 100_000 USD
  const debtInterestRate = toScale(percentToDecimal(7), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(30)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(50)
  const liquidationPenaltyExchange = percentToDecimal(5)
  const liquidationPenaltyLiquidator = percentToDecimal(5)

  const snyToken = new Token(connection, sny, TOKEN_PROGRAM_ID, wallet)
  const snyVaultReserve = await snyToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: sny,
    synthetic: xusd,
    collateralReserve: snyVaultReserve,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    liquidationPenaltyExchange,
    liquidationPenaltyLiquidator,
    liquidationThreshold,
    liquidationRatio
  })

  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  const vault = await exchange.getVaultForPair(xusd, sny)

  console.log(`vaultAddress = ${vaultAddress.toString()}`)
  console.log(vault)
}

main()
