import { BN, Program } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token, u64 } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'

export const ORACLE_ADMIN = new Account()
export const EXCHANGE_ADMIN = new Account()
export const ASSETS_MANAGER_ADMIN = new Account()

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
interface ICreateToken {
  connection: Connection
  payer: Account
  mintAuthority: PublicKey
  decimals?: number
}
export const createToken = async ({
  connection,
  payer,
  mintAuthority,
  decimals = 6
}: ICreateToken) => {
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
    instructions: [await oracleProgram.account.priceFeed.createInstruction(collateralTokenFeed)]
  })
  return collateralTokenFeed.publicKey
}
interface ICreateAssetsList {
  managerProgram: Program
  assetsAdmin: Account
  collateralTokenFeed: PublicKey
  collateralToken: Token
  connection: Connection
  wallet: Account
  assetsSize?: number
}
export const createAssetsList = async ({
  managerProgram,
  assetsAdmin,
  collateralToken,
  collateralTokenFeed,
  connection,
  wallet,
  assetsSize = 30
}: ICreateAssetsList) => {
  try {
    // IF we test without previous tests
    await managerProgram.state.rpc.new()
    await managerProgram.state.rpc.initialize(assetsAdmin.publicKey)
  } catch (error) {
    console.log('Dont worry about above error! ')
  }

  const usdToken = await createToken({
    connection,
    payer: wallet,
    mintAuthority: wallet.publicKey
  })
  const assetListAccount = new Account()
  const assetsList = assetListAccount.publicKey
  await managerProgram.rpc.createAssetsList(assetsSize, {
    accounts: {
      assetsList: assetListAccount.publicKey,
      rent: SYSVAR_RENT_PUBKEY
    },
    signers: [assetListAccount],
    instructions: [
      await managerProgram.account.assetsList.createInstruction(
        assetListAccount,
        assetsSize * 97 + 13
      )
    ]
  })
  await managerProgram.state.rpc.createList(
    collateralToken.publicKey,
    collateralTokenFeed,
    usdToken.publicKey,
    {
      accounts: {
        signer: assetsAdmin.publicKey,
        assetsList: assetsList
      },
      signers: [assetsAdmin]
    }
  )
  return assetsList
}
