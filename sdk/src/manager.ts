import { Network } from './network'
import idl from './idl/manager.json'
import { Idl, Program, Provider, web3, Wallet } from '@project-serum/anchor'

export class Manager {
  connection: web3.Connection
  network: Network
  programId: web3.PublicKey
  idl: Idl = idl as Idl
  program: Program
  public constructor(
    connection: web3.Connection,
    network: Network,
    programId?: web3.PublicKey,
    opts?: web3.ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    this.programId = programId
    // This will be unused
    const wallet: Wallet = new Wallet(new web3.Account())
    const provider = new Provider(connection, wallet, opts || Provider.defaultOptions())
    if (network === Network.LOCAL) {
      this.program = new Program(idl as Idl, programId, provider)
    } else {
      // We will add it once we deploy
      throw new Error('Not supported')
    }
  }
}
