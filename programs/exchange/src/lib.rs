#![feature(proc_macro_hygiene)]

mod math;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
use manager::{Asset, AssetsList, SetAssetSupply};
use math::*;

#[program]
pub mod exchange {
    use std::{borrow::BorrowMut, convert::TryInto};

    use crate::math::{calculate_debt, get_collateral_shares};

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
            if !ctx
                .accounts
                .collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
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
        pub fn mint(&mut self, ctx: Context<Mint>, amount: u64) -> Result<()> {
            let mint_token_adddress = ctx.accounts.usd_token.key;
            let collateral_account = &ctx.accounts.collateral_account;
            if !mint_token_adddress.eq(&ctx.accounts.assets_list.assets[0].asset_address) {
                return Err(ErrorCode::NotSyntheticUsd.into());
            }
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            let assets = &ctx.accounts.assets_list.assets;
            let exchange_account = &mut ctx.accounts.exchange_account;
            let slot = ctx.accounts.clock.slot;
            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();

            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);

            let mint_asset = &assets[0];
            let collateral_asset = &assets[1];

            let amount_mint_usd = calculate_amount_mint_in_usd(&mint_asset, amount);
            let collateral_amount = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let max_user_debt = calculate_max_user_debt_in_usd(
                &collateral_asset,
                self.collateralization_level,
                collateral_amount,
            );
            if max_user_debt - user_debt < amount_mint_usd {
                return Err(ErrorCode::MintLimit.into());
            }
            let new_shares = calculate_new_shares(self.debt_shares, total_debt, amount_mint_usd);
            let seeds = &[self.program_signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];
            let cpi_program = ctx.accounts.manager_program.clone();
            let cpi_accounts = SetAssetSupply {
                assets_list: ctx.accounts.assets_list.clone().into(),
                exchange_authority: ctx.accounts.exchange_authority.clone().into(),
            };
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts).with_signer(signer);
            manager::cpi::set_asset_supply(
                cpi_ctx,
                mint_asset.asset_address,
                mint_asset.supply + amount,
            );
            self.debt_shares += new_shares;
            exchange_account.debt_shares += new_shares;

            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::mint_to(cpi_ctx, amount);
            Ok(())
        }
        pub fn withdraw(&mut self, ctx: Context<Withdraw>, amount: u64) -> Result<()> {
            let collateral_account = &ctx.accounts.collateral_account;
            if !collateral_account
                .to_account_info()
                .key
                .eq(&self.collateral_account)
            {
                return Err(ErrorCode::CollateralAccountError.into());
            }
            let slot = ctx.accounts.clock.slot;
            let assets = &ctx.accounts.assets_list.assets;
            let total_debt = calculate_debt(assets, slot, self.max_delay).unwrap();

            let exchange_account = &mut ctx.accounts.exchange_account;

            let user_debt =
                calculate_user_debt_in_usd(exchange_account, total_debt, self.debt_shares);

            let collateral_asset = &assets[1];

            let collateral_amount = calculate_user_collateral_in_token(
                exchange_account.collateral_shares,
                self.collateral_shares,
                collateral_account.amount,
            );
            let max_user_debt = calculate_max_user_debt_in_usd(
                &collateral_asset,
                self.collateralization_level,
                collateral_amount,
            );
            let max_withdraw_in_usd = calculate_max_withdraw_in_usd(
                &max_user_debt,
                &user_debt,
                &self.collateralization_level,
            );
            let max_withdrawable =
                calculate_max_withdrawable(collateral_asset, max_withdraw_in_usd);
            if max_withdrawable < amount {
                return Err(ErrorCode::WithdrawLimit.into());
            }
            let shares_to_burn =
                amount_to_shares(self.collateral_shares, collateral_account.amount, amount);
            let seeds = &[self.program_signer.as_ref(), &[self.nonce]];
            let signer = &[&seeds[..]];

            self.collateral_shares -= shares_to_burn;
            exchange_account.collateral_shares -= shares_to_burn;

            let cpi_ctx = CpiContext::from(&*ctx.accounts).with_signer(signer);
            token::transfer(cpi_ctx, amount);
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
pub struct Withdraw<'info> {
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub collateral_account: CpiAccount<'info, TokenAccount>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.collateral_account.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Mint<'info> {
    #[account(mut)]
    pub assets_list: CpiAccount<'info, AssetsList>,
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut)]
    pub usd_token: AccountInfo<'info>,
    #[account(mut)]
    pub to: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub manager_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: ProgramAccount<'info, ExchangeAccount>,
    pub clock: Sysvar<'info, Clock>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    pub collateral_account: CpiAccount<'info, TokenAccount>,
}
impl<'a, 'b, 'c, 'info> From<&Mint<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Mint<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
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
    #[msg("Not synthetic USD asset")]
    NotSyntheticUsd,
    #[msg("Oracle price is outdated")]
    OutdatedOracle,
    #[msg("Mint limit")]
    MintLimit,
    #[msg("Withdraw limit")]
    WithdrawLimit,
    #[msg("Invalid collateral_account")]
    CollateralAccountError,
}
