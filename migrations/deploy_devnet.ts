import { Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  sleep,
  SYNTHETIFY_ECHANGE_SEED
} from '../tests/utils'
import { MINTER } from './minter'
import oracleIdl from '../target/idl/pyth.json'
import { PublicKey, Transaction } from '@solana/web3.js'
import { createPriceFeed } from '../tests/oracleUtils'

const initialTokens = [
  {
    price: 50000,
    ticker: Buffer.from('xBTC'),
    decimals: 8,
    limit: new BN(1e12),
    priceFeed: new PublicKey('HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J')
  },
  {
    price: 36,
    ticker: Buffer.from('xSOL'),
    decimals: 6,
    limit: new BN(1e12),
    priceFeed: new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix')
  },
  {
    price: 5,
    ticker: Buffer.from('xSRM'),
    decimals: 6,
    limit: new BN(1e12),
    priceFeed: new PublicKey('992moaMQKs32GKZ9dxi8keyM2bUmbrwBZpK4p2K6X5Vs')
  }
]
const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})

const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
  'Fka99HSG9ErxA3zURgoLeSkSdvoKFAHHaHV1iYup12De'
)
const oracleProgramId: web3.PublicKey = new web3.PublicKey(
  'FqcnGwHttTjRzb87bDsDHbkEzhZwG8Nht86NziRN2qiw'
)
const authority = '6Ngr2N3CGjvWQMA15u4xEgPShfdyKWJ4mpDw7J7rWCx4'

const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const wallet = provider.wallet.payer as web3.Account
  const oracleProgram = new Program(oracleIdl as Idl, oracleProgramId, provider)

  const [exchangeAuthority, nonce] = await web3.PublicKey.findProgramAddress(
    [SYNTHETIFY_ECHANGE_SEED],
    exchangeProgramId
  )
  console.log('exchangeAuthority')
  console.log(exchangeAuthority.toString())
  const collateralTokenFeed = await createPriceFeed({
    oracleProgram,
    initPrice: 2,
    expo: -6
  })

  const collateralToken = await createToken({
    connection,
    payer: wallet,
    mintAuthority: MINTER.publicKey
  })
  console.log('Create Accounts')
  await sleep(2000)

  const snyReserve = await collateralToken.createAccount(exchangeAuthority)
  const snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)
  const stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

  console.log('Create Asset List')
  let exchange: Exchange
  // @ts-expect-error
  exchange = new Exchange(
    connection,
    Network.LOCAL,
    provider.wallet,
    exchangeAuthority,
    exchangeProgramId
  )

  const data = await createAssetsList({
    exchangeAuthority,
    collateralToken,
    collateralTokenFeed,
    connection,
    wallet,
    exchange,
    snyReserve,
    snyLiquidationFund
  })
  const assetsList = data.assetsList
  console.log('Initialize Exchange')
  await sleep(5000)
  await exchange.init({
    admin: wallet.publicKey,
    assetsList,
    nonce,
    amountPerRound: new BN(100 * 1e6),
    stakingRoundLength: 100,
    stakingFundAccount: stakingFundAccount
  })
  while (true) {
    await sleep(2000)
    try {
      console.log('state ')
      console.log(await exchange.getState())
      break
    } catch (error) {
      console.log('not found ')
    }
  }

  await sleep(5000)
  exchange = await Exchange.build(
    connection,
    Network.LOCAL,
    provider.wallet,
    exchangeAuthority,
    exchangeProgramId
  )
  // await exchange.getState()
  console.log('Initialize Tokens')

  for (const asset of initialTokens) {
    console.log(`Adding ${asset.ticker.toString()}`)

    const newToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: exchangeAuthority,
      decimals: asset.decimals
    })

    console.log(`Adding ${newToken.publicKey.toString()}`)
    await sleep(2000)

    const state = await exchange.getState()
    const newAssetIx = await exchange.addNewAssetInstruction({
      assetsList: assetsList,
      assetFeedAddress: asset.priceFeed
    })
    await signAndSend(new Transaction().add(newAssetIx), [wallet], connection)
    await sleep(5000)

    const addEthSynthetic = await exchange.addSyntheticInstruction({
      assetAddress: newToken.publicKey,
      assetsList,
      decimals: asset.decimals + 1,
      maxSupply: asset.limit,
      priceFeed: asset.priceFeed
    })
    await signAndSend(new Transaction().add(addEthSynthetic), [wallet], connection)
  }
  await sleep(5000)
  const state = await exchange.getState()
  await sleep(12000)
  await exchange.updatePrices(state.assetsList)
  await sleep(12000)
  await exchange.updatePrices(state.assetsList)
  await exchange.updatePrices(state.assetsList)
  const assets = await exchange.getAssetsList(state.assetsList)

  for (const asset of assets.synthetics) {
    console.log('##########')
    console.log(asset.assetAddress.toString())
    console.log(assets.assets[asset.assetIndex].price.toString())
  }
}
main()
