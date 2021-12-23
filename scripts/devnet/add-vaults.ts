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
const xsol = new PublicKey('3zPcvFVBuV4f8hnwpWAsextaqFs73jB6JWvmYq5K7X2w')
const xsolPriceFeed = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
const xsolDecimal = 9

const main = async () => {
  const ledgerWallet = await getLedgerWallet()
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  console.log(`ledger: ${ledgerWallet.publicKey?.toString()}`)
  console.log(`admin: ${state.admin.toString()}`)

  await createSnyXsolVault(exchange, ledgerWallet)
  await createXusdXsolVault(exchange, ledgerWallet)
}

const createSnyXsolVault = async (exchange: Exchange, ledgerWallet: LedgerWalletProvider) => {
  const maxBorrow = {
    val: new BN(100_000).mul(new BN(10)).pow(new BN(xsolDecimal)),
    scale: xsolDecimal
  } // 100_000 SOL
  const debtInterestRate = toScale(percentToDecimal(4), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(30)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(50)
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)

  const snyToken = new Token(connection, sny, TOKEN_PROGRAM_ID, wallet)
  const snyVaultReserve = await snyToken.createAccount(exchange.exchangeAuthority)
  const snyVaultLiquidationFund = await snyToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: sny,
    synthetic: xsol,
    collateralReserve: snyVaultReserve,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    collateralPriceFeed: xsolPriceFeed,
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
const createXusdXsolVault = async (exchange: Exchange, ledgerWallet: LedgerWalletProvider) => {
  const maxBorrow = { val: new BN(10).pow(new BN(xsolDecimal)).muln(100_000), scale: xsolDecimal } // 100_000 xSOL
  const debtInterestRate = toScale(percentToDecimal(5), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(70)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(85)
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)

  const xusdToken = new Token(connection, xusd, TOKEN_PROGRAM_ID, wallet)
  const xusdVaultReserve = await xusdToken.createAccount(exchange.exchangeAuthority)
  const xusdVaultLiquidationFund = await xusdToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: xusd,
    synthetic: xsol,
    collateralReserve: xusdVaultReserve,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    collateralPriceFeed: PublicKey.default,
    liquidationFund: xusdVaultLiquidationFund,
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
