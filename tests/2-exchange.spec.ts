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
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.programSigner.equals(programSigner.publicKey))
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 10)
    assert.ok(state.fee === 30)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.collateralShares.eq(new BN(0)))
  })
  it('Account Creation', async () => {
    const exchangeAccount = new Account()
    const accountOwner = new Account().publicKey
    await exchangeProgram.rpc.createExchangeAccount(accountOwner, {
      accounts: {
        exchangeAccount: exchangeAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [exchangeAccount],
      instructions: [
        await exchangeProgram.account.exchangeAccount.createInstruction(exchangeAccount)
      ]
    })
    const userExchangeAccount = await exchangeProgram.account.exchangeAccount(
      exchangeAccount.publicKey
    )
    // Owner of account
    assert.ok(userExchangeAccount.owner.equals(accountOwner))
    // Initial values
    assert.ok(userExchangeAccount.debtShares.eq(new BN(0)))
    assert.ok(userExchangeAccount.collateralShares.eq(new BN(0)))
  })
})
