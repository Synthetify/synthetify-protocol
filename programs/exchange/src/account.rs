use crate::*;
use anchor_lang::prelude::*;

#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct Settlement {
    // 116
    //8 Account signature
    pub bump: u8,                  // 1
    pub reserve_address: Pubkey,   // 32
    pub token_in_address: Pubkey,  // 32
    pub token_out_address: Pubkey, // 32 xUSD
    pub decimals_in: u8,           // 1
    pub decimals_out: u8,          // 1
    pub ratio: Decimal,            // 17
}

#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct StakingRound {
    // 33
    pub start: u64,      // 8 Slot when round starts
    pub amount: Decimal, // 17 Amount of SNY distributed in this round
    pub all_points: u64, // 8 All points used to calculate user share in staking rewards
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Staking {
    // 152
    pub fund_account: Pubkey,         // 32 Source account of SNY tokens
    pub round_length: u32,            // 4 Length of round in slots
    pub amount_per_round: Decimal,    // 17 Amount of SNY distributed per round
    pub finished_round: StakingRound, // 33
    pub current_round: StakingRound,  // 33
    pub next_round: StakingRound,     // 33
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct UserStaking {
    // 49
    pub amount_to_claim: Decimal, // 17 Amount of SNY accumulated by account
    pub finished_round_points: u64, // 8 Points are based on debt_shares in specific round
    pub current_round_points: u64, // 8
    pub next_round_points: u64,   // 8
    pub last_update: u64,         // 8
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Asset {
    // 109
    pub feed_address: Pubkey, // 32 Pyth oracle account address
    pub price: Decimal,       // 17
    pub last_update: u64,     // 8
    pub twap: Decimal,        // 17
    pub twac: Decimal,        // 17 unused
    pub status: u8,           // 1
    pub confidence: Decimal,  // 17 unused
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Collateral {
    // 148
    pub asset_index: u8,            // 1
    pub collateral_address: Pubkey, // 32
    pub reserve_address: Pubkey,    // 32
    pub liquidation_fund: Pubkey,   // 32
    pub reserve_balance: Decimal,   // 17
    pub collateral_ratio: Decimal,  // 17
    pub max_collateral: Decimal,    // 17
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct Synthetic {
    // 109
    pub asset_index: u8,          // 1
    pub asset_address: Pubkey,    // 32
    pub supply: Decimal,          // 17
    pub max_supply: Decimal,      // 17
    pub borrowed_supply: Decimal, // 17
    pub swapline_supply: Decimal, // 17
    pub settlement_slot: u64,     // 8
}
#[account(zero_copy)]
#[derive(PartialEq, Debug)]
pub struct State {
    // 2048
    //8 Account signature
    pub admin: Pubkey,                      // 32
    pub halted: bool,                       // 1
    pub nonce: u8,                          // 1
    pub debt_shares: u64,                   // 8
    pub assets_list: Pubkey,                // 32
    pub health_factor: Decimal,             // 17 In % 1-100% modifier for debt
    pub max_delay: u32,                     // 4  In slots delay between last oracle update 100 blocks ~ 1 min
    pub fee: Decimal,                       // 17 In % default fee per swap
    pub swap_tax_ratio: Decimal,            // 17 In % range 0-20%
    pub swap_tax_reserve: Decimal,          // 17 Amount on tax from swap
    pub liquidation_rate: Decimal,          // 17 Percentage of debt repay in liquidation
    pub penalty_to_liquidator: Decimal,     // 17 In % range 0-25%
    pub penalty_to_exchange: Decimal,       // 17 In % range 0-25%
    pub liquidation_buffer: u32,            // 4  Time given user to fix collateralization ratio (in slots)
    pub debt_interest_rate: Decimal,        // 17 In % range 0-20%
    pub accumulated_debt_interest: Decimal, // 17 Accumulated debt interest
    pub last_debt_adjustment: i64,          // 8
    pub staking: Staking,                   // 152
    pub exchange_authority: Pubkey,         // 32
    pub bump: u8,                           // 1
    pub padding: [u8; 1620],                // 1620 (2048 - 428) reserved for future use
}
impl Default for State {
    #[inline]
    fn default() -> State {
        State {
            admin: Pubkey::default(),
            halted: false,
            nonce: 0,
            debt_shares: 0,
            assets_list: Pubkey::default(),
            health_factor: Decimal::default(),
            max_delay: 0,
            fee: Decimal::default(),
            swap_tax_ratio: Decimal::default(),
            swap_tax_reserve: Decimal::default(),
            liquidation_rate: Decimal::default(),
            penalty_to_liquidator: Decimal::default(),
            penalty_to_exchange: Decimal::default(),
            liquidation_buffer: 0,
            debt_interest_rate: Decimal::default(),
            accumulated_debt_interest: Decimal::default(),
            last_debt_adjustment: 0,
            staking: Staking::default(),
            exchange_authority: Pubkey::default(),
            bump: 0,
            padding: [0; 1620],
        }
    }
}

#[account(zero_copy)]
#[derive(PartialEq, Debug)]
pub struct ExchangeAccount {
    // 1412
    pub owner: Pubkey,                      // 32 Identity controlling account
    pub version: u8,                        // 1 Version of account struct
    pub debt_shares: u64,                   // 8 Shares representing part of entire debt pool
    pub liquidation_deadline: u64,          // 8 Slot number after which account can be liquidated
    pub user_staking_data: UserStaking,     // 49 Staking information
    pub head: u8,                           // 1
    pub bump: u8,                           // 1
    pub collaterals: [CollateralEntry; 32], // 1312
}
impl Default for ExchangeAccount {
    #[inline]
    fn default() -> ExchangeAccount {
        ExchangeAccount {
            bump: 0,
            head: 0,
            version: 0,
            debt_shares: 0,
            liquidation_deadline: 0,
            owner: Pubkey::default(),
            user_staking_data: UserStaking::default(),
            collaterals: [CollateralEntry {
                ..Default::default()
            }; 32],
        }
    }
}
#[zero_copy]
#[derive(PartialEq, Default, Debug)]
pub struct CollateralEntry {
    // 41
    pub amount: u64,                // 8
    pub collateral_address: Pubkey, // 32
    pub index: u8,                  // 1
}
impl ExchangeAccount {
    pub fn append(&mut self, entry: CollateralEntry) {
        self.collaterals[(self.head) as usize] = entry;
        self.head += 1;
    }
    pub fn remove(&mut self, index: usize) {
        self.collaterals[index] = self.collaterals[(self.head - 1) as usize];
        self.collaterals[(self.head - 1) as usize] = CollateralEntry {
            ..Default::default()
        };
        self.head -= 1;
    }
}

#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct Swapline {
    // 166
    pub synthetic: Pubkey,          // 32
    pub collateral: Pubkey,         // 32
    pub fee: Decimal,               // 17
    pub accumulated_fee: Decimal,   // 17
    pub balance: Decimal,           // 17
    pub limit: Decimal,             // 17
    pub collateral_reserve: Pubkey, // 32
    pub halted: bool,               // 1
    pub bump: u8,                   // 1
}

#[account(zero_copy)]
// #[derive(Default)]
pub struct AssetsList {
    // 93333
    pub head_assets: u8,                // 1
    pub head_collaterals: u8,           // 1
    pub head_synthetics: u8,            // 1
    pub assets: [Asset; 255],           // 27795
    pub collaterals: [Collateral; 255], // 37740
    pub synthetics: [Synthetic; 255],   // 27795
}
impl Default for AssetsList {
    #[inline]
    fn default() -> AssetsList {
        AssetsList {
            head_assets: 0,
            head_collaterals: 0,
            head_synthetics: 0,
            assets: [Asset {
                ..Default::default()
            }; 255],
            collaterals: [Collateral {
                ..Default::default()
            }; 255],
            synthetics: [Synthetic {
                ..Default::default()
            }; 255],
        }
    }
}

impl AssetsList {
    pub fn append_asset(&mut self, new_asset: Asset) {
        self.assets[(self.head_assets) as usize] = new_asset;
        self.head_assets += 1;
    }
    pub fn append_collateral(&mut self, new_collateral: Collateral) {
        self.collaterals[(self.head_collaterals) as usize] = new_collateral;
        self.head_collaterals += 1;
    }
    pub fn append_synthetic(&mut self, new_synthetic: Synthetic) {
        self.synthetics[(self.head_synthetics) as usize] = new_synthetic;
        self.head_synthetics += 1;
    }
    pub fn remove_synthetic(&mut self, index: usize) -> Result<()> {
        require!(index > 0, UsdSettlement);
        self.synthetics[index] = self.synthetics[(self.head_synthetics - 1) as usize];
        self.synthetics[(self.head_synthetics - 1) as usize] = Synthetic {
            ..Default::default()
        };
        self.head_synthetics -= 1;
        Ok(())
    }
    pub fn split_borrow(
        &mut self,
    ) -> (
        &mut [Asset; 255],
        &mut [Collateral; 255],
        &mut [Synthetic; 255],
    ) {
        (
            &mut self.assets,
            &mut self.collaterals,
            &mut self.synthetics,
        )
    }
}

#[zero_copy]
#[derive(PartialEq, Default, Debug, AnchorDeserialize, AnchorSerialize)]
pub struct Decimal {
    // 17
    pub val: u128, // 16
    pub scale: u8, // 1
}

#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct Vault {
    // 357
    pub halted: bool,                            // 1
    pub synthetic: Pubkey,                       // 32
    pub collateral: Pubkey,                      // 32
    pub collateral_price_feed: Pubkey,           // 32
    pub open_fee: Decimal,                       // 32
    pub debt_interest_rate: Decimal,             // 17
    pub collateral_ratio: Decimal,               // 17
    pub liquidation_threshold: Decimal,          // 17
    pub liquidation_ratio: Decimal,              // 17
    pub liquidation_penalty_liquidator: Decimal, // 17
    pub liquidation_penalty_exchange: Decimal,   // 17
    pub accumulated_interest: Decimal,           // 17
    pub accumulated_interest_rate: Decimal,      // 17
    pub liquidation_fund: Pubkey,                // 32
    pub collateral_reserve: Pubkey,              // 32
    pub mint_amount: Decimal,                    // 17
    pub collateral_amount: Decimal,              // 17
    pub max_borrow: Decimal,                     // 17
    pub last_update: i64,                        // 8
    pub bump: u8,                                // 1
}
#[account(zero_copy)]
#[derive(PartialEq, Default, Debug)]
pub struct VaultEntry {
    // 116
    pub owner: Pubkey,                           // 32
    pub vault: Pubkey,                           // 32
    pub last_accumulated_interest_rate: Decimal, // 17
    pub synthetic_amount: Decimal,               // 17
    pub collateral_amount: Decimal,              // 17
    pub bump: u8,                                // 1
}
