#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;

#[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto};

    use super::*;
    #[state]
    pub struct InternalState {
        pub admin: Pubkey,
        pub program_signer: Pubkey,
        pub nonce: u8,
        pub debt_shares: u64,
        pub collateral_shares: u64,
        pub collateral_token: Pubkey,
        pub collateral_account: Pubkey,
        pub assets_list: Pubkey,
        pub collateralization_level: u32, // in % should range from 300%-1000%
        pub max_delay: u32,               // max blocks of delay 100 blocks ~ 1 min
        pub fee: u8,                      // in basis points 30 ~ 0.3%
    }
    impl InternalState {
        pub fn new(ctx: Context<New>, nonce: u8) -> Result<Self> {
            Ok(Self {
                admin: *ctx.accounts.admin.key,
                program_signer: *ctx.accounts.program_signer.key,
                nonce: nonce,
                debt_shares: 0u64,
                collateral_shares: 0u64,
                collateral_token: *ctx.accounts.collateral_token.key,
                collateral_account: *ctx.accounts.collateral_account.key,
                assets_list: *ctx.accounts.assets_list.key,
                collateralization_level: 1000,
                max_delay: 10,
                fee: 30,
            })
        }
    }
    pub fn create_exchange_account(
        ctx: Context<CreateExchangeAccount>,
        owner: Pubkey,
    ) -> ProgramResult {
        let exchange_account = &mut ctx.accounts.exchange_account;
        exchange_account.owner = owner;
        exchange_account.debt_shares = 0;
        exchange_account.collateral_shares = 0;
        Ok(())
    }
}
#[derive(Accounts)]
pub struct New<'info> {
    pub admin: AccountInfo<'info>,
    pub collateral_token: AccountInfo<'info>,
    pub collateral_account: AccountInfo<'info>,
    pub assets_list: AccountInfo<'info>,
    pub program_signer: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct CreateExchangeAccount<'info> {
    #[account(init)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub rent: Sysvar<'info, Rent>,
}
#[account]
pub struct ExchangeAccount {
    pub owner: Pubkey,
    pub debt_shares: u64,
    pub collateral_shares: u64,
}
#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("You are not admin")]
    Unauthorized,
}
