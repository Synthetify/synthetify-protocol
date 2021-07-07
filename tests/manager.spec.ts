import * as anchor from '@project-serum/anchor'
import { BN, Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { Exchange } from '@synthetify/sdk'
import {
  createToken,
  DEFAULT_PUBLIC_KEY,
  createAssetsList,
  IAddNewAssets,
  addNewAssets,
  assertThrowsAsync,
  newAccountWithLamports,
  SYNTHETIFY_ECHANGE_SEED,
  EXCHANGE_ADMIN
} from './utils'
import { Network } from '@synthetify/sdk/lib/network'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { signAndSend } from '../sdk/src'
import { ERRORS, ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'

const MAX_U64 = new BN('ffffffffffffffff', 16)
const USDT_VALUE_U64 = new BN(1000000)
const ZERO_U64 = new BN(0)

describe('manager', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection

  const exchangeProgram = anchor.workspace.Exchange as Program

  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let reserveAccount: PublicKey
  let liquidationAccount: PublicKey
  let stakingFundAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let PAYER_ACCOUNT: Account
  let nonce: number
  const stakingRoundLength = 10
  const amountPerRound = new BN(100)

  let initialCollateralPrice = 2
  before(async () => {
    PAYER_ACCOUNT = await newAccountWithLamports(connection)

    const [_exchangeAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )

    nonce = _nonce
    exchangeAuthority = _exchangeAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: initialCollateralPrice,
      expo: -6
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })

    reserveAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange,
      reserveAccount
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
      liquidationAccount,
      nonce,
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )
  })
  it('Initialize', async () => {
    const initTokensDecimals = 6
    const assetsListData = await exchange.getAssetsList(assetsList)
    // Length should be 2
    assert.ok(assetsListData.assets.length === 2)
    // Authority of list
    const collateralAsset = assetsListData.assets[assetsListData.assets.length - 1]

    // Check feed address
    assert.ok(collateralAsset.feedAddress.equals(collateralTokenFeed))

    // Check token address
    assert.ok(collateralAsset.collateral.collateralAddress.equals(collateralToken.publicKey))

    // Check price
    assert.ok(collateralAsset.price.eq(ZERO_U64))

    const usdAsset = assetsListData.assets[0]

    // USD token checks

    // Check token address
    assert.ok(usdAsset.synthetic.assetAddress.equals(usdToken.publicKey))

    // Check decimals
    assert.ok(usdAsset.synthetic.decimals === initTokensDecimals)

    // Check asset limit
    assert.ok(usdAsset.synthetic.maxSupply.eq(MAX_U64))

    // Check price
    assert.ok(usdAsset.price.eq(USDT_VALUE_U64))
  })

  // describe('#add_new_asset()', async () => {
  //   it('Should add new asset ', async () => {
  //     const newAssetLimit = new BN(3 * 1e4)
  //     const newAssetDecimals = 8
  //     const addNewAssetParams: IAddNewAssets = {
  //       connection,
  //       wallet,
  //       oracleProgram,
  //       exchange,
  //       assetsList,
  //       newAssetDecimals,
  //       newAssetLimit
  //     }

  //     const beforeAssetList = await exchange.getAssetsList(assetsList)

  //     const newAssets = await addNewAssets(addNewAssetParams)

  //     const afterAssetList = await exchange.getAssetsList(assetsList)

  //     const newAsset = afterAssetList.assets[afterAssetList.assets.length - 1]

  //     // Length should be increased by 1
  //     assert.ok(beforeAssetList.assets.length + 1 === afterAssetList.assets.length)

  //     // Check feed address
  //     assert.ok(newAsset.feedAddress.equals(newAssets[0].feedAddress))

  //     // Check token address
  //     assert.ok(newAsset.synthetic.assetAddress.equals(newAssets[0].assetAddress))

  //     // Check decimals
  //     assert.ok(newAsset.synthetic.decimals === newAssetDecimals)

  //     // Check asset limit
  //     assert.ok(newAsset.synthetic.maxSupply.eq(newAssetLimit))

  //     // Check price
  //     assert.ok(newAsset.price.eq(ZERO_U64))
  //   })
  //   // it('Should not add new asset ', async () => {
  //   //   const newAssetDecimals = 8
  //   //   const newAssetLimit = new BN(3 * 1e4)

  //   //   const addNewAssetParams: IAddNewAssets = {
  //   //     connection,
  //   //     wallet,
  //   //     oracleProgram,
  //   //     exchange,
  //   //     assetsList,
  //   //     newAssetDecimals,
  //   //     newAssetLimit
  //   //   }
  //   //   // we hit limit of account size and cannot add another asset
  //   //   await assertThrowsAsync(addNewAssets(addNewAssetParams), ERRORS.SERIALIZATION)
  //   // })
  // })
  // describe('#set_max_supply()', async () => {
  //   const newAssetLimit = new BN(4 * 1e4)

  //   it('Error should be throwed while setting new max supply', async () => {
  //     await assertThrowsAsync(
  //       exchange.setAssetMaxSupply({
  //         assetAddress: new Account().publicKey,
  //         exchangeAdmin: EXCHANGE_ADMIN,
  //         assetsList,
  //         newMaxSupply: newAssetLimit
  //       }),
  //       ERRORS_EXCHANGE.NO_ASSET_FOUND
  //     )

  //     const afterAssetList = await exchange.getAssetsList(assetsList)

  //     assert.notOk(
  //       afterAssetList.assets[afterAssetList.assets.length - 1].synthetic.maxSupply.eq(
  //         newAssetLimit
  //       )
  //     )
  //   })
  //   it('New max supply should be set', async () => {
  //     const beforeAssetList = await exchange.getAssetsList(assetsList)
  //     let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]

  //     await exchange.setAssetMaxSupply({
  //       assetAddress: beforeAsset.synthetic.assetAddress,
  //       exchangeAdmin: EXCHANGE_ADMIN,
  //       assetsList,
  //       newMaxSupply: newAssetLimit
  //     })

  //     const afterAssetList = await exchange.getAssetsList(assetsList)

  //     assert.ok(
  //       afterAssetList.assets[afterAssetList.assets.length - 1].synthetic.maxSupply.eq(
  //         newAssetLimit
  //       )
  //     )
  //   })
  // })
  // describe('#set_price_feed()', async () => {
  //   it('New price_feed should be set', async () => {
  //     const newPriceFeed = await createPriceFeed({
  //       oracleProgram,
  //       initPrice: 2,
  //       expo: -6
  //     })
  //     const beforeAssetList = await exchange.getAssetsList(assetsList)
  //     let beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]
  //     const ix = await exchange.setPriceFeedInstruction({
  //       assetsList,
  //       priceFeed: newPriceFeed,
  //       signer: EXCHANGE_ADMIN.publicKey,
  //       tokenAddress: beforeAsset.synthetic.assetAddress
  //     })
  //     await signAndSend(new Transaction().add(ix), [PAYER_ACCOUNT, EXCHANGE_ADMIN], connection)
  //     const afterAssetList = await exchange.getAssetsList(assetsList)

  //     assert.ok(
  //       afterAssetList.assets[afterAssetList.assets.length - 1].feedAddress.equals(newPriceFeed)
  //     )
  //   })
  // })
  describe('#set_assets_prices()', async () => {
    const newPrice = 6
    it('Should not change prices', async () => {
      const assetListBefore = await exchange.getAssetsList(assetsList)

      const feedAddresses = assetListBefore.assets
        .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
        .map((asset) => {
          return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
        })

      feedAddresses.push({ pubkey: new Account().publicKey, isWritable: false, isSigner: false })
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      await assertThrowsAsync(
        exchangeProgram.rpc.setAssetsPrices({
          remainingAccounts: feedAddresses,
          accounts: {
            assetsList: assetsList
          }
        }),
        ERRORS.PANICKED
      )
      const assetList = await exchange.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check not changed price
      assert.ok(collateralAsset.price.eq(ZERO_U64))
    })
    it.only('Should change prices', async () => {
      const assetListBefore = await exchange.getAssetsList(assetsList)
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      const collateralAssetLastUpdateBefore = assetListBefore.assets[1].lastUpdate

      await exchange.updatePrices(assetsList)

      const assetList = await exchange.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check new price
      assert.ok(collateralAsset.price.eq(new BN(newPrice * 1e6)))

      // Check last_update new value
      assert.ok(collateralAsset.lastUpdate > collateralAssetLastUpdateBefore)
    })
  })
})
