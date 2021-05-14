import { DEV_NET, Network, TEST_NET } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, utils } from '@project-serum/anchor'
import { IWallet } from '.'
import { calculateDebt, DEFAULT_PUBLIC_KEY, signAndSend, sleep, tou64 } from './utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AssetsList, Manager } from './manager'
import {
  Connection,
  PublicKey,
  ConfirmOptions,
  Account,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  sendAndConfirmRawTransaction
} from '@solana/web3.js'

export class Exchange {
  connection: Connection
  network: Network
  manager: Manager
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
    manager: Manager,
    exchangeAuthority?: PublicKey,
    programId?: PublicKey,
    opts?: ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    this.wallet = wallet
    this.manager = manager
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
    manager: Manager,
    exchangeAuthority?: PublicKey,
    programId?: PublicKey,
    opts?: ConfirmOptions
  ) {
    const instance = new Exchange(
      connection,
      network,
      wallet,
      manager,
      exchangeAuthority,
      programId,
      opts
    )
    await instance.getState()
    instance.assetsList = await instance.manager.getAssetsList(instance.state.assetsList)
    return instance
  }
  public onStateChange(fn: (state: ExchangeState) => void) {
    // @ts-expect-error
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
    // @ts-expect-error
    await this.program.state.rpc.new(nonce, stakingRoundLength, amountPerRound, {
      accounts: {
        admin: admin,
        collateralToken: collateralToken,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        clock: SYSVAR_CLOCK_PUBKEY,
        liquidationAccount: liquidationAccount,
        stakingFundAccount: stakingFundAccount
      }
    })
  }
  public async getState() {
    const state = (await this.program.state()) as ExchangeState
    // need to add hooks on change
    this.state = state
    this.assetsList = await this.manager.getAssetsList(this.state.assetsList)
    return state
  }
  public async getExchangeAccount(exchangeAccount: PublicKey) {
    return (await this.program.account.exchangeAccount(exchangeAccount)) as ExchangeAccount
  }
  public async getUserCollateralBalance(exchangeAccount: PublicKey) {
    const userAccount = (await this.program.account.exchangeAccount(
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
    const userAccount = (await this.program.account.exchangeAccount(
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
    //@ts-expect-error
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
    //@ts-expect-error
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
    //@ts-expect-error
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
    // @ts-expect-error
    return (await this.program.state.instruction.deposit(amount, {
      accounts: {
        owner: owner,
        exchangeAccount: exchangeAccount,
        collateralAccount: this.state.collateralAccount,
        userCollateralAccount: userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAuthority: this.exchangeAuthority,
        clock: SYSVAR_CLOCK_PUBKEY
      }
    })) as TransactionInstruction
  }
  public async withdrawInstruction({ amount, exchangeAccount, owner, to }: WithdrawInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.withdraw(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.programId,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async mintInstruction({ amount, exchangeAccount, owner, to }: MintInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.mint(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.assets[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId,
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
    // @ts-expect-error
    return await (this.program.state.instruction.swap(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        tokenFor: tokenFor,
        tokenIn: tokenIn,
        userTokenAccountFor: userTokenAccountFor,
        userTokenAccountIn: userTokenAccountIn,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId,
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
    // @ts-expect-error
    return await (this.program.state.instruction.liquidate({
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        signer: signer,
        usdToken: this.assetsList.assets[0].assetAddress,
        assetsList: this.state.assetsList,
        userCollateralAccount: userCollateralAccount,
        userUsdAccount: userUsdAccount,
        managerProgram: this.manager.programId,
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
    // @ts-expect-error
    return await (this.program.state.instruction.burn(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.assets[0].assetAddress,
        userTokenAccountBurn: userTokenAccountBurn,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId
      }
    }) as TransactionInstruction)
  }
  public async claimRewardsInstruction(exchangeAccount: PublicKey) {
    // @ts-expect-error
    return await (this.program.state.instruction.claimRewards({
      accounts: {
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount
      }
    }) as TransactionInstruction)
  }
  public async withdrawRewardsInstruction({
    exchangeAccount,
    owner,
    userTokenAccount
  }: WithdrawRewardsInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.withdrawRewards({
      accounts: {
        clock: SYSVAR_CLOCK_PUBKEY,
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
    // @ts-expect-error
    return await (this.program.state.instruction.checkAccountCollateralization({
      accounts: {
        clock: SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        assetsList: this.state.assetsList,
        collateralAccount: this.state.collateralAccount
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationBufferInstruction(newLiquidationBuffer: number) {
    // @ts-expect-error
    return await (this.program.state.instruction.setLiquidationBuffer(newLiquidationBuffer, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationThresholdInstruction(newLiquidationThreshold: number) {
    // @ts-expect-error
    return await (this.program.state.instruction.setLiquidationThreshold(newLiquidationThreshold, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setLiquidationPenaltyInstruction(newLiquidationPenalty: number) {
    // @ts-expect-error
    return await (this.program.state.instruction.setLiquidationPenalty(newLiquidationPenalty, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setCollateralizationLevelInstruction(newCollateralizationLevel: number) {
    // @ts-expect-error
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
    // @ts-expect-error
    return await (this.program.state.instruction.setFee(newFee, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setMaxDelayInstruction(newMaxDelay: number) {
    // @ts-expect-error
    return await (this.program.state.instruction.setMaxDelay(newMaxDelay, {
      accounts: {
        admin: this.state.admin
      }
    }) as TransactionInstruction)
  }
  public async setHaltedInstruction(halted: boolean) {
    // @ts-expect-error
    return await (this.program.state.instruction.setHalted(halted, {
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
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const checkIx = await this.checkAccountInstruction(exchangeAccount)

    const updateTx = new Transaction().add(updateIx)
    const checkTx = new Transaction().add(checkIx)
    const txs = await this.processOperations([updateTx, checkTx])
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
  }
  public async liquidate({
    exchangeAccount,
    signer,
    userCollateralAccount,
    userUsdAccount,
    signers,
    allowanceAmount
  }: Liquidate) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
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
    const updateTx = new Transaction().add(updateIx)
    const liquidateTx = new Transaction().add(approveIx).add(liquidateIx)
    const txs = await this.processOperations([updateTx, liquidateTx])
    signers ? txs[1].partialSign(...signers) : null
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
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
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
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
    const updateTx = new Transaction().add(updateIx)
    const swapTx = new Transaction().add(approveIx).add(swapIx)
    const txs = await this.processOperations([updateTx, swapTx])
    signers ? txs[1].partialSign(...signers) : null
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
  }
  public async burn({ amount, exchangeAccount, owner, userTokenAccountBurn, signers }: Burn) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
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
    const updateTx = new Transaction().add(updateIx)
    const burnTx = new Transaction().add(approveIx).add(burnIx)
    const txs = await this.processOperations([updateTx, burnTx])
    signers ? txs[1].partialSign(...signers) : null
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
  }
  public async mint({ amount, exchangeAccount, owner, to, signers }: Mint) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const mintIx = await this.mintInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const updateTx = new Transaction().add(updateIx)
    const mintTx = new Transaction().add(mintIx)
    const txs = await this.processOperations([updateTx, mintTx])
    signers ? txs[1].partialSign(...signers) : null
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
  }
  public async withdraw({ amount, exchangeAccount, owner, to, signers }: Withdraw) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const withdrawIx = await this.withdrawInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const updateTx = new Transaction().add(updateIx)
    const withdrawTx = new Transaction().add(withdrawIx)
    const txs = await this.processOperations([updateTx, withdrawTx])
    signers ? txs[1].partialSign(...signers) : null
    await this.connection.sendRawTransaction(txs[0].serialize(), {
      skipPreflight: true
    })
    await sleep(600)
    return sendAndConfirmRawTransaction(this.connection, txs[1].serialize(), {
      skipPreflight: true
    })
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
    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize(), {
      skipPreflight: true
    })
  }
  public async claimRewards(exchangeAccount: PublicKey) {
    const claimRewardsIx = await this.claimRewardsInstruction(exchangeAccount)
    const tx = new Transaction().add(claimRewardsIx)
    const txs = await this.processOperations([tx])
    return sendAndConfirmRawTransaction(this.connection, txs[0].serialize(), {
      skipPreflight: true
    })
  }
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
