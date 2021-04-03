import { Network } from './network'
import idl from './idl/exchange.json'
import { BN, Idl, Program, Provider, web3, utils } from '@project-serum/anchor'
import { IWallet } from '.'
import { DEFAULT_PUBLIC_KEY } from './utils'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

export class Exchange {
  connection: web3.Connection
  network: Network
  wallet: IWallet
  programId: web3.PublicKey
  idl: Idl = idl as Idl
  program: Program
  public constructor(
    connection: web3.Connection,
    network: Network,
    wallet: IWallet,
    programId?: web3.PublicKey,
    opts?: web3.ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    this.wallet = wallet
    // This will be unused
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
