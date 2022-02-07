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
  skipPreflight: true,
  commitment: 'recent'
})
// @ts-expect-error
const wallet = provider.wallet.payer as Account
const connection = provider.connection

const COLLATERAL = new PublicKey('83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y')
const SYNTHETIC = new PublicKey('HtxznfExBatdX28kMFDvmvU1rXVwiG3JSWcNPdFQ4PLh')
const COLLATERAL_ORACLE = new PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG')
const MAX_BORROW = 100
const COLLATERAL_RATIO = percentToDecimal(65)
const LIQUIDATION_THRESHOLD = percentToDecimal(75)
const LIQUIDATION_RATIO = percentToDecimal(50)
const PENALTY_EXCHANGE = percentToDecimal(1)
const PENALTY_LIQUIDATOR = percentToDecimal(9)
const VAULT_TYPE = 0
const DEBT_INTEREST_RATE = toScale(percentToDecimal(4), INTEREST_RATE_DECIMALS)
const OPEN_FEE = percentToDecimal(0.01)

const main = async () => {
  const ledgerWallet = await getLedgerWallet()

  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  const state = await exchange.getState()
  // const collateralToken = new Token(connection, COLLATERAL, TOKEN_PROGRAM_ID, wallet)
  // const info = await collateralToken.getMintInfo()
  // console.log(wallet.publicKey.toBase58())
  // console.log(await connection.getBalance(wallet.publicKey))
  // const collateralVaultReserve = await collateralToken.createAccount(exchange.exchangeAuthority)
  // const collateralVaultLiquidationFund = await collateralToken.createAccount(
  //   exchange.exchangeAuthority
  // )

  const ix = await exchange.setVaultHaltedInstruction({
    collateral: COLLATERAL,
    synthetic: SYNTHETIC,
    vaultType: VAULT_TYPE,
    halted: true
  })
  const tx = await signAndSendLedger(new Transaction().add(ix), connection, ledgerWallet)

  console.log(`tx: ${tx.toString()}`)
}
main()
