#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;

#[program]
pub mod manager {
    use std::{borrow::BorrowMut, convert::TryInto};

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

        pub fn create_list(
            &mut self,
            ctx: Context<InitializeAssetsList>,
            collateral_token: Pubkey,
            collateral_token_feed: Pubkey,
            usd_token: Pubkey,
        ) -> Result<()> {
            msg!("Hellooo");
            if !self.admin.eq(ctx.accounts.signer.key) {
                return Err(ErrorCode::Unauthorized.into());
            }
            let usd_asset = Asset {
                decimals: 6,
                asset_address: usd_token,
                feed_address: Pubkey::default(), // unused
                last_update: std::u64::MAX,      // we dont update usd price
                price: 1 * 10u64.pow(4),
                supply: 0,
                max_supply: std::u64::MAX, // no limit for usd asset
            };
            let collateral_asset = Asset {
                decimals: 6,
                asset_address: collateral_token,
                feed_address: collateral_token_feed,
                last_update: 0,
                price: 0,
                supply: 0, // unused
                max_supply: std::u64::MAX, // no limit for collateral asset
            };
            ctx.accounts.assets_list.assets = vec![usd_asset, collateral_asset];
            ctx.accounts.assets_list.initialized = true;
            Ok(())
        }
        pub fn add_new_asset(
            &mut self,
            ctx: Context<AddNewAsset>,
            new_asset_feed_address: Pubkey,
            new_asset_address: Pubkey,
            new_asset_decimals: u8,
            new_asset_max_supply: u64,
        ) -> Result<()> {
            msg!("Add new asset");
            if !self.admin.eq(ctx.accounts.signer.key) {
                return Err(ErrorCode::Unauthorized.into());
            }
            let new_asset = Asset {
                decimals: new_asset_decimals,
                asset_address: new_asset_address,
                feed_address: new_asset_feed_address,
                last_update: 0,
                price: 0,
                supply: 0,
                max_supply: new_asset_max_supply,
            };

            ctx.accounts.assets_list.assets.push(new_asset);
            Ok(())
        }
    }
    pub fn create_assets_list(ctx: Context<CreateAssetsList>, length: u32) -> ProgramResult {
        let assets_list = &mut ctx.accounts.assets_list;
        assets_list.initialized = false;
        let default_asset = Asset::default();

        assets_list.assets = vec![default_asset.clone(); length.try_into().unwrap()];
        Ok(())
    }
}
#[derive(Accounts)]
pub struct New {}
#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct CreateAssetsList<'info> {
    #[account(init)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct InitializeAssetsList<'info> {
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
}

#[derive(Accounts)]
pub struct AddNewAsset<'info> {
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct Asset {
    pub feed_address: Pubkey,  // 32
    pub asset_address: Pubkey, // 32
    pub price: u64,           // 8
    pub supply: u64,          // 8
    pub decimals: u8,          // 1
    pub last_update: u64,      // 8
    pub max_supply: u64,       // 8

}
// This will need 13 + x*97 bytes for each asset
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
