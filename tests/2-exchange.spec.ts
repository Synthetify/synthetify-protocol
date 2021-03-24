import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { assert, expect } from 'chai'
import { createPriceFeed, createToken, sleep } from './utils'
import { O_TRUNC } from 'constants'

describe('exchange', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  const oracleAdmin = wallet.publicKey
  const assetsAdmin = new Account()
  const exchangeAdmin = new Account()
  const programSigner = new anchor.web3.Account()
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let mintAuthority: PublicKey
  let collateralAccount: PublicKey
  let nonce: number
  before(async () => {

  })
  it('Initialize', async () => {
    // try {
    //   const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
    //     [programSigner.publicKey.toBuffer()],
    //     exchangeProgram.programId
    //   )
    //   nonce = _nonce
    //   mintAuthority = _mintAuthority
    //   collateralTokenFeed = await createPriceFeed({
    //     admin: oracleAdmin,
    //     oracleProgram,
    //     initPrice: new BN(2 * 1e4)
    //   })
    //   collateralToken = await createToken({
    //     connection,
    //     payer: wallet,
    //     mintAuthority: wallet.publicKey
    //   })
    //   collateralAccount = await collateralToken.createAccount(mintAuthority)
    //   assetsList = new Account().publicKey
    //   await exchangeProgram.state.rpc.new(
    //     exchangeAdmin.publicKey,
    //     programSigner.publicKey,
    //     nonce,
    //     collateralToken.publicKey,
    //     collateralAccount,
    //     assetsList
    //   )
    // } catch (error) {
    //   console.log(error)
    // }
    // // Add your test here.
    // collateralToken = await createToken({
    //   connection,
    //   payer: wallet,
    //   mintAuthority: wallet.publicKey
    // })
    // usdToken = await createToken({
    //   connection,
    //   payer: wallet,
    //   mintAuthority: wallet.publicKey
    // })
    // collateralTokenFeed = await createPriceFeed({
    //   admin: oracleAdmin,
    //   oracleProgram,
    //   initPrice: new BN(2 * 1e4)
    // })

    // await exchangeProgram.state.rpc.new(assetsAdmin.publicKey)
    const state = await exchangeProgram.state()
    console.log(state)
  })
})
