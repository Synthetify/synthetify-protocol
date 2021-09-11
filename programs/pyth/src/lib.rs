use anchor_lang::prelude::*;
pub mod pc;
use pc::{Price, PriceStatus};

declare_id!("3URDD3Eutw6SufPBzNm2dbwqwvQjRUFCtqkKVsjk3uSE");

#[program]
pub mod pyth {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, price: i64, expo: i32, conf: u64) -> ProgramResult {
        let oracle = &ctx.accounts.price;

        let mut price_oracle = Price::load(&oracle).unwrap();

        price_oracle.agg.status = PriceStatus::Trading;
        price_oracle.agg.price = price;
        price_oracle.agg.conf = conf;
        price_oracle.twap.val = price;
        price_oracle.twac.val = conf as i64;
        price_oracle.expo = expo;
        price_oracle.ptype = pc::PriceType::Price;
        Ok(())
    }
    pub fn set_price(ctx: Context<SetPrice>, price: i64) -> ProgramResult {
        let oracle = &ctx.accounts.price;
        let mut price_oracle = Price::load(&oracle).unwrap();
        price_oracle.agg.price = price as i64;
        Ok(())
    }
    pub fn set_trading(ctx: Context<SetPrice>, status: u8) -> ProgramResult {
        let oracle = &ctx.accounts.price;
        let mut price_oracle = Price::load(&oracle).unwrap();
        match status {
            0 => price_oracle.agg.status = PriceStatus::Unknown,
            1 => price_oracle.agg.status = PriceStatus::Trading,
            2 => price_oracle.agg.status = PriceStatus::Halted,
            3 => price_oracle.agg.status = PriceStatus::Auction,
            _ => {
                msg!("Unknown status: {}", status);
                return Err(ProgramError::Custom(1559));
            }
        }
        Ok(())
    }
    pub fn set_twap(ctx: Context<SetPrice>, value: u64) -> ProgramResult {
        let oracle = &ctx.accounts.price;
        let mut price_oracle = Price::load(&oracle).unwrap();
        price_oracle.twap.val = value as i64;

        Ok(())
    }
}
#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(mut)]
    pub price: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub price: AccountInfo<'info>,
}
