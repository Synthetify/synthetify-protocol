use anchor_lang::prelude::*;
use oracle::PriceFeed;
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
        pub fn new(_ctx: Context<New>, admin: Pubkey) -> Result<Self> {
            Ok(Self {
                admin: admin,
                initialized: false,
            })
        }

        pub fn create_list(
            &mut self,
            ctx: Context<InitializeAssetsList>,
            exchange_authority: Pubkey,
            collateral_token: Pubkey,
            collateral_token_feed: Pubkey,
            usd_token: Pubkey,
        ) -> Result<()> {
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
                supply: 0,                 // unused
                max_supply: std::u64::MAX, // no limit for collateral asset
            };
            ctx.accounts.assets_list.assets = vec![usd_asset, collateral_asset];
            ctx.accounts.assets_list.initialized = true;
            ctx.accounts.assets_list.exchange_authority = exchange_authority;
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
        pub fn set_max_supply(
            &mut self,
            ctx: Context<SetMaxSupply>,
            asset_address: Pubkey,
            new_max_supply: u64,
        ) -> Result<()> {
            if !self.admin.eq(ctx.accounts.signer.key) {
                return Err(ErrorCode::Unauthorized.into());
            }

            let asset = ctx
                .accounts
                .assets_list
                .assets
                .iter_mut()
                .find(|x| x.asset_address == asset_address);

            match asset {
                Some(asset) => asset.max_supply = new_max_supply,
                None => return Err(ErrorCode::NoAssetFound.into()),
            }
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
    pub fn set_asset_supply(
        ctx: Context<SetAssetSupply>,
        asset_address: Pubkey,
        new_supply: u64,
    ) -> ProgramResult {
        let assets_list = &mut ctx.accounts.assets_list;
        let asset = assets_list
            .assets
            .iter_mut()
            .find(|x| x.asset_address == asset_address)
            .unwrap();
        if new_supply.gt(&asset.max_supply) {
            return Err(ErrorCode::MaxSupply.into());
        }
        asset.supply = new_supply;
        Ok(())
    }
    pub fn set_assets_prices(ctx: Context<SetAssetsPrices>) -> ProgramResult {
        for oracle_account in ctx.remaining_accounts {
            let price_feed: CpiAccount<PriceFeed> = CpiAccount::try_from(oracle_account)?;
            let feed_address = oracle_account.key;
            let asset = ctx
                .accounts
                .assets_list
                .assets
                .iter_mut()
                .find(|x| x.feed_address == *feed_address);
            match asset {
                Some(asset) => {
                    asset.price = price_feed.price;
                    asset.last_update = ctx.accounts.clock.slot;
                }
                None => return Err(ErrorCode::NoAssetFound.into()),
            }
        }

        Ok(())
    }
}
#[derive(Accounts)]
pub struct New {}
#[derive(Accounts, Clone)]
pub struct SetAssetSupply<'info> {
    #[account(mut,has_one=exchange_authority)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
    #[account(signer)]
    pub exchange_authority: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetAssetsPrices<'info> {
    #[account(mut)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
    pub clock: Sysvar<'info, Clock>,
}

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

#[derive(Accounts)]
pub struct SetMaxSupply<'info> {
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct Asset {
    pub feed_address: Pubkey,  // 32
    pub asset_address: Pubkey, // 32
    pub price: u64,            // 8
    pub supply: u64,           // 8
    pub decimals: u8,          // 1
    pub last_update: u64,      // 8
    pub max_supply: u64,       // 8
}
// This will need 45 + x*97 bytes for each asset
#[account]
pub struct AssetsList {
    pub initialized: bool,
    pub exchange_authority: Pubkey,
    pub assets: Vec<Asset>,
}
#[error]
pub enum ErrorCode {
    #[msg("Your error message")]
    ErrorType,
    #[msg("You are not admin")]
    Unauthorized,
    #[msg("No asset with such address was found")]
    NoAssetFound,
    #[msg("Asset max_supply crossed")]
    MaxSupply,
}
