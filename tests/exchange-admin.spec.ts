import * as anchor from '@project-serum/anchor'
import { Program, Provider } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  sendAndConfirmRawTransaction,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert, expect, should } from 'chai'
import { BN, calculateLiquidation, Exchange, Manager, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createPriceFeed,
  createToken,
  sleep,
  ORACLE_ADMIN,
  ASSETS_MANAGER_ADMIN,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  DEFAULT_PUBLIC_KEY,
  ORACLE_OFFSET,
  ACCURACY,
  calculateDebt,
  SYNTHETIFY_ECHANGE_SEED,
  calculateAmountAfterFee,
  toEffectiveFee,
  createAccountWithCollateralAndMaxMintUsd,
  tokenToUsdValue,
  assertThrowsAsync,
  U64_MAX
} from './utils'

describe('staking', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgram.programId)
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Oracle as Program

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
  let CollateralTokenMinter: Account = wallet
  let nonce: number
  const stakingRoundLength = 10
  const amountPerRound = new BN(100)

  let initialCollateralPrice = new BN(2 * 1e4)
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: initialCollateralPrice
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)
    liquidationAccount = await collateralToken.createAccount(exchangeAuthority)
    stakingFundAccount = await collateralToken.createAccount(exchangeAuthority)

    const data = await createAssetsList({
      exchangeAuthority,
      assetsAdmin: ASSETS_MANAGER_ADMIN,
      collateralToken,
      collateralTokenFeed,
      connection,
      manager,
      wallet
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    // @ts-expect-error
    exchange = new Exchange(
      connection,
      Network.LOCAL,
      provider.wallet,
      manager,
      exchangeAuthority,
      exchangeProgram.programId
    )
    await exchange.init({
      admin: EXCHANGE_ADMIN.publicKey,
      assetsList,
      collateralAccount,
      liquidationAccount,
      collateralToken: collateralToken.publicKey,
      nonce,
      amountPerRound: amountPerRound,
      stakingRoundLength: stakingRoundLength,
      stakingFundAccount: stakingFundAccount
    })
    exchange = await Exchange.build(
      connection,
      Network.LOCAL,
      provider.wallet,
      manager,
      exchangeAuthority,
      exchangeProgram.programId
    )
  })
  it('Initialize', async () => {
    const state = await exchange.getState()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.halted === false)
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.liquidationAccount.equals(liquidationAccount))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 10)
    assert.ok(state.fee === 300)
    assert.ok(state.liquidationPenalty === 15)
    assert.ok(state.liquidationThreshold === 200)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.liquidationBuffer === 172800)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.collateralShares.eq(new BN(0)))
  })
  describe('#setLiquidationBuffer()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationBuffer = 999
      const ix = await exchange.setLiquidationBufferInstruction(newLiquidationBuffer)
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
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
  describe('#setLiquidationThreshold()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationThreshold = 150
      const ix = await exchange.setLiquidationThresholdInstruction(newLiquidationThreshold)
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
      const state = await exchange.getState()
      assert.ok(state.liquidationThreshold !== newLiquidationThreshold)
    })
    it('change value', async () => {
      const newLiquidationThreshold = 150
      const ix = await exchange.setLiquidationThresholdInstruction(newLiquidationThreshold)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.liquidationThreshold === newLiquidationThreshold)
    })
  })
  describe('#setLiquidationPenalty()', async () => {
    it('Fail without admin signature', async () => {
      const newLiquidationPenalty = 9
      const ix = await exchange.setLiquidationPenaltyInstruction(newLiquidationPenalty)
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
      const state = await exchange.getState()
      assert.ok(state.liquidationPenalty !== newLiquidationPenalty)
    })
    it('change value', async () => {
      const newLiquidationPenalty = 9
      const ix = await exchange.setLiquidationPenaltyInstruction(newLiquidationPenalty)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.liquidationPenalty === newLiquidationPenalty)
    })
  })
  describe('#setCollateralizationLevel()', async () => {
    it('Fail without admin signature', async () => {
      const newCollateralizationLevel = 400
      const ix = await exchange.setCollateralizationLevelInstruction(newCollateralizationLevel)
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
      const state = await exchange.getState()
      assert.ok(state.collateralizationLevel !== newCollateralizationLevel)
    })
    it('change value', async () => {
      const newCollateralizationLevel = 9
      const ix = await exchange.setCollateralizationLevelInstruction(newCollateralizationLevel)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.collateralizationLevel === newCollateralizationLevel)
    })
  })
  describe('#setFee()', async () => {
    it('Fail without admin signature', async () => {
      const newFee = 999
      const ix = await exchange.setFeeInstruction(newFee)
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
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
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
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
      await assertThrowsAsync(signAndSend(new Transaction().add(ix), [wallet], connection))
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
})
