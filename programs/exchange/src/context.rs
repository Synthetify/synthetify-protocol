use anchor_lang::prelude::*;
use crate::account::*;
use crate::oracle::*;
use anchor_spl::token::{self, Burn, MintTo, TokenAccount, Transfer};
use anchor_lang::solana_program::system_program;
use crate::decimal::XUSD_SCALE;

#[derive(Accounts)]
pub struct SetAssetsList<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id,
    )]
    pub state: Loader<'info, State>,
    #[account(constraint = assets_list.to_account_info().owner == program_id)]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateSwapline<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(init, seeds = [b"swaplinev1", synthetic.to_account_info().key.as_ref(),collateral.to_account_info().key.as_ref()], bump=bump, payer=admin )]
    pub swapline: Loader<'info, Swapline>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(
        constraint = &collateral_reserve.mint == collateral.to_account_info().key,
        constraint = collateral_reserve.owner == state.load()?.exchange_authority
    )]
    pub collateral_reserve: Account<'info, TokenAccount>,
    #[account(mut, signer)]
    pub admin: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}
#[derive(Accounts)]

pub struct UseSwapLine<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"swaplinev1", synthetic.to_account_info().key.as_ref(),collateral.to_account_info().key.as_ref()], bump = swapline.load()?.bump,
        constraint = swapline.to_account_info().owner == program_id
    )]
    pub swapline: Loader<'info, Swapline>,
    #[account(mut)]
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &user_collateral_account.mint == collateral.to_account_info().key,
        constraint = &user_collateral_account.owner == signer.key,
        constraint = user_collateral_account.to_account_info().key != collateral_reserve.to_account_info().key
    )]
    pub user_collateral_account: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &user_synthetic_account.mint == synthetic.to_account_info().key,
        constraint = &user_synthetic_account.owner == signer.key
    )]
    pub user_synthetic_account: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id,
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = &collateral_reserve.mint == collateral.to_account_info().key,
        constraint = &collateral_reserve.owner == exchange_authority.key,
        constraint = collateral_reserve.to_account_info().key == &swapline.load()?.collateral_reserve
    )]
    pub collateral_reserve: Account<'info, TokenAccount>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&UseSwapLine<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &UseSwapLine<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.synthetic.to_account_info(),
            to: accounts.user_synthetic_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&UseSwapLine<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &UseSwapLine<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.synthetic.to_account_info(),
            to: accounts.user_synthetic_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct WithdrawSwaplineFee<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"swaplinev1", synthetic.to_account_info().key.as_ref(),collateral.to_account_info().key.as_ref()],bump = swapline.load()?.bump,
        constraint = swapline.to_account_info().owner == program_id
    )]
    pub swapline: Loader<'info, Swapline>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(
        constraint = exchange_authority.key == &state.load()?.exchange_authority
    )]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = &collateral_reserve.owner == exchange_authority.key,
        constraint = &collateral_reserve.mint == collateral.to_account_info().key,
        constraint = collateral_reserve.to_account_info().key == &swapline.load()?.collateral_reserve
    )]
    pub collateral_reserve: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &to.mint == collateral.to_account_info().key,
        constraint = to.to_account_info().key != collateral_reserve.to_account_info().key
    )]
    pub to: Account<'info, TokenAccount>, // withdraw fee to any account expect collateral_reserve
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&WithdrawSwaplineFee<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>>
{
    fn from(
        accounts: &WithdrawSwaplineFee<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.collateral_reserve.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct SetHaltedSwapline<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id,
    )]
    pub state: Loader<'info, State>,
     #[account(mut,
        seeds = [b"swaplinev1", synthetic.to_account_info().key.as_ref(),collateral.to_account_info().key.as_ref()],bump = swapline.load()?.bump,
        constraint = swapline.to_account_info().owner == program_id,
    )]
    pub swapline: Loader<'info, Swapline>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct InitializeAssetsList<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id,
    )]
    pub state: Loader<'info, State>,
    #[account(zero)]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    pub collateral_token: Account<'info, anchor_spl::token::Mint>,
    #[account(
        owner = oracle::ID,
        constraint = collateral_token_feed.data_len() == 3312
    )]
    pub collateral_token_feed: AccountInfo<'info>,
    #[account(constraint = usd_token.decimals == XUSD_SCALE)]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(
        constraint = &sny_reserve.owner == exchange_authority.key,
        constraint = &sny_reserve.mint == collateral_token.to_account_info().key,
        constraint = sny_reserve.to_account_info().key != sny_liquidation_fund.to_account_info().key
    )]
    pub sny_reserve: Account<'info, TokenAccount>,
    #[account(
        constraint = &sny_liquidation_fund.owner == exchange_authority.key,
        constraint = &sny_liquidation_fund.mint == collateral_token.to_account_info().key
    )]
    pub sny_liquidation_fund: Account<'info, TokenAccount>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
}
#[derive(Accounts)]
pub struct SetAssetsPrices<'info> {
    #[account(mut)] // constraint with state not required (maximize context space)
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct AddNewAsset<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(
        constraint = exchange_authority.key == &state.load()?.exchange_authority
    )]
    pub exchange_authority: AccountInfo<'info>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id    
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
		constraint = &to.mint == usd_token.to_account_info().key
	)]
    pub to: Account<'info, TokenAccount>, // admin can withdraw to any account
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&AdminWithdraw<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>>
{
    fn from(accounts: &AdminWithdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
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
pub struct WithdrawAccumulatedDebtInterest<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(
        constraint = exchange_authority.key == &state.load()?.exchange_authority,
    )]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &to.mint == usd_token.to_account_info().key
    )]
    pub to: Account<'info, TokenAccount>, // admin can withdraw to any accounts
	#[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&WithdrawAccumulatedDebtInterest<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>>
{
    fn from(
        accounts: &WithdrawAccumulatedDebtInterest<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
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
pub struct SetMaxSupply<'info> {
    #[account(mut,
         seeds = [b"statev1".as_ref()],
         bump = state.load()?.bump,
         constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct SetPriceFeed<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(
        owner = oracle::ID,
        constraint = price_feed.data_len() == 3312
    )]
    pub price_feed: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct AddCollateral<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub asset_address: Account<'info, anchor_spl::token::Mint>,
    #[account(
        constraint = liquidation_fund.owner == state.load()?.exchange_authority,
        constraint = &liquidation_fund.mint == asset_address.to_account_info().key
    )]
    pub liquidation_fund: Account<'info,TokenAccount>,
    #[account(
        constraint = reserve_account.owner == state.load()?.exchange_authority,
        constraint = &reserve_account.mint == asset_address.to_account_info().key,
        constraint = reserve_account.to_account_info().key != liquidation_fund.to_account_info().key
    )]
    pub reserve_account: Account<'info,TokenAccount>,
    pub feed_address: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetCollateralRatio<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub collateral_address: Account<'info, anchor_spl::token::Mint>,
}
#[derive(Accounts)]
pub struct SetMaxCollateral<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub collateral_address: Account<'info, anchor_spl::token::Mint>,
}
#[derive(Accounts)]
pub struct SetAdmin<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(owner = system_program::ID)]
    pub new_admin: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct SetSettlementSlot<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub synthetic_address: Account<'info, anchor_spl::token::Mint>,
}
#[derive(Accounts)]
pub struct AddSynthetic<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub asset_address: Account<'info, anchor_spl::token::Mint>,
    #[account(
        owner = oracle::ID,
        constraint = feed_address.data_len() == 3312
    )]
    pub feed_address: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateExchangeAccount<'info> {
    #[account(init, seeds = [b"accountv1", admin.key.as_ref()], bump=bump, payer=payer )]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    pub admin: AccountInfo<'info>,
    #[account(mut, signer)]
    pub payer: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}


#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = &reserve_account.owner == exchange_authority.key
    )]
    pub reserve_account: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = user_collateral_account.to_account_info().key != reserve_account.to_account_info().key
    )]
    pub user_collateral_account: Account<'info, TokenAccount>, // can withdraw to any account except reserve_account
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Withdraw<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Withdraw<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.reserve_account.to_account_info(),
            to: accounts.user_collateral_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Mint<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &to.mint == usd_token.to_account_info().key
    )]
    pub to: Account<'info, TokenAccount>, // mint xusd to any account
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
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
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(mut,
        constraint = &reserve_address.owner == exchange_authority.key
    )]
    pub reserve_address: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &user_collateral_account.owner == owner.key,
        constraint = user_collateral_account.to_account_info().key != reserve_address.to_account_info().key
    )]
    pub user_collateral_account: Account<'info, TokenAccount>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    // owner can deposit to any exchange_account
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Deposit<'info>> for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
    fn from(accounts: &Deposit<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.user_collateral_account.to_account_info(),
            to: accounts.reserve_address.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &liquidator_usd_account.mint == usd_token.to_account_info().key,
        constraint = &liquidator_usd_account.owner == signer.key
    )]
    pub liquidator_usd_account: Account<'info, TokenAccount>,
    // liquidated collateral can be send to any account except liquidation_fund and reserve_account
    #[account(mut,
        constraint = liquidator_collateral_account.to_account_info().key != liquidation_fund.to_account_info().key,
        constraint = liquidator_collateral_account.to_account_info().key != reserve_account.to_account_info().key,
    )]
    pub liquidator_collateral_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
    #[account(mut,
        constraint = liquidation_fund.mint == liquidator_collateral_account.mint,
        constraint = &liquidation_fund.owner == exchange_authority.key
    )]
    pub liquidation_fund: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = reserve_account.mint == liquidator_collateral_account.mint,
        constraint = &reserve_account.owner == exchange_authority.key,
        constraint = reserve_account.to_account_info().key != liquidation_fund.to_account_info().key
    )]
    pub reserve_account: Account<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct BurnToken<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &user_token_account_burn.mint == usd_token.to_account_info().key,
        constraint = &user_token_account_burn.owner == owner.key
    )]
    pub user_token_account_burn: Account<'info, TokenAccount>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&BurnToken<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &BurnToken<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.user_token_account_burn.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_in: Account<'info, anchor_spl::token::Mint>,
    #[account(mut)]
    pub token_for: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &user_token_account_in.mint == token_in.to_account_info().key,
        constraint = &user_token_account_in.owner  == owner.key
    )]
    pub user_token_account_in: Account<'info, TokenAccount>,
    // out token can be transfer to any account
    #[account(mut,
        constraint = &user_token_account_for.mint == token_for.to_account_info().key,
    )]
    pub user_token_account_for: Account<'info, TokenAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_in.to_account_info(),
            to: accounts.user_token_account_in.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&Swap<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &Swap<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.token_for.to_account_info(),
            to: accounts.user_token_account_for.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct CheckCollateralization<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    // everyone can trigger claim any exchange_account
    #[account(mut)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
}
#[derive(Accounts)]
pub struct WithdrawRewards<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut, has_one = owner)]
    pub exchange_account: Loader<'info, ExchangeAccount>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    // rewards can be withdraw to any accounts except staking_fund_account
    #[account(mut,
        constraint = user_token_account.to_account_info().key != staking_fund_account.to_account_info().key
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = user_token_account.mint == staking_fund_account.mint,
        constraint = &staking_fund_account.owner == exchange_authority.key,
        constraint = staking_fund_account.to_account_info().key == &state.load()?.staking.fund_account
    )]
    pub staking_fund_account: Account<'info, TokenAccount>,
}
#[derive(Accounts)]
pub struct WithdrawLiquidationPenalty<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    // admin can withdraw liquidated penalty to any account except liquidation_fund
    #[account(mut,
        constraint = to.to_account_info().key != liquidation_fund.to_account_info().key
    )]
    pub to: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = liquidation_fund.mint == to.mint,
        constraint = &liquidation_fund.owner == exchange_authority.key
    )]
    pub liquidation_fund: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
}
#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(mut,
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct Init<'info> {
    #[account(init, seeds = [b"statev1".as_ref()], bump = bump, payer = payer)]
    pub state: Loader<'info, State>,
    #[account(owner = system_program::ID)]
    pub payer: AccountInfo<'info>,
    pub admin: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
    pub staking_fund_account: Account<'info, TokenAccount>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct SettleSynthetic<'info> {
    #[account(init, seeds = [b"settlement".as_ref(), token_to_settle.to_account_info().key.as_ref()], bump=bump, payer = payer)]
    pub settlement: Loader<'info, Settlement>,
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub payer: AccountInfo<'info>,
    pub token_to_settle: Account<'info, anchor_spl::token::Mint>,
    #[account(
        mut,
        constraint = &settlement_reserve.owner == exchange_authority.key,
        constraint = &settlement_reserve.mint == usd_token.to_account_info().key
    )]
    pub settlement_reserve: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &assets_list.load()?.synthetics[0].asset_address
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&SettleSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>>
{
    fn from(accounts: &SettleSynthetic<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.usd_token.to_account_info(),
            to: accounts.settlement_reserve.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct SwapSettledSynthetic<'info> {
    #[account(
        seeds = [b"settlement".as_ref(), token_to_settle.to_account_info().key.as_ref()],
        bump = settlement.load()?.bump,
        constraint = settlement.to_account_info().owner == program_id
    )]
    pub settlement: Loader<'info, Settlement>,
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        constraint = token_to_settle.to_account_info().key == &settlement.load()?.token_in_address
    )]
    pub token_to_settle: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &user_settled_token_account.mint == token_to_settle.to_account_info().key,
        constraint = &user_settled_token_account.owner == signer.key,
    )]
    pub user_settled_token_account: Account<'info, TokenAccount>,
    // user can transfer settled usd token to any account
    #[account(mut,
        constraint = usd_token.to_account_info().key == &user_usd_account.mint,
        constraint = user_usd_account.to_account_info().key != settlement_reserve.to_account_info().key
    )]
    pub user_usd_account: Account<'info, TokenAccount>, // out token can be transfer to any account except settlement_reserve
    #[account(mut,
        constraint = settlement_reserve.to_account_info().key == &settlement.load()?.reserve_address,
        constraint = &settlement_reserve.owner == exchange_authority.key
    )]
    pub settlement_reserve: Account<'info, TokenAccount>,
    #[account(
        constraint = usd_token.decimals == XUSD_SCALE,
        constraint = usd_token.to_account_info().key == &settlement.load()?.token_out_address,
    )]
    pub usd_token: Account<'info, anchor_spl::token::Mint>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(signer)]
    pub signer: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&SwapSettledSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>>
{
    fn from(
        accounts: &SwapSettledSynthetic<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.settlement_reserve.to_account_info(),
            to: accounts.user_usd_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
impl<'a, 'b, 'c, 'info> From<&SwapSettledSynthetic<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Burn<'info>>
{
    fn from(accounts: &SwapSettledSynthetic<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.token_to_settle.to_account_info(),
            to: accounts.user_settled_token_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}


#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(init, seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()], bump=bump, payer=admin )]
    pub vault: Loader<'info, Vault>,
    #[account(mut, signer)]
    pub admin: AccountInfo<'info>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(
        constraint = &collateral_reserve.mint == collateral.to_account_info().key,
        constraint = collateral_reserve.owner == state.load()?.exchange_authority
    )]
    pub collateral_reserve: Account<'info, TokenAccount>,
    #[account(
        constraint = &liquidation_fund.owner == &state.load()?.exchange_authority,
        constraint = liquidation_fund.mint == collateral.key(),
        constraint = liquidation_fund.key() != collateral_reserve.key()
    )]
    pub liquidation_fund: Account<'info, TokenAccount>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(
        owner = oracle::ID,
        constraint = collateral_price_feed.data_len() == 3312
    )]
    pub collateral_price_feed: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}
#[derive(Accounts)]
#[instruction(bump: u8)]
pub struct CreateVaultEntry<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(init, seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()], bump=bump, payer=owner)]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut, signer)]
    pub owner: AccountInfo<'info>,
    #[account(mut,
        constraint = vault.to_account_info().owner == program_id,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump 
    )]
    pub vault: Loader<'info, Vault>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    pub rent: Sysvar<'info, Rent>,
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
}
#[derive(Accounts)]
pub struct DepositVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id 
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump,
        constraint = vault_entry.to_account_info().owner == program_id 
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id 
    )]
    pub vault: Loader<'info, Vault>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = &vault.load()?.collateral_reserve == reserve_address.to_account_info().key,
        constraint = &reserve_address.mint == collateral.to_account_info().key,
        constraint = &reserve_address.owner == exchange_authority.key
    )]
    pub reserve_address: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &user_collateral_account.mint == collateral.to_account_info().key,
        constraint = &user_collateral_account.owner == owner.key,
        constraint = user_collateral_account.to_account_info().key != reserve_address.to_account_info().key
    )]
    pub user_collateral_account: Account<'info, TokenAccount>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut, signer)]
    pub owner: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&DepositVault<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>>
{
    fn from(accounts: &DepositVault<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.user_collateral_account.to_account_info(),
            to: accounts.reserve_address.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct BorrowVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump,
        constraint = vault_entry.to_account_info().owner == program_id
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    #[account(mut)]
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(
        owner = oracle::ID, // TODO: Default public key
        constraint = collateral_price_feed.key() == vault.load()?.collateral_price_feed,
        constraint = collateral_price_feed.data_len() == 3312
    )]
    pub collateral_price_feed: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = &to.mint == synthetic.to_account_info().key,
    )]
    pub to: Account<'info, TokenAccount>, // not must be owner
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut, signer)]
    pub owner: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&BorrowVault<'info>> for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
    fn from(accounts: &BorrowVault<'info>) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.synthetic.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}

#[derive(Accounts)]
pub struct WithdrawVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump,
        constraint = vault_entry.to_account_info().owner == program_id
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(
        owner = oracle::ID,
        constraint = collateral_price_feed.key() == vault.load()?.collateral_price_feed,
        constraint = collateral_price_feed.data_len() == 3312
    )]
    pub collateral_price_feed: AccountInfo<'info>,
    #[account(mut, 
        constraint = &vault.load()?.collateral_reserve == reserve_address.to_account_info().key,
        constraint = &reserve_address.owner == exchange_authority.key,
        constraint = &reserve_address.mint == collateral.to_account_info().key,
    )]
    pub reserve_address: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &user_collateral_account.mint == collateral.to_account_info().key,
        constraint = user_collateral_account.to_account_info().key != reserve_address.to_account_info().key
    )]
    pub user_collateral_account: Account<'info, TokenAccount>, // can withdraw to any accounts except reserve_address
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut, signer)]
    pub owner: AccountInfo<'info>,
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&WithdrawVault<'info>>
    for CpiContext<'a, 'b, 'c, 'info, Transfer<'info>>
{
    fn from(accounts: &WithdrawVault<'info>) -> CpiContext<'a, 'b, 'c, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: accounts.reserve_address.to_account_info(),
            to: accounts.user_collateral_account.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct RepayVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump,
        constraint = vault_entry.to_account_info().owner == program_id
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    #[account(mut)]
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut, 
        constraint = &user_token_account_repay.owner == owner.key,
        constraint = &user_token_account_repay.mint == synthetic.to_account_info().key,
    )]
    pub user_token_account_repay: Account<'info, TokenAccount>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    #[account(signer)]
    pub owner: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&RepayVault<'info>> for CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
    fn from(accounts: &RepayVault<'info>) -> CpiContext<'a, 'b, 'c, 'info, Burn<'info>> {
        let cpi_accounts = Burn {
            mint: accounts.synthetic.to_account_info(),
            to: accounts.user_token_account_repay.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
#[derive(Accounts)]
pub struct LiquidateVault<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(mut,
        has_one = owner,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump,
        constraint = vault_entry.to_account_info().owner == program_id
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump ,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    #[account(mut)]
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    #[account(
        owner = oracle::ID,
        constraint = collateral_price_feed.key() == vault.load()?.collateral_price_feed,
        constraint = collateral_price_feed.data_len() == 3312,
    )]
    pub collateral_price_feed: AccountInfo<'info>,
    #[account(mut)]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = &vault.load()?.collateral_reserve == collateral_reserve.to_account_info().key,
        constraint = &collateral_reserve.mint == collateral.to_account_info().key,
        constraint = &collateral_reserve.owner == exchange_authority.key
    )]
    pub collateral_reserve: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &liquidator_synthetic_account.mint == synthetic.to_account_info().key,
        constraint = &liquidator_synthetic_account.owner == liquidator.key
    )]
    pub liquidator_synthetic_account: Account<'info, TokenAccount>,
    #[account(mut,
        constraint = &liquidator_collateral_account.owner == liquidator.key,
        constraint = &liquidator_collateral_account.mint == collateral.to_account_info().key,
        constraint = liquidator_collateral_account.to_account_info().key != liquidation_fund.to_account_info().key,
        constraint = liquidator_collateral_account.to_account_info().key != collateral_reserve.to_account_info().key,
    )]
    pub liquidator_collateral_account: Box<Account<'info, TokenAccount>>,
    #[account(mut,
        constraint = &liquidation_fund.owner == &state.load()?.exchange_authority,
        constraint = &liquidation_fund.mint == collateral.to_account_info().key,
        constraint = liquidation_fund.key() == vault.load()?.liquidation_fund,
        constraint = liquidation_fund.to_account_info().key != collateral_reserve.to_account_info().key
    )]
    pub liquidation_fund: Box<Account<'info, TokenAccount>>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
    pub owner: AccountInfo<'info>,
    #[account(signer)]
    pub liquidator: AccountInfo<'info>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct TriggerVaultEntryDebtAdjustment<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        has_one = owner,
        constraint = vault_entry.to_account_info().owner == program_id,
        seeds = [b"vault_entryv1", owner.key.as_ref(), vault.to_account_info().key.as_ref()],bump=vault_entry.load()?.bump
    )]
    pub vault_entry: Loader<'info, VaultEntry>,
    #[account(mut,
        constraint = vault.to_account_info().owner == program_id,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump
    )]
    pub vault: Loader<'info, Vault>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(mut,
        constraint = assets_list.to_account_info().owner == program_id,
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list
    )]
    pub assets_list: Loader<'info, AssetsList>,
    pub owner: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SetVaultHalted<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SetVaultParameter<'info> {
    #[account(
        seeds = [b"statev1".as_ref()],
        bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],
        bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
}

#[derive(Accounts)]
pub struct WithdrawVaultAccumulatedInterest<'info> {
    #[account(
        seeds = [b"statev1".as_ref()], bump = state.load()?.bump,
        constraint = state.to_account_info().owner == program_id
    )]
    pub state: Loader<'info, State>,
    #[account(signer)]
    pub admin: AccountInfo<'info>,
    #[account(mut,
        seeds = [b"vaultv1", synthetic.to_account_info().key.as_ref(), collateral.to_account_info().key.as_ref()],
        bump=vault.load()?.bump,
        constraint = vault.to_account_info().owner == program_id
    )]
    pub vault: Loader<'info, Vault>,
    #[account(mut)]
    pub synthetic: Account<'info, anchor_spl::token::Mint>,
    pub collateral: Account<'info, anchor_spl::token::Mint>,
    #[account(constraint = exchange_authority.key == &state.load()?.exchange_authority)]
    pub exchange_authority: AccountInfo<'info>,
    #[account(
        constraint = assets_list.to_account_info().key == &state.load()?.assets_list,
        constraint = assets_list.to_account_info().owner == program_id
    )]
    pub assets_list: Loader<'info, AssetsList>,
    #[account(mut,
        constraint = &to.mint == synthetic.to_account_info().key
    )]
    pub to: Account<'info, TokenAccount>, // withdraw to any account
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}
impl<'a, 'b, 'c, 'info> From<&WithdrawVaultAccumulatedInterest<'info>>
    for CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> 
{
    fn from(
        accounts: &WithdrawVaultAccumulatedInterest<'info>,
    ) -> CpiContext<'a, 'b, 'c, 'info, MintTo<'info>> {
        let cpi_accounts = MintTo {
            mint: accounts.synthetic.to_account_info(),
            to: accounts.to.to_account_info(),
            authority: accounts.exchange_authority.to_account_info(),
        };
        let cpi_program = accounts.token_program.to_account_info();
        CpiContext::new(cpi_program, cpi_accounts)
    }
}