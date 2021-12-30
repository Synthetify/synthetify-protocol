import { BN, Provider } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { IWallet, signAndSend } from '@synthetify/sdk'
import { Exchange, Network } from '@synthetify/sdk'
import { OracleType } from '@synthetify/sdk/src/exchange'
import {
  INTEREST_RATE_DECIMALS,
  percentToDecimal,
  toScale,
  UNIFIED_PERCENT_SCALE
} from '@synthetify/sdk/src/utils'
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
const xbtc = new PublicKey('HL5aKrMbm13a6VGNRSxJmy61nRsgySDacHVpLzCwHhL5')
const usdc = new PublicKey('HgexCyLCZUydm7YcJWeZRMK9HzsU17NJQvJGnMuzGVKG')
const xftt = new PublicKey('BPyw7qZrDTiUdUTCUSMcuyZnYEf4P2yo92L15L3VoK7V')
// const btcPriceFeed = new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J')
const snyPriceFeed = new PublicKey('DEmEX28EgrdQEBwNXdfMsDoJWZXCHRS5pbgmJiTkjCRH')
const xFTTDecimal = 8
const xsolDecimal = 9
const xbtcDecimal = 10

const main = async () => {
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()

  console.log(`admin: ${state.admin.toString()}`)

  // await createSnyXsolType0Vault(exchange, wallet)
  await createSnyXsolType1Vault(exchange, wallet)
  // await createXusdXbtcType0Vault(exchange, wallet)
  // await createUsdcXFTType1Vault(exchange, wallet)
}

const createSnyXsolType1Vault = async (exchange: Exchange, wallet: Account) => {
  const maxBorrow = { val: new BN(10).pow(new BN(xsolDecimal)).muln(100_000), scale: xsolDecimal } // 100_000 SOL
  const debtInterestRate = toScale(percentToDecimal(10), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(90)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = { val: new BN(90100), scale: UNIFIED_PERCENT_SCALE } // 90.1%
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)
  const vaultType = 1

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
    collateralPriceFeed: snyPriceFeed,
    liquidationFund: snyVaultLiquidationFund,
    openFee: percentToDecimal(1),
    liquidationPenaltyExchange,
    liquidationPenaltyLiquidator,
    liquidationThreshold,
    liquidationRatio,
    oracleType: OracleType.Pyth,
    vaultType
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSend(new Transaction().add(ix), [wallet], connection)
  const vault = await exchange.getVaultForPair(xusd, sny, vaultType)
  console.log(vault)
}

const maxBorrow = { val: new BN(10).pow(new BN(xsolDecimal)).muln(100_000), scale: xsolDecimal } // 100_000 SOL

const createSnyXsolType0Vault = async (exchange: Exchange, wallet: Account) => {
  const maxBorrow = { val: new BN(10).pow(new BN(xsolDecimal)).muln(100_000), scale: xsolDecimal } // 100_000 SOL
  const debtInterestRate = toScale(percentToDecimal(4), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(30)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(50)
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)
  const vaultType = 0

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
    collateralPriceFeed: snyPriceFeed,
    liquidationFund: snyVaultLiquidationFund,
    openFee: percentToDecimal(1),
    liquidationPenaltyExchange,
    liquidationPenaltyLiquidator,
    liquidationThreshold,
    liquidationRatio,
    oracleType: OracleType.Pyth,
    vaultType
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSend(new Transaction().add(ix), [wallet], connection)
  const vault = await exchange.getVaultForPair(xusd, sny, vaultType)
  console.log(vault)
}

// failed deu to provided seeds do not result in a valid address
const createXusdXbtcType0Vault = async (exchange: Exchange, wallet: Account) => {
  const maxBorrow = { val: new BN(10).pow(new BN(xbtcDecimal)).muln(10_000), scale: xbtcDecimal } // 10_000 BTC
  const debtInterestRate = toScale(percentToDecimal(5), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(70)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(85)
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)
  const vaultType = 0

  const xusdToken = new Token(connection, xusd, TOKEN_PROGRAM_ID, wallet)
  const xusdVaultReserve = await xusdToken.createAccount(exchange.exchangeAuthority)
  const xusdVaultLiquidationFund = await xusdToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: xusd,
    synthetic: xbtc,
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
    oracleType: OracleType.Pyth,
    vaultType
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSend(new Transaction().add(ix), [wallet], connection)
  const vault = await exchange.getVaultForPair(xusd, sny, vaultType)
  console.log(vault)
}

const createUsdcXFTType1Vault = async (exchange: Exchange, wallet: Account) => {
  const maxBorrow = { val: new BN(10).pow(new BN(xFTTDecimal)).muln(100_000), scale: xFTTDecimal } // 100_000 FTT
  const debtInterestRate = toScale(percentToDecimal(6), INTEREST_RATE_DECIMALS)
  const collateralRatio = percentToDecimal(70)
  const liquidationRatio = percentToDecimal(20)
  const liquidationThreshold = percentToDecimal(80)
  const liquidationPenaltyExchange = percentToDecimal(2)
  const liquidationPenaltyLiquidator = percentToDecimal(8)
  const vaultType = 1

  const usdcToken = new Token(connection, usdc, TOKEN_PROGRAM_ID, wallet)
  const usdcVaultReserve = await usdcToken.createAccount(exchange.exchangeAuthority)
  const usdcVaultLiquidationFund = await usdcToken.createAccount(exchange.exchangeAuthority)

  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: usdc,
    synthetic: xftt,
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
    oracleType: OracleType.Pyth,
    vaultType
  })
  console.log(`vaultAddress = ${vaultAddress.toString()}`)

  await signAndSend(new Transaction().add(ix), [wallet], connection)
  const vault = await exchange.getVaultForPair(xusd, sny, vaultType)
  console.log(vault)
}

const fetchVault = async (exchange: Exchange) => {
  const vault = await exchange.getVaultForPair(xsol, sny, 0)
  console.log(vault)
}

main()
