import { DEV_NET, Network, TEST_NET } from './network'
import idl from './idl/manager.json'
import { BN, Idl, Program, Provider, web3 } from '@project-serum/anchor'
import { IWallet } from '.'
import { DEFAULT_PUBLIC_KEY } from './utils'
import {
  Connection,
  PublicKey,
  ConfirmOptions,
  Account,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction
} from '@solana/web3.js'
export class Manager {
  connection: Connection
  network: Network
  programId: PublicKey
  idl: Idl = idl as Idl
  program: Program
  public constructor(
    connection: Connection,
    network: Network,
    wallet: IWallet,
    programId?: PublicKey,
    opts?: ConfirmOptions
  ) {
    this.connection = connection
    this.network = network
    // This will be unused
    const provider = new Provider(connection, wallet, opts || Provider.defaultOptions())
    switch (network) {
      case Network.LOCAL:
        this.programId = programId
        this.program = new Program(idl as Idl, this.programId, provider)
        break
      case Network.DEV:
        this.programId = DEV_NET.manager
        this.program = new Program(idl as Idl, this.programId, provider)
        break
      case Network.TEST:
        this.programId = TEST_NET.manager
        this.program = new Program(idl as Idl, this.programId, provider)
        break
      default:
        throw new Error('Not supported')
    }
  }
  public async init(admin: PublicKey) {
    await this.program.state.rpc.new(admin)
  }
  public async getState() {
    return (await this.program.state.fetch()) as { admin: PublicKey; initialized: boolean }
  }
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
    assetsAdmin,
    assetsList,
    collateralToken,
    collateralTokenFeed,
    exchangeAuthority,
    usdToken
  }: InitializeAssetList) {
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
    assetIndex,
    newSupply
  }: SetAssetSupply) {
    return await this.program.rpc.setAssetSupply(new BN(assetIndex), newSupply, {
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
  exchangeAuthority: PublicKey
  collateralToken: PublicKey
  collateralTokenFeed: PublicKey
  usdToken: PublicKey
  assetsAdmin: Account
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
  exchangeAuthority: PublicKey
  initialized: boolean
  assets: Array<Asset>
}
export interface SetAssetSupply {
  assetIndex: number
  assetsList: PublicKey
  exchangeAuthority: Account
  newSupply: BN
}
export interface SetAssetMaxSupply {
  assetAddress: PublicKey
  assetsList: PublicKey
  assetsAdmin: Account
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
