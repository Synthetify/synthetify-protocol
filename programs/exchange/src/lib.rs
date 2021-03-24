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
pub struct New<'info> {
    pub admin: AccountInfo<'info>,
    pub collateral_token: AccountInfo<'info>,
    pub collateral_account: AccountInfo<'info>,
    pub assets_list: AccountInfo<'info>,
    pub program_signer: AccountInfo<'info>,
}

// #[derive(Accounts)]
// pub struct AddNewAsset<'info> {
//     pub signer: AccountInfo<'info>,
//     pub collateral_token: AccountInfo<'info>,
//     pub collateral_account: AccountInfo<'info>,
//     pub assets_list: AccountInfo<'info>,
//     pub program_signer: AccountInfo<'info>,
// }

// #[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
// pub struct Asset {
//     pub feed_address: Pubkey,  // 32
//     pub asset_address: Pubkey, // 32
//     pub price: u128,           // 16
//     pub supply: u128,          // 16
//     pub decimals: u8,          // 1
//     pub last_update: u64,      // 8
// }
// This will need 13 + x*105 bytes for each asset

#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("You are not admin")]
    Unauthorized,
}
