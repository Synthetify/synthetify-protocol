import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
  Transaction
} from '@solana/web3.js'
import { assert, expect } from 'chai'
import { Manager } from '@synthetify/sdk'
import {
  createToken,
  sleep,
  ASSETS_MANAGER_ADMIN,
  DEFAULT_PUBLIC_KEY,
  createAssetsList,
  ICreateAssetsList,
  IAddNewAssets,
  addNewAssets,
  assertThrowsAsync,
  newAccountWithLamports
} from './utils'
import { Network } from '@synthetify/sdk/lib/network'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { signAndSend } from '../sdk/src'

const MAX_U64 = new BN('ffffffffffffffff', 16)
const USDT_VALUE_U64 = new BN(1000000)
const ZERO_U64 = new BN(0)
const errMessage = 'No asset with such address was found'
const initCollateralOraclePrice = 2
const exchangeAuthorityAccount = new Account()

describe('manager', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const managerProgram = anchor.workspace.Manager as Program
  const oracleProgram = anchor.workspace.Pyth as Program
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgram.programId)
  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let PAYER_ACCOUNT: Account
  before(async () => {
    PAYER_ACCOUNT = await newAccountWithLamports(connection)
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
      oracleProgram,
      initPrice: initCollateralOraclePrice,
      expo: -6
    })

    await manager.init(ASSETS_MANAGER_ADMIN.publicKey)

    assetsList = await manager.createAssetsList(4)
    await manager.initializeAssetsList({
      assetsList,
      collateralTokenFeed,
      collateralToken: collateralToken.publicKey,
      assetsAdmin: ASSETS_MANAGER_ADMIN,
      exchangeAuthority: exchangeAuthorityAccount.publicKey,
      usdToken: usdToken.publicKey
    })
  })
  it('Initialize', async () => {
    const initTokensDecimals = 6
    const state = await manager.getState()
    assert.ok(state.admin.equals(ASSETS_MANAGER_ADMIN.publicKey))

    const assetsListData = await manager.getAssetsList(assetsList)
    // Length should be 2
    assert.ok(assetsListData.assets.length === 2)
    // Authority of list
    assert.ok(assetsListData.exchangeAuthority.equals(exchangeAuthorityAccount.publicKey))

    const collateralAsset = assetsListData.assets[assetsListData.assets.length - 1]

    // Collatera token checks

    // Check feed address
    assert.ok(collateralAsset.feedAddress.equals(collateralTokenFeed))

    // Check token address
    assert.ok(collateralAsset.assetAddress.equals(collateralToken.publicKey))

    // Check decimals
    assert.ok(collateralAsset.decimals === initTokensDecimals)

    // // Check asset limit
    assert.ok(collateralAsset.maxSupply.eq(MAX_U64))

    // Check price
    assert.ok(collateralAsset.price.eq(ZERO_U64))

    const usdAsset = assetsListData.assets[0]

    // USD token checks

    // Check token address
    assert.ok(usdAsset.assetAddress.equals(usdToken.publicKey))

    // Check decimals
    assert.ok(usdAsset.decimals === initTokensDecimals)

    // Check asset limit
    assert.ok(usdAsset.maxSupply.eq(MAX_U64))

    // Check price
    assert.ok(usdAsset.price.eq(USDT_VALUE_U64))
  })
  describe('#set_asset_supply()', async () => {
    it('Should change asset supply', async () => {
      const beforeAssetList = await manager.getAssetsList(assetsList)
      const beforeAsset = beforeAssetList.assets[0]

      const newSupply = beforeAsset.supply.add(new BN(12345678))
      const assetIndex = beforeAssetList.assets.findIndex((asset) =>
        asset.assetAddress.equals(beforeAsset.assetAddress)
      )
      await manager.setAssetSupply({
        assetsList,
        assetIndex,
        newSupply,
        exchangeAuthority: exchangeAuthorityAccount
      })
      const afterAssetList = await manager.getAssetsList(assetsList)
      const afterAsset = afterAssetList.assets[0]
      // Check new supply
      assert.ok(afterAsset.supply.eq(newSupply))
    })
    it('Set asset supply over max', async () => {
      const newAssetLimit = new BN(3 * 1e4)
      const newAssetDecimals = 6
      const newToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: wallet.publicKey,
        decimals: newAssetDecimals
      })
      const newTokenFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2,
        expo: -6
      })

      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: newToken.publicKey,
        tokenDecimals: newAssetDecimals,
        tokenFeed: newTokenFeed
      })
      const newSupply = newAssetLimit.addn(1)

      const beforeAssetList = await manager.getAssetsList(assetsList)
      const assetIndex = beforeAssetList.assets.findIndex((asset) =>
        asset.assetAddress.equals(newToken.publicKey)
      )
      await assertThrowsAsync(
        manager.setAssetSupply({
          assetsList,
          assetIndex,
          newSupply,
          exchangeAuthority: exchangeAuthorityAccount
        })
      )
    })
    it('Should fail with wrong signer', async () => {
      const beforeAssetList = await manager.getAssetsList(assetsList)
      const beforeAsset = beforeAssetList.assets[0]

      const newSupply = beforeAsset.supply.add(new BN(12345678))

      const assetIndex = beforeAssetList.assets.findIndex((asset) =>
        asset.assetAddress.equals(beforeAsset.assetAddress)
      )

      await assertThrowsAsync(
        managerProgram.rpc.setAssetSupply(assetIndex, newSupply, {
          accounts: {
            assetsList: assetsList,
            exchangeAuthority: exchangeAuthorityAccount.publicKey
          },
          signers: [new Account()]
        })
      )
    })
    it('Should fail if asset not found', async () => {
      const beforeAssetList = await manager.getAssetsList(assetsList)
      const beforeAsset = beforeAssetList.assets[0]

      const newSupply = beforeAsset.supply.add(new BN(12345678))
      await assertThrowsAsync(
        manager.setAssetSupply({
          assetsList,
          assetIndex: 254,
          newSupply,
          exchangeAuthority: exchangeAuthorityAccount
        })
      )
    })
  })
  describe('#add_new_asset()', async () => {
    it('Should add new asset ', async () => {
      const newAssetLimit = new BN(3 * 1e4)
      const newAssetDecimals = 8
      const addNewAssetParams: IAddNewAssets = {
        connection,
        wallet,
        oracleProgram,
        manager,
        assetsList,
        newAssetDecimals,
        newAssetLimit
      }

      const beforeAssetList = await manager.getAssetsList(assetsList)

      const newAssets = await addNewAssets(addNewAssetParams)

      const afterAssetList = await manager.getAssetsList(assetsList)

      const newAsset = afterAssetList.assets[afterAssetList.assets.length - 1]

      // Length should be increased by 1
      assert.ok(beforeAssetList.assets.length + 1 === afterAssetList.assets.length)

      // Check feed address
      assert.ok(newAsset.feedAddress.equals(newAssets[0].feedAddress))

      // Check token address
      assert.ok(newAsset.assetAddress.equals(newAssets[0].assetAddress))

      // Check decimals
      assert.ok(newAsset.decimals === newAssetDecimals)

      // Check asset limit
      assert.ok(newAsset.maxSupply.eq(newAssetLimit))

      // Check price
      assert.ok(newAsset.price.eq(ZERO_U64))
    })
    it('Should not add new asset ', async () => {
      const newAssetDecimals = 8
      const newAssetLimit = new BN(3 * 1e4)

      const addNewAssetParams: IAddNewAssets = {
        connection,
        wallet,
        oracleProgram,
        manager,
        assetsList,
        newAssetDecimals,
        newAssetLimit
      }
      // we hit limit of account size and cannot add another asset
      await assertThrowsAsync(addNewAssets(addNewAssetParams))
    })
  })
  describe('#set_max_supply()', async () => {
    const newAssetLimit = new BN(4 * 1e4)

    it('Error should be throwed while setting new max supply', async () => {
      await assertThrowsAsync(
        manager.setAssetMaxSupply({
          assetAddress: new Account().publicKey,
          assetsAdmin: ASSETS_MANAGER_ADMIN,
          assetsList,
          newMaxSupply: newAssetLimit
        })
      )

      const afterAssetList = await manager.getAssetsList(assetsList)

      assert.notOk(
        afterAssetList.assets[afterAssetList.assets.length - 1].maxSupply.eq(newAssetLimit)
      )
    })
    it('New max supply should be set', async () => {
      const beforeAssetList = await manager.getAssetsList(assetsList)
      let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]

      await manager.setAssetMaxSupply({
        assetAddress: beforeAsset.assetAddress,
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        newMaxSupply: newAssetLimit
      })

      const afterAssetList = await manager.getAssetsList(assetsList)

      assert.ok(afterAssetList.assets[afterAssetList.assets.length - 1].maxSupply.eq(newAssetLimit))
    })
  })
  describe('#set_price_feed()', async () => {
    it('New price_feed should be set', async () => {
      const newPriceFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2,
        expo: -6
      })
      const beforeAssetList = await manager.getAssetsList(assetsList)
      let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]
      const ix = await manager.setPriceFeedInstruction({
        assetsList,
        priceFeed: newPriceFeed,
        signer: ASSETS_MANAGER_ADMIN.publicKey,
        tokenAddress: beforeAsset.assetAddress
      })
      await signAndSend(
        new Transaction().add(ix),
        [PAYER_ACCOUNT, ASSETS_MANAGER_ADMIN],
        connection
      )
      const afterAssetList = await manager.getAssetsList(assetsList)

      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].feedAddress.equals(newPriceFeed)
      )
    })
  })
  describe('#set_assets_prices()', async () => {
    const newPrice = 6
    it('Should not change prices', async () => {
      const assetListBefore = await manager.getAssetsList(assetsList)

      const feedAddresses = assetListBefore.assets
        .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
        .map((asset) => {
          return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
        })

      feedAddresses.push({ pubkey: new Account().publicKey, isWritable: false, isSigner: false })
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      await assertThrowsAsync(
        managerProgram.rpc.setAssetsPrices({
          remainingAccounts: feedAddresses,
          accounts: {
            assetsList: assetsList
          }
        })
      )
      const assetList = await manager.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check not changed price
      assert.ok(collateralAsset.price.eq(ZERO_U64))
    })
    it('Should change prices', async () => {
      const assetListBefore = await manager.getAssetsList(assetsList)
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      const collateralAssetLastUpdateBefore = assetListBefore.assets[1].lastUpdate

      await manager.updatePrices(assetsList)

      const assetList = await manager.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check new price
      assert.ok(collateralAsset.price.eq(new BN(newPrice * 1e6)))

      // Check last_update new value
      assert.ok(collateralAsset.lastUpdate > collateralAssetLastUpdateBefore)
    })
    it('Test 30 assets', async () => {
      const anotherPrice = 8
      const assetsListSize = 30
      const createAssetsListParams: ICreateAssetsList = {
        exchangeAuthority: exchangeAuthorityAccount.publicKey,
        manager,
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        collateralToken,
        collateralTokenFeed,
        connection,
        wallet,
        assetsSize: assetsListSize
      }

      const data = await createAssetsList(createAssetsListParams)
      const newAssetsList = data.assetsList
      const newAssetLimit = new BN(3 * 1e4)
      const newAssetDecimals = 8
      const addNewAssetParams: IAddNewAssets = {
        connection,
        wallet,
        oracleProgram,
        manager,
        assetsList: newAssetsList,
        newAssetDecimals,
        newAssetLimit,
        newAssetsNumber: assetsListSize - 2 // Collateral and usd
      }

      await addNewAssets(addNewAssetParams)
      await setFeedPrice(oracleProgram, anotherPrice, collateralTokenFeed)

      await manager.updatePrices(newAssetsList)
      const assetList = await manager.getAssetsList(newAssetsList)
      const collateralAsset = assetList.assets[1]

      // Check assets list lenght
      assert.ok(assetList.assets.length === assetsListSize)

      // Check new price
      assert.ok(collateralAsset.price.eq(new BN(anotherPrice * 1e6)))
    })
  })
})
