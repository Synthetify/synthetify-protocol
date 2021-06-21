use anchor_lang::prelude::*;
use pyth::pc::Price;
mod math;
pub const PRICE_OFFSET: u8 = 6;
// use
#[program]
pub mod manager {
    use std::convert::TryInto;

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
        #[access_control(admin(&self, &ctx.accounts.signer))]
        pub fn create_list(
            &mut self,
            ctx: Context<InitializeAssetsList>,
            exchange_authority: Pubkey,
            collateral_token: Pubkey,
            collateral_token_feed: Pubkey,
            usd_token: Pubkey,
        ) -> Result<()> {
            if ctx.accounts.assets_list.initialized {
                return Err(ErrorCode::Initialized.into());
            }
            let usd_asset = Asset {
                decimals: 6,
                asset_address: usd_token,
                feed_address: Pubkey::default(), // unused
                last_update: std::u64::MAX,      // we dont update usd price
                price: 1 * 10u64.pow(PRICE_OFFSET.into()),
                supply: 0,
                max_supply: std::u64::MAX, // no limit for usd asset
                settlement_slot: u64::MAX,
                confidence: 0,
            };
            let collateral_asset = Asset {
                decimals: 6,
                asset_address: collateral_token,
                feed_address: collateral_token_feed,
                last_update: 0,
                price: 0,
                supply: 0,                 // unused
                max_supply: std::u64::MAX, // no limit for collateral asset
                settlement_slot: u64::MAX,
                confidence: 0,
            };
            ctx.accounts.assets_list.assets = vec![usd_asset, collateral_asset];
            ctx.accounts.assets_list.initialized = true;
            ctx.accounts.assets_list.exchange_authority = exchange_authority;
            Ok(())
        }
        #[access_control(admin(&self, &ctx.accounts.signer))]
        pub fn add_new_asset(
            &mut self,
            ctx: Context<AddNewAsset>,
            new_asset_feed_address: Pubkey,
            new_asset_address: Pubkey,
            new_asset_decimals: u8,
            new_asset_max_supply: u64,
        ) -> Result<()> {
            if !ctx.accounts.assets_list.initialized {
                return Err(ErrorCode::Uninitialized.into());
            }
            let new_asset = Asset {
                decimals: new_asset_decimals,
                asset_address: new_asset_address,
                feed_address: new_asset_feed_address,
                last_update: 0,
                price: 0,
                supply: 0,
                max_supply: new_asset_max_supply,
                settlement_slot: u64::MAX,
                confidence: 0,
            };

            ctx.accounts.assets_list.assets.push(new_asset);
            Ok(())
        }
        #[access_control(admin(&self, &ctx.accounts.signer))]
        pub fn set_max_supply(
            &mut self,
            ctx: Context<SetMaxSupply>,
            asset_address: Pubkey,
            new_max_supply: u64,
        ) -> Result<()> {
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
        #[access_control(admin(&self, &ctx.accounts.signer))]
        pub fn set_price_feed(
            &mut self,
            ctx: Context<SetPriceFeed>,
            asset_address: Pubkey,
        ) -> Result<()> {
            let asset = ctx
                .accounts
                .assets_list
                .assets
                .iter_mut()
                .find(|x| x.asset_address == asset_address);

            match asset {
                Some(asset) => asset.feed_address = *ctx.accounts.price_feed.key,
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
        asset_index: u8, // use index istead of address to save computation units
        new_supply: u64,
    ) -> ProgramResult {
        let assets_list = &mut ctx.accounts.assets_list;
        let asset = &mut assets_list.assets[asset_index as usize];

        if new_supply.gt(&asset.max_supply) {
            return Err(ErrorCode::MaxSupply.into());
        }
        asset.supply = new_supply;
        Ok(())
    }
    pub fn set_assets_prices(ctx: Context<SetAssetsPrices>) -> ProgramResult {
        for oracle_account in ctx.remaining_accounts {
            let price_feed = Price::load(oracle_account)?;
            let feed_address = oracle_account.key;
            let asset = ctx
                .accounts
                .assets_list
                .assets
                .iter_mut()
                .find(|x| x.feed_address == *feed_address);
            match asset {
                Some(asset) => {
                    let offset = (PRICE_OFFSET as i32).checked_add(price_feed.expo).unwrap();
                    if offset >= 0 {
                        let scaled_price = price_feed
                            .agg
                            .price
                            .checked_mul(10i64.pow(offset.try_into().unwrap()))
                            .unwrap();

                        asset.price = scaled_price.try_into().unwrap();
                    } else {
                        let scaled_price = price_feed
                            .agg
                            .price
                            .checked_div(10i64.pow((-offset).try_into().unwrap()))
                            .unwrap();

                        asset.price = scaled_price.try_into().unwrap();
                    }

                    asset.confidence =
                        math::calculate_confidence(price_feed.agg.conf, price_feed.agg.price);

                    asset.last_update = Clock::get()?.slot;
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
#[derive(Accounts)]
pub struct SetPriceFeed<'info> {
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: ProgramAccount<'info, AssetsList>,
    pub price_feed: AccountInfo<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, PartialEq, Default, Clone, Debug)]
pub struct Asset {
    pub feed_address: Pubkey,  // 32 Pyth oracle account address
    pub asset_address: Pubkey, // 32
    pub price: u64,            // 8
    pub supply: u64,           // 8
    pub decimals: u8,          // 1
    pub last_update: u64,      // 8
    pub max_supply: u64,       // 8
    pub settlement_slot: u64,  // 8 unused
    pub confidence: u32,       // 4 unused
}
// This will need 45 + x*109 bytes for each asset
#[account]
pub struct AssetsList {
    pub initialized: bool,
    pub exchange_authority: Pubkey,
    pub assets: Vec<Asset>,
}
#[error]
pub enum ErrorCode {
    #[msg("You are not admin")]
    Unauthorized,
    #[msg("Assets list already initialized")]
    Initialized,
    #[msg("Assets list is not initialized")]
    Uninitialized,
    #[msg("No asset with such address was found")]
    NoAssetFound,
    #[msg("Asset max_supply crossed")]
    MaxSupply,
}

// Only admin access
fn admin<'info>(state: &InternalState, signer: &AccountInfo<'info>) -> Result<()> {
    if !signer.key.eq(&state.admin) {
        return Err(ErrorCode::Unauthorized.into());
    }
    Ok(())
}
