#![feature(proc_macro_hygiene)]

mod math;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};

#[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto};

    use crate::math::get_collateral_shares;

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
        pub fn deposit(&mut self, ctx: Context<Deposit>, amount: u64) -> Result<()> {
            let exchange_collateral_balance = ctx.accounts.collateral_account.amount;
            // Transfer token
            let seeds = &[self.program_signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            let result = token::transfer(cpi_ctx, amount);
            let new_shares = get_collateral_shares(
                &exchange_collateral_balance,
                &amount,
                &self.collateral_shares,
            );
            let exchange_account = &mut ctx.accounts.exchange_account;
            exchange_account.collateral_shares += new_shares;
            self.collateral_shares += new_shares;
            Ok(())
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
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_collateral_account: CpiAccount<'info, TokenAccount>,
    pub token_program: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Deposit<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.user_collateral_account.to_account_info(),
            to: accounts.collateral_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
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
