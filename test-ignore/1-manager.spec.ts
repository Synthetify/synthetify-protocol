import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { assert, expect } from 'chai'
import { createPriceFeed, createToken, sleep, ORACLE_ADMIN, ASSETS_MANAGER_ADMIN } from '../tests/utils'
import { O_TRUNC } from 'constants'

describe('manager', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const managerProgram = anchor.workspace.Manager as Program
  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
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
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: new BN(2 * 1e4)
    })

    await managerProgram.state.rpc.new()
    await managerProgram.state.rpc.initialize(ASSETS_MANAGER_ADMIN.publicKey)
    const state = await managerProgram.state()
    assert.ok(state.admin.equals(ASSETS_MANAGER_ADMIN.publicKey))

    const assetListAccount = new Account()
    assetsList = assetListAccount.publicKey
    await managerProgram.rpc.createAssetsList(30, {
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [
        // 223 allows for 5 assets
        await managerProgram.account.assetsList.createInstruction(assetListAccount, 30 * 105 + 13)
      ]
    })
    await managerProgram.state.rpc.createList(
      collateralToken.publicKey,
      collateralTokenFeed,
      usdToken.publicKey,
      {
        accounts: {
          signer: ASSETS_MANAGER_ADMIN.publicKey,
          assetsList: assetsList
        },
        signers: [ASSETS_MANAGER_ADMIN]
      }
    )

    const assetsListData = await managerProgram.account.assetsList(assetsList)
    console.log(assetsListData)
  })
  describe('#add_new_asset()', async () => {
    it('Add new asset ', async () => {
      const newAssetDecimals = 8
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

      const beforeAssetList = await managerProgram.account.assetsList(assetsList)

      await managerProgram.state.rpc.addNewAsset(
        newTokenFeed,
        newToken.publicKey,
        newAssetDecimals,
        {
          accounts: {
            signer: ASSETS_MANAGER_ADMIN.publicKey,
            assetsList: assetsList
          },
          signers: [ASSETS_MANAGER_ADMIN]
        }
      )

      const afterAssetList = await managerProgram.account.assetsList(assetsList)

      console.log(beforeAssetList)
      console.log(afterAssetList)

      // Length should be increased by 1
      assert.ok(beforeAssetList.assets.length + 1 == afterAssetList.assets.length)

      // Check feed address
      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].feedAddress.equals(newTokenFeed)
      )

      // Check token address
      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].assetAddress.equals(
          newToken.publicKey
        )
      )

      // Check decimals
      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].decimals == newAssetDecimals
      )
      console.log(await connection.getProgramAccounts(managerProgram.programId))
    })
  })
})
