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
        pub assets_list_address: Pubkey,
        pub collateralization_level: u16, // in % should range from 300%-1000%
        pub max_delay: u16,               // max blocks of delay 100 blocks ~ 1 min
        pub fee: u8,                      // in basis points 30 ~ 0.3%
    }
    impl InternalState {
        pub fn new(
            _ctx: Context<New>,
            admin: Pubkey,
            program_signer: Pubkey,
            nonce: u8,
            collateral_token: Pubkey,
            collateral_account: Pubkey,
            assets_list_address: Pubkey,
        ) -> Result<Self> {
            Ok(Self {
                admin: admin,
                program_signer: program_signer,
                nonce: nonce,
                debt_shares: 0u64,
                collateral_shares: 0u64,
                collateral_token: collateral_token,
                collateral_account: collateral_account,
                assets_list_address: assets_list_address,
                collateralization_level: 1000,
                max_delay: 10,
                fee: 30,
            })
        }

    }
    // pub fn create_assets_list(ctx: Context<CreateAssetsList>, length: u32) -> ProgramResult {
    //     let assets_list = &mut ctx.accounts.assets_list;
    //     assets_list.initialized = false;
    //     let default_asset = Asset::default();

    //     assets_list.assets = vec![default_asset.clone(); length.try_into().unwrap()];
    //     msg!("{:?}", assets_list.assets.len());
    //     Ok(())
    // }
}
#[derive(Accounts)]
pub struct New {}

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
    pub price: u128,           // 16
    pub supply: u128,          // 16
    pub decimals: u8,          // 1
    pub last_update: u64,      // 8
}
// This will need 13 + x*105 bytes for each asset
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
