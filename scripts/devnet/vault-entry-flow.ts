import { BN, Provider } from "@project-serum/anchor"
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token"
import { DEVNET_ADMIN_ACCOUNT } from './admin'
import { Keypair, PublicKey, Transaction } from "@solana/web3.js"
import {sleep, tou64} from '@synthetify/sdk/lib/utils'
import { Exchange, Network, signAndSend } from "../../sdk/lib"

const sny = new PublicKey('91qzpKj8nwYkssvG52moAtUUiWV5w4CuHwhkPQtBWTDE')
const xusd = new PublicKey('76qqFEokX3VgTxXX8dZYkDMijFtoYbJcxZZU4DgrDnUF')
const owner = Keypair.generate()

const provider = Provider.local('https://api.devnet.solana.com', {
  // preflightCommitment: 'max',
  skipPreflight: true
})
const connection = provider.connection
// @ts-expect-error
const wallet = provider.wallet.payer as Keypair

const main = async () => {
  await snyXusdFlow()
}

const snyXusdFlow = async () => {
  console.log(`owner =  ${owner.publicKey}`)
    // @ts-expect-error
    const exchange = await Exchange.build(connection, Network.DEV, DEVNET_ADMIN_ACCOUNT, wallet)
    await exchange.getState()

    const snyToken = new Token(connection, new PublicKey(sny), TOKEN_PROGRAM_ID, wallet)
    const xUsdToken = new Token(connection, new PublicKey(xusd), TOKEN_PROGRAM_ID, wallet)

    const [ownerSny, ownerXUsd, _] = await Promise.all([
      snyToken.createAccount(owner.publicKey),
      xUsdToken.createAccount(owner.publicKey),
      connection.requestAirdrop(owner.publicKey, 1e9)
    ])

    const snyAmount = new BN(10).pow(new BN(6)).muln(1000) // 1000 SNY
    const toBorrowAmount = new BN(10).pow(new BN(6)).muln(100) // 100 USD

    await snyToken.mintTo(ownerSny, DEVNET_ADMIN_ACCOUNT, [], tou64(snyAmount))
    const vault = await exchange.getVaultForPair(xusd, sny)

    const { ix } = await exchange.createVaultEntryInstruction({
        owner: owner.publicKey,
        synthetic: xusd,
        collateral: sny,
    })
    await signAndSend(new Transaction().add(ix), [owner], connection)

    let vaultEntry
    while (true) {
      try {
        await sleep(2000)
        vaultEntry = await exchange.getVaultEntryForOwner(xusd, sny, owner.publicKey)
        break
      }catch (e) {}
    }
    // NOTICE: to make easy all oracle was updated, but only collateral/synthetic are required for update

    // DEPOSIT (token approval, deposit)
    const depositApproveIx = Token.createApproveInstruction(
      snyToken.programId,
      ownerSny,
      exchange.exchangeAuthority,
      owner.publicKey,
      [],
      tou64(snyAmount)
    )
    const depositIx = await exchange.vaultDepositInstruction({
        collateral: sny,
        synthetic: xusd,
        owner: owner.publicKey,
        amount: snyAmount,
        userCollateralAccount: ownerSny,
        reserveAddress: vault.collateralReserve,
    })
    await signAndSend(new Transaction().add(depositApproveIx).add(depositIx), [owner], connection)

    // BORROW (update oracle, borrow)
    const updatePriceIx =  await exchange.updatePricesInstruction(exchange.state.assetsList)
    const borrowVaultIx = await exchange.borrowVaultInstruction({
      collateral: sny,
      synthetic: xusd,
      owner: owner.publicKey,
      amount: toBorrowAmount,
      to: ownerXUsd,
    })
    await signAndSend(new Transaction().add(updatePriceIx).add(borrowVaultIx), [owner], connection)

    // REPAY (token approval, update oracle, repay)
    const repayApproveIx = Token.createApproveInstruction(
      TOKEN_PROGRAM_ID,
      ownerXUsd,
      exchange.exchangeAuthority,
      owner.publicKey,
      [],
      tou64(toBorrowAmount)
    )
    const repayIx = await exchange.repayVaultInstruction({
      collateral: sny,
      synthetic: xusd,
      owner: owner.publicKey,
      amount: toBorrowAmount,
      userTokenAccountRepay: ownerXUsd,
    })
    await signAndSend(new Transaction().add(repayApproveIx).add(updatePriceIx).add(repayIx), [owner], connection)

    // WITHDRAW (update oracle, withdraw)
    const withdrawIx = await exchange.withdrawVaultInstruction({
      collateral: sny,
      synthetic: xusd,
      owner: owner.publicKey,
      amount: new BN('ffffffffffffffff', 16),
      userCollateralAccount: ownerXUsd
    })
    await signAndSend(new Transaction().add(updatePriceIx).add(withdrawIx), [owner], connection)
}

main()