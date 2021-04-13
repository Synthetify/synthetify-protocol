import { Network } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, web3, utils } from '@project-serum/anchor'
import { IWallet } from '.'
import { calculateDebt, DEFAULT_PUBLIC_KEY, signAndSend, tou64 } from './utils'
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { AssetsList, Manager } from './manager'

export class Exchange {
  connection: web3.Connection
  network: Network
  manager: Manager
  wallet: IWallet
  programId: web3.PublicKey
  exchangeAuthority: web3.PublicKey
  idl: Idl = idl as Idl
  program: Program
  state: ExchangeState
  opts?: web3.ConfirmOptions
  assetsList: AssetsList

  private constructor(
    connection: web3.Connection,
    network: Network,
    wallet: IWallet,
    manager: Manager,
    exchangeAuthority?: web3.PublicKey,
    programId?: web3.PublicKey,
    opts?: web3.ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    this.wallet = wallet
    this.manager = manager
    this.opts = opts
    const provider = new Provider(connection, wallet, opts || Provider.defaultOptions())
    if (network === Network.LOCAL) {
      this.programId = programId
      this.exchangeAuthority = exchangeAuthority
      this.program = new Program(idl as Idl, programId, provider)
    } else {
      // We will add it once we deploy
      throw new Error('Not supported')
    }
  }
  public static async build(
    connection: web3.Connection,
    network: Network,
    wallet: IWallet,
    manager: Manager,
    exchangeAuthority?: web3.PublicKey,
    programId?: web3.PublicKey,
    opts?: web3.ConfirmOptions
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
    instance.onStateChange((state) => {
      instance.state = state
    })
    instance.assetsList = await instance.manager.getAssetsList(instance.state.assetsList)
    return instance
  }
  public onStateChange(fn: (state: ExchangeState) => void) {
    // @ts-expect-error
    this.program.state.subscribe('singleGossip').on('change', (state: ExchangeState) => {
      fn(state)
    })
  }
  public onAccountChange(address: web3.PublicKey, fn: (account: ExchangeAccount) => void) {
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
    liquidationAccount
  }: Init) {
    // @ts-expect-error
    await this.program.state.rpc.new(nonce, {
      accounts: {
        admin: admin,
        collateralToken: collateralToken,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        liquidationAccount: liquidationAccount
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
  public async getExchangeAccount(exchangeAccount: web3.PublicKey) {
    return (await this.program.account.exchangeAccount(exchangeAccount)) as ExchangeAccount
  }
  public async getUserCollateralBalance(exchangeAccount: web3.PublicKey) {
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
      new web3.Account()
    )
    const exchangeCollateralInfo = await collateralToken.getAccountInfo(state.collateralAccount)
    return userAccount.collateralShares
      .mul(new BN(exchangeCollateralInfo.amount.toString()))
      .div(state.collateralShares)
  }
  public async getUserDebtBalance(exchangeAccount: web3.PublicKey) {
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
  public async createExchangeAccount(owner: web3.PublicKey) {
    const exchangeAccount = new web3.Account()
    await this.program.rpc.createExchangeAccount(owner, {
      accounts: {
        exchangeAccount: exchangeAccount.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY
      },
      signers: [exchangeAccount],
      instructions: [await this.program.account.exchangeAccount.createInstruction(exchangeAccount)]
    })
    return exchangeAccount.publicKey
  }
  public async depositInstruction({
    amount,
    exchangeAccount,
    userCollateralAccount
  }: DepositInstruction) {
    // @ts-expect-error
    return (await this.program.state.instruction.deposit(amount, {
      accounts: {
        exchangeAccount: exchangeAccount,
        collateralAccount: this.state.collateralAccount,
        userCollateralAccount: userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAuthority: this.exchangeAuthority
      }
    })) as web3.TransactionInstruction
  }
  public async withdrawInstruction({ amount, exchangeAccount, owner, to }: WithdrawInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.withdraw(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.programId,
        collateralAccount: this.state.collateralAccount
      }
    }) as web3.TransactionInstruction)
  }
  public async mintInstruction({ amount, exchangeAccount, owner, to }: MintInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.mint(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        usdToken: this.assetsList.assets[0].assetAddress,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId,
        collateralAccount: this.state.collateralAccount
      }
    }) as web3.TransactionInstruction)
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
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId,
        collateralAccount: this.state.collateralAccount
      }
    }) as web3.TransactionInstruction)
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
        clock: web3.SYSVAR_CLOCK_PUBKEY,
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
    }) as web3.TransactionInstruction)
  }
  public async burnInstruction({
    amount,
    exchangeAccount,
    owner,
    tokenBurn,
    userTokenAccountBurn
  }: BurnInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.burn(amount, {
      accounts: {
        exchangeAuthority: this.exchangeAuthority,
        tokenBurn: tokenBurn,
        userTokenAccountBurn: userTokenAccountBurn,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: this.state.assetsList,
        managerProgram: this.manager.programId
      }
    }) as web3.TransactionInstruction)
  }
  private async processOperations(txs: web3.Transaction[]) {
    const blockhash = await this.connection.getRecentBlockhash(
      this.opts?.commitment || Provider.defaultOptions().commitment
    )
    txs.forEach((tx) => {
      tx.feePayer = this.wallet.publicKey
      tx.recentBlockhash = blockhash.blockhash
    })
    this.wallet.signAllTransactions(txs)
    return txs
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
    const updateTx = new web3.Transaction().add(updateIx)
    const liquidateTx = new web3.Transaction().add(approveIx).add(liquidateIx)
    const txs = await this.processOperations([updateTx, liquidateTx])
    signers ? txs[1].partialSign(...signers) : null
    const promisesTx = txs.map((tx) =>
      web3.sendAndConfirmRawTransaction(this.connection, tx.serialize(), {
        skipPreflight: true
      })
    )
    return Promise.all(promisesTx)
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
    const updateTx = new web3.Transaction().add(updateIx)
    const swapTx = new web3.Transaction().add(approveIx).add(swapIx)
    const txs = await this.processOperations([updateTx, swapTx])
    signers ? txs[1].partialSign(...signers) : null
    const promisesTx = txs.map((tx) =>
      web3.sendAndConfirmRawTransaction(this.connection, tx.serialize(), {
        skipPreflight: true
      })
    )
    return Promise.all(promisesTx)
  }
  public async burn({
    amount,
    exchangeAccount,
    owner,
    tokenBurn,
    userTokenAccountBurn,
    signers
  }: Burn) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const burnIx = await this.burnInstruction({
      amount,
      exchangeAccount,
      owner,
      tokenBurn,
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
    const updateTx = new web3.Transaction().add(updateIx)
    const burnTx = new web3.Transaction().add(approveIx).add(burnIx)
    const txs = await this.processOperations([updateTx, burnTx])
    signers ? txs[1].partialSign(...signers) : null
    const promisesTx = txs.map((tx) =>
      web3.sendAndConfirmRawTransaction(this.connection, tx.serialize(), {
        skipPreflight: true
      })
    )
    return Promise.all(promisesTx)
  }
  public async mint({ amount, exchangeAccount, owner, to, signers }: Mint) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const mintIx = await this.mintInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const updateTx = new web3.Transaction().add(updateIx)
    const mintTx = new web3.Transaction().add(mintIx)
    const txs = await this.processOperations([updateTx, mintTx])
    signers ? txs[1].partialSign(...signers) : null
    const promisesTx = txs.map((tx) =>
      web3.sendAndConfirmRawTransaction(this.connection, tx.serialize(), {
        skipPreflight: true
      })
    )
    return Promise.all(promisesTx)
  }
  public async withdraw({ amount, exchangeAccount, owner, to, signers }: Withdraw) {
    const updateIx = await this.manager.updatePricesInstruction(this.state.assetsList)
    const withdrawIx = await this.withdrawInstruction({
      amount,
      exchangeAccount,
      owner,
      to
    })
    const updateTx = new web3.Transaction().add(updateIx)
    const withdrawTx = new web3.Transaction().add(withdrawIx)
    const txs = await this.processOperations([updateTx, withdrawTx])
    signers ? txs[1].partialSign(...signers) : null
    const promisesTx = txs.map((tx) =>
      web3.sendAndConfirmRawTransaction(this.connection, tx.serialize(), {
        skipPreflight: true
      })
    )
    return Promise.all(promisesTx)
  }
}
export interface Mint {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  amount: BN
  signers?: Array<web3.Account>
}
export interface Liquidate {
  exchangeAccount: web3.PublicKey
  userUsdAccount: web3.PublicKey
  userCollateralAccount: web3.PublicKey
  signer: web3.PublicKey
  allowanceAmount: BN
  signers?: Array<web3.Account>
}
export interface Swap {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  tokenIn: web3.PublicKey
  tokenFor: web3.PublicKey
  userTokenAccountIn: web3.PublicKey
  userTokenAccountFor: web3.PublicKey
  amount: BN
  signers?: Array<web3.Account>
}
export interface Burn {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  tokenBurn: web3.PublicKey
  userTokenAccountBurn: web3.PublicKey
  amount: BN
  signers?: Array<web3.Account>
}
export interface Withdraw {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  amount: BN
  signers?: Array<web3.Account>
}
export interface MintInstruction {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  amount: BN
}
export interface SwapInstruction {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  tokenIn: web3.PublicKey
  tokenFor: web3.PublicKey
  userTokenAccountIn: web3.PublicKey
  userTokenAccountFor: web3.PublicKey
  amount: BN
}
export interface LiquidateInstruction {
  exchangeAccount: web3.PublicKey
  userUsdAccount: web3.PublicKey
  userCollateralAccount: web3.PublicKey
  signer: web3.PublicKey
}
export interface BurnInstruction {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  tokenBurn: web3.PublicKey
  userTokenAccountBurn: web3.PublicKey
  amount: BN
}
export interface WithdrawInstruction {
  exchangeAccount: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  amount: BN
}
export interface DepositInstruction {
  exchangeAccount: web3.PublicKey
  userCollateralAccount: web3.PublicKey
  amount: BN
}
export interface Init {
  admin: web3.PublicKey
  nonce: number
  assetsList: web3.PublicKey
  collateralToken: web3.PublicKey
  collateralAccount: web3.PublicKey
  liquidationAccount: web3.PublicKey
}
export interface ExchangeState {
  admin: web3.PublicKey
  nonce: number
  debtShares: BN
  collateralShares: BN
  assetsList: web3.PublicKey
  collateralToken: web3.PublicKey
  collateralAccount: web3.PublicKey
  liquidationAccount: web3.PublicKey
  collateralizationLevel: number
  maxDelay: number
  fee: number
  liquidationPenalty: number
  liquidationThreshold: number
}
export interface ExchangeAccount {
  owner: web3.PublicKey
  debtShares: BN
  collateralShares: BN
}
