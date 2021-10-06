import { Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'
import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  sleep,
  SYNTHETIFY_EXCHANGE_SEED
} from '../tests/utils'
import { MINTER } from './minter'
import oracleIdl from '../target/idl/pyth.json'
import { PublicKey, Transaction } from '@solana/web3.js'
import { createPriceFeed } from '../tests/oracleUtils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'

const initialTokens = [
  {
    price: 50000,
    ticker: Buffer.from('xBTC'),
    decimals: 10,
    limit: new BN(1e12),
    priceFeed: new PublicKey('GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU')
  },
  {
    price: 36,
    ticker: Buffer.from('xSOL'),
    decimals: 9,
    limit: new BN(1e13),
    priceFeed: new PublicKey('H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG')
  },
  {
    price: 5,
    ticker: Buffer.from('xFTT'),
    decimals: 8,
    limit: new BN(1e11),
    priceFeed: new PublicKey('8JPJJkmDScpcNmBRKGZuPuG2GYAveQgP3t5gFuMymwvF')
  },
  {
    price: 3000,
    ticker: Buffer.from('xETH'),
    decimals: 9,
    limit: new BN(1e12),
    priceFeed: new PublicKey('JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB')
  }
]
const provider = Provider.local('https://solana-api.projectserum.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const connection = provider.connection

const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
  '5Jx2koXFSH1CNB5NKtACUh1zhNb1h2G27HKUzeYkUvS3'
)
const authority = 'Gs1oPECd79PkytEaUPutykRoZomXVY8T68yMQ6Lpbo7i'

const SNY_MINT = new PublicKey('4dmKkXNHdgYsXqBHCuMikNQWwVomZURhYvkkX5c4pQ7y')
const SNY_ORACLE = new PublicKey('BkN8hYgRjhyH5WNBQfDV73ivvdqNKfonCMhiYVJ1D9n9')

const main = async () => {
  // const connection = provider.connection
  // @ts-expect-error
  const wallet = provider.wallet.payer as web3.Account

  const [exchangeAuthority, nonce] = await web3.PublicKey.findProgramAddress(
    [SYNTHETIFY_EXCHANGE_SEED],
    exchangeProgramId
  )
  console.log('exchangeAuthority')
  console.log(exchangeAuthority.toString())
  const collateralTokenFeed = SNY_ORACLE

  const collateralToken = new Token(connection, SNY_MINT, TOKEN_PROGRAM_ID, wallet)
  console.log('Create Accounts')
  await sleep(2000)

  const snyReserve = await collateralToken.createAccount(exchangeAuthority)
  const snyLiquidationFund = await collateralToken.createAccount(exchangeAuthority)
  const stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

  let exchange: Exchange
  // @ts-expect-error
  exchange = new Exchange(
    connection,
    Network.LOCAL,
    provider.wallet,
    exchangeAuthority,
    exchangeProgramId
  )
  console.log('Init exchange')
  await sleep(1000)

  await exchange.init({
    admin: wallet.publicKey,
    nonce,
    amountPerRound: new BN(100 * 1e6),
    stakingRoundLength: 100,
    stakingFundAccount: stakingFundAccount,
    exchangeAuthority: exchangeAuthority
  })
  await sleep(10000)

  exchange = await Exchange.build(
    connection,
    Network.LOCAL,
    provider.wallet,
    exchangeAuthority,
    exchangeProgramId
  )
  await sleep(10000)

  console.log('Create Asset List')
  const data = await createAssetsList({
    exchangeAuthority,
    collateralToken,
    collateralTokenFeed,
    connection,
    wallet,
    exchangeAdmin: wallet,
    exchange,
    snyReserve: snyReserve,
    snyLiquidationFund: snyLiquidationFund
  })
  const assetsList = data.assetsList
  await sleep(10000)

  console.log('Set assets list')
  await exchange.setAssetsList({ exchangeAdmin: wallet, assetsList })

  while (true) {
    await sleep(2000)
    try {
      console.log('state ')
      console.log(await exchange.getState())
      break
    } catch (error) {
      console.log(error)
      console.log('not found ')
    }
  }
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
    await sleep(10000)

    const addEthSynthetic = await exchange.addSyntheticInstruction({
      assetAddress: newToken.publicKey,
      assetsList,
      maxSupply: asset.limit,
      priceFeed: asset.priceFeed
    })
    await signAndSend(new Transaction().add(addEthSynthetic), [wallet], connection)
  }
  await sleep(5000)
  const state = await exchange.getState()
  await sleep(12000)
  await exchange.updatePrices(state.assetsList)
  const assets = await exchange.getAssetsList(state.assetsList)

  for (const asset of assets.synthetics) {
    console.log('##########')
    console.log('Synthetics')

    console.log(asset.assetAddress.toString())
    console.log(assets.assets[asset.assetIndex].price.val.toString())
  }
  for (const asset of assets.collaterals) {
    console.log('##########')
    console.log('Collaterals')
    console.log(asset.collateralAddress.toString())
    console.log(assets.assets[asset.assetIndex].price.toString())
  }
}
main()
