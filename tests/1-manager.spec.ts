import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
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
  const assetsAdmin = new Account()
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
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
    await managerProgram.state.rpc.initialize(assetsAdmin.publicKey)
    const state = await managerProgram.state()
    assert.ok(state.admin.equals(assetsAdmin.publicKey))

    const assetListAccount = new Account()
    assetsList = assetListAccount.publicKey
    await managerProgram.rpc.createAssetsList(2, {
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [
        // 223 allows for 2 assets
        await managerProgram.account.assetsList.createInstruction(assetListAccount, 2 * 105 + 13)
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

    const assetsListData = await managerProgram.account.assetsList(assetsList)
    console.log(assetsListData)
  })
})
