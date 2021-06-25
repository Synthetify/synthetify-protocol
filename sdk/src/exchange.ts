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
    await instance.getState()
    instance.assetsList = await instance.getAssetsList(instance.state.assetsList)
    return instance
  }
  public onStateChange(fn: (state: ExchangeState) => void) {
    this.program.state.subscribe('singleGossip').on('change', (state: ExchangeState) => {
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
    collateralAccount,
    collateralToken,
    nonce,
    liquidationAccount,
    amountPerRound,
    stakingRoundLength,
    stakingFundAccount
  }: Init) {
    await this.program.state.rpc.new(nonce, stakingRoundLength, amountPerRound, {
      accounts: {
        admin: admin,
        collateralToken: collateralToken,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        liquidationAccount: liquidationAccount,
        stakingFundAccount: stakingFundAccount
      }
    })
  }
  public async getState() {
    const state = (await this.program.state.fetch()) as ExchangeState
    // need to add hooks on change
    this.state = state
    this.assetsList = await this.getAssetsList(this.state.assetsList)
    return state
  }
  public async getExchangeAccount(exchangeAccount: PublicKey) {
    return (await this.program.account.exchangeAccount.fetch(exchangeAccount)) as ExchangeAccount
  }
  public async getUserCollateralBalance(exchangeAccount: PublicKey) {
    const userAccount = (await this.program.account.exchangeAccount.fetch(
      exchangeAccount
    )) as ExchangeAccount
    if (userAccount.collateralShares.eq(new BN(0))) {
      return new BN(0)
    }
    const state = await this.getState()
    const collateralToken = new Token(
      this.connection,
      this.assetsList.assets[1].assetAddress,
      TOKEN_PROGRAM_ID,
      new Account()
    )
    const exchangeCollateralInfo = await collateralToken.getAccountInfo(state.collateralAccount)
    return userAccount.collateralShares
      .mul(new BN(exchangeCollateralInfo.amount.toString()))
      .div(state.collateralShares)
  }
  public async getUserDebtBalance(exchangeAccount: PublicKey) {
    const userAccount = (await this.program.account.exchangeAccount.fetch(
      exchangeAccount
    )) as ExchangeAccount
    if (userAccount.collateralShares.eq(new BN(0))) {
      return new BN(0)
    }
    const state = await this.getState()
    const debt = calculateDebt(this.assetsList)
    return userAccount.debtShares.mul(debt).div(state.debtShares)
  }
  public async createExchangeAccount(owner: PublicKey) {
    const state = await this.program.state.address()
    const account = await this.program.account.exchangeAccount.associatedAddress(owner, state)
    await this.program.rpc.createExchangeAccount(owner, {
      accounts: {
        exchangeAccount: account,
        rent: SYSVAR_RENT_PUBKEY,
        admin: owner,
        payer: this.wallet.publicKey,
        state: state,
        systemProgram: SystemProgram.programId
      }
    })
    return account
  }
  public async createExchangeAccountInstruction(owner: PublicKey) {
    const state = await this.program.state.address()
    const account = await this.program.account.exchangeAccount.associatedAddress(owner, state)
    const ix = (await this.program.instruction.createExchangeAccount(owner, {
      accounts: {
        exchangeAccount: account,
        rent: SYSVAR_RENT_PUBKEY,
        admin: owner,
        payer: this.wallet.publicKey,
        state: state,
        systemProgram: SystemProgram.programId
      }
    })) as TransactionInstruction
    return { account, ix }
  }
  public async getExchangeAccountAddress(owner: PublicKey) {
    const state = await this.program.state.address()
    const account = await this.program.account.exchangeAccount.associatedAddress(owner, state)
    return account
  }

  public async depositInstruction({
    amount,
    exchangeAccount,
    userCollateralAccount,
    owner
  }: DepositInstruction) {
    return (await this.program.state.instruction.deposit(amount, {
      accounts: {
        owner: owner,
        exchangeAccount: exchangeAccount,
        collateralAccount: this.state.collateralAccount,
        userCollateralAccount: userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAuthority: this.exchangeAuthority
      }
    })) as TransactionInstruction
  }
  public async withdrawInstruction({ amount, exchangeAccount, owner, to }: WithdrawInstruction) {
    return await (this.program.state.instruction.withdraw(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.programId,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async mintInstruction({ amount, exchangeAccount, owner, to }: MintInstruction) {
    return await (this.program.state.instruction.mint(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.assets[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async swapInstruction({
    amount,
    exchangeAccount,
    owner,
    tokenFor,
    tokenIn,
    userTokenAccountFor,
    userTokenAccountIn
  }: SwapInstruction) {
    return await (this.program.state.instruction.swap(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        tokenFor: tokenFor,
        tokenIn: tokenIn,
        userTokenAccountFor: userTokenAccountFor,
        userTokenAccountIn: userTokenAccountIn,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async liquidateInstruction({
    exchangeAccount,
    signer,
    userCollateralAccount,
    userUsdAccount
  }: LiquidateInstruction) {
    return await (this.program.state.instruction.liquidate({
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        signer: signer,
        usdToken: this.assetsList.assets[0].assetAddress,
        assetsList: this.state.assetsList,
        userCollateralAccount: userCollateralAccount,
        userUsdAccount: userUsdAccount,
        collateralAccount: this.state.collateralAccount,
        liquidationAccount: this.state.liquidationAccount
      }
    }) as TransactionInstruction)
  }
  public async burnInstruction({
    amount,
    exchangeAccount,
    owner,
    userTokenAccountBurn
  }: BurnInstruction) {
    return await (this.program.state.instruction.burn(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.assets[0].assetAddress,
        userTokenAccountBurn: userTokenAccountBurn,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList
      }
    }) as TransactionInstruction)
  }
  public async claimRewardsInstruction(exchangeAccount: PublicKey) {
    return await (this.program.state.instruction.claimRewards({
      accounts: {
        exchangeAccount: exchangeAccount
      }
    }) as TransactionInstruction)
  }
  public async withdrawRewardsInstruction({
    exchangeAccount,
    owner,
    userTokenAccount
  }: WithdrawRewardsInstruction) {
    return await (this.program.state.instruction.withdrawRewards({
      accounts: {
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
    return await (this.program.state.instruction.checkAccountCollateralization({
      accounts: {
        exchangeAccount: exchangeAccount,
        assetsList: this.state.assetsList,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationBufferInstruction(newLiquidationBuffer: number) {
    return await (this.program.state.instruction.setLiquidationBuffer(newLiquidationBuffer, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationThresholdInstruction(newLiquidationThreshold: number) {
    return await (this.program.state.instruction.setLiquidationThreshold(newLiquidationThreshold, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationPenaltyInstruction(newLiquidationPenalty: number) {
    return await (this.program.state.instruction.setLiquidationPenalty(newLiquidationPenalty, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setCollateralizationLevelInstruction(newCollateralizationLevel: number) {
    return await (this.program.state.instruction.setCollateralizationLevel(
      newCollateralizationLevel,
      {
        accounts: {
          admin: this.state.admin
        }
      }
    ) as TransactionInstruction)
  }
  public async setFeeInstruction(newFee: number) {
    return await (this.program.state.instruction.setFee(newFee, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setMaxDelayInstruction(newMaxDelay: number) {
    return await (this.program.state.instruction.setMaxDelay(newMaxDelay, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setHaltedInstruction(halted: boolean) {
    return await (this.program.state.instruction.setHalted(halted, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setStakingAmountPerRound(amount: BN) {
    return await (this.program.state.instruction.setStakingAmountPerRound(amount, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setStakingRoundLength(length: number) {
    return await (this.program.state.instruction.setStakingRoundLength(length, {
      accounts: {
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
    userCollateralAccount,
    userUsdAccount,
    signers,
    allowanceAmount
  }: Liquidate) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const liquidateIx = await this.liquidateInstruction({
      exchangeAccount,
      signer,
      userCollateralAccount,
      userUsdAccount
    })
    const approveIx = await Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      userUsdAccount,
      this.exchangeAuthority,
      signer,
      [],
      tou64(allowanceAmount)
    )
    const liquidateTx = new Transaction().add(updateIx).add(approveIx).add(liquidateIx)
    const txs = await this.processOperations([liquidateTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async swap({
    amount,
    exchangeAccount,
    owner,
    tokenFor,
    tokenIn,
    userTokenAccountFor,
    userTokenAccountIn,
    signers
  }: Swap) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
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
    const swapTx = new Transaction().add(updateIx).add(approveIx).add(swapIx)
    const txs = await this.processOperations([swapTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
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
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const mintIx = await this.mintInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const mintTx = new Transaction().add(updateIx).add(mintIx)
    const txs = await this.processOperations([mintTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
  }
  public async withdraw({ amount, exchangeAccount, owner, to, signers }: Withdraw) {
    const updateIx = await this.updatePricesInstruction(this.state.assetsList)
    const withdrawIx = await this.withdrawInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const withdrawTx = new Transaction().add(updateIx).add(withdrawIx)
    const txs = await this.processOperations([withdrawTx])
    signers ? txs[0].partialSign(...signers) : null

    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize())
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
    return (await this.program.account.assetsList.fetch(assetsList)) as AssetsList
  }
  public onAssetsListChange(address: PublicKey, fn: (list: AssetsList) => void) {
    this.program.account.assetsList
      .subscribe(address, 'singleGossip')
      .on('change', (list: AssetsList) => {
        fn(list)
      })
  }
  public async createAssetsList(size: number) {
    const assetListAccount = new Account()
    await this.program.rpc.createAssetsList(size, {
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [
        await this.program.account.assetsList.createInstruction(assetListAccount, size * 109 + 45)
      ]
    })
    return assetListAccount.publicKey
  }
  public async setPriceFeedInstruction({
    assetsList,
    priceFeed,
    signer,
    tokenAddress
  }: SetPriceFeedInstruction) {
    return (await this.program.state.instruction.setPriceFeed(tokenAddress, {
      accounts: {
        signer: signer,
        assetsList: assetsList,
        priceFeed: priceFeed
      }
    })) as TransactionInstruction
  }

  public async initializeAssetsList({
    assetsList,
    collateralToken,
    collateralTokenFeed,
    usdToken
  }: InitializeAssetList) {
    return await this.program.rpc.createList(collateralToken, collateralTokenFeed, usdToken, {
      accounts: {
        assetsList: assetsList
      }
    })
  }

  public async setAssetMaxSupply({
    assetsList,
    exchangeAdmin,
    assetAddress,
    newMaxSupply
  }: SetAssetMaxSupply) {
    return await this.program.state.rpc.setMaxSupply(assetAddress, newMaxSupply, {
      accounts: {
        signer: exchangeAdmin.publicKey,
        assetsList: assetsList
      },
      signers: [exchangeAdmin]
    })
  }
  public async addNewAsset({
    assetsList,
    assetsAdmin,
    maxSupply,
    tokenAddress,
    tokenDecimals,
    tokenFeed
  }: AddNewAsset) {
    return await this.program.state.rpc.addNewAsset(
      tokenFeed,
      tokenAddress,
      tokenDecimals,
      maxSupply,
      {
        accounts: {
          signer: assetsAdmin.publicKey,
          assetsList: assetsList
        },
        signers: [assetsAdmin]
      }
    )
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
}
export interface Asset {
  feedAddress: PublicKey
  assetAddress: PublicKey
  price: BN
  supply: BN
  lastUpdate: BN
  maxSupply: BN
  settlementSlot: BN
  decimals: number
}
export interface AssetsList {
  initialized: boolean
  assets: Array<Asset>
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
export interface AddNewAsset {
  tokenFeed: PublicKey
  tokenAddress: PublicKey
  assetsList: PublicKey
  tokenDecimals: number
  maxSupply: BN
  assetsAdmin: Account
}
export interface SetPriceFeedInstruction {
  assetsList: PublicKey
  priceFeed: PublicKey
  tokenAddress: PublicKey
  signer: PublicKey
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
  userUsdAccount: PublicKey
  userCollateralAccount: PublicKey
  signer: PublicKey
  allowanceAmount: BN
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
export interface Withdraw {
  exchangeAccount: PublicKey
  owner: PublicKey
  to: PublicKey
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
  userUsdAccount: PublicKey
  userCollateralAccount: PublicKey
  signer: PublicKey
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
  owner: PublicKey
  to: PublicKey
  amount: BN
}
export interface DepositInstruction {
  exchangeAccount: PublicKey
  userCollateralAccount: PublicKey
  owner: PublicKey
  amount: BN
}
export interface Init {
  admin: PublicKey
  nonce: number
  stakingRoundLength: number
  stakingFundAccount: PublicKey
  amountPerRound: BN
  assetsList: PublicKey
  collateralToken: PublicKey
  collateralAccount: PublicKey
  liquidationAccount: PublicKey
}
export interface ExchangeState {
  admin: PublicKey
  halted: boolean
  nonce: number
  debtShares: BN
  collateralShares: BN
  assetsList: PublicKey
  collateralToken: PublicKey
  collateralAccount: PublicKey
  liquidationAccount: PublicKey
  collateralizationLevel: number
  maxDelay: number
  fee: number
  liquidationPenalty: number
  liquidationThreshold: number
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
  collateralShares: BN
  liquidationDeadline: BN
  userStakingData: UserStaking
}
export interface UserStaking {
  amountToClaim: BN
  finishedRoundPoints: BN
  currentRoundPoints: BN
  nextRoundPoints: BN
  lastUpdate: BN
}
