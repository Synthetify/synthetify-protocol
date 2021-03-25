import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { assert, expect } from 'chai'
import { createPriceFeed, createToken, sleep, ORACLE_ADMIN, ASSETS_MANAGER_ADMIN } from './utils'
import { O_TRUNC } from 'constants'

const MAX_U64 = new BN('ffffffffffffffff', 16)
const USDT_VALUE_U64 = new BN(10000)
const ZERO_U64 = new BN(0)

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
    const initTokensDecimals = 6
    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey,
      decimals: 6
    })
    usdToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: wallet.publicKey,
      decimals: 6
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
    await managerProgram.rpc.createAssetsList(3, {
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [
        // 291 allows for 3 assets
        await managerProgram.account.assetsList.createInstruction(assetListAccount, 3 * 97 + 13)
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
    // Length should be 2
    assert.ok(assetsListData.assets.length === 2)

    // Collatera token checks

    // Check feed address
    assert.ok(
      assetsListData.assets[assetsListData.assets.length - 1].feedAddress.equals(
        collateralTokenFeed
      )
    )

    // Check token address
    assert.ok(
      assetsListData.assets[assetsListData.assets.length - 1].assetAddress.equals(
        collateralToken.publicKey
      )
    )

    // Check decimals
    assert.ok(
      assetsListData.assets[assetsListData.assets.length - 1].decimals === initTokensDecimals
    )

    // // Check asset limit
    assert.ok(assetsListData.assets[assetsListData.assets.length - 1].maxSupply.eq(MAX_U64))

    // Check price
    assert.ok(assetsListData.assets[assetsListData.assets.length - 1].price.eq(ZERO_U64))

    // USD token checks

    // Check token address
    assert.ok(assetsListData.assets[0].assetAddress.equals(usdToken.publicKey))

    // Check decimals
    assert.ok(assetsListData.assets[0].decimals === initTokensDecimals)

    // Check asset limit
    assert.ok(assetsListData.assets[0].maxSupply.eq(MAX_U64))

    // Check price
    assert.ok(assetsListData.assets[0].price.eq(USDT_VALUE_U64))
  })
  describe('#add_new_asset()', async () => {
    it('Should add new asset ', async () => {
      const newAssetLimit = new BN(3 * 1e4)
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
        newAssetLimit,
        {
          accounts: {
            signer: ASSETS_MANAGER_ADMIN.publicKey,
            assetsList: assetsList
          },
          signers: [ASSETS_MANAGER_ADMIN]
        }
      )

      const afterAssetList = await managerProgram.account.assetsList(assetsList)

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
        afterAssetList.assets[afterAssetList.assets.length - 1].decimals === newAssetDecimals
      )

      // Check asset limit
      assert.ok(afterAssetList.assets[afterAssetList.assets.length - 1].maxSupply.eq(newAssetLimit))

      // Check price
      assert.ok(afterAssetList.assets[afterAssetList.assets.length - 1].price.eq(ZERO_U64))
    })
    it('Should not add new asset ', async () => {
      const newAssetDecimals = 8
      const newAssetLimit = new BN(3 * 1e4)
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

      let err = null
      try {
        await managerProgram.state.rpc.addNewAsset(
          newTokenFeed,
          newToken.publicKey,
          newAssetDecimals,
          newAssetLimit,
          {
            accounts: {
              signer: ASSETS_MANAGER_ADMIN.publicKey,
              assetsList: assetsList
            },
            signers: [ASSETS_MANAGER_ADMIN]
          }
        )
      } catch (error) {
        err = error
      }
      assert.isNotNull(err)
    })
  })
  describe('#set_max_supply()', async () => {
    const newAssetLimit = new BN(4 * 1e4)

    it('Error should be throwed while setting new max supply', async () => {
      const beforeAssetList = await managerProgram.account.assetsList(assetsList)
      let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]

      const errMessage = 'No asset with such address was found'

      try {
        await managerProgram.state.rpc.setMaxSupply(new Account().publicKey, newAssetLimit, {
          accounts: {
            signer: ASSETS_MANAGER_ADMIN.publicKey,
            assetsList: assetsList
          },
          signers: [ASSETS_MANAGER_ADMIN]
        })
        assert.ok(false)
      } catch (err) {
        // Check err message
        assert.ok(err.msg === errMessage)
      }

      const afterAssetList = await managerProgram.account.assetsList(assetsList)

      assert.notOk(
        afterAssetList.assets[afterAssetList.assets.length - 1].maxSupply.eq(newAssetLimit)
      )
    })
    it('New max supply should be set', async () => {
      const beforeAssetList = await managerProgram.account.assetsList(assetsList)
      let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]

      await managerProgram.state.rpc.setMaxSupply(beforeAsset.assetAddress, newAssetLimit, {
        accounts: {
          signer: ASSETS_MANAGER_ADMIN.publicKey,
          assetsList: assetsList
        },
        signers: [ASSETS_MANAGER_ADMIN]
      })

      const afterAssetList = await managerProgram.account.assetsList(assetsList)

      console.log(afterAssetList)
      assert.ok(afterAssetList.assets[afterAssetList.assets.length - 1].maxSupply.eq(newAssetLimit))
    })
  })
})
