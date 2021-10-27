import { Provider, AccountsCoder, Idl } from '@project-serum/anchor'
import { PublicKey, Transaction, Keypair, TransactionInstruction } from '@solana/web3.js'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { getLedgerWallet, signAndSendLedger } from '../walletProvider/wallet'
import EXCHANGE_IDL from '@synthetify/sdk/lib/idl/exchange.json'
import { ExchangeAccount } from '@synthetify/sdk/lib/exchange'

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const main = async () => {
  // @ts-expect-error
  const wallet = provider.wallet.payer as Keypair
  const coder = new AccountsCoder(EXCHANGE_IDL as Idl)
  const connection = provider.connection
  // @ts-expect-error
  const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT)
  await exchange.getState()

  // fetching all exchange accounts
  console.log('Fetching accounts...')
  const accounts = await connection.getProgramAccounts(exchange.programId, {
    filters: [{ dataSize: 1420 }]
  })

  console.log('Filtering accounts...')
  // filer accounts that can claim anything
  const accountsToClaim = (await Promise.all(
    accounts
      .map((fetched) => {
        // parsing accounts
        const data = coder.decode<ExchangeAccount>('ExchangeAccount', fetched.account.data)
        if (data.userStakingData.finishedRoundPoints.gt(new BN(0))) {
          return exchange.claimRewardsInstruction(fetched.pubkey)
        }
      })
      .filter((ix) => {
        return ix != undefined
      })
  )) as TransactionInstruction[]

  console.log(`found ${accountsToClaim.length} accounts, claiming...`)

  const chunkSize = 22
  let chunk: TransactionInstruction[] = []
  for (let i = 0; i < accountsToClaim.length; i++) {
    chunk.push(accountsToClaim[i])

    // when chunk ends send transaction
    if (i % chunkSize == chunkSize - 1 || i == accountsToClaim.length - 1) {
      const tx = new Transaction()
      chunk.forEach((ix) => tx.add(ix as TransactionInstruction))

      const id = await signAndSend(tx, [wallet], connection)
      console.log(id)
      chunk = []
    }
  }
}
main()
