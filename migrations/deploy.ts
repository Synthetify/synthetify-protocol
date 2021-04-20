import { Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { BN, Exchange, Manager, Network } from '@synthetify/sdk'
import {
  createAssetsList,
  createPriceFeed,
  createToken,
  sleep,
  SYNTHETIFY_ECHANGE_SEED
} from '../tests/utils'
import { admin } from './testAdmin'
import oracleIdl from '../target/idl/oracle.json'

const initialTokens = [
  { price: new BN(40 * 1e4), ticker: Buffer.from('xFTT'), decimals: 6, limit: new BN(1e12) },
  { price: new BN(50000 * 1e4), ticker: Buffer.from('xBTC'), decimals: 8, limit: new BN(1e12) },
  { price: new BN(12 * 1e4), ticker: Buffer.from('xSOL'), decimals: 6, limit: new BN(1e12) },
  { price: new BN(5 * 1e4), ticker: Buffer.from('xSRM'), decimals: 6, limit: new BN(1e12) },
  { price: new BN(2000 * 1e4), ticker: Buffer.from('xETH'), decimals: 8, limit: new BN(1e12) },
  { price: new BN(25 * 1e4), ticker: Buffer.from('xLINK'), decimals: 6, limit: new BN(1e12) },
  { price: new BN(300 * 1e4), ticker: Buffer.from('xBNB'), decimals: 6, limit: new BN(1e12) }
]
const provider = Provider.local('https://testnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
// const provider = Provider.local('http://127.0.0.1:8899', {
//   // preflightCommitment: 'max',
//   skipPreflight: true
// })
const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
  '9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'
)
const oracleProgramId: web3.PublicKey = new web3.PublicKey(
  '8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'
)
const managerProgramId: web3.PublicKey = new web3.PublicKey(
  '2joXgqZtcTsSnBotkxmyYiZo3xPEzeGq7r4UZFXX2Kqu'
)
const authority = 'AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW'
// const exchangeProgramId: web3.PublicKey = new web3.PublicKey(
//   'H6AgoP6cPWtTxTJpuMYMvTjnkSRevUVX2GJSLJGTxLUQ'
// )
// const oracleProgramId: web3.PublicKey = new web3.PublicKey(
//   '4dp69AVMjj3q6KYMTvwWJjgGfXbN1GkNT7gcTRFhRd8c'
// )
// const managerProgramId: web3.PublicKey = new web3.PublicKey(
//   'GXM6bZUMGtNm1HetQeHz4bo67421kGoqtv4preV2QNiN'
// )

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
  // const collateralTokenFeed = await createPriceFeed({
  //   admin: wallet.publicKey,
  //   oracleProgram,
  //   initPrice: new BN(2 * 1e4)
  // })

  // const collateralToken = await createToken({
  //   connection,
  //   payer: wallet,
  //   mintAuthority: admin.publicKey
  // })
  // console.log('Create Account')
  // await sleep(15000)
  // const collateralAccount = await collateralToken.createAccount(exchangeAuthority)
  // const liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
  // console.log('Create Asset List')

  // const data = await createAssetsList({
  //   exchangeAuthority,
  //   assetsAdmin: wallet,
  //   collateralToken,
  //   collateralTokenFeed,
  //   connection,
  //   manager,
  //   wallet
  // })
  // const assetsList = data.assetsList
  // const usdToken = data.usdToken

  //@ts-ignore
  let exchange: Exchange = new Exchange(
    connection,
    Network.LOCAL,
    provider.wallet,
    manager,
    exchangeAuthority,
    exchangeProgramId
  )
  // console.log('Initialize Exchange')
  // await sleep(10000)
  // await exchange.init({
  //   admin: wallet.publicKey,
  //   assetsList,
  //   collateralAccount,
  //   liquidationAccount,
  //   collateralToken: collateralToken.publicKey,
  //   nonce
  // })
  // console.log('Initialize Tokens')

  // for (const asset of initialTokens) {
  //   console.log(`Adding ${asset.ticker.toString()}`)

  //   const newToken = await createToken({
  //     connection,
  //     payer: wallet,
  //     mintAuthority: exchangeAuthority,
  //     decimals: asset.decimals
  //   })
  //   const newFeed = await createPriceFeed({
  //     admin: wallet.publicKey,
  //     oracleProgram,
  //     initPrice: asset.price
  //   })
  //   console.log(`Adding ${newToken.publicKey.toString()}`)
  //   await sleep(10000)

  //   await manager.addNewAsset({
  //     assetsAdmin: wallet,
  //     assetsList,
  //     maxSupply: asset.limit,
  //     tokenAddress: newToken.publicKey,
  //     tokenDecimals: asset.decimals,
  //     tokenFeed: newFeed
  //   })
  // }
  const state = await exchange.getState()
  await manager.updatePrices(state.assetsList)
  const assets = await manager.getAssetsList(state.assetsList)

  for (const asset of assets.assets) {
    console.log(asset.assetAddress.toString())
    console.log(asset.price.toString())
  }
  // console.log(await exchange.getState())
}
main()