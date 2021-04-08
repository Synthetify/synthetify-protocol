import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction
} from '@solana/web3.js'
import { assert, expect } from 'chai'
import { BN, Exchange, Manager, Network, signAndSend } from '@synthetify/sdk'

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
  createAccountWithCollateralAndMaxMintUsd
} from './utils'

describe('exchange', () => {
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
      admin: ORACLE_ADMIN.publicKey,
      oracleProgram,
      initPrice: new BN(2 * 1e4)
    })

    collateralToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })
    collateralAccount = await collateralToken.createAccount(exchangeAuthority)

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
      collateralToken: collateralToken.publicKey,
      nonce
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
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 10)
    assert.ok(state.fee === 300)
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
        userCollateralAccount: userCollateralTokenAccount
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
        userCollateralAccount: userCollateralTokenAccount
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

      try {
        const depositIx = await exchange.depositInstruction({
          amount: amount.mul(new BN(2)),
          exchangeAccount,
          userCollateralAccount: userCollateralTokenAccount
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
        assert.ok(false)
      } catch (err) {
        assert.ok(true)
      }
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
      try {
        await exchange.mint({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: usdTokenAccount,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
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
      try {
        await exchange.withdraw({
          amount: withdrawAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: userCollateralTokenAccount,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (err) {
        assert.ok(true)
      }
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
      try {
        await exchange.withdraw({
          amount: new BN(1),
          exchangeAccount,
          owner: accountOwner.publicKey,
          to: userCollateralTokenAccount,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
    })
  })
  describe('#swap()', async () => {
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
        admin: ORACLE_ADMIN.publicKey,
        oracleProgram,
        initPrice: new BN(50000 * 1e4)
      })
      ethToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const ethFeed = await createPriceFeed({
        admin: ORACLE_ADMIN.publicKey,
        oracleProgram,
        initPrice: new BN(2000 * 1e4)
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
      try {
        await exchange.swap({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: assetsListData.assets[0].assetAddress,
          tokenIn: assetsListData.assets[0].assetAddress,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
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

      try {
        await exchange.swap({
          amount: usdMintAmount.add(new BN(1)),
          exchangeAccount,
          owner: accountOwner.publicKey,
          userTokenAccountFor: btcTokenAccount,
          userTokenAccountIn: usdTokenAccount,
          tokenFor: btcAsset.assetAddress,
          tokenIn: assetsListData.assets[0].assetAddress,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
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
        admin: ORACLE_ADMIN.publicKey,
        oracleProgram,
        initPrice: new BN(50000 * 1e4)
      })
      ethToken = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: 6
      })
      const ethFeed = await createPriceFeed({
        admin: ORACLE_ADMIN.publicKey,
        oracleProgram,
        initPrice: new BN(2000 * 1e4)
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
        tokenBurn: usdToken.publicKey,
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
        tokenBurn: usdToken.publicKey,
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

      try {
        await exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          tokenBurn: usdToken.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: []
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
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

      const userUsdTokenAccountBefore = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccountBefore.amount.eq(usdMintAmount))
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountBefore.debtShares.gt(new BN(0)))

      try {
        await exchange.burn({
          amount: usdMintAmount,
          exchangeAccount,
          owner: accountOwner.publicKey,
          tokenBurn: ethToken.publicKey,
          userTokenAccountBurn: usdTokenAccount,
          signers: [accountOwner]
        })
        assert.ok(false)
      } catch (error) {
        assert.ok(true)
      }
    })
    it('Burn btc token', async () => {
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

      const userBtcTokenAccount = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccount.amount.eq(new BN(0)))
      const userUsdTokenAccount = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdTokenAccount.amount.eq(usdMintAmount))
      const exchangeAccountData = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountData.debtShares.gt(new BN(0)))

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
      const exchangeAccountBefore = await exchange.getExchangeAccount(exchangeAccount)

      await exchange.burn({
        amount: btcAmountOut,
        exchangeAccount,
        owner: accountOwner.publicKey,
        tokenBurn: btcToken.publicKey,
        userTokenAccountBurn: btcTokenAccount,
        signers: [accountOwner]
      })
      // We should endup with some debt
      const exchangeAccountAfter = await exchange.getExchangeAccount(exchangeAccount)
      assert.ok(exchangeAccountAfter.debtShares.gt(new BN(0)))
      assert.ok(exchangeAccountAfter.debtShares.lt(exchangeAccountBefore.debtShares))

      // Burned all BTC
      const userBtcTokenAccountAfter = await btcToken.getAccountInfo(btcTokenAccount)
      assert.ok(userBtcTokenAccountAfter.amount.eq(new BN(0)))
    })
  })
})
