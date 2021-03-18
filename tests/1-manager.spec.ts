import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { createPriceFeed, createToken, sleep } from './utils'

describe('manager', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const managerProgram = anchor.workspace.Manager as Program
  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  const oracleAdmin = wallet.publicKey
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  it('Initialize', async () => {
    // Add your test here.
    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey
    })
    usdToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey
    })
    collateralTokenFeed = await createPriceFeed({
      admin: oracleAdmin,
      oracleProgram,
      initPrice: new BN(2 * 1e4)
    })

    await managerProgram.state.rpc.new()
    await managerProgram.state.rpc.initialize(wallet.publicKey)
    const state = await managerProgram.state()
    assert.ok(state.admin.equals(wallet.publicKey))

    // const tx = await program.rpc.initialize()
    // console.log('Your transaction signature', tx)
  })
})
