import { BN, Provider } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { IWallet, signAndSend } from '@synthetify/sdk'
import { Exchange, Network } from '@synthetify/sdk'
import { DEFAULT_PUBLIC_KEY } from '@synthetify/sdk/lib/utils'
import { OracleType } from '@synthetify/sdk/src/exchange'
import {
  INTEREST_RATE_DECIMALS,
  percentToDecimal,
  toScale,
  UNIFIED_PERCENT_SCALE
} from '@synthetify/sdk/src/utils'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://ssc-dao.genesysgo.net', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
// @ts-expect-error
const wallet = provider.wallet.payer as Account
const connection = provider.connection

const COLLATERAL = new PublicKey('82Afat35Wr9v4fsZfSqGh8dnXFjxeaiQBfm5G9TK1BNj')
const SYNTHETIC = new PublicKey('83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y')
const COLLATERAL_ORACLE = new PublicKey('EcV1X1gY2yb4KXxjVQtTHTbioum2gvmPnFk4zYAt7zne')
const MAX_BORROW = 1_000_000
const COLLATERAL_RATIO = percentToDecimal(60)
const LIQUIDATION_THRESHOLD = percentToDecimal(70)
const LIQUIDATION_RATIO = percentToDecimal(50)
const PENALTY_EXCHANGE = percentToDecimal(1)
const PENALTY_LIQUIDATOR = percentToDecimal(9)
const VAULT_TYPE = 3
const DEBT_INTEREST_RATE = toScale(percentToDecimal(4), INTEREST_RATE_DECIMALS)
const OPEN_FEE = percentToDecimal(0.01)

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const collateralToken = new Token(connection, COLLATERAL, TOKEN_PROGRAM_ID, wallet)
  const info = await collateralToken.getMintInfo()
  console.log(wallet.publicKey.toBase58())
  console.log(await connection.getBalance(wallet.publicKey))
  const collateralVaultReserve = await collateralToken.createAccount(exchange.exchangeAuthority)
  const collateralVaultLiquidationFund = await collateralToken.createAccount(
    exchange.exchangeAuthority
  )
  const { ix, vaultAddress } = await exchange.createVaultInstruction({
    collateral: COLLATERAL,
    synthetic: SYNTHETIC,
    collateralReserve: collateralVaultReserve,
    debtInterestRate: DEBT_INTEREST_RATE,
    collateralRatio: COLLATERAL_RATIO,
    maxBorrow: {
      val: new BN(10).pow(new BN(info.decimals)).muln(MAX_BORROW),
      scale: info.decimals
    },
    collateralPriceFeed: COLLATERAL_ORACLE,
    liquidationFund: collateralVaultLiquidationFund,
    openFee: OPEN_FEE,
    liquidationPenaltyExchange: PENALTY_EXCHANGE,
    liquidationPenaltyLiquidator: PENALTY_LIQUIDATOR,
    liquidationThreshold: LIQUIDATION_THRESHOLD,
    liquidationRatio: LIQUIDATION_RATIO,
    oracleType: OracleType.Pyth,
    vaultType: VAULT_TYPE
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)

  console.log(`tx: ${tx.toString()}`)
}
main()
