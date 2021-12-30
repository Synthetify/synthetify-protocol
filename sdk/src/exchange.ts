import { DEV_NET, Network, TEST_NET, MAIN_NET } from './network'
import { Exchange as ExchangeType, IDL } from './idl/exchange'
import { BN, Idl, Program, Provider, utils, Wallet } from '@project-serum/anchor'
import { IWallet } from '.'
import { calculateDebt, DEFAULT_PUBLIC_KEY, signAndSend, sleep, tou64 } from './utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  PublicKey,
  ConfirmOptions,
  Account,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmRawTransaction,
  Keypair
} from '@solana/web3.js'

export const STATE_SEED = 'statev1'
export class Exchange {
  connection: Connection
  network: Network
  wallet: IWallet
  programId: PublicKey
  exchangeAuthority: PublicKey
  program: Program<ExchangeType>
  state: ExchangeState
  opts?: ConfirmOptions
  assetsList: AssetsList
  stateAddress: PublicKey

  private constructor(
    connection: Connection,
    network: Network,
    wallet: IWallet,
    exchangeAuthority = PublicKey.default,
    programId = PublicKey.default,
    opts?: ConfirmOptions
  ) {
    this.stateAddress = PublicKey.default
    this.assetsList = {} as AssetsList
    this.state = {} as ExchangeState
    this.connection = connection
    this.network = network
    this.wallet = wallet
    this.opts = opts
    const provider = new Provider(connection, wallet, opts || Provider.defaultOptions())
    switch (network) {
      case Network.LOCAL:
        this.programId = programId
        this.exchangeAuthority = exchangeAuthority
        this.program = new Program<ExchangeType>(IDL, this.programId, provider)
        break
      case Network.DEV:
        this.programId = DEV_NET.exchange
        this.exchangeAuthority = DEV_NET.exchangeAuthority
        this.program = new Program<ExchangeType>(IDL, this.programId, provider)
        break
      case Network.TEST:
        this.programId = TEST_NET.exchange
        this.exchangeAuthority = TEST_NET.exchangeAuthority
        this.program = new Program<ExchangeType>(IDL, this.programId, provider)
        break
      case Network.MAIN:
        this.programId = MAIN_NET.exchange
        this.exchangeAuthority = MAIN_NET.exchangeAuthority
        this.program = new Program<ExchangeType>(IDL, this.programId, provider)
        break
      default:
        throw new Error('Not supported')
    }
  }
  public static async build(
    connection: Connection,
    network: Network,
    wallet: IWallet,
    exchangeAuthority?: PublicKey,
    programId?: PublicKey,
    opts?: ConfirmOptions
  ) {
    const instance = new Exchange(connection, network, wallet, exchangeAuthority, programId, opts)
    const [stateAddress, _] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode(STATE_SEED))],
      instance.program.programId
    )
    instance.stateAddress = stateAddress
    return instance
  }
  public onStateChange(fn: (state: ExchangeState) => void) {
    this.program.account.state.subscribe(this.stateAddress).on('change', (state: ExchangeState) => {
      fn(state)
    })
  }
  public onAccountChange(address: PublicKey, fn: (account: ExchangeAccount) => void) {
    this.program.account.exchangeAccount
      .subscribe(address, 'singleGossip')
      .on('change', (account: ExchangeAccount) => {
        fn(account)
      })
  }
  public onVaultChange(vault: PublicKey, fn: (account: Vault) => void) {
    this.program.account.vault.subscribe(vault, 'recent').on('change', (account: Vault) => {
      fn(account)
    })
  }
  public onVaultEntryChange(vaultEntry: PublicKey, fn: (account: VaultEntry) => void) {
    this.program.account.vaultEntry
      .subscribe(vaultEntry, 'recent')
      .on('change', (account: VaultEntry) => {
        fn(account)
      })
  }
  public async init({
    admin,
    nonce,
    amountPerRound,
    stakingRoundLength,
    stakingFundAccount,
    exchangeAuthority
  }: Init) {
    const [stateAddress, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode(STATE_SEED))],
      this.program.programId
    )

    await this.program.rpc.init(bump, nonce, stakingRoundLength, amountPerRound, {
      accounts: {
        state: stateAddress,
        admin: admin,
        stakingFundAccount: stakingFundAccount,
        payer: this.wallet.publicKey,
        exchangeAuthority: exchangeAuthority,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId
      }
    })
    this.stateAddress = stateAddress
  }
  public async setAssetsList({ exchangeAdmin, assetsList }: SetAssetsList) {
    await this.program.rpc.setAssetsList({
      accounts: {
        assetsList: assetsList,
        state: this.stateAddress,
        admin: exchangeAdmin.publicKey
      },
      signers: [exchangeAdmin]
    })
  }
  public async setAssetsListInstruction(assetsList: PublicKey) {
    return (await this.program.instruction.setAssetsList({
      accounts: {
        assetsList,
        state: this.stateAddress,
        admin: this.state.admin
      }
    })) as TransactionInstruction
  }
  public async getState() {
    const state = (await this.program.account.state.fetch(this.stateAddress)) as ExchangeState
    // need to add hooks on change
    this.state = state
    this.assetsList = await this.getAssetsList(this.state.assetsList)
    return state
  }
  public async getExchangeAccount(exchangeAccount: PublicKey) {
    const account = (await this.program.account.exchangeAccount.fetch(
      exchangeAccount
    )) as ExchangeAccount
    account.collaterals = account.collaterals.slice(0, account.head)
    return account
  }

  public async getSettlementAccountForSynthetic(synthetic: PublicKey) {
    const [settlement, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('settlement')), synthetic.toBuffer()],
      this.program.programId
    )
    const account = (await this.program.account.settlement.fetch(settlement)) as Settlement
    return account
  }
  public async getVaultAddress(synthetic: PublicKey, collateral: PublicKey, vaultType: number) {
    const vaultTypeBuffer = Buffer.alloc(1)
    vaultTypeBuffer.writeUInt8(vaultType)
    const [vaultAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('vaultv1')),
        synthetic.toBuffer(),
        collateral.toBuffer(),
        vaultTypeBuffer
      ],
      this.program.programId
    )
    return { vaultAddress, bump }
  }
  public async getVaultEntryAddress(
    synthetic: PublicKey,
    collateral: PublicKey,
    vaultType: number,
    owner: PublicKey
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const [vaultEntryAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('vault_entryv1')),
        owner.toBuffer(),
        vaultAddress.toBuffer()
      ],
      this.program.programId
    )
    return {
      vaultEntryAddress,
      bump
    }
  }
  public async getVaultForPair(synthetic: PublicKey, collateral: PublicKey, vaultType: number) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const account = (await this.program.account.vault.fetch(vaultAddress)) as Vault
    return account
  }
  public async getVaultEntryForOwner(
    synthetic: PublicKey,
    collateral: PublicKey,
    owner: PublicKey,
    vaultType: number
  ) {
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )
    const account = (await this.program.account.vaultEntry.fetch(vaultEntryAddress)) as VaultEntry
    return account
  }

  public async getUserCollateralBalance(exchangeAccount: PublicKey) {
    const userAccount = (await this.program.account.exchangeAccount.fetch(
      exchangeAccount
    )) as ExchangeAccount
    const snyCollateral = this.assetsList.collaterals[0]
    const collateralEntry = userAccount.collaterals.find((entry) =>
      entry.collateralAddress.equals(snyCollateral.collateralAddress)
    )
    if (collateralEntry) {
      return collateralEntry.amount
    } else {
      return new BN(0)
    }
  }
  public async getUserDebtBalance(exchangeAccount: PublicKey) {
    const userAccount = (await this.program.account.exchangeAccount.fetch(
      exchangeAccount
    )) as ExchangeAccount
    if (userAccount.debtShares.eq(new BN(0))) {
      return new BN(0)
    }
    const state = await this.getState()
    const debt = calculateDebt(this.assetsList)

    return userAccount.debtShares.mul(debt).div(state.debtShares)
  }
  public async createExchangeAccount(owner: PublicKey) {
    const [account, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('accountv1')), owner.toBuffer()],
      this.program.programId
    )
    await this.program.rpc.createExchangeAccount(bump, {
      accounts: {
        exchangeAccount: account,
        rent: SYSVAR_RENT_PUBKEY,
        admin: owner,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId
      }
    })
    return account
  }
  public async createSwaplineInstruction({
    collateral,
    collateralReserve,
    synthetic,
    limit
  }: CreateSwapline) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    const ix = await this.program.instruction.createSwapline(bump, limit, {
      accounts: {
        state: this.stateAddress,
        swapline: swaplineAddress,
        synthetic: synthetic,
        collateral: collateral,
        assetsList: this.state.assetsList,
        collateralReserve: collateralReserve,
        admin: this.state.admin,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId
      }
    })
    return { swaplineAddress, ix }
  }
  public async withdrawSwaplineFee({ collateral, synthetic, to, amount }: WithdrawSwaplineFee) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    const swapline = await this.getSwapline(swaplineAddress)
    const ix = await this.program.instruction.withdrawSwaplineFee(amount, {
      accounts: {
        state: this.stateAddress,
        swapline: swaplineAddress,
        synthetic: synthetic,
        collateral: collateral,
        to: to,
        collateralReserve: swapline.collateralReserve,
        admin: this.state.admin,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })
    return ix
  }
  public async setHaltedSwapline({ collateral, synthetic, halted }: SetHaltedSwapline) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    const ix = (await this.program.instruction.setHaltedSwapline(halted, {
      accounts: {
        state: this.stateAddress,
        swapline: swaplineAddress,
        synthetic: synthetic,
        collateral: collateral,
        admin: this.state.admin
      }
    })) as TransactionInstruction
    return ix
  }
  public async nativeToSynthetic({
    collateral,
    synthetic,
    signer,
    userCollateralAccount,
    userSyntheticAccount,
    amount
  }: UseSwapline) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    const swapline = await this.getSwapline(swaplineAddress)
    const ix = await this.program.instruction.nativeToSynthetic(amount, {
      accounts: {
        state: this.stateAddress,
        swapline: swaplineAddress,
        synthetic: synthetic,
        collateral: collateral,
        userCollateralAccount: userCollateralAccount,
        userSyntheticAccount: userSyntheticAccount,
        assetsList: this.state.assetsList,
        collateralReserve: swapline.collateralReserve,
        signer: signer,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })
    return ix
  }
  public async syntheticToNative({
    collateral,
    synthetic,
    signer,
    userCollateralAccount,
    userSyntheticAccount,
    amount
  }: UseSwapline) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    const swapline = await this.getSwapline(swaplineAddress)
    const ix = await this.program.instruction.syntheticToNative(amount, {
      accounts: {
        state: this.stateAddress,
        swapline: swaplineAddress,
        synthetic: synthetic,
        collateral: collateral,
        userCollateralAccount: userCollateralAccount,
        userSyntheticAccount: userSyntheticAccount,
        assetsList: this.state.assetsList,
        collateralReserve: swapline.collateralReserve,
        signer: signer,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })
    return ix
  }
  public async getSwapline(swapline: PublicKey) {
    const swaplineData = (await this.program.account.swapline.fetch(swapline)) as Swapline
    return swaplineData
  }
  public async getSwaplineAddress(synthetic: PublicKey, collateral: PublicKey) {
    const [swaplineAddress, bump] = await PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('swaplinev1')),
        synthetic.toBuffer(),
        collateral.toBuffer()
      ],
      this.program.programId
    )
    return { swaplineAddress, bump }
  }
  public async createExchangeAccountInstruction(owner: PublicKey) {
    const [account, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('accountv1')), owner.toBuffer()],
      this.program.programId
    )
    const ix = (await this.program.instruction.createExchangeAccount(bump, {
      accounts: {
        exchangeAccount: account,
        rent: SYSVAR_RENT_PUBKEY,
        admin: owner,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId
      }
    })) as TransactionInstruction
    return { account, ix }
  }
  public async getExchangeAccountAddress(owner: PublicKey) {
    const [account, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('accountv1')), owner.toBuffer()],
      this.program.programId
    )
    return account
  }

  public async depositInstruction({
    amount,
    exchangeAccount,
    userCollateralAccount,
    owner,
    reserveAddress
  }: DepositInstruction) {
    return (await this.program.instruction.deposit(amount, {
      accounts: {
        state: this.stateAddress,
        owner: owner,
        exchangeAccount: exchangeAccount,
        userCollateralAccount: userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAuthority: this.exchangeAuthority,
        reserveAddress: reserveAddress,
        assetsList: this.state.assetsList
      }
    })) as TransactionInstruction
  }
  public async withdrawInstruction({
    amount,
    exchangeAccount,
    owner,
    userCollateralAccount,
    reserveAccount
  }: WithdrawInstruction) {
    return await (this.program.instruction.withdraw(amount, {
      accounts: {
        state: this.stateAddress,
        assetsList: this.state.assetsList,
        exchangeAuthority: this.exchangeAuthority,
        reserveAccount,
        userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        owner: owner,
        exchangeAccount: exchangeAccount
      }
    }) as TransactionInstruction)
  }
  public async mintInstruction({ amount, exchangeAccount, owner, to }: MintInstruction) {
    return await (this.program.instruction.mint(amount, {
      accounts: {
        state: this.stateAddress,
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction)
  }

  public async swapInstruction({
    amount,
    owner,
    tokenFor,
    tokenIn,
    userTokenAccountFor,
    userTokenAccountIn,
    exchangeAccount
  }: SwapInstruction) {
    const remainingAccounts = exchangeAccount
      ? [{ pubkey: exchangeAccount, isWritable: false, isSigner: false }]
      : []

    return this.program.instruction.swap(amount, {
      remainingAccounts,
      accounts: {
        state: this.stateAddress,
        exchangeAuthority: this.exchangeAuthority,
        tokenFor: tokenFor,
        tokenIn: tokenIn,
        userTokenAccountFor: userTokenAccountFor,
        userTokenAccountIn: userTokenAccountIn,
        tokenProgram: TOKEN_PROGRAM_ID,
        owner: owner,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction
  }
  public async liquidateInstruction({
    exchangeAccount,
    signer,
    liquidationFund,
    liquidatorCollateralAccount,
    liquidatorUsdAccount,
    reserveAccount,
    amount
  }: LiquidateInstruction) {
    return await (this.program.instruction.liquidate(amount, {
      accounts: {
        state: this.stateAddress,
        exchangeAuthority: this.exchangeAuthority,
        assetsList: this.state.assetsList,
        tokenProgram: TOKEN_PROGRAM_ID,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        liquidatorUsdAccount: liquidatorUsdAccount,
        liquidatorCollateralAccount: liquidatorCollateralAccount,
        exchangeAccount: exchangeAccount,
        signer: signer,
        liquidationFund: liquidationFund,
        reserveAccount: reserveAccount
      }
    }) as TransactionInstruction)
  }
  public async burnInstruction({
    amount,
    exchangeAccount,
    owner,
    userTokenAccountBurn
  }: BurnInstruction) {
    return await (this.program.instruction.burn(amount, {
      accounts: {
        state: this.stateAddress,
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        userTokenAccountBurn: userTokenAccountBurn,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction)
  }
  public async claimRewardsInstruction(exchangeAccount: PublicKey) {
    return await (this.program.instruction.claimRewards({
      accounts: {
        state: this.stateAddress,
        exchangeAccount: exchangeAccount
      }
    }) as TransactionInstruction)
  }
  public async withdrawRewardsInstruction({
    exchangeAccount,
    owner,
    userTokenAccount
  }: WithdrawRewardsInstruction) {
    return await (this.program.instruction.withdrawRewards({
      accounts: {
        state: this.stateAddress,
        exchangeAccount: exchangeAccount,
        exchangeAuthority: this.exchangeAuthority,
        owner: owner,
        tokenProgram: TOKEN_PROGRAM_ID,
        userTokenAccount: userTokenAccount,
        stakingFundAccount: this.state.staking.fundAccount
      }
    }) as TransactionInstruction)
  }
  public async checkAccountInstruction(exchangeAccount: PublicKey) {
    return await (this.program.instruction.checkAccountCollateralization({
      accounts: {
        state: this.stateAddress,
        exchangeAccount: exchangeAccount,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationBufferInstruction(newLiquidationBuffer: number) {
    return await (this.program.instruction.setLiquidationBuffer(newLiquidationBuffer, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationRateInstruction(newLiquidationRate: Decimal) {
    return await (this.program.instruction.setLiquidationRate(newLiquidationRate, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setFeeInstruction(newFee: Decimal) {
    return await (this.program.instruction.setFee(newFee, {
      accounts: {
        state: this.stateAddress,

        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setMaxDelayInstruction(newMaxDelay: number) {
    return await (this.program.instruction.setMaxDelay(newMaxDelay, {
      accounts: {
        state: this.stateAddress,

        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setHaltedInstruction(halted: boolean) {
    return await (this.program.instruction.setHalted(halted, {
      accounts: {
        state: this.stateAddress,

        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setHealthFactorInstruction(percentage: Decimal) {
    return await (this.program.instruction.setHealthFactor(percentage, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setStakingAmountPerRound(amount: Decimal) {
    return await (this.program.instruction.setStakingAmountPerRound(amount, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setStakingRoundLength(length: number) {
    return await (this.program.instruction.setStakingRoundLength(length, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setCollateralRatio(collateralAddress: PublicKey, newRatio: Decimal) {
    return await (this.program.instruction.setCollateralRatio(newRatio, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        assetsList: this.state.assetsList,
        collateralAddress: collateralAddress
      }
    }) as TransactionInstruction)
  }
  public async setMaxCollateral(collateralAddress: PublicKey, newMaxCollateral: Decimal) {
    return await (this.program.instruction.setMaxCollateral(newMaxCollateral, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        assetsList: this.state.assetsList,
        collateralAddress: collateralAddress
      }
    }) as TransactionInstruction)
  }
  public async setAdmin(newAdmin: PublicKey) {
    return await (this.program.instruction.setAdmin({
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        newAdmin: newAdmin
      }
    }) as TransactionInstruction)
  }
  public async setSettlementSlotInstruction(syntheticAddress: PublicKey, newSettlementSlot: BN) {
    return await (this.program.instruction.setSettlementSlot(newSettlementSlot, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        assetsList: this.state.assetsList,
        syntheticAddress: syntheticAddress
      }
    }) as TransactionInstruction)
  }
  public async settleSynthetic({
    payer,
    settlementReserve,
    tokenToSettle
  }: SettleSyntheticInstruction) {
    const assetsList = await this.getAssetsList(this.state.assetsList)
    const synthetic = assetsList.synthetics.find((s) =>
      s.assetAddress.equals(tokenToSettle)
    ) as Synthetic
    const feedAddress = assetsList.assets[synthetic.assetIndex].feedAddress
    const priceFeed = { pubkey: feedAddress, isWritable: false, isSigner: false }

    const oracleUpdateIx = (await this.program.instruction.setAssetsPrices({
      remainingAccounts: [priceFeed],
      accounts: {
        assetsList: this.state.assetsList
      }
    })) as TransactionInstruction

    const [settlement, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('settlement')), tokenToSettle.toBuffer()],
      this.program.programId
    )
    const settleIx = this.program.instruction.settleSynthetic(bump, {
      accounts: {
        settlement: settlement,
        state: this.stateAddress,
        assetsList: this.state.assetsList,
        payer: payer,
        tokenToSettle: tokenToSettle,
        settlementReserve: settlementReserve,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        rent: SYSVAR_RENT_PUBKEY,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      }
    }) as TransactionInstruction
    return { oracleUpdateIx, settleIx, settlement }
  }
  public async swapSettledSyntheticInstruction({
    tokenToSettle,
    userSettledTokenAccount,
    userUsdAccount,
    amount,
    signer
  }: SwapSettledSyntheticInstruction) {
    const settlement = await this.getSettlementAccountForSynthetic(tokenToSettle)
    const [settlementAddress, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode('settlement')), tokenToSettle.toBuffer()],
      this.program.programId
    )
    const ix = this.program.instruction.swapSettledSynthetic(amount, {
      accounts: {
        settlement: settlementAddress,
        state: this.stateAddress,
        tokenToSettle: tokenToSettle,
        userSettledTokenAccount: userSettledTokenAccount,
        userUsdAccount: userUsdAccount,
        settlementReserve: settlement.reserveAddress,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        signer: signer
      }
    }) as TransactionInstruction
    return ix
  }
  public async setSwapTaxRatioInstruction(swapTaxRatio: Decimal) {
    return await (this.program.instruction.setSwapTaxRatio(swapTaxRatio, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setDebtInterestRateInstruction(debtInterestRate: Decimal) {
    return await (this.program.instruction.setDebtInterestRate(debtInterestRate, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  private async processOperations(txs: Transaction[]) {
    const blockhash = await this.connection.getRecentBlockhash(
      this.opts?.commitment || Provider.defaultOptions().commitment
    )
    txs.forEach((tx) => {
      tx.feePayer = this.wallet.publicKey
      tx.recentBlockhash = blockhash.blockhash
    })
    await this.wallet.signAllTransactions(txs)
    return txs
  }
  private async updatePricesAndSend(ixs: TransactionInstruction[], signers, split?: boolean) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)

    if (!split) {
      let tx = new Transaction().add(updateIx)
      ixs.forEach((ix) => tx.add(ix))

      const txs = await this.processOperations([tx])
      if (signers) txs[0].partialSign(...signers)
      return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
    } else {
      let tx = new Transaction()
      ixs.forEach((ix) => tx.add(ix))

      const txs = await this.processOperations([new Transaction().add(updateIx), tx])
      if (signers) txs[1].partialSign(...signers)
      sendAndConfirmRawTransaction(this.connection, txs[0].serialize(), {
        skipPreflight: true
      })
      await sleep(100)
      return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
        skipPreflight: true
      })
    }
  }

  public async checkAccount(exchangeAccount: PublicKey) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const checkIx = await this.checkAccountInstruction(exchangeAccount)

    const checkTx = new Transaction().add(updateIx).add(checkIx)
    const txs = await this.processOperations([checkTx])

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async liquidate({
    exchangeAccount,
    signer,
    signers,
    liquidationFund,
    liquidatorCollateralAccount,
    liquidatorUsdAccount,
    reserveAccount,
    amount
  }: Liquidate) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const liquidateIx = await this.liquidateInstruction({
      exchangeAccount,
      signer,
      liquidationFund,
      liquidatorCollateralAccount,
      liquidatorUsdAccount,
      reserveAccount,
      amount
    })
    const approveIx = await Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      liquidatorUsdAccount,
      this.exchangeAuthority,
      signer,
      [],
      tou64(amount)
    )
    const liquidateTx = new Transaction().add(updateIx).add(approveIx).add(liquidateIx)
    const txs = await this.processOperations([liquidateTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async swap({
    amount,
    owner,
    tokenFor,
    tokenIn,
    userTokenAccountFor,
    userTokenAccountIn,
    signers,
    exchangeAccount
  }: Swap) {
    await this.getState()
    const swapIx = await this.swapInstruction({
      amount,
      exchangeAccount,
      owner,
      tokenFor,
      tokenIn,
      userTokenAccountFor,
      userTokenAccountIn
    })
    const approveIx = await Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      userTokenAccountIn,
      this.exchangeAuthority,
      owner,
      [],
      tou64(amount)
    )
    return this.updatePricesAndSend([approveIx, swapIx], signers, this.assetsList.headAssets >= 20)
  }
  public async burn({ amount, exchangeAccount, owner, userTokenAccountBurn, signers }: Burn) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const burnIx = await this.burnInstruction({
      amount,
      exchangeAccount,
      owner,
      userTokenAccountBurn
    })
    const approveIx = await Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      userTokenAccountBurn,
      this.exchangeAuthority,
      owner,
      [],
      tou64(amount)
    )
    const burnTx = new Transaction().add(updateIx).add(approveIx).add(burnIx)
    const txs = await this.processOperations([burnTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async mint({ amount, exchangeAccount, owner, to, signers }: Mint) {
    const mintIx = await this.mintInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    await this.getState()
    return await this.updatePricesAndSend([mintIx], signers, this.assetsList.headAssets >= 20)
  }
  public async deposit({
    amount,
    exchangeAccount,
    owner,
    userCollateralAccount,
    reserveAccount,
    collateralToken,
    exchangeAuthority,
    signers
  }: Deposit) {
    const depositIx = await this.depositInstruction({
      amount,
      exchangeAccount,
      userCollateralAccount,
      owner,
      reserveAddress: reserveAccount
    })
    const approveIx = Token.createApproveInstruction(
      collateralToken.programId,
      userCollateralAccount,
      exchangeAuthority,
      owner,
      [],
      tou64(amount)
    )
    await signAndSend(new Transaction().add(approveIx).add(depositIx), signers, this.connection)
  }
  public async withdraw({
    amount,
    exchangeAccount,
    owner,
    userCollateralAccount,
    signers,
    reserveAccount
  }: Withdraw) {
    const withdrawIx = await this.withdrawInstruction({
      reserveAccount,
      amount,
      exchangeAccount,
      owner,
      userCollateralAccount
    })
    await this.getState()
    return this.updatePricesAndSend([withdrawIx], signers, this.assetsList.headAssets >= 20)
  }

  public async withdrawRewards({
    exchangeAccount,
    owner,
    signers,
    userTokenAccount
  }: WithdrawRewards) {
    const withdrawIx = await this.withdrawRewardsInstruction({
      userTokenAccount,
      exchangeAccount,
      owner
    })
    const withdrawTx = new Transaction().add(withdrawIx)
    const txs = await this.processOperations([withdrawTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async claimRewards(exchangeAccount: PublicKey) {
    const claimRewardsIx = await this.claimRewardsInstruction(exchangeAccount)
    const tx = new Transaction().add(claimRewardsIx)
    const txs = await this.processOperations([tx])
    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }

  // Asset list
  public async getAssetsList(assetsList: PublicKey): Promise<AssetsList> {
    const assetList = (await this.program.account.assetsList.fetch(
      assetsList
    )) as unknown as AssetsList
    assetList.assets = assetList.assets.slice(0, assetList.headAssets)
    assetList.collaterals = assetList.collaterals.slice(0, assetList.headCollaterals)
    assetList.synthetics = assetList.synthetics.slice(0, assetList.headSynthetics)
    return assetList
  }
  public onAssetsListChange(address: PublicKey, fn: (list: AssetsList) => void) {
    this.program.account.assetsList
      .subscribe(address, 'singleGossip')
      .on('change', (list: AssetsList) => {
        fn(list)
      })
  }

  public async setPriceFeedInstruction({
    assetsList,
    priceFeed,
    oldPriceFeed
  }: SetPriceFeedInstruction) {
    return (await this.program.instruction.setPriceFeed(oldPriceFeed, {
      accounts: {
        state: this.stateAddress,
        signer: this.state.admin,
        assetsList: assetsList,
        priceFeed: priceFeed
      }
    })) as TransactionInstruction
  }

  public async setLiquidationPenaltiesInstruction({
    penaltyToExchange,
    penaltyToLiquidator
  }: SetLiquidationPenaltiesInstruction) {
    return (await this.program.instruction.setLiquidationPenalties(
      penaltyToExchange,
      penaltyToLiquidator,
      {
        accounts: {
          state: this.stateAddress,
          admin: this.state.admin
        }
      }
    )) as TransactionInstruction
  }

  public async addSyntheticInstruction({
    assetsList,
    assetAddress,
    priceFeed,
    maxSupply
  }: AddSyntheticInstruction) {
    return (await this.program.instruction.addSynthetic(maxSupply, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        assetsList,
        assetAddress: assetAddress,
        feedAddress: priceFeed
      }
    })) as TransactionInstruction
  }

  public async initializeAssetsList({
    admin,
    collateralToken,
    collateralTokenFeed,
    usdToken,
    snyLiquidationFund,
    snyReserve
  }: InitializeAssetList) {
    const assetListAccount = Keypair.generate()
    await this.program.rpc.createList({
      accounts: {
        collateralToken,
        collateralTokenFeed,
        usdToken,
        admin: admin.publicKey,
        state: this.stateAddress,
        assetsList: assetListAccount.publicKey,
        snyReserve: snyReserve,
        snyLiquidationFund: snyLiquidationFund,
        exchangeAuthority: this.exchangeAuthority,
        rent: SYSVAR_RENT_PUBKEY
      },
      signers: [admin, assetListAccount],
      instructions: [await this.program.account.assetsList.createInstruction(assetListAccount)]
    })
    return assetListAccount.publicKey
  }

  public async setAssetMaxSupply({
    assetsList,
    exchangeAdmin,
    assetAddress,
    newMaxSupply
  }: SetAssetMaxSupply) {
    return await this.program.rpc.setMaxSupply(assetAddress, newMaxSupply, {
      accounts: {
        state: this.stateAddress,
        signer: exchangeAdmin.publicKey,
        assetsList: assetsList
      },
      signers: [exchangeAdmin]
    })
  }
  public async setAssetMaxSupplyInstruction({
    assetAddress,
    newMaxSupply
  }: SetAssetMaxSupplyInstruction) {
    return await this.program.instruction.setMaxSupply(assetAddress, newMaxSupply, {
      accounts: {
        state: this.stateAddress,
        signer: this.state.admin,
        assetsList: this.state.assetsList
      }
    })
  }
  public async addNewAssetInstruction({ assetsList, assetFeedAddress }: AddNewAssetInstruction) {
    return (await this.program.instruction.addNewAsset(assetFeedAddress, {
      accounts: {
        state: this.stateAddress,
        signer: this.state.admin,
        assetsList
      }
    })) as TransactionInstruction
  }
  public async withdrawSwapTaxInstruction({ amount, to }: AdminWithdraw) {
    return (await this.program.instruction.withdrawSwapTax(amount, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        exchangeAuthority: this.exchangeAuthority,
        assetsList: this.state.assetsList,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })) as TransactionInstruction
  }
  public async withdrawAccumulatedDebtInterestInstruction({ amount, to }: AdminWithdraw) {
    return (await this.program.instruction.withdrawAccumulatedDebtInterest(amount, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin,
        exchangeAuthority: this.exchangeAuthority,
        assetsList: this.state.assetsList,
        usdToken: this.assetsList.synthetics[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })) as TransactionInstruction
  }
  public async addCollateralInstruction({
    assetsList,
    assetAddress,
    liquidationFund,
    reserveAccount,
    feedAddress,
    collateralRatio,
    reserveBalance,
    maxCollateral
  }: AddCollateralInstruction) {
    return (await this.program.instruction.addCollateral(
      reserveBalance,
      maxCollateral,
      collateralRatio,
      {
        accounts: {
          admin: this.state.admin,
          state: this.stateAddress,
          assetsList,
          assetAddress,
          liquidationFund,
          feedAddress,
          reserveAccount
        }
      }
    )) as TransactionInstruction
  }
  public async createVaultInstruction({
    synthetic,
    collateral,
    collateralReserve,
    collateralPriceFeed,
    liquidationFund,
    openFee,
    debtInterestRate,
    collateralRatio,
    maxBorrow,
    liquidationThreshold,
    liquidationPenaltyLiquidator,
    liquidationPenaltyExchange,
    liquidationRatio,
    oracleType,
    vaultType
  }: CreateVault) {
    const { vaultAddress, bump } = await this.getVaultAddress(synthetic, collateral, vaultType)

    const ix = this.program.instruction.createVault(
      bump,
      vaultType,
      openFee,
      debtInterestRate,
      collateralRatio,
      maxBorrow,
      liquidationThreshold,
      liquidationPenaltyLiquidator,
      liquidationPenaltyExchange,
      liquidationRatio,
      oracleType,
      {
        accounts: {
          vault: vaultAddress,
          admin: this.state.admin,
          assetsList: this.state.assetsList,
          state: this.stateAddress,
          collateralReserve: collateralReserve,
          synthetic: synthetic,
          collateral: collateral,
          liquidationFund,
          collateralPriceFeed,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId
        }
      }
    )
    return { ix, vaultAddress }
  }
  public async createVaultEntryInstruction({
    owner,
    synthetic,
    collateral,
    vaultType
  }: CreateVaultEntry) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress, bump } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    const ix = this.program.instruction.createVaultEntry(bump, {
      accounts: {
        owner: owner,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        state: this.stateAddress,
        assetsList: this.state.assetsList,
        synthetic: synthetic,
        collateral: collateral,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId
      }
    })
    return { ix, vaultEntryAddress }
  }
  public async vaultDepositInstruction({
    owner,
    synthetic,
    collateral,
    userCollateralAccount,
    reserveAddress,
    amount,
    vaultType
  }: VaultDepositInstruction) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    return this.program.instruction.depositVault(amount, {
      accounts: {
        synthetic,
        collateral,
        reserveAddress,
        userCollateralAccount,
        owner,
        state: this.stateAddress,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
        assetsList: this.state.assetsList,
        exchangeAuthority: this.exchangeAuthority
      }
    }) as TransactionInstruction
  }
  public async vaultDepositTransaction(vaultDepositInstruction: DepositVaultTransaction) {
    const {
      owner,
      synthetic,
      collateral,
      userCollateralAccount,
      reserveAddress,
      amount,
      collateralToken,
      vaultType
    } = vaultDepositInstruction
    const depositVaultIx = await this.vaultDepositInstruction({
      owner,
      synthetic,
      collateral,
      userCollateralAccount,
      reserveAddress,
      amount,
      vaultType
    })
    const approveIx = Token.createApproveInstruction(
      collateralToken.programId,
      userCollateralAccount,
      this.exchangeAuthority,
      owner,
      [],
      tou64(amount)
    )
    return new Transaction().add(approveIx).add(depositVaultIx)
  }

  public async vaultDeposit(depositVault: DepositVault) {
    const tx = await this.vaultDepositTransaction(depositVault)
    await signAndSend(tx, depositVault.signers, this.connection)
  }
  public async borrowVaultInstruction({
    owner,
    to,
    synthetic,
    collateral,
    collateralPriceFeed,
    amount,
    vaultType
  }: BorrowVaultInstruction) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    return this.program.instruction.borrowVault(amount, {
      accounts: {
        synthetic,
        collateral,
        collateralPriceFeed,
        owner,
        to,
        state: this.stateAddress,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
        assetsList: this.state.assetsList,
        exchangeAuthority: this.exchangeAuthority
      }
    }) as TransactionInstruction
  }
  public async liquidateVaultInstruction({
    owner,
    synthetic,
    collateral,
    collateralReserve,
    liquidationFund,
    collateralPriceFeed,
    amount,
    liquidator,
    liquidatorCollateralAccount,
    liquidatorSyntheticAccount,
    vaultType
  }: LiquidateVaultInstruction) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    return this.program.instruction.liquidateVault(amount, {
      accounts: {
        state: this.stateAddress,
        assetsList: this.state.assetsList,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        collateralReserve,
        liquidationFund,
        synthetic,
        collateral,
        collateralPriceFeed,
        liquidatorSyntheticAccount,
        liquidatorCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        owner,
        liquidator,
        exchangeAuthority: this.exchangeAuthority
      }
    }) as TransactionInstruction
  }
  public async updateVaultSyntheticPriceIx(
    synthetic: PublicKey
  ): Promise<TransactionInstruction | null> {
    const syntheticStructure = this.assetsList.synthetics.find((s) =>
      s.assetAddress.equals(synthetic)
    ) as Synthetic
    const syntheticFeedAddress = this.assetsList.assets[syntheticStructure.assetIndex].feedAddress

    if (syntheticFeedAddress.equals(PublicKey.default)) {
      return null
    }
    const updateSyntheticPriceIx = await this.updateSelectedPricesInstruction(
      this.state.assetsList,
      [syntheticFeedAddress]
    )
    return updateSyntheticPriceIx
  }

  public async borrowVaultTransaction(borrowVaultInstruction: BorrowVaultInstruction) {
    const tx = new Transaction()
    const updatePriceIx = await this.updateVaultSyntheticPriceIx(borrowVaultInstruction.synthetic)
    if (updatePriceIx !== null) {
      tx.add(updatePriceIx)
    }
    const borrowIx = await this.borrowVaultInstruction(borrowVaultInstruction)
    tx.add(borrowIx)

    return tx
  }
  public async borrowVault(borrowVault: BorrowVault) {
    const tx = await this.borrowVaultTransaction(borrowVault)
    return await signAndSend(tx, borrowVault.signers, this.connection)
  }
  public async withdrawVaultInstruction({
    amount,
    owner,
    collateral,
    reserveAddress,
    collateralPriceFeed,
    synthetic,
    userCollateralAccount,
    vaultType
  }: WithdrawVaultInstruction) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    const ix = this.program.instruction.withdrawVault(amount, {
      accounts: {
        userCollateralAccount,
        owner,
        collateral,
        collateralPriceFeed,
        synthetic,
        state: this.stateAddress,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        reserveAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
        assetsList: this.state.assetsList,
        exchangeAuthority: this.exchangeAuthority
      }
    })

    return ix
  }
  public async withdrawVaultTransaction(withdrawVaultTransaction: WithdrawVaultInstruction) {
    const tx = new Transaction()
    const updatePriceIx = await this.updateVaultSyntheticPriceIx(withdrawVaultTransaction.synthetic)
    if (updatePriceIx !== null) {
      tx.add(updatePriceIx)
    }
    const withdrawVaultIx = await this.withdrawVaultInstruction(withdrawVaultTransaction)
    tx.add(withdrawVaultIx)

    return tx
  }
  public async repayVaultInstruction({
    amount,
    owner,
    synthetic,
    collateral,
    userTokenAccountRepay,
    vaultType
  }: RepayVaultInstruction) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    const ix = this.program.instruction.repayVault(amount, {
      accounts: {
        owner,
        synthetic,
        collateral,
        userTokenAccountRepay,
        state: this.stateAddress,
        vaultEntry: vaultEntryAddress,
        vault: vaultAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
        assetsList: this.state.assetsList,
        exchangeAuthority: this.exchangeAuthority
      }
    })

    return ix
  }
  public async repayVaultTransaction(repayVaultInstruction: RepayVaultInstruction) {
    const { amount, owner, synthetic, collateral, userTokenAccountRepay } = repayVaultInstruction

    const approveIx = Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      userTokenAccountRepay,
      this.exchangeAuthority,
      owner,
      [],
      tou64(amount)
    )
    const repayIx = await this.repayVaultInstruction(repayVaultInstruction)

    return new Transaction().add(approveIx).add(repayIx)
  }
  public async repayVault(repayVault: RepayVault) {
    const tx = await this.repayVaultTransaction(repayVault)

    await signAndSend(tx, repayVault.signers, this.connection)
  }
  public async setVaultHaltedInstruction({
    halted,
    collateral,
    synthetic,
    vaultType
  }: SetVaultHalted) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    const ix = this.program.instruction.setVaultHalted(halted, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress,
        assetsList: this.state.assetsList,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    })

    return ix
  }
  public async setVaultDebtInterestRateInstruction(
    debtInterestRate: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ): Promise<TransactionInstruction> {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultDebtInterestRate(debtInterestRate, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress
      }
    }) as TransactionInstruction
  }
  public async setVaultLiquidationThresholdInstruction(
    liquidationThreshold: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultLiquidationThreshold(liquidationThreshold, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress
      }
    }) as TransactionInstruction
  }
  public async setVaultSetLiquidationRatioInstruction(
    liquidationRatio: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultSetLiquidationRatio(liquidationRatio, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress
      }
    }) as TransactionInstruction
  }
  public async setVaultLiquidationPenaltyLiquidatorInstruction(
    liquidationPenaltyLiquidator: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultLiquidationPenaltyLiquidator(
      liquidationPenaltyLiquidator,
      {
        accounts: {
          synthetic,
          collateral,
          state: this.stateAddress,
          admin: this.state.admin,
          vault: vaultAddress
        }
      }
    ) as TransactionInstruction
  }
  public async setVaultLiquidationPenaltyExchangeInstruction(
    liquidationPenaltyExchange: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultLiquidationPenaltyExchange(liquidationPenaltyExchange, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress
      }
    }) as TransactionInstruction
  }
  public async setVaultMaxBorrowInstruction(
    maxBorrow: Decimal,
    { synthetic, collateral, vaultType }: SetVaultParameter
  ) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.setVaultMaxBorrow(maxBorrow, {
      accounts: {
        synthetic,
        collateral,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress
      }
    }) as TransactionInstruction
  }
  public async withdrawVaultAccumulatedInterestInstruction({
    synthetic,
    collateral,
    to,
    amount,
    vaultType
  }: WithdrawVaultAccumulatedInterest) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.withdrawVaultAccumulatedInterest(amount, {
      accounts: {
        synthetic,
        collateral,
        to,
        assetsList: this.state.assetsList,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    }) as TransactionInstruction
  }
  public async withdrawVaultLiquidationPenaltyInstruction({
    synthetic,
    collateral,
    liquidationFund,
    to,
    amount,
    vaultType
  }: WithdrawVaultLiquidationPenalty) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)

    return this.program.instruction.withdrawVaultLiquidationPenalty(amount, {
      accounts: {
        synthetic,
        collateral,
        to,
        liquidationFund,
        state: this.stateAddress,
        admin: this.state.admin,
        vault: vaultAddress,
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID
      }
    }) as TransactionInstruction
  }

  public async updatePrices(assetsList: PublicKey) {
    const assetsListData = await this.getAssetsList(assetsList)
    const feedAddresses = assetsListData.assets
      .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
      .map((asset) => {
        return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
      })
    return await this.program.rpc.setAssetsPrices({
      remainingAccounts: feedAddresses,
      accounts: {
        assetsList: assetsList
      }
    })
  }
  public async updatePricesInstruction(assetsList: PublicKey) {
    const assetsListData = await this.getAssetsList(assetsList)
    const feedAddresses = assetsListData.assets
      .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
      .map((asset) => {
        return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
      })
    return (await this.program.instruction.setAssetsPrices({
      remainingAccounts: feedAddresses,
      accounts: {
        assetsList: assetsList
      }
    })) as TransactionInstruction
  }
  public async updateSelectedPricesInstruction(assetsList: PublicKey, selectedAssets: PublicKey[]) {
    const feedAddresses = selectedAssets.map((feedAddress) => {
      return { pubkey: feedAddress, isWritable: false, isSigner: false }
    })
    return (await this.program.instruction.setAssetsPrices({
      remainingAccounts: feedAddresses,
      accounts: {
        assetsList: assetsList
      }
    })) as TransactionInstruction
  }
  public async triggerVaultEntryDebtAdjustmentInstruction({
    synthetic,
    collateral,
    owner,
    vaultType
  }: VaultEntryId) {
    const { vaultAddress } = await this.getVaultAddress(synthetic, collateral, vaultType)
    const { vaultEntryAddress } = await this.getVaultEntryAddress(
      synthetic,
      collateral,
      vaultType,
      owner
    )

    return (await this.program.instruction.triggerVaultEntryDebtAdjustment({
      accounts: {
        synthetic,
        collateral,
        owner,
        admin: this.state.admin,
        state: this.stateAddress,
        vault: vaultAddress,
        vaultEntry: vaultEntryAddress,
        assetsList: this.state.assetsList
      }
    })) as TransactionInstruction
  }
}
export interface InitializeAssetList {
  admin: Keypair | Account
  collateralToken: PublicKey
  collateralTokenFeed: PublicKey
  usdToken: PublicKey
  snyReserve: PublicKey
  snyLiquidationFund: PublicKey
}
export interface SetAssetsList {
  assetsList: PublicKey
  exchangeAdmin: Keypair | Account
}
export enum PriceStatus {
  Unknown = 0,
  Trading = 1,
  Halted = 2,
  Auction = 3
}
export interface Asset {
  feedAddress: PublicKey
  price: Decimal
  lastUpdate: BN
  confidence: Decimal
  twap: Decimal
  twac: Decimal
  status: PriceStatus
}
export interface AssetsList {
  initialized: boolean
  headAssets: number
  headCollaterals: number
  headSynthetics: number
  assets: Array<Asset>
  collaterals: Array<Collateral>
  synthetics: Array<Synthetic>
}
export interface Collateral {
  assetIndex: number
  collateralAddress: PublicKey
  reserveAddress: PublicKey
  liquidationFund: PublicKey
  reserveBalance: Decimal
  collateralRatio: Decimal
  maxCollateral: Decimal
}
export interface Synthetic {
  assetIndex: number
  assetAddress: PublicKey
  supply: Decimal
  maxSupply: Decimal
  borrowedSupply: Decimal
  swaplineSupply: Decimal
  settlementSlot: BN
}

export interface SetAssetSupply {
  assetIndex: number
  assetsList: PublicKey
  newSupply: BN
}
export interface SetAssetMaxSupply {
  assetAddress: PublicKey
  assetsList: PublicKey
  exchangeAdmin: Account
  newMaxSupply: Decimal
}
export interface SetAssetMaxSupplyInstruction {
  assetAddress: PublicKey
  newMaxSupply: Decimal
}
export interface AddNewAssetInstruction {
  assetsList: PublicKey
  assetFeedAddress: PublicKey
}
export interface AdminWithdraw {
  amount: BN
  to: PublicKey
}
export interface SetPriceFeedInstruction {
  assetsList: PublicKey
  priceFeed: PublicKey
  oldPriceFeed: PublicKey
}

export interface SetLiquidationPenaltiesInstruction {
  penaltyToExchange: Decimal
  penaltyToLiquidator: Decimal
}

export interface AddSyntheticInstruction {
  assetAddress: PublicKey
  assetsList: PublicKey
  priceFeed: PublicKey
  maxSupply: BN
}
export interface AddCollateralInstruction {
  assetsList: PublicKey
  assetAddress: PublicKey
  liquidationFund: PublicKey
  feedAddress: PublicKey
  reserveBalance: Decimal
  reserveAccount: PublicKey
  collateralRatio: Decimal
  maxCollateral: Decimal
}

export interface Mint {
  exchangeAccount: PublicKey
  owner: PublicKey
  to: PublicKey
  amount: BN
  signers?: Array<Account>
}
export interface Liquidate {
  exchangeAccount: PublicKey
  signer: PublicKey
  liquidatorCollateralAccount: PublicKey
  liquidatorUsdAccount: PublicKey
  liquidationFund: PublicKey
  reserveAccount: PublicKey
  amount: BN

  signers?: Array<Account>
}
export interface Swap {
  exchangeAccount?: PublicKey
  owner: PublicKey
  tokenIn: PublicKey
  tokenFor: PublicKey
  userTokenAccountIn: PublicKey
  userTokenAccountFor: PublicKey
  amount: BN
  signers?: Array<Account>
}
export interface Burn {
  exchangeAccount: PublicKey
  owner: PublicKey
  userTokenAccountBurn: PublicKey
  amount: BN
  signers?: Array<Account>
}
interface Deposit {
  amount: BN
  exchangeAccount: PublicKey
  owner: PublicKey
  userCollateralAccount: PublicKey
  reserveAccount: PublicKey
  collateralToken: Token
  exchangeAuthority: PublicKey
  signers: Array<Account>
}
export interface Withdraw {
  reserveAccount: PublicKey
  exchangeAccount: PublicKey
  owner: PublicKey
  userCollateralAccount: PublicKey
  amount: BN
  signers?: Array<Account>
}
export interface WithdrawRewards {
  exchangeAccount: PublicKey
  owner: PublicKey
  userTokenAccount: PublicKey
  signers?: Array<Account>
}
export interface MintInstruction {
  exchangeAccount: PublicKey
  owner: PublicKey
  to: PublicKey
  amount: BN
}
export interface SwapInstruction {
  exchangeAccount?: PublicKey
  owner: PublicKey
  tokenIn: PublicKey
  tokenFor: PublicKey
  userTokenAccountIn: PublicKey
  userTokenAccountFor: PublicKey
  amount: BN
}
export interface LiquidateInstruction {
  exchangeAccount: PublicKey
  liquidatorCollateralAccount: PublicKey
  liquidatorUsdAccount: PublicKey
  liquidationFund: PublicKey
  reserveAccount: PublicKey
  signer: PublicKey
  amount: BN
}

export interface BurnInstruction {
  exchangeAccount: PublicKey
  owner: PublicKey
  userTokenAccountBurn: PublicKey
  amount: BN
}
export interface WithdrawRewardsInstruction {
  exchangeAccount: PublicKey
  owner: PublicKey
  userTokenAccount: PublicKey
}
export interface WithdrawInstruction {
  exchangeAccount: PublicKey
  reserveAccount: PublicKey
  owner: PublicKey
  userCollateralAccount: PublicKey
  amount: BN
}
export interface DepositInstruction {
  exchangeAccount: PublicKey
  userCollateralAccount: PublicKey
  owner: PublicKey
  reserveAddress: PublicKey
  amount: BN
}

export interface SettleSyntheticInstruction {
  payer: PublicKey
  tokenToSettle: PublicKey
  settlementReserve: PublicKey
}
export interface SwapSettledSyntheticInstruction {
  tokenToSettle: PublicKey
  userSettledTokenAccount: PublicKey
  userUsdAccount: PublicKey
  signer: PublicKey
  amount: BN
}
export interface Init {
  admin: PublicKey
  nonce: number
  stakingRoundLength: number
  stakingFundAccount: PublicKey
  amountPerRound: BN
  exchangeAuthority: PublicKey
}
export interface ExchangeState {
  admin: PublicKey
  exchangeAuthority: PublicKey
  halted: boolean
  nonce: number
  debtShares: BN
  assetsList: PublicKey
  healthFactor: Decimal
  maxDelay: number
  fee: Decimal
  swapTaxRatio: Decimal
  swapTaxReserve: Decimal
  debtInterestRate: Decimal
  accumulatedDebtInterest: Decimal
  lastDebtAdjustment: BN
  liquidationRate: Decimal
  penaltyToLiquidator: Decimal
  penaltyToExchange: Decimal
  liquidationBuffer: number
  staking: Staking
}
export interface Staking {
  fundAccount: PublicKey
  roundLength: number
  amountPerRound: Decimal
  finishedRound: StakingRound
  currentRound: StakingRound
  nextRound: StakingRound
}
export interface StakingRound {
  start: BN
  amount: Decimal
  allPoints: BN
}
export interface ExchangeAccount {
  owner: PublicKey
  version: number
  debtShares: BN
  liquidationDeadline: BN
  userStakingData: UserStaking
  head: number
  collaterals: Array<CollateralEntry>
}
export interface Settlement {
  reserveAddress: PublicKey
  tokenInAddress: PublicKey
  tokenOutAddress: PublicKey
  decimalsIn: number
  decimalsOut: number
  ratio: Decimal
}

export interface Vault {
  halted: boolean
  synthetic: PublicKey
  collateral: PublicKey
  collateralReserve: PublicKey
  collateralPriceFeed: PublicKey
  liquidationFund: PublicKey
  openFee: Decimal
  collateralRatio: Decimal
  liquidationThreshold: Decimal
  liquidationRatio: Decimal
  liquidationPenaltyLiquidator: Decimal
  liquidationPenaltyExchange: Decimal
  debtInterestRate: Decimal
  accumulatedInterest: Decimal
  accumulatedInterestRate: Decimal
  mintAmount: Decimal
  collateralAmount: Decimal
  maxBorrow: Decimal
  lastUpdate: BN
  oracleType: OracleType
  vaultType: number
}
export interface VaultEntry {
  owner: PublicKey
  vault: PublicKey
  lastAccumulatedInterestRate: Decimal
  syntheticAmount: Decimal
  collateralAmount: Decimal
}
export interface VaultDepositInstruction {
  owner: PublicKey
  synthetic: PublicKey
  collateral: PublicKey
  userCollateralAccount: PublicKey
  reserveAddress: PublicKey
  amount: BN
  vaultType: number
}
export interface DepositVaultTransaction extends VaultDepositInstruction {
  collateralToken: Token
}
export interface DepositVault extends DepositVaultTransaction {
  signers: Array<Account | Keypair>
}
export interface LiquidateVaultInstruction {
  owner: PublicKey
  liquidator: PublicKey
  liquidatorSyntheticAccount: PublicKey
  liquidatorCollateralAccount: PublicKey
  synthetic: PublicKey
  collateral: PublicKey
  collateralReserve: PublicKey
  liquidationFund: PublicKey
  collateralPriceFeed: PublicKey
  amount: BN
  vaultType: number
}
export interface BorrowVaultInstruction {
  owner: PublicKey
  to: PublicKey
  synthetic: PublicKey
  collateral: PublicKey
  collateralPriceFeed: PublicKey
  amount: BN
  vaultType: number
}
export interface BorrowVault extends BorrowVaultInstruction {
  signers: Array<Account | Keypair>
}

export interface WithdrawVaultInstruction {
  amount: BN
  owner: PublicKey
  collateral: PublicKey
  reserveAddress: PublicKey
  collateralPriceFeed: PublicKey
  synthetic: PublicKey
  userCollateralAccount: PublicKey
  vaultType: number
}

export interface RepayVaultInstruction {
  amount: BN
  owner: PublicKey
  synthetic: PublicKey
  collateral: PublicKey
  userTokenAccountRepay: PublicKey
  vaultType: number
}
export interface RepayVault extends RepayVaultInstruction {
  signers: Array<Account | Keypair>
}
export interface CollateralEntry {
  amount: BN
  collateralAddress: PublicKey
  index: number
}
export interface UserStaking {
  amountToClaim: Decimal
  finishedRoundPoints: BN
  currentRoundPoints: BN
  nextRoundPoints: BN
  lastUpdate: BN
}
export interface CreateVault {
  synthetic: PublicKey
  collateral: PublicKey
  collateralReserve: PublicKey
  collateralPriceFeed: PublicKey
  liquidationFund: PublicKey
  openFee: Decimal
  debtInterestRate: Decimal
  collateralRatio: Decimal
  maxBorrow: Decimal
  liquidationThreshold: Decimal
  liquidationPenaltyLiquidator: Decimal
  liquidationPenaltyExchange: Decimal
  liquidationRatio: Decimal
  oracleType: OracleType
  vaultType: number
}

export interface CreateVaultEntry {
  synthetic: PublicKey
  collateral: PublicKey
  owner: PublicKey
  vaultType: number
}
export interface SetVaultHalted {
  halted: boolean
  synthetic: PublicKey
  collateral: PublicKey
  vaultType: number
}

export interface Decimal {
  val: BN
  scale: number
}
export interface Swapline {
  synthetic: PublicKey
  collateral: PublicKey
  collateralReserve: PublicKey
  fee: Decimal
  accumulatedFee: Decimal
  balance: Decimal
  limit: Decimal
  bump: number
  halted: boolean
}
export interface CreateSwapline {
  synthetic: PublicKey
  collateral: PublicKey
  collateralReserve: PublicKey
  limit: BN
}
export interface UseSwapline {
  synthetic: PublicKey
  collateral: PublicKey
  userCollateralAccount: PublicKey
  userSyntheticAccount: PublicKey
  signer: PublicKey
  amount: BN
}
export interface WithdrawSwaplineFee {
  synthetic: PublicKey
  collateral: PublicKey
  to: PublicKey
  amount: BN
}

export interface SetVaultParameter {
  synthetic: PublicKey
  collateral: PublicKey
  vaultType: number
}

export interface VaultEntryId {
  synthetic: PublicKey
  collateral: PublicKey
  owner: PublicKey
  vaultType: number
}

export interface WithdrawVaultAccumulatedInterest {
  synthetic: PublicKey
  collateral: PublicKey
  to: PublicKey
  amount: BN
  vaultType: number
}
export interface WithdrawVaultLiquidationPenalty {
  synthetic: PublicKey
  collateral: PublicKey
  liquidationFund: PublicKey
  to: PublicKey
  amount: BN
  vaultType: number
}
export interface SetHaltedSwapline {
  synthetic: PublicKey
  collateral: PublicKey
  halted: boolean
}
export enum OracleType {
  Pyth = 0,
  Chainlink = 1
}
