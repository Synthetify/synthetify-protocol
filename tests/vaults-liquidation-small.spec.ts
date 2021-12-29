import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Account,
  Keypair,
  PublicKey,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} from '@solana/web3.js'
import { assert } from 'chai'
import { BN, Exchange, Network, signAndSend } from '@synthetify/sdk'

import {
  createAssetsList,
  createToken,
  sleep,
  EXCHANGE_ADMIN,
  tou64,
  createAccountWithCollateral,
  calculateDebt,
  SYNTHETIFY_EXCHANGE_SEED,
  calculateAmountAfterFee,
  createAccountWithCollateralAndMaxMintUsd,
  assertThrowsAsync,
  mulByPercentage,
  createCollateralToken,
  calculateFee,
  calculateSwapTax,
  U64_MAX,
  eqDecimals,
  mulByDecimal,
  almostEqual
} from './utils'
import { createPriceFeed, getFeedData, setFeedPrice, setFeedTrading } from './oracleUtils'
import {
  decimalToPercent,
  ERRORS,
  INTEREST_RATE_DECIMALS,
  percentToDecimal,
  SNY_DECIMALS,
  toDecimal,
  toScale,
  XUSD_DECIMALS
} from '@synthetify/sdk/lib/utils'
import { ERRORS_EXCHANGE, toEffectiveFee } from '@synthetify/sdk/src/utils'
import { Collateral, PriceStatus, Synthetic } from '@synthetify/sdk/lib/exchange'
import { Decimal, OracleType } from '@synthetify/sdk/src/exchange'

describe('vaults liquidation', () => {
  const provider = anchor.Provider.local()
  const connection = provider.connection
  const exchangeProgram = anchor.workspace.Exchange as Program
  let exchange: Exchange

  const oracleProgram = anchor.workspace.Pyth as Program

  //@ts-ignore
  const wallet = provider.wallet.payer as Account

  let snyToken: Token
  let xusdToken: Token
  let assetsList: PublicKey
  let snyTokenFeed: PublicKey
  let exchangeAuthority: PublicKey
  let snyReserve: PublicKey
  let stakingFundAccount: PublicKey
  let snyLiquidationFund: PublicKey
  let nonce: number
  let CollateralTokenMinter: Account = wallet
  let ethToken: Token
  let ethVaultReserve: PublicKey
  let ethVaultLiquidationFund: PublicKey
  let ethPriceFeed: PublicKey

  const accountOwner = Keypair.generate()
  const vaultType = 0
  let liquidator: Account
  let liquidatorXusdAccount: PublicKey

  before(async () => {
    await connection.requestAirdrop(accountOwner.publicKey, 10e9)
    await connection.requestAirdrop(EXCHANGE_ADMIN.publicKey, 10e9)

    const [_mintAuthority, _nonce] = await anchor.web3.PublicKey.findProgramAddress(
      [SYNTHETIFY_EXCHANGE_SEED],
      exchangeProgram.programId
    )
    nonce = _nonce

    exchangeAuthority = _mintAuthority
    snyTokenFeed = await createPriceFeed({
      oracleProgram,
      initPrice: 2,
      expo: -6
    })

    snyToken = await createToken({
      connection,
      payer: wallet,
      mintAuthority: CollateralTokenMinter.publicKey
    })

    snyReserve = await snyToken.createAccount(exchangeAuthority)
    snyLiquidationFund = await snyToken.createAccount(exchangeAuthority)
    stakingFundAccount = await snyToken.createAccount(exchangeAuthority)

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
      collateralToken: snyToken,
      collateralTokenFeed: snyTokenFeed,
      connection,
      wallet,
      exchangeAdmin: EXCHANGE_ADMIN,
      exchange,
      snyReserve,
      snyLiquidationFund
    })
    assetsList = data.assetsList
    xusdToken = data.usdToken

    await exchange.setAssetsList({ exchangeAdmin: EXCHANGE_ADMIN, assetsList })
    await exchange.getState()

    // create USDC collateral token
    const { feed, token } = await createCollateralToken({
      collateralRatio: 50,
      connection,
      decimals: 6,
      exchange,
      exchangeAuthority,
      oracleProgram,
      price: 2000,
      wallet
    })
    ethPriceFeed = feed
    ethToken = token
    ethVaultReserve = await ethToken.createAccount(exchangeAuthority)
    ethVaultLiquidationFund = await ethToken.createAccount(exchangeAuthority)

    const liquidatorData = await createAccountWithCollateralAndMaxMintUsd({
      usdToken: xusdToken,
      collateralToken: snyToken,
      exchangeAuthority,
      exchange,
      reserveAddress: snyReserve,
      collateralTokenMintAuthority: CollateralTokenMinter.publicKey,
      amount: new BN(100000 * 10 ** SNY_DECIMALS) // give enough for liquidations
    })

    liquidator = liquidatorData.accountOwner
    liquidatorXusdAccount = liquidatorData.usdTokenAccount
    await connection.requestAirdrop(liquidator.publicKey, 10e9)
  })
  it('liquidation flow small vault', async () => {
    // create vault
    const assetsListData = await exchange.getAssetsList(assetsList)
    const xusd = assetsListData.synthetics[0]
    const eth = assetsListData.collaterals.find((c) =>
      c.collateralAddress.equals(ethToken.publicKey)
    )
    if (!eth) {
      throw new Error('eth not found')
    }
    const ethAsset = assetsListData.assets[eth.assetIndex]
    const xusdAsset = assetsListData.assets[xusd.assetIndex]

    const openFee = percentToDecimal(1)
    const debtInterestRate = toScale(percentToDecimal(0), INTEREST_RATE_DECIMALS) // zero interest for sake of tests
    const collateralRatio = percentToDecimal(80)
    const liquidationThreshold = percentToDecimal(85)
    const liquidationRatio = percentToDecimal(50)
    const liquidationPenaltyExchange = percentToDecimal(0)
    const liquidationPenaltyLiquidator = percentToDecimal(5)

    const maxBorrow = { val: new BN(1e14), scale: xusd.maxSupply.scale }

    const { ix: createVaultInstruction } = await exchange.createVaultInstruction({
      collateralReserve: ethVaultReserve,
      collateral: eth.collateralAddress,
      collateralPriceFeed: ethPriceFeed,
      liquidationFund: ethVaultLiquidationFund,
      synthetic: xusd.assetAddress,
      openFee,
      debtInterestRate,
      collateralRatio,
      maxBorrow,
      liquidationPenaltyExchange,
      liquidationPenaltyLiquidator,
      liquidationThreshold,
      liquidationRatio,
      oracleType: OracleType.Pyth,
      vaultType
    })
    await signAndSend(new Transaction().add(createVaultInstruction), [EXCHANGE_ADMIN], connection)
    // create vaultEntry
    const { ix: createVaultEntryInstruction } = await exchange.createVaultEntryInstruction({
      owner: accountOwner.publicKey,
      collateral: eth.collateralAddress,
      synthetic: xusd.assetAddress,
      vaultType
    })
    await signAndSend(
      new Transaction().add(createVaultEntryInstruction),
      [accountOwner],
      connection
    )
    // deposit collateral
    const userEthTokenAccount = await ethToken.createAccount(accountOwner.publicKey)
    // 2000 * 0.001 => 2 USD
    const collateralAmount = new BN(0.001 * 1e6) // 10 ETH
    await ethToken.mintTo(userEthTokenAccount, wallet, [], tou64(collateralAmount))

    await exchange.vaultDeposit({
      amount: collateralAmount,
      owner: accountOwner.publicKey,
      collateral: eth.collateralAddress,
      synthetic: xusd.assetAddress,
      userCollateralAccount: userEthTokenAccount,
      reserveAddress: ethVaultReserve,
      collateralToken: ethToken,
      signers: [accountOwner],
      vaultType
    })

    //  0.8 USD
    const borrowAmount = new BN(1 * 0.8 * 1e6) // 2000(ETH price) * 10(ETH amount) * 0.8(collateral ratio)
    const xusdTokenAmount = await xusdToken.createAccount(accountOwner.publicKey)

    // borrow xusd
    await exchange.borrowVault({
      amount: borrowAmount,
      owner: accountOwner.publicKey,
      to: xusdTokenAmount,
      collateral: eth.collateralAddress,
      collateralPriceFeed: ethPriceFeed,
      synthetic: xusd.assetAddress,
      signers: [accountOwner],
      vaultType
    })
    //liquidate
    const liquidatorCollateralAccount = await ethToken.createAccount(liquidator.publicKey)

    const liquidateVaultInstruction = await exchange.liquidateVaultInstruction({
      amount: U64_MAX,
      collateral: eth.collateralAddress,
      collateralReserve: ethVaultReserve,
      liquidationFund: ethVaultLiquidationFund,
      collateralPriceFeed: ethPriceFeed,
      synthetic: xusd.assetAddress,
      liquidator: liquidator.publicKey,
      liquidatorCollateralAccount,
      liquidatorSyntheticAccount: liquidatorXusdAccount,
      owner: accountOwner.publicKey,
      vaultType
    })
    const approveIx = Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      liquidatorXusdAccount,
      exchange.exchangeAuthority,
      liquidator.publicKey,
      [],
      tou64(U64_MAX)
    )
    // Fail liquidation for safe user
    await assertThrowsAsync(
      signAndSend(
        new Transaction().add(approveIx).add(liquidateVaultInstruction),
        [liquidator],
        connection
      ),
      ERRORS_EXCHANGE.INVALID_LIQUIDATION
    )
    // Change price of ETH from 2000 -> 900
    await setFeedPrice(oracleProgram, 900, ethPriceFeed)
    // Liquidate
    await signAndSend(
      new Transaction().add(approveIx).add(liquidateVaultInstruction),
      [liquidator],
      connection
    )
    // Post liquidation checks

    // Vault entry should adjust collateral and synthetic amounts
    const vaultEntryDataAfter = await exchange.getVaultEntryForOwner(
      xusd.assetAddress,
      eth.collateralAddress,
      accountOwner.publicKey,
      vaultType
    )
    assert.ok(vaultEntryDataAfter.syntheticAmount.val.eq(new BN(0)))
  })
})
