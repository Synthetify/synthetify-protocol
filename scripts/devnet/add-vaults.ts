import { BN, Provider } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Transaction } from '@solana/web3.js'
import { Exchange, Network } from '@synthetify/sdk'
import { OracleType } from '@synthetify/sdk/src/exchange'
import { INTEREST_RATE_DECIMALS, percentToDecimal, toScale } from '@synthetify/sdk/src/utils'
import { LedgerWalletProvider } from '../walletProvider/ledger'
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
const usdc = new PublicKey('HgexCyLCZUydm7YcJWeZRMK9HzsU17NJQvJGnMuzGVKG')
const xbtc = new PublicKey('HL5aKrMbm13a6VGNRSxJmy61nRsgySDacHVpLzCwHhL5')

const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  console.log(`ledger: ${ledgerWallet.publicKey?.toString()}`)
  console.log(`admin: ${state.admin.toString()}`)

  await createSnyXusdVault(exchange, ledgerWallet)
  await createUsdcXbtcVault(exchange, ledgerWallet)
}

const createSnyXusdVault = async (exchange: Exchange, ledgerWallet: LedgerWalletProvider) => {
  const maxBorrow = { val: new BN(100_000_000_000), scale: 6 } // 100_000 USD
  const debtInterestRate = toScale(percentToDecimal(7), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(30)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(50)
  const liquidationPenaltyExchange = percentToDecimal(5)
  const liquidationPenaltyLiquidator = percentToDecimal(5)

  const snyToken = new Token(connection, sny, TOKEN_PROGRAM_ID, wallet)
  const snyVaultReserve = await snyToken.createAccount(exchange.exchangeAuthority)
  const snyVaultLiquidationFund = await snyToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: sny,
    synthetic: xusd,
    collateralReserve: snyVaultReserve,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    collateralPriceFeed: new PublicKey('DEmEX28EgrdQEBwNXdfMsDoJWZXCHRS5pbgmJiTkjCRH'),
    liquidationFund: snyVaultLiquidationFund,
    openFee: percentToDecimal(1),
    liquidationPenaltyExchange,
    liquidationPenaltyLiquidator,
    liquidationThreshold,
    liquidationRatio,
    oracleType: OracleType.Pyth
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  const vault = await exchange.getVaultForPair(xusd, sny)
  console.log(vault)
}
const createUsdcXbtcVault = async (exchange: Exchange, ledgerWallet: LedgerWalletProvider) => {
  const btcDecimal = 10
  const maxBorrow = { val: new BN(10).pow(new BN(btcDecimal)).muln(100), scale: btcDecimal } // 100 BTC
  const debtInterestRate = toScale(percentToDecimal(7), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(50)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(75)
  const liquidationPenaltyExchange = percentToDecimal(5)
  const liquidationPenaltyLiquidator = percentToDecimal(5)

  const usdcToken = new Token(connection, usdc, TOKEN_PROGRAM_ID, wallet)
  const usdcVaultReserve = await usdcToken.createAccount(exchange.exchangeAuthority)
  const usdcVaultLiquidationFund = await usdcToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: usdc,
    synthetic: xbtc,
    collateralReserve: usdcVaultReserve,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    collateralPriceFeed: PublicKey.default,
    liquidationFund: usdcVaultLiquidationFund,
    openFee: percentToDecimal(1),
    liquidationPenaltyExchange,
    liquidationPenaltyLiquidator,
    liquidationThreshold,
    liquidationRatio,
    oracleType: OracleType.Pyth
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)
  const vault = await exchange.getVaultForPair(xusd, sny)
  console.log(vault)
}

main()
