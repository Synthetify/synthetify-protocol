import { BN, Program } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
interface ICreateToken {
  connection: Connection
  payer: Account
  mintAuthority: PublicKey
  decimals?: number 
}
export const createToken = async ({ connection, payer, mintAuthority, decimals = 6 }: ICreateToken) => {
  const token = await Token.createMint(
    connection,
    payer,
    mintAuthority,
    null,
    decimals,
    TokenInstructions.TOKEN_PROGRAM_ID
  )
  return token
}
interface ICreatePriceFeed {
  oracleProgram: Program
  admin: PublicKey
  initPrice: BN
}
export const createPriceFeed = async ({
  oracleProgram,
  admin,
  initPrice = new BN(2 * 1e4)
}: ICreatePriceFeed) => {
  const collateralTokenFeed = new Account()

  await oracleProgram.rpc.create(admin, initPrice, {
    accounts: {
      priceFeed: collateralTokenFeed.publicKey,
      rent: SYSVAR_RENT_PUBKEY
    },
    signers: [collateralTokenFeed],
    instructions: [
      await oracleProgram.account.priceFeed.createInstruction(collateralTokenFeed)
    ]
  })
  return collateralTokenFeed.publicKey
}
