import { BN, Program } from '@project-serum/anchor'
import { TokenInstructions } from '@project-serum/serum'
import { Token, TOKEN_PROGRAM_ID, u64 } from '@solana/spl-token'
import { Account, Connection, PublicKey, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js'
import { Exchange, Manager, signAndSend } from '@synthetify/sdk'
import { AssetsList } from '@synthetify/sdk/lib/manager'

export const ORACLE_ADMIN = new Account()
export const EXCHANGE_ADMIN = new Account()
export const ASSETS_MANAGER_ADMIN = new Account()
export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 4
export const ACCURACY = 6

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.assets.reduce(
    (acc, asset) =>
      acc.add(
        asset.supply.mul(asset.price).div(new BN(10 ** (asset.decimals + ORACLE_OFFSET - ACCURACY)))
      ),
    new BN(0)
  )
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
export interface ICreateAssetsList {
  manager: Manager
  assetsAdmin: Account
  collateralTokenFeed: PublicKey
  exchangeAuthority: PublicKey
  collateralToken: Token
  connection: Connection
  wallet: Account
  assetsSize?: number
}
export type AddNewAssetResult = {
  assetAddress: PublicKey
  feedAddress: PublicKey
}
export interface IAddNewAssets {
  manager: Manager
  oracleProgram: Program
  connection: Connection
  wallet: Account
  assetsList: PublicKey
  newAssetDecimals: number
  newAssetLimit: BN
  newAssetsNumber?: number
}
export const createAssetsList = async ({
  manager,
  assetsAdmin,
  collateralToken,
  collateralTokenFeed,
  connection,
  wallet,
  exchangeAuthority,
  assetsSize = 30
}: ICreateAssetsList) => {
  try {
    // IF we test without previous tests
    await manager.init(assetsAdmin.publicKey)
  } catch (error) {
    console.log('Dont worry about above error! ')
  }

  const usdToken = await createToken({
    connection,
    payer: wallet,
    mintAuthority: exchangeAuthority
  })
  const assetsList = await manager.createAssetsList(assetsSize)

  await manager.initializeAssetsList({
    assetsAdmin,
    assetsList,
    collateralToken: collateralToken.publicKey,
    collateralTokenFeed,
    exchangeAuthority,
    usdToken: usdToken.publicKey
  })
  return { assetsList, usdToken }
}
export const addNewAssets = async ({
  connection,
  wallet,
  oracleProgram,
  manager,
  assetsList,
  newAssetDecimals,
  newAssetLimit,
  newAssetsNumber = 1
}: IAddNewAssets) => {
  let newAssetsResults = []
  for (var newAssetNumber = 0; newAssetNumber < newAssetsNumber; newAssetNumber++) {
    const newToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey,
      decimals: newAssetDecimals
    })
    const newTokenFeed = await createPriceFeed({
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: new BN(2 * 1e4)
    })

    await manager.addNewAsset({
      assetsAdmin: ASSETS_MANAGER_ADMIN,
      assetsList,
      maxSupply: newAssetLimit,
      tokenAddress: newToken.publicKey,
      tokenDecimals: newAssetDecimals,
      tokenFeed: newTokenFeed
    })
    newAssetsResults.push({
      assetAddress: newToken.publicKey,
      feedAddress: newTokenFeed
    })
  }
  return newAssetsResults
}

const newAccountWithLamports = async (connection, lamports = 1e10) => {
  const account = new Account()

  let retries = 30
  await connection.requestAirdrop(account.publicKey, lamports)
  for (;;) {
    await sleep(500)
    // eslint-disable-next-line eqeqeq
    if (lamports == (await connection.getBalance(account.publicKey))) {
      return account
    }
    if (--retries <= 0) {
      break
    }
  }
  throw new Error(`Airdrop of ${lamports} failed`)
}
export interface IAccountWithCollateral {
  exchange: Exchange
  collateralTokenMintAuthority: PublicKey
  collateralAccount: PublicKey
  exchangeAuthority: PublicKey
  collateralToken: Token
  amount: BN
}
export const createAccountWithCollateral = async ({
  exchange,
  collateralTokenMintAuthority,
  collateralToken,
  collateralAccount,
  exchangeAuthority,
  amount
}: IAccountWithCollateral) => {
  const accountOwner = await newAccountWithLamports(exchange.connection)
  const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)
  const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
  await collateralToken.mintTo(
    userCollateralTokenAccount,
    collateralTokenMintAuthority,
    [],
    tou64(amount)
  )
  const depositIx = await exchange.depositInstruction({
    amount: amount,
    collateralAccount,
    exchangeAccount,
    exchangeAuthority,
    userCollateralAccount: userCollateralTokenAccount
  })
  const approveIx = Token.createApproveInstruction(
    collateralToken.programId,
    userCollateralTokenAccount,
    exchangeAuthority,
    accountOwner.publicKey,
    [],
    tou64(amount)
  )
  await signAndSend(
    new Transaction().add(approveIx).add(depositIx),
    [accountOwner],
    exchange.connection
  )

  return { accountOwner, exchangeAccount: exchangeAccount, userCollateralTokenAccount }
}
