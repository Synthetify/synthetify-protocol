import { Buffer } from 'buffer'
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
  expo = -4
}: ICreatePriceFeed) => {
  const conf = confidence || new BN((initPrice / 10) * 10 ** -expo)
  const collateralTokenFeed = new web3.Account()
  await oracleProgram.rpc.initialize(new BN(initPrice * 10 ** -expo), expo, conf, {
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
  })
  return collateralTokenFeed.publicKey
}
export const setFeedPrice = async (
  oracleProgram: Program,
  newPrice: number,
  priceFeed: web3.PublicKey
) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
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
export const setTwap = async (
  oracleProgram: Program,
  newTwap: number,
  priceFeed: web3.PublicKey
) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  const data = parsePriceData(info.data)
  await oracleProgram.rpc.setTwap(new BN(newTwap * 10 ** -data.exponent), {
    accounts: { price: priceFeed }
  })
}
export const getFeedData = async (oracleProgram: Program, priceFeed: web3.PublicKey) => {
  const info = await oracleProgram.provider.connection.getAccountInfo(priceFeed)
  return parsePriceData(info.data)
}
