import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { State } from '@project-serum/anchor/dist/rpc'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, SYSVAR_CLOCK_PUBKEY, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { assert, expect } from 'chai'
import { BN } from '@synthetify/sdk'

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
  DEFAULT_PUBLIC_KEY
} from './utils'

describe('exchange', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  const managerProgram = anchor.workspace.Manager as Program

  const oracleProgram = anchor.workspace.Oracle as Program

  // @ts-expect-error
  const wallet = provider.wallet.payer as Account
  const programSigner = new anchor.web3.Account()
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
      [programSigner.publicKey.toBuffer()],
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
      managerProgram,
      wallet
    })
    assetsList = data.assetsList
    usdToken = data.usdToken
    await exchangeProgram.state.rpc.new(nonce, {
      accounts: {
        admin: EXCHANGE_ADMIN.publicKey,
        collateralToken: collateralToken.publicKey,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        programSigner: programSigner.publicKey
      }
    })
  })
  it('Initialize', async () => {
    const state = await exchangeProgram.state()
    // Check initialized addreses
    assert.ok(state.admin.equals(EXCHANGE_ADMIN.publicKey))
    assert.ok(state.programSigner.equals(programSigner.publicKey))
    assert.ok(state.collateralToken.equals(collateralToken.publicKey))
    assert.ok(state.collateralAccount.equals(collateralAccount))
    assert.ok(state.assetsList.equals(assetsList))
    // Check initialized parameters
    assert.ok(state.nonce === nonce)
    assert.ok(state.maxDelay === 10)
    assert.ok(state.fee === 30)
    assert.ok(state.collateralizationLevel === 1000)
    assert.ok(state.debtShares.eq(new BN(0)))
    assert.ok(state.collateralShares.eq(new BN(0)))
  })
  it('Account Creation', async () => {
    const exchangeAccount = new Account()
    const accountOwner = new Account().publicKey
    await exchangeProgram.rpc.createExchangeAccount(accountOwner, {
      accounts: {
        exchangeAccount: exchangeAccount.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY
      },
      signers: [exchangeAccount],
      instructions: [
        await exchangeProgram.account.exchangeAccount.createInstruction(exchangeAccount)
      ]
    })
    const userExchangeAccount = await exchangeProgram.account.exchangeAccount(
      exchangeAccount.publicKey
    )
    // Owner of account
    assert.ok(userExchangeAccount.owner.equals(accountOwner))
    // Initial values
    assert.ok(userExchangeAccount.debtShares.eq(new BN(0)))
    assert.ok(userExchangeAccount.collateralShares.eq(new BN(0)))
  })
  describe('#deposit()', async () => {
    it('Deposit collateral 1st', async () => {
      const exchangeAccount = new Account()
      const accountOwner = new Account()
      await exchangeProgram.rpc.createExchangeAccount(accountOwner.publicKey, {
        accounts: {
          exchangeAccount: exchangeAccount.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY
        },
        signers: [exchangeAccount],
        instructions: [
          await exchangeProgram.account.exchangeAccount.createInstruction(exchangeAccount)
        ]
      })

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

      await exchangeProgram.state.rpc.deposit(amount, {
        accounts: {
          exchangeAccount: exchangeAccount.publicKey,
          collateralAccount: collateralAccount,
          userCollateralAccount: userCollateralTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          exchangeAuthority: exchangeAuthority
        },
        signers: [accountOwner],
        instructions: [
          Token.createApproveInstruction(
            collateralToken.programId,
            userCollateralTokenAccount,
            exchangeAuthority,
            accountOwner.publicKey,
            [],
            tou64(amount)
          )
        ]
      })
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        collateralAccount
      )
      // Increase by deposited amount
      assert.ok(exchangeCollateralTokenAccountInfoAfter.amount.eq(amount))

      const userExchangeAccountAfter = await exchangeProgram.account.exchangeAccount(
        exchangeAccount.publicKey
      )
      // First deposit create same amount of shares as deposit amount
      assert.ok(userExchangeAccountAfter.collateralShares.eq(amount))
      const state = await exchangeProgram.state()
      assert.ok(state.collateralShares.eq(amount))
    })
    it('Deposit collateral next', async () => {
      const exchangeAccount = new Account()
      const accountOwner = new Account()
      await exchangeProgram.rpc.createExchangeAccount(accountOwner.publicKey, {
        accounts: {
          exchangeAccount: exchangeAccount.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY
        },
        signers: [exchangeAccount],
        instructions: [
          await exchangeProgram.account.exchangeAccount.createInstruction(exchangeAccount)
        ]
      })

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

      const exchangeCollateralTokenAccountInfoBefore = await collateralToken.getAccountInfo(
        collateralAccount
      )
      const stateBefore = await exchangeProgram.state()

      await exchangeProgram.state.rpc.deposit(amount, {
        accounts: {
          exchangeAccount: exchangeAccount.publicKey,
          collateralAccount: collateralAccount,
          userCollateralAccount: userCollateralTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          exchangeAuthority: exchangeAuthority
        },
        signers: [accountOwner],
        instructions: [
          Token.createApproveInstruction(
            collateralToken.programId,
            userCollateralTokenAccount,
            exchangeAuthority,
            accountOwner.publicKey,
            [],
            tou64(amount)
          )
        ]
      })
      const exchangeCollateralTokenAccountInfoAfter = await collateralToken.getAccountInfo(
        collateralAccount
      )
      // Increase by deposited amount
      assert.ok(
        exchangeCollateralTokenAccountInfoAfter.amount.eq(
          exchangeCollateralTokenAccountInfoBefore.amount.add(amount)
        )
      )

      const userExchangeAccountAfter = await exchangeProgram.account.exchangeAccount(
        exchangeAccount.publicKey
      )
      const createdShares = amount
        .mul(stateBefore.collateralShares)
        .div(exchangeCollateralTokenAccountInfoBefore.amount)
      // First deposit create same amount of shares as deposit amount
      assert.ok(userExchangeAccountAfter.collateralShares.eq(createdShares))
      const state = await exchangeProgram.state()
      assert.ok(state.collateralShares.eq(stateBefore.collateralShares.add(createdShares)))
    })
    it('Deposit more than allowance', async () => {
      const exchangeAccount = new Account()
      const accountOwner = new Account()
      await exchangeProgram.rpc.createExchangeAccount(accountOwner.publicKey, {
        accounts: {
          exchangeAccount: exchangeAccount.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY
        },
        signers: [exchangeAccount],
        instructions: [
          await exchangeProgram.account.exchangeAccount.createInstruction(exchangeAccount)
        ]
      })

      const userCollateralTokenAccount = await collateralToken.createAccount(accountOwner.publicKey)
      const amount = new anchor.BN(100 * 1e6) // Mint 100 SNY
      await collateralToken.mintTo(userCollateralTokenAccount, wallet, [], tou64(amount))

      try {
        await exchangeProgram.state.rpc.deposit(amount.mul(new BN(2)), {
          accounts: {
            exchangeAccount: exchangeAccount.publicKey,
            collateralAccount: collateralAccount,
            userCollateralAccount: userCollateralTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            exchangeAuthority: exchangeAuthority
          },
          signers: [accountOwner],
          instructions: [
            Token.createApproveInstruction(
              collateralToken.programId,
              userCollateralTokenAccount,
              exchangeAuthority,
              accountOwner.publicKey,
              [],
              tou64(amount)
            )
          ]
        })
        assert.ok(false)
      } catch (err) {
        assert.ok(true)
      }
    })
  })
  describe('#mint()', async () => {
    it.only('Mint with zero debt', async () => {
      const collateralAmount = new BN(100 * 1e6)
      const {
        accountOwner,
        exchangeAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateral({
        collateralAccount,
        collateralToken,
        exchangeAuthority,
        exchangeProgram,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount
      })
      const usdTokenAccount = await usdToken.createAccount(accountOwner.publicKey)
      const assetListData = await managerProgram.account.assetsList(assetsList)

      const feedAddresses = assetListData.assets
        .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
        .map((asset) => {
          return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
        })
      const txUpdateOracle = managerProgram.rpc.setAssetsPrices({
        remainingAccounts: feedAddresses,
        accounts: {
          assetsList: assetsList,
          clock: SYSVAR_CLOCK_PUBKEY
        }
      })
      const usdMintAmount = new BN(20 * 1e6)
      const txMint = exchangeProgram.state.rpc.mint(usdMintAmount, {
        accounts: {
          authority: exchangeAuthority,
          mint: usdToken.publicKey,
          to: usdTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
          exchangeAccount: exchangeAccount,
          owner: accountOwner.publicKey,
          assetsList: assetsList,
          managerProgram: managerProgram.programId
        },
        signers: [accountOwner],
        options: { skipPreflight: true }
      })
      await Promise.all([txUpdateOracle, txMint])
      const userUsdAccountInfo = await usdToken.getAccountInfo(usdTokenAccount)
      assert.ok(userUsdAccountInfo.amount.eq(usdMintAmount))
    })
  })
})
