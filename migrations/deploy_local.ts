import { Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { BN, Exchange, Network } from '@synthetify/sdk'
import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  sleep,
  SYNTHETIFY_ECHANGE_SEED
} from '../tests/utils'
import { admin } from './testAdmin'
import oracleIdl from '../target/idl/pyth.json'
import { PublicKey } from '@solana/web3.js'
import { createPriceFeed } from '../tests/oracleUtils'

const initialTokens = [
  {
    price: 50000,
    ticker: Buffer.from('xBTC'),
    decimals: 8,
    limit: new BN(1e12)
  },
  {
    price: 36,
    ticker: Buffer.from('xSOL'),
    decimals: 6,
    limit: new BN(1e12)
  },
  {
    price: 5,
    ticker: Buffer.from('xSRM'),
    decimals: 6,
    limit: new BN(1e12)
  }
]
// const provider = Provider.local('https://api.devnet.solana.com', {
//   // preflightCommitment: 'max',
//   skipPreflight: true
// })
const provider = Provider.local('http://127.0.0.1:8899', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
  '8ixZBWTk7nm96Rso3PbqvY7epnNouf5vb9SjHBvjmPqJ'
)
const oracleProgramId: web3.PublicKey = new web3.PublicKey(
  'HfwDLqu3SEgMxqZffrvZJunR97LmCrKDN6zDXPUiZEtB'
)
const authority = 'CxmyR2rzKWjbTJThQWGeaDF4ACeXq3RSg45Q1rhzgkXv'

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
    mintAuthority: admin.publicKey
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
  console.log(assetsList.toString())
  console.log('Initialize Exchange')
  await sleep(5000)
  await exchange.init({
    admin: wallet.publicKey,
    assetsList,
    nonce,
    amountPerRound: new BN(100),
    stakingRoundLength: 300,
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

    const oracleAddress = await createPriceFeed({
      oracleProgram,
      initPrice: asset.price,
      expo: -asset.decimals
    })
    await sleep(2000)
    const state = await exchange.getState()
    await exchange.addNewAsset({
      assetsAdmin: wallet,
      assetsList: state.assetsList,
      maxSupply: asset.limit,
      tokenAddress: newToken.publicKey,
      tokenDecimals: asset.decimals,
      tokenFeed: oracleAddress
    })
  }
  await sleep(5000)
  const state = await exchange.getState()
  await exchange.updatePrices(state.assetsList)
  await sleep(12000)
  const assets = await exchange.getAssetsList(state.assetsList)
  for (const asset of assets.assets) {
    console.log('##########')
    console.log(asset.synthetic.assetAddress.toString())
    console.log(asset.price.toString())
  }
}
main()
