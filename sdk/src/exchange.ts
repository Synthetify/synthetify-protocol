import { Network } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, web3, utils } from '@project-serum/anchor'
import { IWallet } from '.'
import { DEFAULT_PUBLIC_KEY, signAndSend, tou64 } from './utils'
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
    instance.assetsList = await instance.manager.getAssetsList(instance.state.assetsList)
    return instance
  }
  public async init({ admin, assetsList, collateralAccount, collateralToken, nonce }: Init) {
    // @ts-expect-error
    await this.program.state.rpc.new(nonce, {
      accounts: {
        admin: admin,
        collateralToken: collateralToken,
        collateralAccount: collateralAccount,
        assetsList: assetsList
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
    const mintIx = await this.swapInstruction({
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
    const mintTx = new web3.Transaction().add(approveIx).add(mintIx)
    const txs = await this.processOperations([updateTx, mintTx])
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
}
export interface ExchangeState {
  admin: web3.PublicKey
  nonce: number
  debtShares: BN
  collateralShares: BN
  assetsList: web3.PublicKey
  collateralToken: web3.PublicKey
  collateralAccount: web3.PublicKey
  collateralizationLevel: number
  maxDelay: number
  fee: number
}
export interface ExchangeAccount {
  owner: web3.PublicKey
  debtShares: BN
  collateralShares: BN
}
