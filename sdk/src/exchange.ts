import { DEV_NET, Network, TEST_NET } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, utils } from '@project-serum/anchor'
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
  sendAndConfirmRawTransaction
} from '@solana/web3.js'

export const STATE_SEED = 'statev1'
export class Exchange {
  connection: Connection
  network: Network
  wallet: IWallet
  programId: PublicKey
  exchangeAuthority: PublicKey
  idl: Idl = idl as Idl
  program: Program
  state: ExchangeState
  opts?: ConfirmOptions
  assetsList: AssetsList
  stateAddress?: PublicKey

  private constructor(
    connection: Connection,
    network: Network,
    wallet: IWallet,
    exchangeAuthority?: PublicKey,
    programId?: PublicKey,
    opts?: ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    this.wallet = wallet
    this.opts = opts
    const provider = new Provider(connection, wallet, opts || Provider.defaultOptions())
    switch (network) {
      case Network.LOCAL:
        this.programId = programId
        this.exchangeAuthority = exchangeAuthority
        this.program = new Program(idl as Idl, this.programId, provider)
        break
      case Network.DEV:
        this.programId = DEV_NET.exchange
        this.exchangeAuthority = DEV_NET.exchangeAuthority
        this.program = new Program(idl as Idl, this.programId, provider)
        break
      case Network.TEST:
        this.programId = TEST_NET.exchange
        this.exchangeAuthority = TEST_NET.exchangeAuthority
        this.program = new Program(idl as Idl, this.programId, provider)
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
    await instance.getState()
    instance.assetsList = await instance.getAssetsList(instance.state.assetsList)
    return instance
  }
  public onStateChange(fn: (state: ExchangeState) => void) {
    this.program.account.state.subscribe('singleGossip').on('change', (state: ExchangeState) => {
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
  public async init({
    admin,
    assetsList,
    nonce,
    amountPerRound,
    stakingRoundLength,
    stakingFundAccount
  }: Init) {
    const [stateAddress, bump] = await PublicKey.findProgramAddress(
      [Buffer.from(utils.bytes.utf8.encode(STATE_SEED))],
      this.program.programId
    )
    await this.program.rpc.init(bump, nonce, stakingRoundLength, amountPerRound, {
      accounts: {
        state: stateAddress,
        admin: admin,
        assetsList: assetsList,
        stakingFundAccount: stakingFundAccount,
        payer: this.wallet.publicKey,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId
      }
    })
    this.stateAddress = stateAddress
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
        exchangeAccount: exchangeAccount,
        managerProgram: this.programId
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
    return await (this.program.instruction.swap(amount, {
      accounts: {
        state: this.stateAddress,
        exchangeAuthority: this.exchangeAuthority,
        tokenFor: tokenFor,
        tokenIn: tokenIn,
        userTokenAccountFor: userTokenAccountFor,
        userTokenAccountIn: userTokenAccountIn,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction)
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
  public async setLiquidationRateInstruction(newLiquidationRate: number) {
    return await (this.program.instruction.setLiquidationRate(newLiquidationRate, {
      accounts: {
        state: this.stateAddress,

        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setFeeInstruction(newFee: number) {
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
  public async setHealthFactorInstruction(percentage: BN) {
    return await (this.program.instruction.setHealthFactor(percentage, {
      accounts: {
        state: this.stateAddress,
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setStakingAmountPerRound(amount: BN) {
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
    // const updateIx = await this.updatePricesInstruction(this.state.assetsList)
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
    return this.updatePricesAndSend([approveIx, swapIx], signers, false)
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
    // await this.updatePricesAndSend([mintIx], signers, this.assetsList.head >= 20)
    await this.updatePricesAndSend([mintIx], signers, false)
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
    // return this.updatePricesAndSend([withdrawIx], signers, this.assetsList.head >= 20)
    return this.updatePricesAndSend([withdrawIx], signers, false)
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
    const assetList = (await this.program.account.assetsList.fetch(assetsList)) as AssetsList
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
  public async createAssetsList() {
    const assetListAccount = new Account()
    await this.program.rpc.createAssetsList({
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [await this.program.account.assetsList.createInstruction(assetListAccount)]
    })
    return assetListAccount.publicKey
  }
  public async setPriceFeedInstruction({
    assetsList,
    priceFeed,
    tokenAddress
  }: SetPriceFeedInstruction) {
    return (await this.program.instruction.setPriceFeed(tokenAddress, {
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
    decimals,
    maxSupply
  }: AddSyntheticInstruction) {
    return (await this.program.instruction.addSynthetic(maxSupply, decimals, {
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
    assetsList,
    collateralToken,
    collateralTokenFeed,
    usdToken,
    snyLiquidationFund,
    snyReserve
  }: InitializeAssetList) {
    return await this.program.rpc.createList(collateralToken, collateralTokenFeed, usdToken, {
      accounts: {
        assetsList: assetsList,
        snyReserve: snyReserve,
        snyLiquidationFund: snyLiquidationFund
      }
    })
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
  public async addNewAssetInstruction({ assetsList, assetFeedAddress }: AddNewAssetInstruction) {
    return (await this.program.instruction.addNewAsset(assetFeedAddress, {
      accounts: {
        state: this.stateAddress,
        signer: this.state.admin,
        assetsList
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
    decimals
  }: AddCollateralInstruction) {
    return (await this.program.instruction.addCollateral(
      reserveBalance,
      decimals,
      collateralRatio,
      {
        accounts: {
          admin: this.state.admin,
          state: this.stateAddress,
          signer: this.state.admin,
          assetsList,
          assetAddress,
          liquidationFund,
          feedAddress,
          reserveAccount
        }
      }
    )) as TransactionInstruction
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
}
export interface InitializeAssetList {
  collateralToken: PublicKey
  collateralTokenFeed: PublicKey
  usdToken: PublicKey
  assetsList: PublicKey
  snyReserve: PublicKey
  snyLiquidationFund: PublicKey
}
export interface Asset {
  feedAddress: PublicKey
  price: BN
  lastUpdate: BN
  confidence: number
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
  reserveBalance: BN
  collateralRatio: number
  decimals: number
}
export interface Synthetic {
  assetIndex: number
  assetAddress: PublicKey
  supply: BN
  maxSupply: BN
  settlementSlot: BN
  decimals: number
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
  newMaxSupply: BN
}
export interface AddNewAssetInstruction {
  assetsList: PublicKey
  assetFeedAddress: PublicKey
}
export interface SetPriceFeedInstruction {
  assetsList: PublicKey
  priceFeed: PublicKey
  tokenAddress: PublicKey
}

export interface SetLiquidationPenaltiesInstruction {
  penaltyToExchange: number
  penaltyToLiquidator: number
}

export interface AddSyntheticInstruction {
  assetAddress: PublicKey
  assetsList: PublicKey
  priceFeed: PublicKey
  maxSupply: BN
  decimals: number
}
export interface AddCollateralInstruction {
  assetsList: PublicKey
  assetAddress: PublicKey
  liquidationFund: PublicKey
  feedAddress: PublicKey
  reserveBalance: BN
  reserveAccount: PublicKey
  collateralRatio: number
  decimals: number
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
  exchangeAccount: PublicKey
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
  exchangeAccount: PublicKey
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
export interface Init {
  admin: PublicKey
  nonce: number
  stakingRoundLength: number
  stakingFundAccount: PublicKey
  amountPerRound: BN
  assetsList: PublicKey
}
export interface ExchangeState {
  admin: PublicKey
  halted: boolean
  nonce: number
  debtShares: BN
  assetsList: PublicKey
  healthFactor: number
  maxDelay: number
  fee: number
  liquidationRate: number
  penaltyToLiquidator: number
  penaltyToExchange: number
  liquidationBuffer: number
  accountVersion: number
  staking: Staking
}
export interface Staking {
  fundAccount: PublicKey
  roundLength: number
  amountPerRound: BN
  finishedRound: StakingRound
  currentRound: StakingRound
  nextRound: StakingRound
}
export interface StakingRound {
  start: BN
  amount: BN
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
export interface CollateralEntry {
  amount: BN
  collateralAddress: PublicKey
  index: number
}
export interface UserStaking {
  amountToClaim: BN
  finishedRoundPoints: BN
  currentRoundPoints: BN
  nextRoundPoints: BN
  lastUpdate: BN
}
