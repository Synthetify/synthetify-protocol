import { BN, Provider } from '@project-serum/anchor'
import { u64 } from '@solana/spl-token'
import {
  PublicKey,
  Transaction,
  Connection,
  ConfirmOptions,
  sendAndConfirmRawTransaction,
  Account,
  Keypair
} from '@solana/web3.js'
import { Asset, AssetsList, Collateral, Decimal, ExchangeAccount } from './exchange'
import { Network } from './network'

export const DEFAULT_PUBLIC_KEY = new PublicKey(0)
export const ORACLE_OFFSET = 8
export const ACCURACY = 6 // TODO: remove, use always XUSD_DECIMALS
export const UNIFIED_PERCENT_SCALE = 5
export const SNY_DECIMALS = 6
export const XUSD_DECIMALS = 6
export const INTEREST_RATE_DECIMALS = 18
// hex code must be at the end of message
export enum ERRORS {
  SIGNATURE = 'Error: Signature verification failed',
  SIGNER = 'Error: unknown signer',
  PANICKED = 'Program failed to complete',
  SERIALIZATION = '0xa4',
  ALLOWANCE = 'custom program error: 0x1',
  NO_SIGNERS = 'Error: No signers'
}
export enum ERRORS_EXCHANGE {
  UNAUTHORIZED = '0x12c', //0
  NOT_SYNTHETIC_USD = '0x12d', //1
  OUTDATED_ORACLE = '0x12e', //2
  MINT_LIMIT = '0x12f', //3
  WITHDRAW_LIMIT = '0x130', //4
  COLLATERAL_ACCOUNT_ERROR = '0x131', //5
  SYNTHETIC_COLLATERAL = '0x132', //6
  INVALID_ASSETS_LIST = '0x133', //7
  INVALID_LIQUIDATION = '0x134', //8
  INVALID_SIGNER = '0x135', //9
  WASH_TRADE = '0x136', //10
  EXCHANGE_LIQUIDATION_ACCOUNT = '0x137', //11
  LIQUIDATION_DEADLINE = '0x138', //12
  HALTED = '0x139', //13
  NO_REWARDS = '0x13a', //14
  FUND_ACCOUNT_ERROR = '0x13b', //15
  SWAP_UNAVAILABLE = '0x13c', //16
  INITIALIZED = '0x13d', //17
  UNINITIALIZED = '0x13e', //18
  NO_ASSET_FOUND = '0x13f', //19
  MAX_SUPPLY = '0x140', //20
  NOT_COLLATERAL = '0x141', //21
  ALREADY_COLLATERAL = '0x142', //22
  INSUFFICIENT_VALUE_TRADE = '0x143', //23
  INSUFFICIENT_AMOUNT_ADMIN_WITHDRAW = '0x144', //24
  SETTLEMENT_NOT_REACHED = '0x145', //25
  USD_SETTLEMENT = '0x146', //26
  PARAMETER_OUT_OF_RANGE = '0x147', //27
  OVERFLOW = '0x148', //28
  DIFFERENT_SCALE = '0x149', //29
  MISMATCHED_TOKENS = '0x14a', //30
  SWAPLINE_LIMIT = '0x14b', //31
  COLLATERAL_LIMIT_EXCEEDED = '0x14c', //32
  USER_BORROW_LIMIT = '0x14d', // 33
  VAULT_BORROW_LIMIT = '0x14e', // 34
  VAULT_WITHDRAW_LIMIT = '0x14f', // 35
  INVALID_ACCOUNT = '0x150', // 36
  PRICE_CONFIDENCE_OUT_OF_RANGE = '0x151', // 37
  INVALID_ORACLE_PROGRAM = '0x152'
}
export const signAndSend = async (
  tx: Transaction,
  signers: Array<Account | Keypair>,
  connection: Connection,
  opts?: ConfirmOptions
) => {
  tx.setSigners(...signers.map((s) => s.publicKey))
  const blockhash = await connection.getRecentBlockhash(
    opts?.commitment || Provider.defaultOptions().commitment
  )
  tx.recentBlockhash = blockhash.blockhash
  tx.partialSign(...signers)
  const rawTx = tx.serialize()
  return await sendAndConfirmRawTransaction(connection, rawTx, opts || Provider.defaultOptions())
}

export const tou64 = (amount) => {
  // eslint-disable-next-line new-cap
  return new u64(amount.toString())
}
export const percentToDecimal = (value: number): Decimal => {
  return { val: new BN(value * 10 ** (UNIFIED_PERCENT_SCALE - 2)), scale: UNIFIED_PERCENT_SCALE }
}
export const decimalToPercent = (decimal: Decimal): number => {
  return decimal.val.toNumber() / 10 ** (decimal.scale - 2)
}
export const toDecimal = (value: BN, scale: number): Decimal => {
  return { val: value, scale: scale }
}
export const toScale = (decimal: Decimal, scale: number) => {
  if (decimal.scale > scale) {
    return {
      val: decimal.val.div(new BN(10).pow(new BN(decimal.scale - scale))),
      scale
    }
  } else {
    return {
      val: decimal.val.mul(new BN(10).pow(new BN(scale - decimal.scale))),
      scale
    }
  }
}
export const fromPercentToInterestRate = (percent: number) => {
  return toScale(percentToDecimal(percent), INTEREST_RATE_DECIMALS)
}

export const divUp = (a: BN, b: BN) => {
  return a.add(b.subn(1)).div(b)
}
export const calculateLiquidation = (
  maxDebt: BN,
  debtValue: BN,
  penaltyToLiquidator: Decimal,
  penaltyToExchange: Decimal,
  liquidationRate: Decimal,
  asset: Asset,
  collateral: Collateral
) => {
  if (maxDebt.gt(debtValue)) {
    throw new Error('Account is safe')
  }
  let maxAmount: BN
  if (debtValue.lte(new BN(1 * 10 ** XUSD_DECIMALS))) {
    maxAmount = debtValue
  } else {
    maxAmount = debtValue.mul(liquidationRate.val).divn(10 ** liquidationRate.scale)
  }
  const seizedCollateralInUsd = divUp(
    maxAmount.mul(penaltyToExchange.val.add(penaltyToLiquidator.val)),
    new BN(10 ** penaltyToExchange.scale)
  ).add(maxAmount)

  const seizedInToken = seizedCollateralInUsd
    .mul(new BN(10).pow(new BN(collateral.reserveBalance.scale + ORACLE_OFFSET - ACCURACY)))
    .div(asset.price.val)

  const collateralToExchange = divUp(
    seizedInToken.mul(penaltyToExchange.val),
    new BN(10 ** penaltyToExchange.scale).add(penaltyToExchange.val).add(penaltyToLiquidator.val)
  )
  const collateralToLiquidator = seizedInToken.sub(collateralToExchange)
  return { seizedInToken, maxAmount, collateralToExchange, collateralToLiquidator }
}

export const calculateDebt = (assetsList: AssetsList) => {
  return assetsList.synthetics.reduce(
    (acc, synthetic) =>
      acc.add(
        synthetic.supply.val
          .sub(synthetic.swaplineSupply.val)
          .mul(assetsList.assets[synthetic.assetIndex].price.val)
          .div(new BN(10 ** (synthetic.supply.scale + ORACLE_OFFSET - ACCURACY)))
      ),
    new BN(0)
  )
}
export const calculateUserCollateral = (
  exchangeAccount: ExchangeAccount,
  assetsList: AssetsList
) => {
  return exchangeAccount.collaterals.reduce((acc, entry) => {
    const collateral = assetsList.collaterals[entry.index]
    return acc.add(
      entry.amount
        .mul(assetsList.assets[collateral.assetIndex].price.val)
        .div(new BN(10 ** (collateral.reserveBalance.scale + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const calculateUserMaxDebt = (exchangeAccount: ExchangeAccount, assetsList: AssetsList) => {
  return exchangeAccount.collaterals.reduce((acc, entry) => {
    const collateral = assetsList.collaterals[entry.index]
    const asset = assetsList.assets[collateral.assetIndex]
    return acc.add(
      entry.amount
        .mul(asset.price.val)
        .mul(collateral.collateralRatio.val)
        .divn(10 ** collateral.collateralRatio.scale)
        .div(new BN(10 ** (collateral.reserveBalance.scale + ORACLE_OFFSET - ACCURACY)))
    )
  }, new BN(0))
}
export const toEffectiveFee = (fee: Decimal, userCollateralBalance: BN) => {
  // decimals of token = 6
  const ONE_SNY = new BN(1000000)
  let discount = 0
  switch (true) {
    case userCollateralBalance.lt(ONE_SNY.muln(100)):
      discount = 0
      break
    case userCollateralBalance.lt(ONE_SNY.muln(200)):
      discount = 1
      break

    case userCollateralBalance.lt(ONE_SNY.muln(500)):
      discount = 2
      break
    case userCollateralBalance.lt(ONE_SNY.muln(1000)):
      discount = 3
      break
    case userCollateralBalance.lt(ONE_SNY.muln(2000)):
      discount = 4
      break
    case userCollateralBalance.lt(ONE_SNY.muln(5000)):
      discount = 5
      break
    case userCollateralBalance.lt(ONE_SNY.muln(10000)):
      discount = 6
      break
    case userCollateralBalance.lt(ONE_SNY.muln(25000)):
      discount = 7
      break
    case userCollateralBalance.lt(ONE_SNY.muln(50000)):
      discount = 8
      break
    case userCollateralBalance.lt(ONE_SNY.muln(100000)):
      discount = 9
      break
    case userCollateralBalance.lt(ONE_SNY.muln(250000)):
      discount = 10
      break
    case userCollateralBalance.lt(ONE_SNY.muln(500000)):
      discount = 11
      break
    case userCollateralBalance.lt(ONE_SNY.muln(1000000)):
      discount = 12
      break
    case userCollateralBalance.lt(ONE_SNY.muln(2000000)):
      discount = 13
      break
    case userCollateralBalance.lt(ONE_SNY.muln(5000000)):
      discount = 14
      break
    case userCollateralBalance.lt(ONE_SNY.muln(10000000)):
      discount = 15
      break
  }
  return toDecimal(fee.val.sub(fee.val.muln(discount).divn(100)), fee.scale)
}
export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
export const SWAPLINE_MAP: {
  [key in Network]: Array<{ synthetic: PublicKey; collateral: PublicKey }>
} = {
  [Network.DEV]: [
    {
      synthetic: new PublicKey('76qqFEokX3VgTxXX8dZYkDMijFtoYbJcxZZU4DgrDnUF'),
      collateral: new PublicKey('HgexCyLCZUydm7YcJWeZRMK9HzsU17NJQvJGnMuzGVKG')
    },
    {
      synthetic: new PublicKey('3zPcvFVBuV4f8hnwpWAsextaqFs73jB6JWvmYq5K7X2w'),
      collateral: new PublicKey('So11111111111111111111111111111111111111112')
    },
    {
      synthetic: new PublicKey('6QARYJsmN7EfnUFPn8X1qFANhT2CssLU6DyTtCkE3JNX'),
      collateral: new PublicKey('CzxkxsqcijCGLtP4jhCrjVofvjyyciRbe5XFJTEXG7Sj')
    }
  ],
  [Network.LOCAL]: [],
  [Network.MAIN]: [
    // USDC<>xUSD
    {
      synthetic: new PublicKey('83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y'),
      collateral: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    },
    // WSOL<>xSOL
    {
      synthetic: new PublicKey('BdUJucPJyjkHxLMv6ipKNUhSeY3DWrVtgxAES1iSBAov'),
      collateral: new PublicKey('So11111111111111111111111111111111111111112')
    },
    // renBTC<>xBTC
    {
      synthetic: new PublicKey('HWxpSV3QAGzLQzGAtvhSYAEr7sTQugQygnni1gnUGh1D'),
      collateral: new PublicKey('CDJWUqTcYTVAKXAVXoQZFes5JUFc7owSeq7eMQcDSbo5')
    },
    // whETH<>xETH
    {
      synthetic: new PublicKey('8bqjz8DeSuim1sEAsQatjJN4zseyxSPdhHQcuuhL8PCK'),
      collateral: new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs')
    },
    // whFTT<>xFTT
    {
      synthetic: new PublicKey('Fr3W7NPVvdVbwMcHgA7Gx2wUxP43txdsn3iULJGFbKz9'),
      collateral: new PublicKey('EzfgjvkSwthhgHaceR3LnKXUoRkP6NUhfghdaHAj1tUv')
    }
  ],
  [Network.TEST]: []
}

export const addressToAssetSymbol: { [key: string]: string } = {
  //Local
  '8V8JuSxR4SCSbqp2f74w7Kiv93FBbqfmPQGSJ1x2MPYi': 'xUSD',
  qB6GZSkKLWkkPEzraDdroAVvMFWyvvw9PWP71PKfAsm: 'SNY',
  '5Hm3K6nNUJ8gBQTQhLBb8ZHC8BupaED6mkws3vXPuHyH': 'xBTC',
  HPxzYx1doGTbwJx6AJmtsx1iN53v6sV2nPy7VgeA5aJ7: 'xSOL',
  '2HnwLrUhdkUg7zLmC2vaU9gVppkLo9WMPHyJK49h9SRa': 'xSRM',
  //Dev
  '76qqFEokX3VgTxXX8dZYkDMijFtoYbJcxZZU4DgrDnUF': 'xUSD',
  '91qzpKj8nwYkssvG52moAtUUiWV5w4CuHwhkPQtBWTDE': 'SNY',
  HL5aKrMbm13a6VGNRSxJmy61nRsgySDacHVpLzCwHhL5: 'xBTC',
  '3zPcvFVBuV4f8hnwpWAsextaqFs73jB6JWvmYq5K7X2w': 'xSOL',
  BPyw7qZrDTiUdUTCUSMcuyZnYEf4P2yo92L15L3VoK7V: 'xFTT',
  '6QARYJsmN7EfnUFPn8X1qFANhT2CssLU6DyTtCkE3JNX': 'xETH',
  CzxkxsqcijCGLtP4jhCrjVofvjyyciRbe5XFJTEXG7Sj: 'whETH',
  So11111111111111111111111111111111111111112: 'WSOL',
  oBNJxzeq1bkmSyULuqQoQtyHQMh8st8yfm4e7WqoJky: 'stSOL',
  HgexCyLCZUydm7YcJWeZRMK9HzsU17NJQvJGnMuzGVKG: 'USDC',
  //Testnet
  '2XyMRw6MHMFVu1VBLGYKJa8GSjM5h7AvNkynu2wPpnfH': 'xUSD',
  Cf21AhB2VnwNTJk7Wf6jRHEyjXriVyprEHVp6bQzzVXX: 'SNY',
  '3Zn5ewamQsEQVv8i1vKzCHP9rpnJdH5bU3iPUQwMmoXM': 'xBTC',
  '9WNjiufPPCZDHLhkNKW6CLzqgy3Sp8yb4eQ5XaCmurXU': 'xSOL',
  '5wqex5HHs2rEkXfHgiD6VYmT5TvrK1LJscZQDkZLdi4R': 'xSRM',
  DFQXctKS9mYkU7TmcjjxP8avzqSj3euXkpiFabPuMjUo: 'xFTT',
  Auaz6F4BPLchbR42LksZxZXQnTbeShVNDp777Q2BWxP4: 'xETH',
  //Mainnet
  '83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y': 'xUSD',
  '4dmKkXNHdgYsXqBHCuMikNQWwVomZURhYvkkX5c4pQ7y': 'SNY',
  HWxpSV3QAGzLQzGAtvhSYAEr7sTQugQygnni1gnUGh1D: 'xBTC',
  BdUJucPJyjkHxLMv6ipKNUhSeY3DWrVtgxAES1iSBAov: 'xSOL',
  Fr3W7NPVvdVbwMcHgA7Gx2wUxP43txdsn3iULJGFbKz9: 'xFTT',
  '8bqjz8DeSuim1sEAsQatjJN4zseyxSPdhHQcuuhL8PCK': 'xETH',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  CDJWUqTcYTVAKXAVXoQZFes5JUFc7owSeq7eMQcDSbo5: 'renBTC',
  EzfgjvkSwthhgHaceR3LnKXUoRkP6NUhfghdaHAj1tUv: 'whFTT',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'whETH',
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'mSOL'
}
