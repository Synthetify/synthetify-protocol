import { BN, Program, web3 } from '@project-serum/anchor'
import { parsePriceData } from '@pythnetwork/client'
import { PriceStatus } from '@synthetify/sdk/lib/exchange'

interface ICreatePriceFeed {
  oracleProgram: Program
  initPrice: number
  confidence?: BN
  expo?: number
}
export const createPriceFeed = async ({
  oracleProgram,
  initPrice,
  confidence,
  expo = -8
}: ICreatePriceFeed) => {
  const conf = confidence || new BN(0)
  const collateralTokenFeed = new web3.Account()

  await oracleProgram.rpc.initialize(
    new BN(initPrice).mul(new BN(10).pow(new BN(-expo))),
    expo,
    conf,
    {
      accounts: { price: collateralTokenFeed.publicKey },
      signers: [collateralTokenFeed],
      instructions: [
        web3.SystemProgram.createAccount({
          fromPubkey: oracleProgram.provider.wallet.publicKey,
          newAccountPubkey: collateralTokenFeed.publicKey,
          space: 3312,
          lamports: await oracleProgram.provider.connection.getMinimumBalanceForRentExemption(3312),
          programId: oracleProgram.programId
        })
      ]
    }
  )
  return collateralTokenFeed.publicKey
}
export const setFeedPrice = async (
  oracleProgram: Program,
  newPrice: number,
  priceFeed: web3.PublicKey
) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  //@ts-expect-error
  const data = parsePriceData(info.data)
  await oracleProgram.rpc.setPrice(new BN(newPrice * 10 ** -data.exponent), {
    accounts: { price: priceFeed }
  })
}
export const setFeedTrading = async (
  oracleProgram: Program,
  newStatus: PriceStatus,
  priceFeed: web3.PublicKey
) => {
  await oracleProgram.rpc.setTrading(newStatus, {
    accounts: { price: priceFeed }
  })
}
export const setConfidence = async (
  oracleProgram: Program,
  newConfidence: number,
  priceFeed: web3.PublicKey
) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  //@ts-expect-error
  const data = parsePriceData(info.data)
  const scaledConf = new BN(newConfidence * 10 ** -data.exponent)

  await oracleProgram.rpc.setConfidence(scaledConf, {
    accounts: { price: priceFeed }
  })
}
export const setTwap = async (
  oracleProgram: Program,
  newTwap: number,
  priceFeed: web3.PublicKey
) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  //@ts-expect-error
  const data = parsePriceData(info.data)
  await oracleProgram.rpc.setTwap(new BN(newTwap * 10 ** -data.exponent), {
    accounts: { price: priceFeed }
  })
}
export const getFeedData = async (oracleProgram: Program, priceFeed: web3.PublicKey) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  //@ts-expect-error
  return parsePriceData(info.data)
}
