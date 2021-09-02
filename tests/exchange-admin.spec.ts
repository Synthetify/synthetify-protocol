import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token } from '@solana/spl-token'
import { Account, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  SYNTHETIFY_EXCHANGE_SEED,
  assertThrowsAsync,
  DEFAULT_PUBLIC_KEY,
  U64_MAX,
  eqDecimals
} from './utils'
import { createPriceFeed, getFeedData, setFeedPrice, setFeedTrading } from './oracleUtils'
import { ERRORS, INTEREST_RATE_DECIMALS, toScale } from '@synthetify/sdk/src/utils'
import { Asset, Collateral, PriceStatus, Synthetic } from '@synthetify/sdk/lib/exchange'
import {
  ERRORS_EXCHANGE,
  percentToDecimal,
  SNY_DECIMALS,
  toDecimal,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ORACLE_OFFSET } from '@synthetify/sdk'

describe('admin', () => {
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
      [SYNTHETIFY_EXCHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _exchangeAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: initialCollateralPrice,
      expo: -8
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

    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      nonce,
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount,
      exchangeAuthority: exchangeAuthority
    })

    exchange = await Exchange.build(
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
      exchangeAdmin: EXCHANGE_ADMIN,
      exchange,
      snyReserve: reserveAccount,
      snyLiquidationFund: liquidationAccount
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    await exchange.getState()

    const signature = await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
    await connection.confirmTransaction(signature)
  })
  it('Initialize state', async () => {
    const state = await exchange.getState()
    // Check initialized addresses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(eqDecimals(state.healthFactor, percentToDecimal(50)))
    assert.ok(state.maxDelay === 0)
    assert.ok(eqDecimals(state.fee, percentToDecimal(0.3)))
    assert.ok(eqDecimals(state.swapTaxRatio, percentToDecimal(20)))
    assert.ok(eqDecimals(state.swapTaxReserve, toDecimal(new BN(0), XUSD_DECIMALS)))
    assert.ok(
      eqDecimals(state.debtInterestRate, toScale(percentToDecimal(1), INTEREST_RATE_DECIMALS))
    )
    assert.ok(eqDecimals(state.accumulatedDebtInterest, toDecimal(new BN(0), XUSD_DECIMALS)))
    assert.ok(eqDecimals(state.liquidationRate, percentToDecimal(20)))
    assert.ok(eqDecimals(state.penaltyToLiquidator, percentToDecimal(5)))
    assert.ok(eqDecimals(state.penaltyToExchange, percentToDecimal(5)))
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.eq(new BN(0)))

    // Check size of state
    const stateAccountInfo = await connection.getAccountInfo(exchange.stateAddress as PublicKey)
    assert.equal(stateAccountInfo?.data.length, 2048 + 8)
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
    assert.ok(
      eqDecimals(
        snyAsset.price,
        toScale(toDecimal(new BN(initialCollateralPrice), 0), ORACLE_OFFSET)
      )
    )

    // Check token address
    const snyCollateral = assetsListData.collaterals[assetsListData.collaterals.length - 1]
    assert.ok(snyCollateral.collateralAddress.equals(collateralToken.publicKey))

    // USD token address
    const usdAsset = assetsListData.assets[0]
    assert.ok(eqDecimals(usdAsset.price, toScale(toDecimal(new BN(1), 0), ORACLE_OFFSET)))

    // xUSD checks
    const usdSynthetic = assetsListData.synthetics[assetsListData.synthetics.length - 1]
    assert.ok(usdSynthetic.assetAddress.equals(usdToken.publicKey))

    assert.ok(usdSynthetic.supply.scale === initTokensDecimals)
    assert.ok(
      eqDecimals(usdSynthetic.maxSupply, toDecimal(new BN('ffffffffffffffff', 16), XUSD_DECIMALS))
    )
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
      assert.isFalse(state.liquidationBuffer === newLiquidationBuffer)
    })
    it('change value', async () => {
      const newLiquidationBuffer = 999
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)

      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.liquidationBuffer === newLiquidationBuffer)
    })
  })
  describe('#setLiquidationRate()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationRate = percentToDecimal(15)
      const ix = await exchange.setLiquidationRateInstruction(newLiquidationRate)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.liquidationRate, newLiquidationRate))
    })
    it('change value', async () => {
      const newLiquidationRate = percentToDecimal(15)
      const ix = await exchange.setLiquidationRateInstruction(newLiquidationRate)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.liquidationRate, newLiquidationRate))
    })
    it('should fail because of paramter out of range', async () => {
      const outOfRange = percentToDecimal(101)
      const ix = await exchange.setLiquidationRateInstruction(outOfRange)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.liquidationRate, outOfRange))
    })
  })
  describe('#setSwapTaxRatio', async () => {
    it('should change', async () => {
      const newSwapTaxRatio = percentToDecimal(25)
      const ix = await exchange.setSwapTaxRatioInstruction(newSwapTaxRatio)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.swapTaxRatio, newSwapTaxRatio))
    })
    it('should fail without admin signature', async () => {
      const newSwapTaxRatio = percentToDecimal(10)
      const ix = await exchange.setSwapTaxRatioInstruction(newSwapTaxRatio)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.swapTaxRatio, newSwapTaxRatio))
    })
    it('should fail because of paramter out of range', async () => {
      const outOfRange = percentToDecimal(31)
      const ix = await exchange.setSwapTaxRatioInstruction(outOfRange)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.swapTaxRatio, outOfRange))
    })
  })
  describe('#setDebtInterestRate', async () => {
    it('should change', async () => {
      const newDebtInterestRate = toScale(percentToDecimal(5), INTEREST_RATE_DECIMALS)
      const ix = await exchange.setDebtInterestRateInstruction(newDebtInterestRate)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.debtInterestRate, newDebtInterestRate))
    })
    it('should fail without admin signature', async () => {
      const newDebtInterestRate = toScale(percentToDecimal(6), INTEREST_RATE_DECIMALS)
      const ix = await exchange.setDebtInterestRateInstruction(newDebtInterestRate)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.debtInterestRate, newDebtInterestRate))
    })
    it('should fail because of paramter out of range', async () => {
      const newDebtInterestRate = toScale(percentToDecimal(27), INTEREST_RATE_DECIMALS)
      const ix = await exchange.setDebtInterestRateInstruction(newDebtInterestRate)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.debtInterestRate, newDebtInterestRate))
    })
  })
  describe('#setLiquidationPenalties()', async () => {
    it('Fail without admin signature', async () => {
      const penaltyToExchange = percentToDecimal(10)
      const penaltyToLiquidator = percentToDecimal(10)
      const ix = await exchange.setLiquidationPenaltiesInstruction({
        penaltyToExchange,
        penaltyToLiquidator
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )

      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.penaltyToExchange, penaltyToExchange))
      assert.isFalse(eqDecimals(state.penaltyToLiquidator, penaltyToLiquidator))
    })
    it('Change values', async () => {
      const penaltyToExchange = percentToDecimal(10)
      const penaltyToLiquidator = percentToDecimal(10)
      const ix = await exchange.setLiquidationPenaltiesInstruction({
        penaltyToExchange,
        penaltyToLiquidator
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const state = await exchange.getState()
      assert.ok(eqDecimals(state.penaltyToExchange, penaltyToExchange))
      assert.ok(eqDecimals(state.penaltyToLiquidator, penaltyToLiquidator))
    })
    it('should fail because of paramter out of range', async () => {
      const penaltyToExchange = percentToDecimal(30)
      const penaltyToLiquidator = percentToDecimal(30)
      const ix = await exchange.setLiquidationPenaltiesInstruction({
        penaltyToExchange,
        penaltyToLiquidator
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )

      const state = await exchange.getState()

      assert.isFalse(eqDecimals(state.penaltyToExchange, penaltyToExchange))
      assert.isFalse(eqDecimals(state.penaltyToLiquidator, penaltyToLiquidator))
    })
  })
  describe('#setFee()', async () => {
    it('Fail without admin signature', async () => {
      const newFee = percentToDecimal(0.999)
      const ix = await exchange.setFeeInstruction(newFee)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.fee, newFee))
    })
    it('change value', async () => {
      const newFee = percentToDecimal(0.999)
      const ix = await exchange.setFeeInstruction(newFee)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)

      const state = await exchange.getState()
      assert.ok(eqDecimals(state.fee, newFee))
    })
    it('should fail because of paramter out of range', async () => {
      const newFee = percentToDecimal(2)
      const ix = await exchange.setFeeInstruction(newFee)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const state = await exchange.getState()

      assert.isFalse(eqDecimals(state.fee, newFee))
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
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
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
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === halted)
    })
  })
  describe('#setHealthFactor()', async () => {
    it('Fail without admin signature', async () => {
      const healthFactor = percentToDecimal(70)
      const ix = await exchange.setHealthFactorInstruction(healthFactor)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.healthFactor, healthFactor))
    })
    it('change value', async () => {
      const healthFactor = percentToDecimal(70)
      const ix = await exchange.setHealthFactorInstruction(healthFactor)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.healthFactor, healthFactor))
    })
    it('should fail because of paramter out of range', async () => {
      const outOfRange = percentToDecimal(120)
      const ix = await exchange.setHealthFactorInstruction(outOfRange)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.healthFactor, outOfRange))
    })
  })
  describe('#setAdmin()', async () => {
    it('Fail without admin signature', async () => {
      const newAdmin = Keypair.generate().publicKey
      const ix = await exchange.setAdmin(newAdmin)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()

      assert.isFalse(state.admin.equals(newAdmin))
    })
    it('change value', async () => {
      const newAdmin = new Account()
      const ix = await exchange.setAdmin(newAdmin.publicKey)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()

      assert.ok(state.admin.equals(newAdmin.publicKey))

      // Revert back for next tests
      const ixBack = await exchange.setAdmin(EXCHANGE_ADMIN.publicKey)
      const signature = await connection.requestAirdrop(newAdmin.publicKey, 1e4)
      await connection.confirmTransaction(signature)
      await signAndSend(new Transaction().add(ixBack), [newAdmin], connection)
      const stateAfterChangingBack = await exchange.getState()
      assert.ok(stateAfterChangingBack.admin.equals(EXCHANGE_ADMIN.publicKey))
    })
  })
  describe('#setSettlementSlot()', async () => {
    let addedSynthetic: Synthetic
    before(async () => {
      const state = await exchange.getState()
      const assetsList = await exchange.getAssetsList(state.assetsList)

      const assetForSynthetic = assetsList.assets[0]
      const newSynthetic = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 8
      })
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList: state.assetsList,
        maxSupply: new BN(100),
        priceFeed: assetForSynthetic.feedAddress
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(state.assetsList)
      addedSynthetic = afterAssetList.synthetics.find((a) =>
        a.assetAddress.equals(newSynthetic.publicKey)
      ) as Synthetic
      if (!addedSynthetic) {
        assert.ok(false)
        return
      }
      assert.ok(addedSynthetic.settlementSlot.eq(U64_MAX))
    })

    it('Fail without admin signature', async () => {
      const ix = await exchange.setSettlementSlotInstruction(
        addedSynthetic.assetAddress,
        new BN(100)
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('change value', async () => {
      const newSettlementSlot = new BN(100)
      const ix = await exchange.setSettlementSlotInstruction(
        addedSynthetic.assetAddress,
        new BN(100)
      )
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      const changedAssetsList = await exchange.getAssetsList(state.assetsList)

      const changedSynthetic = changedAssetsList.synthetics.find((synthetic: Synthetic) =>
        synthetic.assetAddress.equals(addedSynthetic.assetAddress)
      )
      assert.ok(changedSynthetic?.settlementSlot.eq(newSettlementSlot))
    })
  })
  describe('#setStakingAmountPerRound()', async () => {
    it('fail without admin signature', async () => {
      const amount = toDecimal(new BN(12399), SNY_DECIMALS)
      const ix = await exchange.setStakingAmountPerRound(amount)
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const state = await exchange.getState()
      assert.isFalse(eqDecimals(state.staking.amountPerRound, amount))
    })
    it('change value', async () => {
      const amount = toDecimal(new BN(12399), SNY_DECIMALS)
      const ix = await exchange.setStakingAmountPerRound(amount)
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(eqDecimals(state.staking.amountPerRound, amount))
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
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
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
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
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
      assert.ok(addedNewAsset.feedAddress.equals(newAssetFeedPublicKey))
      assert.ok(addedNewAsset.lastUpdate.eq(new BN(0)))
      assert.ok(eqDecimals(addedNewAsset.price, toDecimal(new BN(0), ORACLE_OFFSET)))
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
    const syntheticDecimal = 8
    it('Should add new synthetic ', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForSynthetic = beforeAssetList.assets[0]
      const newSynthetic = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: syntheticDecimal
      })
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList,
        maxSupply: new BN(100),
        priceFeed: assetForSynthetic.feedAddress
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      const addedSynthetic = afterAssetList.synthetics.find((a) =>
        a.assetAddress.equals(newSynthetic.publicKey)
      ) as Synthetic
      // Length should be increased by 1
      assert.ok(beforeAssetList.synthetics.length + 1 === afterAssetList.synthetics.length)

      // Check synthetic initial fields
      assert.ok(addedSynthetic.assetAddress.equals(newSynthetic.publicKey))
      assert.ok(addedSynthetic.maxSupply.scale === syntheticDecimal)
      assert.ok(eqDecimals(addedSynthetic.maxSupply, toDecimal(new BN(100), syntheticDecimal)))
      assert.ok(eqDecimals(addedSynthetic.supply, toDecimal(new BN(0), syntheticDecimal)))
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
        decimals: syntheticDecimal
      })
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList,
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
    it('should add new collateral ', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForCollateral = beforeAssetList.assets[0]
      const decimals = 8
      const reserveBalance = toDecimal(new BN(10 ** decimals), decimals)
      const newCollateral = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals
      })
      const liquidationFund = await newCollateral.createAccount(exchangeAuthority)
      const reserveAccount = await newCollateral.createAccount(exchangeAuthority)
      const collateralRatio = percentToDecimal(50)

      const ix = await exchange.addCollateralInstruction({
        assetsList,
        assetAddress: newCollateral.publicKey,
        liquidationFund,
        feedAddress: assetForCollateral.feedAddress,
        reserveAccount,
        reserveBalance,
        collateralRatio,
        maxCollateral: toDecimal(U64_MAX, decimals)
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      const addedCollateral = afterAssetList.collaterals.find((a) =>
        a.collateralAddress.equals(newCollateral.publicKey)
      ) as Collateral
      // Length should be increased by 1
      assert.ok(beforeAssetList.collaterals.length + 1 === afterAssetList.collaterals.length)

      // Check collateral initial fields
      assert.ok(addedCollateral.assetIndex === 0)
      assert.ok(addedCollateral.collateralAddress.equals(newCollateral.publicKey))
      assert.ok(eqDecimals(addedCollateral.collateralRatio, collateralRatio))
      assert.ok(addedCollateral.liquidationFund.equals(liquidationFund))
      assert.ok(addedCollateral.reserveAddress.equals(reserveAccount))
      assert.ok(eqDecimals(addedCollateral.reserveBalance, reserveBalance))
    })
    it('should fail without admin signature', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForCollateral = beforeAssetList.assets[0]
      const liquidationAccount = new Account()
      const reserveAccount = new Account()
      const collateralRatio = percentToDecimal(150)
      const decimals = 8
      const reserveBalance = toDecimal(new BN(10 ** decimals), decimals)
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
        collateralRatio,
        maxCollateral: toDecimal(U64_MAX, decimals)
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
    })
    it('should fail because of out of range paramter', async () => {
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const assetForCollateral = beforeAssetList.assets[0]
      const decimals = 8
      const reserveBalance = toDecimal(new BN(10 ** decimals), decimals)
      const newCollateral = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals
      })
      const liquidationFund = await newCollateral.createAccount(exchangeAuthority)
      const reserveAccount = await newCollateral.createAccount(exchangeAuthority)
      const collateralRatio = percentToDecimal(150)

      const ix = await exchange.addCollateralInstruction({
        assetsList,
        assetAddress: newCollateral.publicKey,
        liquidationFund,
        feedAddress: assetForCollateral.feedAddress,
        reserveAccount,
        reserveBalance,
        collateralRatio,
        maxCollateral: toDecimal(U64_MAX, decimals)
      })
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
    })
  })
  describe('#setMaxSupply()', async () => {
    const newAssetLimit = toDecimal(new BN(4), 4)

    it('error should be thrown while setting new max supply', async () => {
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
        eqDecimals(
          afterAssetList.synthetics[afterAssetList.synthetics.length - 1].maxSupply,
          newAssetLimit
        )
      )
    })
    it('new max supply should be set', async () => {
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
        eqDecimals(
          afterAssetList.synthetics[afterAssetList.synthetics.length - 1].maxSupply,
          newAssetLimit
        )
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
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      assert.ok(
        afterAssetList.assets[afterAssetList.assets.length - 1].feedAddress.equals(newPriceFeed)
      )
    })
  })
  describe('#setFeedTrading', async () => {
    let assetFeed: PublicKey
    before(async () => {
      // create and add new asset
      assetFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 1000000,
        expo: -6
      })
    })
    it('should add new asset with trading state', async () => {
      const ix = await exchange.addNewAssetInstruction({
        assetsList: assetsList,
        assetFeedAddress: assetFeed
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const assetListAfterAdded = await exchange.getAssetsList(assetsList)
      const asset = assetListAfterAdded.assets.find((a: Asset) => {
        return a.feedAddress.equals(assetFeed)
      }) as Asset
      // asset by default should have trading status
      assert.ok(asset.status == PriceStatus.Trading)
    })
    it('Feed Trading should be set to Auction', async () => {
      await setFeedTrading(oracleProgram, 3, assetFeed)
      const feed = await getFeedData(oracleProgram, assetFeed)
      // asset status should change to Auction
      assert.ok(feed.status == PriceStatus.Auction)
    })
  })
  describe('#setCollateralRatio()', async () => {
    it('should fail without admin signature', async () => {
      const newCollateralRatio = percentToDecimal(99)
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      const ix = await exchange.setCollateralRatio(
        collateralBefore.collateralAddress,
        newCollateralRatio
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.isFalse(eqDecimals(collateralAfter.collateralRatio, newCollateralRatio))
    })
    it('should set new collateral ratio for asset', async () => {
      const newCollateralRatio = percentToDecimal(99)
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      assert.isFalse(eqDecimals(collateralBefore.collateralRatio, newCollateralRatio))
      const ix = await exchange.setCollateralRatio(
        collateralBefore.collateralAddress,
        newCollateralRatio
      )
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.ok(eqDecimals(collateralAfter.collateralRatio, newCollateralRatio))
    })
    it('should fail because of out of range paramter', async () => {
      const newCollateralRatio = percentToDecimal(120)
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      assert.isFalse(eqDecimals(collateralBefore.collateralRatio, newCollateralRatio))
      const ix = await exchange.setCollateralRatio(
        collateralBefore.collateralAddress,
        newCollateralRatio
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.PARAMETER_OUT_OF_RANGE
      )
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.isFalse(eqDecimals(collateralAfter.collateralRatio, newCollateralRatio))
    })
  })
  describe('#setMaxCollateral()', async () => {
    it('should fail without admin signature', async () => {
      const newMaxCollateral = toDecimal(
        new BN(1000000).mul(new BN(10).pow(new BN(SNY_DECIMALS))),
        SNY_DECIMALS
      )
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      const ix = await exchange.setMaxCollateral(
        collateralBefore.collateralAddress,
        newMaxCollateral
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [wallet], connection),
        ERRORS.SIGNATURE
      )
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]

      assert.isFalse(eqDecimals(collateralAfter.maxCollateral, newMaxCollateral))
    })
    it('should set new collateral ratio for asset', async () => {
      const newMaxCollateral = toDecimal(
        new BN(1000000).mul(new BN(10).pow(new BN(SNY_DECIMALS))),
        SNY_DECIMALS
      )
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      const ix = await exchange.setMaxCollateral(
        collateralBefore.collateralAddress,
        newMaxCollateral
      )
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.ok(eqDecimals(collateralAfter.maxCollateral, newMaxCollateral))
    })
    it('should fail because of different scales', async () => {
      const newMaxCollateral = toDecimal(
        new BN(1000000).mul(new BN(10).pow(new BN(SNY_DECIMALS))),
        SNY_DECIMALS + 1
      )
      const beforeAssetList = await exchange.getAssetsList(assetsList)
      const collateralBefore = beforeAssetList.collaterals[0]
      const ix = await exchange.setMaxCollateral(
        collateralBefore.collateralAddress,
        newMaxCollateral
      )
      await assertThrowsAsync(
        signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection),
        ERRORS_EXCHANGE.DIFFERENT_SCALE
      )
      const afterAssetList = await exchange.getAssetsList(assetsList)
      const collateralAfter = afterAssetList.collaterals[0]
      assert.isFalse(eqDecimals(collateralAfter.maxCollateral, newMaxCollateral))
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

      assert.notOk(eqDecimals(collateralAsset.price, toDecimal(new BN(6), ORACLE_OFFSET)))
    })
    it('Should change prices', async () => {
      const assetListBefore = await exchange.getAssetsList(assetsList)
      await setFeedPrice(oracleProgram, newPrice, collateralTokenFeed)

      const collateralAssetLastUpdateBefore = assetListBefore.assets[1].lastUpdate

      await exchange.updatePrices(assetsList)

      const assetList = await exchange.getAssetsList(assetsList)
      const collateralAsset = assetList.assets[1]

      // Check new price
      const expectedPrice = toScale(toDecimal(new BN(newPrice), 0), ORACLE_OFFSET)
      assert.ok(eqDecimals(collateralAsset.price, expectedPrice))

      // Check last_update new value
      assert.ok(collateralAsset.lastUpdate > collateralAssetLastUpdateBefore)
    })
  })
})
