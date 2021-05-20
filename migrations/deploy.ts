import { Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { BN, Exchange, Manager, Network } from '@synthetify/sdk'
import { createAssetsList, createToken, sleep, SYNTHETIFY_ECHANGE_SEED } from '../tests/utils'
import { admin } from './testAdmin'
import oracleIdl from '../target/idl/pyth.json'
import { PublicKey } from '@solana/web3.js'
import { createPriceFeed } from '../tests/oracleUtils'

const initialTokens = [
  {
    price: new BN(50000 * 1e4),
    ticker: Buffer.from('xBTC'),
    decimals: 8,
    limit: new BN(1e12),
    oracleAddress: new PublicKey('FCLf9N8xcN9HBA9Cw68FfEZoSBr4bYYJtyRxosNzswMH')
  },
  {
    price: new BN(12 * 1e4),
    ticker: Buffer.from('xSOL'),
    decimals: 6,
    limit: new BN(1e12),
    oracleAddress: new PublicKey('BdgHsXrH1mXqhdosXavYxZgX6bGqTdj5mh2sxDhF8bJy')
  },
  {
    price: new BN(5 * 1e4),
    ticker: Buffer.from('xSRM'),
    decimals: 6,
    limit: new BN(1e12),
    oracleAddress: new PublicKey('2Mt2wcRXpCAbTRp2VjFqGa8SbJVzjJvyK4Tx7aqbRtBJ')
  }
]
const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
// const provider = Provider.local('http://127.0.0.1:8899', {
//   // preflightCommitment: 'max',
//   skipPreflight: true
// })
const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
  '7nQjxBds85XHHA73Y8Nvvs7Dat7Vs1L4cuXJ8yksCTpP'
)
const oracleProgramId: web3.PublicKey = new web3.PublicKey(
  '8XMb2Fvot4FiERQ6XxNhfoeVeCQ7UyBBKjZzr459bdvv'
)
const managerProgramId: web3.PublicKey = new web3.PublicKey(
  '3pWcxWE2p1tpvG9H1ZqUo8x9FH8FwqRggQnPQFuRLkRf'
)
const authority = '4nddjKsbFxFcsNRin4XGayArV3nFgXayA8KojYyW7DJb'

const main = async () => {
  const connection = provider.connection
  // @ts-expect-error
  const wallet = provider.wallet.payer as web3.Account
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgramId)
  const oracleProgram = new Program(oracleIdl as Idl, oracleProgramId, provider)
  const [exchangeAuthority, nonce] = await web3.PublicKey.findProgramAddress(
    [SYNTHETIFY_ECHANGE_SEED],
    exchangeProgramId
  )
  console.log('Create Collateral Token')
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
  console.log('Create Account')
  await sleep(15000)
  const collateralAccount = await collateralToken.createAccount(exchangeAuthority)
  const liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
  const stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

  console.log('Create Asset List')

  const data = await createAssetsList({
    exchangeAuthority,
    assetsAdmin: wallet,
    collateralToken,
    collateralTokenFeed,
    connection,
    manager,
    wallet
  })
  const assetsList = data.assetsList
  const usdToken = data.usdToken

  //@ts-ignore
  let exchange: Exchange = new Exchange(
    connection,
    Network.LOCAL,
    provider.wallet,
    manager,
    exchangeAuthority,
    exchangeProgramId
  )
  console.log('Initialize Exchange')
  await sleep(10000)
  await exchange.init({
    admin: wallet.publicKey,
    assetsList,
    collateralAccount,
    liquidationAccount,
    collateralToken: collateralToken.publicKey,
    nonce,
    amountPerRound: new BN(100 * 1e6),
    stakingRoundLength: 172800, // about one day
    stakingFundAccount: stakingFundAccount
  })
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
    await sleep(10000)

    await manager.addNewAsset({
      assetsAdmin: wallet,
      assetsList,
      maxSupply: asset.limit,
      tokenAddress: newToken.publicKey,
      tokenDecimals: asset.decimals,
      tokenFeed: asset.oracleAddress
    })
  }
  const state = await exchange.getState()
  await manager.updatePrices(state.assetsList)
  const assets = await manager.getAssetsList(state.assetsList)
  await sleep(5000)
  for (const asset of assets.assets) {
    console.log(asset.assetAddress.toString())
    console.log(asset.price.toString())
  }
  // console.log(await exchange.getState())
}
main()
