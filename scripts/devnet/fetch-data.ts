import { Provider, AccountsCoder, Idl } from '@project-serum/anchor'
import { PublicKey, Transaction, Keypair, TransactionInstruction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import EXCHANGE_IDL from '../../target/idl/exchange.json'
import { ExchangeAccount } from '@synthetify/sdk/lib/exchange'
import fs from 'fs'

const provider = Provider.local('https://api.mainnet-beta.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  // @ts-expect-error
  const wallet = provider.wallet.payer as Keypair
  const coder = new AccountsCoder(EXCHANGE_IDL as Idl)
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.MAIN, DEVNET_ADMIN_ACCOUNT)
  await exchange.getState()
  // fetching all exchange accounts
  console.log('Fetching accounts...')
  const accounts = await connection.getProgramAccounts(exchange.programId, {
    filters: [{ dataSize: 1420 }]
  })

  console.log('Filtering accounts...')
  // filer accounts that can claim anything
  const accountsToClaim = await Promise.all(
    accounts
      .map((fetched) => {
        // parsing accounts
        const data = coder.decode<ExchangeAccount>('ExchangeAccount', fetched.account.data)
        return data
      })
      .filter((d) => d.debtShares.gtn(0))
      .filter((d) => {
        let msolCollateral = d.collaterals.find((a) =>
          a.collateralAddress.equals(new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'))
        )
        if (!msolCollateral) {
          return false
        }
        if (msolCollateral?.amount.gtn(0)) {
          d.collaterals = d.collaterals.filter((a) =>
            a.collateralAddress.equals(new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'))
          )

          return true
        }
        return false
      })
  )
  // console.table(accountsToClaim)
  const totalMSOL = accountsToClaim
    .reduce((acc, cur) => acc.add(cur.collaterals[0].amount), new BN(0))
    .toNumber()
  console.log('Total MSOL:', totalMSOL)
  const totalDebtShares = accountsToClaim
    .reduce((acc, cur) => acc.add(cur.debtShares), new BN(0))
    .toNumber()
  console.log('Total Debt Shares:', totalDebtShares)
  console.log('Total Debt Share:', totalDebtShares / exchange.state.debtShares.toNumber())
  const userPoints = accountsToClaim.map((a) => {
    return {
      points: Number(
        (a.debtShares.toNumber() * Math.sqrt(a.collaterals[0].amount.toNumber())).toFixed(0)
      ),
      address: a.owner.toBase58()
    }
  })
  const totalPoints = userPoints.reduce((acc, cur) => acc + cur.points, 0)
  console.log('totalPoints:', totalPoints)

  const amountPerDay = 2747.29 * 1e9
  const amountUsdPerYear = 771854.10631
  const amountPerPointS = (amountPerDay / totalPoints).toFixed(9)
  const amountPerPoint = Number(amountPerPointS)
  console.log('Amount per point:', amountPerPoint)
  const userDistribution = userPoints.map((a) => {
    return {
      points: a.points,
      address: a.address,
      distribution: Number((a.points * amountPerPoint).toFixed(0)) / 1e9
    }
  })
  console.table(userDistribution)
  await fs.writeFileSync(`./msolDist +${Date.now()}.json`, JSON.stringify(userDistribution))
}
main()
