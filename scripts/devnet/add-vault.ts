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
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import { DEVNET_ADMIN_ACCOUNT } from './admin'

const provider = Provider.local('https://ssc-dao.genesysgo.net', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
// @ts-expect-error
const wallet = provider.wallet.payer as Account
const connection = provider.connection

const COLLATERAL = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So')
const SYNTHETIC = new PublicKey('83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y')
const COLLATERAL_ORACLE = new PublicKey('E4v1BBgoso9s64TQvmyownAVJbhbEPGyzA3qn4n46qj9')
const MAX_BORROW = { val: new BN(10).pow(new BN(6)).muln(1_000_000), scale: 6 }
const COLLATERAL_RATIO = percentToDecimal(62)
const LIQUIDATION_THRESHOLD = percentToDecimal(72)
const LIQUIDATION_RATIO = percentToDecimal(50)
const PENALTY_EXCHANGE = percentToDecimal(1)
const PENALTY_LIQUIDATOR = percentToDecimal(7)
const VAULT_TYPE = 0
const DEBT_INTEREST_RATE = toScale(percentToDecimal(4), INTEREST_RATE_DECIMALS)
const OPEN_FEE = percentToDecimal(0.1)

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  const collateralToken = new Token(connection, COLLATERAL, TOKEN_PROGRAM_ID, wallet)
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
    maxBorrow: MAX_BORROW,
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
