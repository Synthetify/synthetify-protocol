import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Manager, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  sleep,
  ASSETS_MANAGER_ADMIN,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  calculateDebt,
  SYNTHETIFY_ECHANGE_SEED,
  calculateAmountAfterFee,
  toEffectiveFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync
} from './utils'
import { createPriceFeed } from './oracleUtils'

describe('exchange', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program
  const manager = new Manager(connection, Network.LOCAL, provider.wallet, managerProgram.programId)
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
  let CollateralTokenMinter: Account = wallet
  let nonce: number
  before(async () => {
    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_ECHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce
    exchangeAuthority = _mintAuthority
    collateralTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2
      // expo: -6
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
      amountPerRound: new BN(100),
      stakingRoundLength: 300,
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
    assert.ok(state.maxDelay === 0)
    assert.ok(state.fee === 300)
    assert.ok(state.liquidationPenalty === 15)
    assert.ok(state.liquidationThreshold === 200)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.collateralShares.eq(new BN(0)))
  })
  it('Account Creation', async () => {
    const accountOwner = new Account().publicKey
    const exchangeAccount = await exchange.createExchangeAccount(accountOwner)

    const userExchangeAccount = await exchange.getExchangeAccount(exchangeAccount)
    // Owner of account
    assert.ok(userExchangeAccount.owner.equals(accountOwner))
    // Initial values
    assert.ok(userExchangeAccount.debtShares.eq(new BN(0)))
    assert.ok(userExchangeAccount.collateralShares.eq(new BN(0)))
  })
  describe('#deposit()', async () => {
    it('Deposit collateral 1st', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(10 * 1e6) // Mint 10 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const userCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      // Minted amount
      assert.ok(userCollateralTokenAccountInfo.amount.eq(amount))
      const exchangeCollateralTokenAccountInfo = await collateralToken.getAccountInfo(
        collateralAccount
      )
      // No previous deposits
      assert.ok(exchangeCollateralTokenAccountInfo.amount.eq(new BN(0)))
      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        collateralAccount
      )

      // Increase by deposited amount
      assert.ok(exchangeCollateralTokenAccountInfoAfter.amount.eq(amount))

      const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      // First deposit create same amount of shares as deposit amount
      assert.ok(userExchangeAccountAfter.collateralShares.eq(amount))
      const state = await exchange.getState()
      assert.ok(state.collateralShares.eq(amount))
    })
    it('Deposit collateral next', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

      const exchangeCollateralTokenAccountInfoBefore = await collateralToken.getAccountInfo(
        collateralAccount
      )
      const stateBefore = await exchange.getState()

      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        collateralAccount
      )
      // Increase by deposited amount
      assert.ok(
        exchangeCollateralTokenAccountInfoAfter.amount.eq(
          exchangeCollateralTokenAccountInfoBefore.amount.add(amount)
        )
      )

      const userExchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      const createdShares = amount
        .mul(stateBefore.collateralShares)
        .div(exchangeCollateralTokenAccountInfoBefore.amount)
      // First deposit create same amount of shares as deposit amount
      assert.ok(userExchangeAccountAfter.collateralShares.eq(createdShares))
      const state = await exchange.getState()
      assert.ok(state.collateralShares.eq(stateBefore.collateralShares.add(createdShares)))
    })
    it('Deposit more than allowance', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const depositIx = await exchange.depositInstruction({
        amount: amount.mul(new BN(2)),
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )
      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(approveIx).add(depositIx),
          [wallet, accountOwner],
          connection
        )
      )
    })
  })
  describe('#mint()', async () => {
    it('Mint #1', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const usdMintAmount = new BN(20 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      // Increase user debt
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(usdMintAmount))

      // Increase exchange debt
      const exchangeStateAfter = await exchange.getState()
      assert.ok(exchangeStateAfter.debtShares.eq(usdMintAmount))

      // Increase asset supply
      const assetsListAfter = await manager.getAssetsList(assetsList)
      assert.ok(assetsListAfter.assets[0].supply.eq(usdMintAmount))

      // Increase user xusd balance
      const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
    })
    it('Mint #2', async () => {
      const collateralAmount = new BN(200 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      const exchangeStateBefore = await exchange.getState()
      const assetsListBefore = await manager.getAssetsList(assetsList)
      const oldDebt = calculateDebt(assetsListBefore)
      const usdMintAmount = new BN(10 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      // Increase user debt
      // newShares = shares*mintedAmount/oldDebt
      const newShares = exchangeStateBefore.debtShares.mul(usdMintAmount).div(oldDebt)

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(newShares))

      // Increase exchange debt
      const exchangeStateAfter = await exchange.getState()
      assert.ok(exchangeStateAfter.debtShares.eq(exchangeStateBefore.debtShares.add(newShares)))

      // Increase asset supply
      const assetsListAfter = await manager.getAssetsList(assetsList)
      assert.ok(
        assetsListAfter.assets[0].supply.eq(assetsListBefore.assets[0].supply.add(usdMintAmount))
      )

      // Increase user xusd balance
      const userUsdAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountAfter.amount.eq(usdMintAmount))
    })
    it('Mint over limit', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      // Max is collateralAmount*price/10 -> 20*1e6
      const usdMintAmount = new BN(20 * 1e6).add(new BN(1))
      await assertThrowsAsync(
        exchange.mint({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: usdTokenAccount,
          signers: [accountOwner]
        })
      )
    })
  })
  describe('#withdraw()', async () => {
    it('withdraw with no debt', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const exchangeStateBefore = await exchange.getState()
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)

      const exchangeCollateralBalanceBefore = (
        await collateralToken.getAccountInfo(collateralAccount)
      ).amount

      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      const withdrawAmount = new BN(20 * 1e6)
      await exchange.withdraw({
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      // amount_to_shares amount * all_shares  / full_amount ;
      const burned_shares = withdrawAmount
        .mul(exchangeStateBefore.collateralShares)
        .div(exchangeCollateralBalanceBefore)

      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))

      const exchangeCollateralBalanceAfter = (
        await collateralToken.getAccountInfo(collateralAccount)
      ).amount

      assert.ok(
        exchangeCollateralBalanceAfter.eq(exchangeCollateralBalanceBefore.sub(withdrawAmount))
      )

      const exchangeStateAfter = await exchange.getState()

      assert.ok(
        exchangeStateAfter.collateralShares.eq(
          exchangeStateBefore.collateralShares.sub(burned_shares)
        )
      )

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(
        exchangeAccountAfter.collateralShares.eq(
          exchangeAccountBefore.collateralShares.sub(burned_shares)
        )
      )
    })
    it('withdraw fully', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const exchangeStateBefore = await exchange.getState()

      const exchangeCollateralBalanceBefore = (
        await collateralToken.getAccountInfo(collateralAccount)
      ).amount

      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      const withdrawAmount = collateralAmount
      await exchange.withdraw({
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      // amount_to_shares amount * all_shares  / full_amount ;
      const burned_shares = withdrawAmount
        .mul(exchangeStateBefore.collateralShares)
        .div(exchangeCollateralBalanceBefore)

      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))

      const exchangeCollateralBalanceAfter = (
        await collateralToken.getAccountInfo(collateralAccount)
      ).amount

      assert.ok(
        exchangeCollateralBalanceAfter.eq(exchangeCollateralBalanceBefore.sub(withdrawAmount))
      )

      const exchangeStateAfter = await exchange.getState()

      assert.ok(
        exchangeStateAfter.collateralShares.eq(
          exchangeStateBefore.collateralShares.sub(burned_shares)
        )
      )

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.collateralShares.eq(new BN(0)))
    })
    it('withdraw over limit', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const withdrawAmount = collateralAmount.add(new BN(1000000))
      await assertThrowsAsync(
        exchange.withdraw({
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: userCollateralTokenAccount,
          signers: [accountOwner]
        })
      )
    })
    it('withdraw with debt', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })

      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const userCollateralTokenAccountBefore = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountBefore.amount.eq(new BN(0)))
      // We can mint max 20 * 1e6
      const usdMintAmount = new BN(10 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      const withdrawAmount = new BN(50 * 1e6)
      await exchange.withdraw({
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: userCollateralTokenAccount,
        signers: [accountOwner]
      })
      const userCollateralTokenAccountAfter = await collateralToken.getAccountInfo(
        userCollateralTokenAccount
      )
      assert.ok(userCollateralTokenAccountAfter.amount.eq(withdrawAmount))
      // We cant withdraw anymore
      await assertThrowsAsync(
        exchange.withdraw({
          amount: new BN(1),
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: userCollateralTokenAccount,
          signers: [accountOwner]
        })
      )
    })
  })
  describe('#swap()', async () => {
    let btcToken: Token
    let ethToken: Token
    let zeroMaxSupplyToken: Token
    before(async () => {
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
      ethToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const zeroMaxSupplyTokenFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 20,
        expo: -4
      })
      zeroMaxSupplyToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const ethFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2000,
        expo: -8
      })
      const newAssetLimit = new BN(10).pow(new BN(18))

      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: btcToken.publicKey,
        tokenDecimals: 8,
        tokenFeed: btcFeed
      })
      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: ethToken.publicKey,
        tokenDecimals: 6,
        tokenFeed: ethFeed
      })
      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: new BN(0),
        tokenAddress: zeroMaxSupplyToken.publicKey,
        tokenDecimals: 6,
        tokenFeed: zeroMaxSupplyTokenFeed
      })
      const state = await exchange.getState()
    })

    it('Swap usd->btc->eth with 0% discount', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)

      // We can mint max 200 * 1e6
      const usdMintAmount = new BN(200 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await manager.getAssetsList(assetsList)
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(effectiveFee === 300) // discount 0%
      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: assetsListData.assets[0].assetAddress,
        signers: [accountOwner]
      })
      const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))

      const btcAmountOut = calculateAmountAfterFee(
        assetsListData.assets[0],
        btcAsset,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(btcAmountOut))

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))

      const assetsListDataAfter = await manager.getAssetsList(assetsList)
      assert.ok(
        assetsListDataAfter.assets[0].supply.eq(assetsListData.assets[0].supply.sub(usdMintAmount))
      )
      const ethAsset = assetsListData.assets.find((a) => a.assetAddress.equals(ethToken.publicKey))

      const userEthTokenAccountBefore = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountBefore.amount.eq(new BN(0)))

      await exchange.swap({
        amount: btcAmountOut,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: ethTokenAccount,
        userTokenAccountIn: btcTokenAccount,
        tokenFor: ethToken.publicKey,
        tokenIn: btcToken.publicKey,
        signers: [accountOwner]
      })

      const ethAmountOut = calculateAmountAfterFee(btcAsset, ethAsset, effectiveFee, btcAmountOut)
      const userEthTokenAccountAfter = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountAfter.amount.eq(ethAmountOut))
    })
    it('Swap usd->btc->eth with zero collateral', async () => {
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: new BN(0)
      })
      const collateralAmount = new BN(1000 * 1e6)
      const temp = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccountTemp = await usdToken.createAccount(temp.accountOwner.publicKey)
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)
      // We can mint max 200 * 1e6
      const usdMintAmount = new BN(200 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount: temp.exchangeAccount,
        owner: temp.accountOwner.publicKey,
        to: usdTokenAccountTemp,
        signers: [temp.accountOwner]
      })
      const userUsdTokenAccountPreTransfer = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountPreTransfer.amount.eq(new BN(0)))

      await usdToken.transfer(
        usdTokenAccountTemp,
        usdTokenAccount,
        temp.accountOwner,
        [],
        tou64(usdMintAmount)
      )

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await manager.getAssetsList(assetsList)
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      assert.ok(userCollateralBalance.eq(new BN(0)))
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(effectiveFee === 300) // discount 0%

      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: assetsListData.assets[0].assetAddress,
        signers: [accountOwner]
      })
      const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))

      const btcAmountOut = calculateAmountAfterFee(
        assetsListData.assets[0],
        btcAsset,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(btcAmountOut))

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))

      const assetsListDataAfter = await manager.getAssetsList(assetsList)
      assert.ok(
        assetsListDataAfter.assets[0].supply.eq(assetsListData.assets[0].supply.sub(usdMintAmount))
      )
      const ethAsset = assetsListData.assets.find((a) => a.assetAddress.equals(ethToken.publicKey))

      const userEthTokenAccountBefore = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountBefore.amount.eq(new BN(0)))

      await exchange.swap({
        amount: btcAmountOut,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: ethTokenAccount,
        userTokenAccountIn: btcTokenAccount,
        tokenFor: ethToken.publicKey,
        tokenIn: btcToken.publicKey,
        signers: [accountOwner]
      })

      const ethAmountOut = calculateAmountAfterFee(btcAsset, ethAsset, effectiveFee, btcAmountOut)
      const userEthTokenAccountAfter = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountAfter.amount.eq(ethAmountOut))
    })
    it('Swap usd->btc->eth with 3% discount', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)
      const ethTokenAccount = await ethToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = new BN(2000 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await manager.getAssetsList(assetsList)
      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(effectiveFee === 291) // discount 3%
      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: assetsListData.assets[0].assetAddress,
        signers: [accountOwner]
      })
      const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))

      const btcAmountOut = calculateAmountAfterFee(
        assetsListData.assets[0],
        btcAsset,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(btcAmountOut))

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))

      const assetsListDataAfter = await manager.getAssetsList(assetsList)
      assert.ok(
        assetsListDataAfter.assets[0].supply.eq(assetsListData.assets[0].supply.sub(usdMintAmount))
      )
      const ethAsset = assetsListData.assets.find((a) => a.assetAddress.equals(ethToken.publicKey))

      const userEthTokenAccountBefore = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountBefore.amount.eq(new BN(0)))

      await exchange.swap({
        amount: btcAmountOut,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: ethTokenAccount,
        userTokenAccountIn: btcTokenAccount,
        tokenFor: ethToken.publicKey,
        tokenIn: btcToken.publicKey,
        signers: [accountOwner]
      })

      const ethAmountOut = calculateAmountAfterFee(btcAsset, ethAsset, effectiveFee, btcAmountOut)
      const userEthTokenAccountAfter = await ethToken.getAccountInfo(ethTokenAccount)
      assert.ok(userEthTokenAccountAfter.amount.eq(ethAmountOut))
    })
    it('Swap usd->usd should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = new BN(2000 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await manager.getAssetsList(assetsList)
      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: assetsListData.assets[0].assetAddress,
          tokenIn: assetsListData.assets[0].assetAddress,
          signers: [accountOwner]
        })
      )
    })
    it('Swap over max supply', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const zeroMaxSupplyTokenAccount = await zeroMaxSupplyToken.createAccount(
        accountOwner.publicKey
      )

      // We can mint max 2000 * 1e6
      const usdMintAmount = new BN(2000 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const zeroMaxSupplyTokenAccountBefore = await zeroMaxSupplyToken.getAccountInfo(
        zeroMaxSupplyTokenAccount
      )
      assert.ok(zeroMaxSupplyTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      await assertThrowsAsync(
        exchange.swap({
          amount: new BN(1e6),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: zeroMaxSupplyTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: zeroMaxSupplyToken.publicKey,
          tokenIn: usdToken.publicKey,
          signers: [accountOwner]
        })
      )
    })
    it('Swap more than balance should fail', async () => {
      const collateralAmount = new BN(10000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      // We can mint max 2000 * 1e6
      const usdMintAmount = new BN(2000 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(new BN(0)))

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))

      const assetsListData = await manager.getAssetsList(assetsList)
      const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))

      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount.add(new BN(1)),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcAsset.assetAddress,
          tokenIn: assetsListData.assets[0].assetAddress,
          signers: [accountOwner]
        })
      )
    })
  })
  describe('#burn()', async () => {
    let btcToken: Token
    let ethToken: Token
    before(async () => {
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
      ethToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const ethFeed = await createPriceFeed({
        oracleProgram,
        initPrice: 2000,
        expo: -8
      })
      const newAssetLimit = new BN(10).pow(new BN(18))
      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: btcToken.publicKey,
        tokenDecimals: 8,
        tokenFeed: btcFeed
      })
      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: ethToken.publicKey,
        tokenDecimals: 6,
        tokenFeed: ethFeed
      })
      // Just to add user
      await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: new BN(10000000 * 1e6),
        usdToken
      })
      const state = await exchange.getState()
    })
    it('Burn all debt', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      // create usd account
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      // We can mint max 200 * 1e6
      const usdMintAmount = new BN(200 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await exchange.burn({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })

      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(new BN(0)))
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
    })
    it('Burn more than debt - should return rest', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const temp = await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      // We can mint max 200 * 1e6
      const usdMintAmount = new BN(200 * 1e6)
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
      // Transfer some USD
      const transferAmount = new BN(10 * 1e6)
      await usdToken.transfer(
        temp.usdTokenAccount,
        usdTokenAccount,
        temp.accountOwner,
        [],
        tou64(transferAmount)
      )
      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount.add(transferAmount)))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await exchange.burn({
        amount: usdMintAmount.add(transferAmount),
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })

      // We should end with transfered amount
      const userUsdTokenAccountAfter = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountAfter.amount.eq(transferAmount))

      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.eq(new BN(0)))
    })
    it('Burn without signer', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        usdTokenAccount,
        userCollateralTokenAccount,
        usdMintAmount
      } = await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      await assertThrowsAsync(
        exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: []
        })
      )
    })
    it('Burn wrong token', async () => {
      const collateralAmount = new BN(1000 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        usdTokenAccount,
        userCollateralTokenAccount,
        usdMintAmount
      } = await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))
      const userBtcTokenAccount = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccount.amount.eq(new BN(0)))

      const userCollateralBalance = await exchange.getUserCollateralBalance(exchangeAccount)
      const effectiveFee = toEffectiveFee(exchange.state.fee, userCollateralBalance)
      assert.ok(effectiveFee === 300) // discount 0%
      const assetsListData = await manager.getAssetsList(assetsList)

      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: usdToken.publicKey,
        signers: [accountOwner]
      })
      const btcAsset = assetsListData.assets.find((a) => a.assetAddress.equals(btcToken.publicKey))
      const btcAmountOut = calculateAmountAfterFee(
        assetsListData.assets[0],
        btcAsset,
        effectiveFee,
        usdMintAmount
      )
      const userBtcTokenAccountBefore = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountBefore.amount.eq(btcAmountOut))

      const burnIx = (await exchange.program.state.instruction.burn(btcAmountOut, {
        accounts: {
          exchangeAuthority: exchangeAuthority,
          usdToken: btcToken.publicKey,
          userTokenAccountBurn: btcTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          exchangeAccount: exchangeAccount,
          owner: accountOwner.publicKey,
          assetsList: exchange.state.assetsList,
          managerProgram: exchange.manager.programId
        }
      })) as TransactionInstruction
      const updateIx = await exchange.manager.updatePricesInstruction(exchange.state.assetsList)

      const approveIx = Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        btcTokenAccount,
        exchange.exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(btcAmountOut)
      )
      const updateTx = new Transaction().add(updateIx)
      const burnTx = new Transaction().add(approveIx).add(burnIx)
      // @ts-expect-error
      const txs = await exchange.processOperations([updateTx, burnTx])
      txs[1].partialSign(accountOwner)
      await connection.sendRawTransaction(txs[0].serialize(), {
        skipPreflight: true
      })
      await sleep(600)
      await assertThrowsAsync(
        sendAndConfirmRawTransaction(connection, txs[1].serialize(), {
          skipPreflight: true
        })
      )
    })
  })
  describe('System Halted', async () => {
    it('#deposit()', async () => {
      const accountOwner = new Account()
      const exchangeAccount = await exchange.createExchangeAccount(accountOwner.publicKey)

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(10 * 1e6) // Mint 10 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))
      const depositIx = await exchange.depositInstruction({
        amount,
        exchangeAccount,
        userCollateralAccount: userCollateralTokenAccount,
        owner: accountOwner.publicKey
      })
      const approveIx = Token.createApproveInstruction(
        collateralToken.programId,
        userCollateralTokenAccount,
        exchangeAuthority,
        accountOwner.publicKey,
        [],
        tou64(amount)
      )

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        signAndSend(
          new Transaction().add(approveIx).add(depositIx),
          [wallet, accountOwner],
          connection
        )
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await signAndSend(
        new Transaction().add(approveIx).add(depositIx),
        [wallet, accountOwner],
        connection
      )
    })
    it('#mint()', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)

      const usdMintAmount = new BN(5 * 1e6)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.mint({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: usdTokenAccount,
          signers: [accountOwner]
        })
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.mint({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: usdTokenAccount,
        signers: [accountOwner]
      })
    })
    it('#withdraw()', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const withdrawAmount = new BN(20 * 1e6)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.withdraw({
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: userCollateralTokenAccount,
          signers: [accountOwner]
        })
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.withdraw({
        amount: withdrawAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        to: userCollateralTokenAccount,
        signers: [accountOwner]
      })
    })
    it('#burn()', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount,
        usdMintAmount,
        usdTokenAccount
      } = await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: [accountOwner]
        })
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.burn({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountBurn: usdTokenAccount,
        signers: [accountOwner]
      })
    })
    it('#swap()', async () => {
      const btcToken = await createToken({
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

      await manager.addNewAsset({
        assetsAdmin: ASSETS_MANAGER_ADMIN,
        assetsList,
        maxSupply: newAssetLimit,
        tokenAddress: btcToken.publicKey,
        tokenDecimals: 8,
        tokenFeed: btcFeed
      })
      await exchange.getState()

      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount,
        usdMintAmount,
        usdTokenAccount
      } = await createAccountWithCollateralAndMaxMintUsd({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })

      const btcTokenAccount = await btcToken.createAccount(accountOwner.publicKey)

      const ixHalt = await exchange.setHaltedInstruction(true)
      await signAndSend(new Transaction().add(ixHalt), [wallet, EXCHANGE_ADMIN], connection)
      const stateHalted = await exchange.getState()
      assert.ok(stateHalted.halted === true)

      // should fail
      await assertThrowsAsync(
        exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcToken.publicKey,
          tokenIn: usdToken.publicKey,
          signers: [accountOwner]
        })
      )
      // unlock
      const ix = await exchange.setHaltedInstruction(false)
      await signAndSend(new Transaction().add(ix), [wallet, EXCHANGE_ADMIN], connection)
      const state = await exchange.getState()
      assert.ok(state.halted === false)

      // should pass
      await exchange.swap({
        amount: usdMintAmount,
        exchangeAccount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: btcTokenAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: btcToken.publicKey,
        tokenIn: usdToken.publicKey,
        signers: [accountOwner]
      })
    })
  })
})
