import { Network } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, web3, utils } from '@project-serum/anchor'
import { IWallet } from '.'
import { DEFAULT_PUBLIC_KEY, signAndSend } from './utils'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Manager } from './manager'

export class Exchange {
  connection: web3.Connection
  network: Network
  manager: Manager
  wallet: IWallet
  programId: web3.PublicKey
  idl: Idl = idl as Idl
  program: Program
  opts?: web3.ConfirmOptions
  public constructor(
    connection: web3.Connection,
    network: Network,
    wallet: IWallet,
    manager: Manager,
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
      this.program = new Program(idl as Idl, programId, provider)
    } else {
      // We will add it once we deploy
      throw new Error('Not supported')
    }
  }
  public async init({
    admin,
    assetsList,
    collateralAccount,
    collateralToken,
    nonce,
    programSigner
  }: Init) {
    // @ts-expect-error
    await this.program.state.rpc.new(nonce, {
      accounts: {
        admin: admin,
        collateralToken: collateralToken,
        collateralAccount: collateralAccount,
        assetsList: assetsList,
        programSigner: programSigner
      }
    })
  }
  public async getState() {
    return (await this.program.state()) as ExchangeState
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
    collateralAccount,
    exchangeAccount,
    exchangeAuthority,
    userCollateralAccount
  }: DepositInstruction) {
    // @ts-expect-error
    return (await this.program.state.instruction.deposit(amount, {
      accounts: {
        exchangeAccount: exchangeAccount,
        collateralAccount: collateralAccount,
        userCollateralAccount: userCollateralAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        exchangeAuthority: exchangeAuthority
      }
    })) as web3.TransactionInstruction
  }
  public async mintInstruction({
    amount,
    exchangeAccount,
    exchangeAuthority,
    assetsList,
    managerProgram,
    owner,
    usdToken,
    to
  }: MintInstruction) {
    // @ts-expect-error
    return await (this.program.state.instruction.mint(amount, {
      accounts: {
        exchangeAuthority: exchangeAuthority,
        usdToken: usdToken,
        to: to,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        exchangeAccount: exchangeAccount,
        owner: owner,
        assetsList: assetsList,
        managerProgram: managerProgram
      }
    }) as web3.TransactionInstruction)
  }
  public async updateAndMint({
    amount,
    exchangeAccount,
    exchangeAuthority,
    assetsList,
    managerProgram,
    owner,
    usdToken,
    to,
    signers
  }: UpdateAndMint) {
    const updateIx = await this.manager.updatePricesInstruction(assetsList)
    const mintIx = await this.mintInstruction({
      amount,
      assetsList,
      exchangeAccount,
      exchangeAuthority,
      managerProgram,
      owner,
      to,
      usdToken
    })
    const updateTx = new web3.Transaction().add(updateIx)
    const mintTx = new web3.Transaction().add(mintIx)
    updateTx.feePayer = this.wallet.publicKey
    mintTx.feePayer = this.wallet.publicKey

    const blockhash = await this.connection.getRecentBlockhash(
      this.opts?.commitment || Provider.defaultOptions().commitment
    )
    updateTx.recentBlockhash = blockhash.blockhash
    mintTx.recentBlockhash = blockhash.blockhash
    this.wallet.signAllTransactions([updateTx, mintTx])
    signers.forEach((signer) => {
      mintTx.partialSign(signer)
    })
    const promiseUpdateTx = web3.sendAndConfirmRawTransaction(
      this.connection,
      updateTx.serialize(),
      this.opts || Provider.defaultOptions()
    )
    const promiseMintTx = web3.sendAndConfirmRawTransaction(this.connection, mintTx.serialize(), {
      skipPreflight: true
    })
    return Promise.all([promiseUpdateTx, promiseMintTx])
  }
}
export interface UpdateAndMint {
  exchangeAccount: web3.PublicKey
  assetsList: web3.PublicKey
  usdToken: web3.PublicKey
  exchangeAuthority: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  managerProgram: web3.PublicKey
  amount: BN
  signers?: Array<web3.Account>
}
export interface MintInstruction {
  exchangeAccount: web3.PublicKey
  assetsList: web3.PublicKey
  usdToken: web3.PublicKey
  exchangeAuthority: web3.PublicKey
  owner: web3.PublicKey
  to: web3.PublicKey
  managerProgram: web3.PublicKey
  amount: BN
}
export interface DepositInstruction {
  exchangeAccount: web3.PublicKey
  collateralAccount: web3.PublicKey
  userCollateralAccount: web3.PublicKey
  exchangeAuthority: web3.PublicKey
  amount: BN
}
export interface Init {
  admin: web3.PublicKey
  programSigner: web3.PublicKey
  nonce: number
  assetsList: web3.PublicKey
  collateralToken: web3.PublicKey
  collateralAccount: web3.PublicKey
}
export interface ExchangeState {
  admin: web3.PublicKey
  programSigner: web3.PublicKey
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
