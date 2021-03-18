#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;

const TOKEN_DECIMALS: u8 = 6;

#[program]
pub mod manager {
    use std::borrow::BorrowMut;

    use super::*;
    #[state]
    pub struct InternalState {
        pub admin: Pubkey,
        pub initialized: bool,
    }
    impl InternalState {
        pub fn new(_ctx: Context<New>) -> Result<Self> {
            Ok(Self {
                admin: Pubkey::default(),
                initialized: false,
            })
        }

        pub fn initialize(&mut self, _ctx: Context<Initialize>, admin: Pubkey) -> Result<()> {
            self.initialized = true;
            self.admin = admin;
            Ok(())
        }
        pub fn create_asset_list(
            &mut self,
            ctx: Context<CreateAssetList>,
            collateral_token: Pubkey,
            collateral_token_feed: Pubkey,
            usd_token: Pubkey,
        ) -> Result<()> {
            if !self.admin.eq(ctx.accounts.signer.key) {
                return Err(ErrorCode::Unauthorized.into());
            }
            let usd_asset = Asset {
                decimals: TOKEN_DECIMALS,
                asset_address: usd_token,
                feed_address: Pubkey::default(), // unused
                last_update: std::u64::MAX, // we dont update usd price
                price: 1 * 10u128.pow(4),
                supply: 0,
            };
            let collateral_asset = Asset {
                decimals: TOKEN_DECIMALS,
                asset_address: collateral_token,
                feed_address: collateral_token_feed,
                last_update: 0,
                price: 0,
                supply: 0,
            };
            ctx.accounts.assets_list.assets = vec![usd_asset, collateral_asset];
            Ok(())
        }
    }
}
#[derive(Accounts)]
pub struct New {}
#[derive(Accounts)]
pub struct Initialize {}
#[derive(Accounts)]
pub struct CreateAssetList<'info> {
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    pub assets_list: ProgramAccount<'info, AssetsList>,
}
#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone)]
pub struct Asset {
    pub feed_address: Pubkey,
    pub asset_address: Pubkey,
    pub price: u128,
    pub supply: u128,
    pub decimals: u8,
    pub last_update: u64,
}
#[account]
pub struct AssetsList {
    pub initialized: bool,
    pub assets: Vec<Asset>,
}
#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("You are not admin")]
    Unauthorized,
}
