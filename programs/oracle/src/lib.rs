#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;

#[program]
mod oracle {
    use super::*;

    pub fn create(ctx: Context<Create>, admin: Pubkey, initial_price: u64) -> ProgramResult {
        let feed = &mut ctx.accounts.price_feed;
        feed.admin = admin;
        feed.price = initial_price;
        Ok(())
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> ProgramResult {
        let counter = &mut ctx.accounts.price_feed;
        counter.price = price;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(init)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, has_one = admin)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(mut, has_one = admin)]
    pub price_feed: ProgramAccount<'info, PriceFeed>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}

#[account]
pub struct PriceFeed {
    pub admin: Pubkey,
    pub price: u64,
}
