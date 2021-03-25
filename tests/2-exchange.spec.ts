import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { assert, expect } from 'chai'
import {
  createAssetsList,
  createPriceFeed,
  createToken,
  sleep,
  ORACLE_ADMIN,
  ASSETS_MANAGER_ADMIN,
  EXCHANGE_ADMIN
} from './utils'

describe('exchange', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program

  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  const programSigner = new anchor.web3.Account()
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let mintAuthority: PublicKey
  let collateralAccount: PublicKey
  let nonce: number
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [programSigner.publicKey.toBuffer()],
      exchangeProgram.programId
    )
    nonce = _nonce
    mintAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: new BN(2 * 1e4)
    })
    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey
    })
    collateralAccount = await collateralToken.createAccount(mintAuthority)
    assetsList = await createAssetsList({
      assetsAdmin: ASSETS_MANAGER_ADMIN,
      collateralToken,
      collateralTokenFeed,
      connection,
      managerProgram,
      wallet
    })
    await exchangeProgram.state.rpc.new(nonce, {
      accounts: {
        admin: EXCHANGE_ADMIN.publicKey,
        collateralToken: collateralToken.publicKey,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        programSigner: programSigner.publicKey
      }
    })
  })
  it('Initialize', async () => {
    const state = await exchangeProgram.state()
    console.log(state)

    // Check exchange admin
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
  })
})
