import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Account, PublicKey, Transaction } from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  EXCHANGE_ADMIN,
  SYNTHETIFY_ECHANGE_SEED,
  assertThrowsAsync,
  createAccountWithCollateralAndMaxMintUsd,
  almostEqual,
  calculateDebt
} from './utils'
import { createPriceFeed, setFeedPrice } from './oracleUtils'
import { Synthetic } from '@synthetify/sdk/lib/exchange'
import { ACCURACY, ERRORS_EXCHANGE, sleep } from '@synthetify/sdk/lib/utils'

describe('settlement', () => {
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
  let snyReserve: PublicKey
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
    snyReserve = await collateralToken.createAccount(exchangeAuthority)

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
      amountPerRound: new BN(100),
      stakingRoundLength: 300,
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
      snyReserve,
      snyLiquidationFund: liquidationAccount
    })
    assetsList = data.assetsList
    usdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })

    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 1e10)
  })
  describe('Settlement', async () => {
    const price = 7
    const decimals = 9
    let syntheticToSettle: Synthetic
    let tokenToSettle: Token
    let settlementReserve: PublicKey
    before(async () => {
      const oracleAddress = await createPriceFeed({
        oracleProgram,
        initPrice: price,
        expo: -9
      })
      const addAssetIx = await exchange.addNewAssetInstruction({
        assetsList,
        assetFeedAddress: oracleAddress
      })
      await signAndSend(new Transaction().add(addAssetIx), [EXCHANGE_ADMIN], connection)
      const assetListData = await exchange.getAssetsList(assetsList)

      const assetForSynthetic = assetListData.assets.find((a) =>
        a.feedAddress.equals(oracleAddress)
      )
      if (!assetForSynthetic) {
        throw new Error('No asset for synthetic')
      }
      const newSynthetic = await createToken({
        connection,
        payer: wallet,
        mintAuthority: exchangeAuthority,
        decimals: decimals
      })
      tokenToSettle = newSynthetic
      const ix = await exchange.addSyntheticInstruction({
        assetAddress: newSynthetic.publicKey,
        assetsList,
        maxSupply: new BN(1e12),
        priceFeed: assetForSynthetic.feedAddress
      })
      await signAndSend(new Transaction().add(ix), [EXCHANGE_ADMIN], connection)
      const afterAssetList = await exchange.getAssetsList(assetsList)

      const addedSynthetic = afterAssetList.synthetics.find((a) =>
        a.assetAddress.equals(newSynthetic.publicKey)
      )
      if (!addedSynthetic) {
        throw new Error('Failed to add synthetic')
      }
      syntheticToSettle = addedSynthetic
      settlementReserve = await usdToken.createAccount(exchangeAuthority)
    })
    it('Fail with outdated oracle', async () => {
      await sleep(1000)
      const { oracleUpdateIx, settleIx, settlement } = await exchange.settleSynthetic({
        payer: wallet.publicKey,
        settlementReserve,
        tokenToSettle: syntheticToSettle.assetAddress
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(settleIx), [wallet], connection),
        ERRORS_EXCHANGE.OUTDATED_ORACLE
      )
    })
    it('Fail before settlement slot', async () => {
      const { oracleUpdateIx, settleIx, settlement } = await exchange.settleSynthetic({
        payer: wallet.publicKey,
        settlementReserve,
        tokenToSettle: syntheticToSettle.assetAddress
      })

      await assertThrowsAsync(
        signAndSend(new Transaction().add(oracleUpdateIx).add(settleIx), [wallet], connection),
        ERRORS_EXCHANGE.SETTLEMENT_NOT_REACHED
      )
    })
    it('Should settle', async () => {
      const collateralAmount = new BN(1e8)
      const {
        accountOwner,
        exchangeAccount,
        usdMintAmount,
        usdTokenAccount,
        userCollateralTokenAccount
      } = await createAccountWithCollateralAndMaxMintUsd({
        reserveAddress: snyReserve,
        collateralToken,
        exchangeAuthority,
        exchange,
        collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
        amount: collateralAmount,
        usdToken
      })
      const tokenToSettleAccount = await tokenToSettle.createAccount(accountOwner.publicKey)

      await exchange.swap({
        exchangeAccount,
        amount: usdMintAmount,
        owner: accountOwner.publicKey,
        userTokenAccountFor: tokenToSettleAccount,
        userTokenAccountIn: usdTokenAccount,
        tokenFor: tokenToSettle.publicKey,
        tokenIn: usdToken.publicKey,
        signers: [accountOwner]
      })
      const tokenToSettleAmount = (await tokenToSettle.getAccountInfo(tokenToSettleAccount)).amount
      // Change settlement slot
      const slot = await connection.getSlot()
      const changeSlotIx = await exchange.setSettlementSlotInstruction(
        syntheticToSettle.assetAddress,
        new BN(slot)
      )
      await signAndSend(new Transaction().add(changeSlotIx), [EXCHANGE_ADMIN], connection)

      const assetsListBeforeSettlement = await exchange.getAssetsList(assetsList)
      const { oracleUpdateIx, settleIx } = await exchange.settleSynthetic({
        payer: wallet.publicKey,
        settlementReserve,
        tokenToSettle: syntheticToSettle.assetAddress
      })
      await signAndSend(new Transaction().add(oracleUpdateIx).add(settleIx), [wallet], connection)

      const assetsListAfterSettlement = await exchange.getAssetsList(assetsList)

      const settlementData = await exchange.getSettlementAccountForSynthetic(
        syntheticToSettle.assetAddress
      )
      const valueOfSetteledSynthetic = new BN(tokenToSettleAmount.toString())
        .mul(settlementData.ratio.val)
        .div(new BN(10 ** (settlementData.decimalsIn + settlementData.ratio.scale - ACCURACY)))
      const delta = assetsListAfterSettlement.synthetics[0].supply.val.sub(
        assetsListBeforeSettlement.synthetics[0].supply.val
      )
      const settelmentAsset = assetsListAfterSettlement.assets[syntheticToSettle.assetIndex]
      assert.ok(almostEqual(valueOfSetteledSynthetic, delta))
      assert.ok(
        assetsListAfterSettlement.synthetics.find((s) =>
          s.assetAddress.equals(syntheticToSettle.assetAddress)
        ) === undefined
      )
      assert.ok(settlementData.decimalsOut === (await usdToken.getMintInfo()).decimals)
      assert.ok(settlementData.decimalsIn === syntheticToSettle.supply.scale)
      assert.ok(almostEqual(settelmentAsset.price.val, settlementData.ratio.val))
      assert.ok(settlementData.reserveAddress.equals(settlementReserve))
      assert.ok(settlementData.tokenInAddress.equals(syntheticToSettle.assetAddress))
      assert.ok(settlementData.tokenOutAddress.equals(usdToken.publicKey))
      const debtBefore = calculateDebt(assetsListBeforeSettlement)
      const debtAfter = calculateDebt(assetsListAfterSettlement)
      assert.ok(almostEqual(debtBefore, debtAfter))

      const approveIx = await Token.createApproveInstruction(
        TOKEN_PROGRAM_ID,
        tokenToSettleAccount,
        exchange.exchangeAuthority,
        accountOwner.publicKey,
        [],
        tokenToSettleAmount
      )

      const swapSettledIx = await exchange.swapSettledSyntheticInstruction({
        tokenToSettle: tokenToSettle.publicKey,
        userSettledTokenAccount: tokenToSettleAccount,
        userUsdAccount: usdTokenAccount,
        amount: new BN(tokenToSettleAmount.toString()),
        signer: accountOwner.publicKey
      })
      const usdBalanceBefore = (await usdToken.getAccountInfo(usdTokenAccount)).amount

      await signAndSend(
        new Transaction().add(approveIx).add(swapSettledIx),
        [wallet, accountOwner],
        connection
      )
      const usdBalanceAfter = (await usdToken.getAccountInfo(usdTokenAccount)).amount
      assert.ok(
        almostEqual(
          new BN(usdBalanceBefore.toString()).add(valueOfSetteledSynthetic),
          new BN(usdBalanceAfter.toString())
        )
      )
    })
  })
})
