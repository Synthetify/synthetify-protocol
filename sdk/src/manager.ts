import { Network } from './network'
import idl from './idl/manager.json'
import { BN, Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { IWallet } from '.'
import { DEFAULT_PUBLIC_KEY } from './utils'
export class Manager {
  connection: web3.Connection
  network: Network
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
  public async init(admin: web3.PublicKey) {
    // @ts-expect-error
    await this.program.state.rpc.new(admin)
  }
  public async getState() {
    return (await this.program.state()) as { admin: web3.PublicKey; initialized: boolean }
  }
  public async getAssetsList(assetsList: web3.PublicKey): Promise<AssetsList> {
    return await this.program.account.assetsList(assetsList)
  }
  public onAssetsListChange(address: web3.PublicKey, fn: (list: AssetsList) => void) {
    this.program.account.assetsList
      .subscribe(address, 'singleGossip')
      .on('change', (list: AssetsList) => {
        fn(list)
      })
  }
  public async createAssetsList(size: number) {
    const assetListAccount = new web3.Account()
    await this.program.rpc.createAssetsList(size, {
      accounts: {
        assetsList: assetListAccount.publicKey,
        rent: web3.SYSVAR_RENT_PUBKEY
      },
      signers: [assetListAccount],
      instructions: [
        // @ts-expect-error
        await this.program.account.assetsList.createInstruction(assetListAccount, size * 97 + 45)
      ]
    })
    return assetListAccount.publicKey
  }

  public async initializeAssetsList({
    assetsAdmin,
    assetsList,
    collateralToken,
    collateralTokenFeed,
    exchangeAuthority,
    usdToken
  }: InitializeAssetList) {
    // @ts-expect-error
    return await this.program.state.rpc.createList(
      exchangeAuthority,
      collateralToken,
      collateralTokenFeed,
      usdToken,
      {
        accounts: {
          signer: assetsAdmin.publicKey,
          assetsList: assetsList
        },
        signers: [assetsAdmin]
      }
    )
  }
  public async setAssetSupply({
    assetsList,
    exchangeAuthority,
    assetAddress,
    newSupply
  }: SetAssetSupply) {
    return await this.program.rpc.setAssetSupply(assetAddress, newSupply, {
      accounts: {
        assetsList: assetsList,
        exchangeAuthority: exchangeAuthority.publicKey
      },
      signers: [exchangeAuthority]
    })
  }
  public async setAssetMaxSupply({
    assetsList,
    assetsAdmin,
    assetAddress,
    newMaxSupply
  }: SetAssetMaxSupply) {
    // @ts-expect-error
    return await this.program.state.rpc.setMaxSupply(assetAddress, newMaxSupply, {
      accounts: {
        signer: assetsAdmin.publicKey,
        assetsList: assetsList
      },
      signers: [assetsAdmin]
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
    // @ts-expect-error
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
  public async updatePrices(assetsList: web3.PublicKey) {
    const assetsListData = await this.getAssetsList(assetsList)
    const feedAddresses = assetsListData.assets
      .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
      .map((asset) => {
        return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
      })
    return await this.program.rpc.setAssetsPrices({
      remainingAccounts: feedAddresses,
      accounts: {
        assetsList: assetsList,
        clock: web3.SYSVAR_CLOCK_PUBKEY
      }
    })
  }
  public async updatePricesInstruction(assetsList: web3.PublicKey) {
    const assetsListData = await this.getAssetsList(assetsList)
    const feedAddresses = assetsListData.assets
      .filter((asset) => !asset.feedAddress.equals(DEFAULT_PUBLIC_KEY))
      .map((asset) => {
        return { pubkey: asset.feedAddress, isWritable: false, isSigner: false }
      })
    return (await this.program.instruction.setAssetsPrices({
      remainingAccounts: feedAddresses,
      accounts: {
        assetsList: assetsList,
        clock: web3.SYSVAR_CLOCK_PUBKEY
      }
    })) as web3.TransactionInstruction
  }
}
export interface InitializeAssetList {
  exchangeAuthority: web3.PublicKey
  collateralToken: web3.PublicKey
  collateralTokenFeed: web3.PublicKey
  usdToken: web3.PublicKey
  assetsAdmin: web3.Account
  assetsList: web3.PublicKey
}
export interface Asset {
  feedAddress: web3.PublicKey
  assetAddress: web3.PublicKey
  price: BN
  supply: BN
  lastUpdate: BN
  maxSupply: BN
  decimals: number
}
export interface AssetsList {
  exchangeAuthority: web3.PublicKey
  initialized: boolean
  assets: Array<Asset>
}
export interface SetAssetSupply {
  assetAddress: web3.PublicKey
  assetsList: web3.PublicKey
  exchangeAuthority: web3.Account
  newSupply: BN
}
export interface SetAssetMaxSupply {
  assetAddress: web3.PublicKey
  assetsList: web3.PublicKey
  assetsAdmin: web3.Account
  newMaxSupply: BN
}
export interface AddNewAsset {
  tokenFeed: web3.PublicKey
  tokenAddress: web3.PublicKey
  assetsList: web3.PublicKey
  tokenDecimals: number
  maxSupply: BN
  assetsAdmin: web3.Account
}
