import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  SYNTHETIFY_ECHANGE_SEED,
  assertThrowsAsync,
  DEFAULT_PUBLIC_KEY,
  U64_MAX
} from './utils'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { ERRORS, ERRORS_EXCHANGE } from '@synthetify/sdk/src/utils'
import { Asset, AssetsList, Collateral, Synthetic } from '@synthetify/sdk/src/exchange'
import { ORACLE_OFFSET } from '@synthetify/sdk'

describe('admin', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  let collateralToken: Token
  let usdToken: Token
  let collateralTokenFeed: PublicKey
  let assetsList: PublicKey
  let exchangeAuthority: PublicKey
  let collateralAccount: PublicKey
  let liquidationAccount: PublicKey
  let stakingFundAccount: PublicKey
  let reserveAccount: PublicKey
  let CollateralTokenMinter: Account = wallet
  let nonce: number
  const stakingRoundLength = 10
  const amountPerRound = new BN(100)

  let initialCollateralPrice = 2
  before(async () => {
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
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)
    reserveAccount = await collateralToken.createAccount(exchangeAuthority)

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      exchangeAuthority,
      exchangeProgram.programId
    )

    const data = await createAssetsList({
      snyLiquidationFund: liquidationAccount,
      snyReserve: reserveAccount,
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      connection,
      wallet,
      exchange
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
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
  it('Initialize state', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.healthFactor === 50)
    assert.ok(state.maxDelay === 0)
    assert.ok(state.fee === 300)
    assert.ok(state.swapTaxRatio === 20)
    assert.ok(state.swapTaxReserve.eq(new BN(0)))
    assert.ok(state.debtInterestRate === 10)
    assert.ok(state.accumulatedDebtInterest.eq(new BN(0)))
    assert.ok(state.liquidationRate === 20)
    assert.ok(state.penaltyToLiquidator === 5)
    assert.ok(state.penaltyToExchange === 5)
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.eq(new BN(0)))
  })
  it('Initialize assets', async () => {
    const initTokensDecimals = 6
    const assetsListData = await exchange.getAssetsList(assetsList)
    // Length should be 2
    assert.ok(assetsListData.assets.length === 2)
    // Authority of list

    // Check feed address
    const snyAsset = assetsListData.assets[assetsListData.assets.length - 1]
    assert.ok(snyAsset.feedAddress.equals(collateralTokenFeed))
    assert.ok(snyAsset.price.eq(new BN(0)))

    // Check token address
    const snyCollateral = assetsListData.collaterals[assetsListData.collaterals.length - 1]
    assert.ok(snyCollateral.collateralAddress.equals(collateralToken.publicKey))

    // USD token address
    const usdAsset = assetsListData.assets[0]
    assert.ok(usdAsset.price.eq(new BN(10 ** ORACLE_OFFSET)))

    // xUSD checks
    const usdSynthetic = assetsListData.synthetics[assetsListData.synthetics.length - 1]
    assert.ok(usdSynthetic.assetAddress.equals(usdToken.publicKey))
    assert.ok(usdSynthetic.decimals === initTokensDecimals)
    assert.ok(usdSynthetic.maxSupply.eq(new BN('ffffffffffffffff', 16)))
  })
  describe('#setLiquidationBuffer()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationBuffer = 999
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.liquidationBuffer !== newLiquidationBuffer)
    })
    it('change value', async () => {
      const newLiquidationBuffer = 999
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.liquidationBuffer === newLiquidationBuffer)
    })
  })
  describe('#setLiquidationRate()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationRate = 15
      const ix = await exchange.setLiquidationRateInstruction(newLiquidationRate)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.liquidationRate !== newLiquidationRate)
    })
    it('change value', async () => {
      const newLiquidationRate = 15
      const ix = await exchange.setLiquidationRateInstruction(newLiquidationRate)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.liquidationRate === newLiquidationRate)
    })
  })
  describe('#setLiquidationPenalties()', async () => {
    it('Fail without admin signature', async () => {
      const penaltyToExchange = 10
      const penaltyToLiquidator = 10
      const ix = await exchange.setLiquidationPenaltiesInstruction({
        penaltyToExchange,
        penaltyToLiquidator
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.penaltyToExchange !== penaltyToExchange)
      assert.ok(state.penaltyToLiquidator !== penaltyToLiquidator)
    })
    it('Change values', async () => {
      const penaltyToExchange = 10
      const penaltyToLiquidator = 10
      const ix = await exchange.setLiquidationPenaltiesInstruction({
        penaltyToExchange,
        penaltyToLiquidator
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)

      const state = await exchange.getState()
      assert.ok(state.penaltyToExchange == penaltyToExchange)
      assert.ok(state.penaltyToLiquidator == penaltyToLiquidator)
    })
  })
  describe('#setFee()', async () => {
    it('Fail without admin signature', async () => {
      const newFee = 999
      const ix = await exchange.setFeeInstruction(newFee)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.fee !== newFee)
    })
    it('change value', async () => {
      const newFee = 999
      const ix = await exchange.setFeeInstruction(newFee)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.fee === newFee)
    })
  })
  describe('#setMaxDelay()', async () => {
    it('Fail without admin signature', async () => {
      const newMaxDelay = 999
      const ix = await exchange.setMaxDelayInstruction(newMaxDelay)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.maxDelay !== newMaxDelay)
    })
    it('change value', async () => {
      const newMaxDelay = 999
      const ix = await exchange.setMaxDelayInstruction(newMaxDelay)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.maxDelay === newMaxDelay)
    })
  })
  describe('#setHalted()', async () => {
    it('Fail without admin signature', async () => {
      const halted = true
      const ix = await exchange.setHaltedInstruction(halted)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.halted !== halted)
    })
    it('change value', async () => {
      const halted = true
      const ix = await exchange.setHaltedInstruction(halted)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === halted)
    })
  })
  describe('#setHealthFactor()', async () => {
    it('Fail without admin signature', async () => {
      const healthFactor = 70
      const ix = await exchange.setHealthFactorInstruction(new BN(healthFactor))
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.healthFactor !== healthFactor)
    })
    it('change value', async () => {
      const healthFactor = 70
      const ix = await exchange.setHealthFactorInstruction(new BN(healthFactor))
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.healthFactor === healthFactor)
    })
  })
  describe('#setStakingAmountPerRound()', async () => {
    it('Fail without admin signature', async () => {
      const amount = new BN(12399)
      const ix = await exchange.setStakingAmountPerRound(amount)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(!state.staking.amountPerRound.eq(amount))
    })
    it('change value', async () => {
      const amount = new BN(12399)
      const ix = await exchange.setStakingAmountPerRound(amount)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.staking.amountPerRound.eq(amount))
    })
  })
  describe('#setStakingRoundLength()', async () => {
    it('Fail without admin signature', async () => {
      const length = 999912
      const ix = await exchange.setStakingRoundLength(length)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.ok(state.staking.roundLength !== length)
    })
    it('change value', async () => {
      const length = 999912
      const ix = await exchange.setStakingRoundLength(length)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.staking.roundLength === length)
    })
  })
  describe('#addNewAsset', async () => {
    it('Should add new asset ', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const newAssetFeedPublicKey = new Account().publicKey
      const ix = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: newAssetFeedPublicKey
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      // Length should be increased by 1
      assert.ok(beforeAssetList.assets.length + 1 === afterAssetList.assets.length)

      // Check new asset is included in asset list
      const addedNewAsset = afterAssetList.assets.find((a) =>
        a.feedAddress.equals(newAssetFeedPublicKey)
      ) as Asset
      // Check new asset exist
      assert.ok(addedNewAsset)

      // Check new asset initial fields
      assert.ok(addedNewAsset.confidence === 0)
      assert.ok(addedNewAsset.feedAddress.equals(newAssetFeedPublicKey))
      assert.ok(addedNewAsset.lastUpdate.eq(new BN(0)))
      assert.ok(addedNewAsset.price.eq(new BN(0)))
    }),
      it('Should fail without admin signature', async () => {
        const newAssetFeedPublicKey = new Account().publicKey
        const ix = await exchange.addNewAssetInstruction({
          assetsList: assetsList,
          assetFeedAddress: newAssetFeedPublicKey
        })
        await assertThrowsAsync(
          signAndSend(new Transaction().add(ix), [wallet], connection),
          ERRORS.SIGNATURE
        )
      })
  })
  describe('#addSynthetic()', async () => {
    it('Should add new synthetic ', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForSynthetic = beforeAssetList.assets[0]
      const newSynthetic = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList,
        decimals: 8,
        maxSupply: new BN(100),
        priceFeed: assetForSynthetic.feedAddress
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      const addedSynthetic = afterAssetList.synthetics.find((a) =>
        a.assetAddress.equals(newSynthetic.publicKey)
      ) as Synthetic
      // Length should be increased by 1
      assert.ok(beforeAssetList.synthetics.length + 1 === afterAssetList.synthetics.length)

      // Check synthetic initial fields
      assert.ok(addedSynthetic.assetAddress.equals(newSynthetic.publicKey))
      assert.ok(addedSynthetic.decimals === 8)
      assert.ok(addedSynthetic.maxSupply.eq(new BN(100)))
      assert.ok(addedSynthetic.supply.eqn(0))
      assert.ok(addedSynthetic.settlementSlot.eq(U64_MAX))
      assert.ok(
        afterAssetList.assets[addedSynthetic.assetIndex].feedAddress.equals(
          assetForSynthetic.feedAddress
        )
      )
    })
    it('Should fail without admin signature', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForSynthetic = beforeAssetList.assets[0]
      const newSynthetic = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList,
        decimals: 8,
        maxSupply: new BN(100),
        priceFeed: assetForSynthetic.feedAddress
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
  })
  describe('#addCollateral()', async () => {
    it('Should add new collateral ', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForCollateral = beforeAssetList.assets[0]
      const reserveBalance = new BN(1000000)
      const decimals = 8
      const newCollateral = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals
      })
      const liquidationFund = await newCollateral.createAccount(exchangeAuthority)
      const reserveAccount = await newCollateral.createAccount(exchangeAuthority)
      const collateralRatio = 50

      const ix = await exchange.addCollateralInstruction({
        assetsList,
        assetAddress: newCollateral.publicKey,
        liquidationFund,
        feedAddress: assetForCollateral.feedAddress,
        reserveAccount,
        reserveBalance: reserveBalance,
        decimals,
        collateralRatio
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      const addedCollateral = afterAssetList.collaterals.find((a) =>
        a.collateralAddress.equals(newCollateral.publicKey)
      ) as Collateral
      // Length should be increased by 1
      assert.ok(beforeAssetList.collaterals.length + 1 === afterAssetList.collaterals.length)

      // Check collateral initial fields
      assert.ok(addedCollateral.assetIndex === 0)
      assert.ok(addedCollateral.collateralAddress.equals(newCollateral.publicKey))
      assert.ok(addedCollateral.collateralRatio === collateralRatio)
      assert.ok(addedCollateral.decimals === decimals)
      assert.ok(addedCollateral.liquidationFund.equals(liquidationFund))
      assert.ok(addedCollateral.reserveAddress.equals(reserveAccount))
      assert.ok(addedCollateral.reserveBalance.eq(reserveBalance))
    }),
      it('Should fail without admin signature', async () => {
        const beforeAssetList = await exchange.getAssetsList(assetsList)
        const assetForCollateral = beforeAssetList.assets[0]
        const liquidationAccount = new Account()
        const reserveAccount = new Account()
        const collateralRatio = 150
        const reserveBalance = new BN(1000000)
        const decimals = 8
        const newCollateral = await createToken({
          connection,
          payer: wallet,
          mintAuthority: exchangeAuthority,
          decimals: 8
        })
        const ix = await exchange.addCollateralInstruction({
          assetsList,
          assetAddress: newCollateral.publicKey,
          liquidationFund: liquidationAccount.publicKey,
          feedAddress: assetForCollateral.feedAddress,
          reserveAccount: reserveAccount.publicKey,
          reserveBalance: reserveBalance,
          decimals,
          collateralRatio
        })
        await assertThrowsAsync(
          signAndSend(new Transaction().add(ix), [wallet], connection),
          ERRORS.SIGNATURE
        )
      })
  })
  describe('#setMaxSupply()', async () => {
    const newAssetLimit = new BN(4 * 1e4)

    it('Error should be thrown while setting new max supply', async () => {
      await assertThrowsAsync(
        exchange.setAssetMaxSupply({
          assetAddress: new Account().publicKey,
          exchangeAdmin: EXCHANGE_ADMIN,
          assetsList,
          newMaxSupply: newAssetLimit
        }),
        ERRORS_EXCHANGE.NO_ASSET_FOUND
      )

      const afterAssetList = await exchange.getAssetsList(assetsList)

      assert.notOk(
        afterAssetList.synthetics[afterAssetList.synthetics.length - 1].maxSupply.eq(newAssetLimit)
      )
    })
    it('New max supply should be set', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      let beforeAsset = beforeAssetList.synthetics[beforeAssetList.synthetics.length - 1]

      await exchange.setAssetMaxSupply({
        assetAddress: beforeAsset.assetAddress,
        exchangeAdmin: EXCHANGE_ADMIN,
        assetsList,
        newMaxSupply: newAssetLimit
      })

      const afterAssetList = await exchange.getAssetsList(assetsList)

      assert.ok(
        afterAssetList.synthetics[afterAssetList.synthetics.length - 1].maxSupply.eq(newAssetLimit)
      )
    })
  })
  describe('#setPriceFeed()', async () => {
    it('New price_feed should be set', async () => {
      const newPriceFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2,
        expo: -6
      })
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const beforeAsset = beforeAssetList.assets[beforeAssetList.assets.length - 1]
      const ix = await exchange.setPriceFeedInstruction({
        assetsList,
        priceFeed: newPriceFeed,
        oldPriceFeed: beforeAsset.feedAddress
      })
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].feedAddress.equals(newPriceFeed)
      )
    })
  })
  describe('#setCollateralRatio()', async () => {
    it('Should set new collateral ratio for asset', async () => {
      const newCollateralRatio = 99
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      assert.ok(collateralBefore.collateralRatio !== newCollateralRatio)
      const ix = await exchange.setCollateralRatio(
        collateralBefore.collateralAddress,
        newCollateralRatio
      )
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.ok(collateralAfter.collateralRatio === newCollateralRatio)
    })
    it('Fail without admin signature', async () => {
      const newCollateralRatio = 99
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      const ix = await exchange.setCollateralRatio(
        collateralBefore.collateralAddress,
        newCollateralRatio
      )
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
    })
  })
  describe('#setAssetsPrices()', async () => {
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
      assert.ok(collateralAsset.price.eq(new BN(0)))
    })
    it('Should change prices', async () => {
      const assetListBefore = await exchange.getAssetsList(assetsList)
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      const collateralAssetLastUpdateBefore = assetListBefore.assets[1].lastUpdate

      await exchange.updatePrices(assetsList)

      const assetList = await exchange.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check new price
      assert.ok(collateralAsset.price.eq(new BN(newPrice).mul(new BN(10 ** ORACLE_OFFSET))))

      // Check last_update new value
      assert.ok(collateralAsset.lastUpdate > collateralAssetLastUpdateBefore)
    })
  })
  describe('#withdrawSwapTax()', async () => {
    let healthFactor: BN
    let usdAsset: Asset
    let usdSynthetic: Synthetic
    let btcAsset: Asset
    let btcSynthetic: Synthetic
    let btcToken: Token
    let totalFee: BN
    let swapTax: BN
    let assetsListData: AssetsList
    before(async () => {
      healthFactor = new BN((await exchange.getState()).healthFactor)
      btcToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const btcFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 50000,
        expo: -9
      })
      const newAssetLimit = new BN(10).pow(new BN(18))

      const addBtcIx = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: btcFeed
      })
      await signAndSend(new Transaction().add(addBtcIx), [wallet, EXCHANGE_ADMIN], connection)
      const addBtcSynthetic = await exchange.addSyntheticInstruction({
        assetAddress: btcToken.publicKey,
        assetsList,
        decimals: 8,
        maxSupply: newAssetLimit,
        priceFeed: btcFeed
      })
      await signAndSend(
        new Transaction().add(addBtcSynthetic),
        [wallet, EXCHANGE_ADMIN],
        connection
      )
    })
  })
})
