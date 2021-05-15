use anchor_lang::prelude::*;
pub mod pc;
use pc::Price;
#[program]
pub mod pyth {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, price: i64, expo: u8, conf: u64) -> ProgramResult {
        let oracle = &ctx.accounts.price;

        let mut price_oracle = Price::load(&oracle).unwrap();

        price_oracle.agg.price = price;
        price_oracle.agg.conf = conf;
        price_oracle.expo = -(expo as i32); // until we get i32
        price_oracle.ptype = pc::PriceType::Price;
        Ok(())
    }
    pub fn set_price(ctx: Context<SetPrice>, price: i64) -> ProgramResult {
        let oracle = &ctx.accounts.price;

        let mut price_oracle = Price::load(&oracle).unwrap();
        price_oracle.agg.price = price as i64;
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

#[error]
pub enum ErrorCode {
    #[msg("This is an error message clients will automatically display")]
    Hello,
}