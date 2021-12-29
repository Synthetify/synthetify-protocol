export type Exchange = {
  "version": "0.0.0",
  "name": "exchange",
  "instructions": [
    {
      "name": "createExchangeAccount",
      "accounts": [
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createList",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "collateralToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralTokenFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "snyReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "snyLiquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setAssetsList",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "setAssetsPrices",
      "accounts": [
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakingFundAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "nonce",
          "type": "u8"
        },
        {
          "name": "stakingRoundLength",
          "type": "u32"
        },
        {
          "name": "amountPerRound",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mint",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swap",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenIn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenFor",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountIn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountFor",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "burn",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountBurn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "liquidate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorUsdAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "checkAccountCollateralization",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimRewards",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "withdrawRewards",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stakingFundAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "withdrawLiquidationPenalty",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "addNewAsset",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "newAssetFeedAddress",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "withdrawSwapTax",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawAccumulatedDebtInterest",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setSwapTaxRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "swapTaxRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setDebtInterestRate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setLiquidationBuffer",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "liquidationBuffer",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setLiquidationRate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "liquidationRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setFee",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "fee",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setMaxDelay",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "maxDelay",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setHalted",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setHealthFactor",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "factor",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setStakingAmountPerRound",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amountPerRound",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setStakingRoundLength",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "roundLength",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setMaxSupply",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "assetAddress",
          "type": "publicKey"
        },
        {
          "name": "newMaxSupply",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setPriceFeed",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "priceFeed",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "oldFeedAddress",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "setLiquidationPenalties",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "penaltyToExchange",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToLiquidator",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "addCollateral",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetAddress",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feedAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "reserveBalance",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "maxCollateral",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setCollateralRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setMaxCollateral",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxCollateral",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setAdmin",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "newAdmin",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setSettlementSlot",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "syntheticAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "settlementSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "addSynthetic",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetAddress",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feedAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxSupply",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleSynthetic",
      "accounts": [
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenToSettle",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "settlementReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "swapSettledSynthetic",
      "accounts": [
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenToSettle",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSettledTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userUsdAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "settlementReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSwapline",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "limit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawSwaplineFee",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setHaltedSwapline",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "nativeToSynthetic",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "syntheticToNative",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "vaultType",
          "type": "u8"
        },
        {
          "name": "openFee",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "maxBorrow",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "liquidationThreshold",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToLiquidator",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToExchange",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "liquidationRatio",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "oracleType",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createVaultEntry",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "depositVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "borrowVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "repayVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountRepay",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "liquidateVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidator",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "triggerVaultEntryDebtAdjustment",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setVaultHalted",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setVaultCollateralRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultDebtInterestRate",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationThreshold",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationThreshold",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultSetLiquidationRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationPenaltyLiquidator",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationPenaltyLiquidator",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationPenaltyExchange",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationPenaltyExchange",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultMaxBorrow",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxBorrow",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "withdrawVaultAccumulatedInterest",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawVaultLiquidationPenalty",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "settlement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserveAddress",
            "type": "publicKey"
          },
          {
            "name": "tokenInAddress",
            "type": "publicKey"
          },
          {
            "name": "tokenOutAddress",
            "type": "publicKey"
          },
          {
            "name": "decimalsIn",
            "type": "u8"
          },
          {
            "name": "decimalsOut",
            "type": "u8"
          },
          {
            "name": "ratio",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "state",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "publicKey"
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "nonce",
            "type": "u8"
          },
          {
            "name": "debtShares",
            "type": "u64"
          },
          {
            "name": "assetsList",
            "type": "publicKey"
          },
          {
            "name": "healthFactor",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxDelay",
            "type": "u32"
          },
          {
            "name": "fee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swapTaxRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swapTaxReserve",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "penaltyToLiquidator",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "penaltyToExchange",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationBuffer",
            "type": "u32"
          },
          {
            "name": "debtInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedDebtInterest",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastDebtAdjustment",
            "type": "i64"
          },
          {
            "name": "staking",
            "type": {
              "defined": "Staking"
            }
          },
          {
            "name": "exchangeAuthority",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                1620
              ]
            }
          }
        ]
      }
    },
    {
      "name": "exchangeAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "debtShares",
            "type": "u64"
          },
          {
            "name": "liquidationDeadline",
            "type": "u64"
          },
          {
            "name": "userStakingData",
            "type": {
              "defined": "UserStaking"
            }
          },
          {
            "name": "head",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "collaterals",
            "type": {
              "array": [
                {
                  "defined": "CollateralEntry"
                },
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "swapline",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "synthetic",
            "type": "publicKey"
          },
          {
            "name": "collateral",
            "type": "publicKey"
          },
          {
            "name": "fee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedFee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "balance",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "limit",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralReserve",
            "type": "publicKey"
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "assetsList",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "headAssets",
            "type": "u8"
          },
          {
            "name": "headCollaterals",
            "type": "u8"
          },
          {
            "name": "headSynthetics",
            "type": "u8"
          },
          {
            "name": "assets",
            "type": {
              "array": [
                {
                  "defined": "Asset"
                },
                255
              ]
            }
          },
          {
            "name": "collaterals",
            "type": {
              "array": [
                {
                  "defined": "Collateral"
                },
                255
              ]
            }
          },
          {
            "name": "synthetics",
            "type": {
              "array": [
                {
                  "defined": "Synthetic"
                },
                255
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "synthetic",
            "type": "publicKey"
          },
          {
            "name": "collateral",
            "type": "publicKey"
          },
          {
            "name": "collateralPriceFeed",
            "type": "publicKey"
          },
          {
            "name": "oracleType",
            "type": "u8"
          },
          {
            "name": "openFee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "debtInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationThreshold",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationPenaltyLiquidator",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationPenaltyExchange",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedInterest",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationFund",
            "type": "publicKey"
          },
          {
            "name": "collateralReserve",
            "type": "publicKey"
          },
          {
            "name": "mintAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxBorrow",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastUpdate",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultType",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "vault",
            "type": "publicKey"
          },
          {
            "name": "lastAccumulatedInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "syntheticAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "StakingRound",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "start",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "allPoints",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Staking",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fundAccount",
            "type": "publicKey"
          },
          {
            "name": "roundLength",
            "type": "u32"
          },
          {
            "name": "amountPerRound",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "finishedRound",
            "type": {
              "defined": "StakingRound"
            }
          },
          {
            "name": "currentRound",
            "type": {
              "defined": "StakingRound"
            }
          },
          {
            "name": "nextRound",
            "type": {
              "defined": "StakingRound"
            }
          }
        ]
      }
    },
    {
      "name": "UserStaking",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountToClaim",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "finishedRoundPoints",
            "type": "u64"
          },
          {
            "name": "currentRoundPoints",
            "type": "u64"
          },
          {
            "name": "nextRoundPoints",
            "type": "u64"
          },
          {
            "name": "lastUpdate",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Asset",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedAddress",
            "type": "publicKey"
          },
          {
            "name": "price",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastUpdate",
            "type": "u64"
          },
          {
            "name": "twap",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "twac",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "confidence",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "Collateral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "collateralAddress",
            "type": "publicKey"
          },
          {
            "name": "reserveAddress",
            "type": "publicKey"
          },
          {
            "name": "liquidationFund",
            "type": "publicKey"
          },
          {
            "name": "reserveBalance",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxCollateral",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "Synthetic",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "assetAddress",
            "type": "publicKey"
          },
          {
            "name": "supply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "borrowedSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swaplineSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "settlementSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CollateralEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "collateralAddress",
            "type": "publicKey"
          },
          {
            "name": "index",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Decimal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "val",
            "type": "u128"
          },
          {
            "name": "scale",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "OracleType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Pyth"
          },
          {
            "name": "Chainlink"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 300,
      "name": "Unauthorized",
      "msg": "You are not admin"
    },
    {
      "code": 301,
      "name": "NotSyntheticUsd",
      "msg": "Not synthetic USD asset"
    },
    {
      "code": 302,
      "name": "OutdatedOracle",
      "msg": "Oracle price is outdated"
    },
    {
      "code": 303,
      "name": "MintLimit",
      "msg": "Mint limit"
    },
    {
      "code": 304,
      "name": "WithdrawLimit",
      "msg": "Withdraw limit"
    },
    {
      "code": 305,
      "name": "CollateralAccountError",
      "msg": "Invalid collateral_account"
    },
    {
      "code": 306,
      "name": "SyntheticCollateral",
      "msg": "Synthetic collateral is not supported"
    },
    {
      "code": 307,
      "name": "InvalidAssetsList",
      "msg": "Invalid Assets List"
    },
    {
      "code": 308,
      "name": "InvalidLiquidation",
      "msg": "Invalid Liquidation"
    },
    {
      "code": 309,
      "name": "InvalidSigner",
      "msg": "Invalid signer"
    },
    {
      "code": 310,
      "name": "WashTrade",
      "msg": "Wash trade"
    },
    {
      "code": 311,
      "name": "ExchangeLiquidationAccount",
      "msg": "Invalid exchange liquidation account"
    },
    {
      "code": 312,
      "name": "LiquidationDeadline",
      "msg": "Liquidation deadline not passed"
    },
    {
      "code": 313,
      "name": "Halted",
      "msg": "Program is currently Halted"
    },
    {
      "code": 314,
      "name": "NoRewards",
      "msg": "No rewards to claim"
    },
    {
      "code": 315,
      "name": "FundAccountError",
      "msg": "Invalid fund_account"
    },
    {
      "code": 317,
      "name": "Initialized",
      "msg": "Assets list already initialized"
    },
    {
      "code": 316,
      "name": "SwapUnavailable",
      "msg": "Swap Unavailable"
    },
    {
      "code": 318,
      "name": "Uninitialized",
      "msg": "Assets list is not initialized"
    },
    {
      "code": 319,
      "name": "NoAssetFound",
      "msg": "No asset with such address was found"
    },
    {
      "code": 320,
      "name": "MaxSupply",
      "msg": "Asset max_supply crossed"
    },
    {
      "code": 321,
      "name": "NotCollateral",
      "msg": "Asset is not collateral"
    },
    {
      "code": 322,
      "name": "AlreadyACollateral",
      "msg": "Asset is already a collateral"
    },
    {
      "code": 323,
      "name": "InsufficientValueTrade",
      "msg": "Insufficient value trade"
    },
    {
      "code": 324,
      "name": "InsufficientAmountAdminWithdraw",
      "msg": "Insufficient amount admin withdraw"
    },
    {
      "code": 325,
      "name": "SettlementNotReached",
      "msg": "Settlement slot not reached"
    },
    {
      "code": 326,
      "name": "UsdSettlement",
      "msg": "Cannot settle xUSD"
    },
    {
      "code": 327,
      "name": "ParameterOutOfRange",
      "msg": "Parameter out of range"
    },
    {
      "code": 328,
      "name": "Overflow",
      "msg": "Overflow"
    },
    {
      "code": 329,
      "name": "DifferentScale",
      "msg": "Scale is different"
    },
    {
      "code": 330,
      "name": "MismatchedTokens",
      "msg": "Tokens does not represent same asset"
    },
    {
      "code": 331,
      "name": "SwaplineLimit",
      "msg": "Limit crossed"
    },
    {
      "code": 332,
      "name": "CollateralLimitExceeded",
      "msg": "Limit of collateral exceeded"
    },
    {
      "code": 333,
      "name": "UserBorrowLimit",
      "msg": "User borrow limit"
    },
    {
      "code": 334,
      "name": "VaultBorrowLimit",
      "msg": "Vault borrow limit"
    },
    {
      "code": 335,
      "name": "VaultWithdrawLimit",
      "msg": "Vault withdraw limit"
    },
    {
      "code": 336,
      "name": "InvalidAccount",
      "msg": "Invalid Account"
    },
    {
      "code": 337,
      "name": "PriceConfidenceOutOfRange",
      "msg": "Price confidence out of range"
    },
    {
      "code": 338,
      "name": "InvalidOracleProgram",
      "msg": "Invalid oracle program"
    },
    {
      "code": 339,
      "name": "InvalidExchangeAccount",
      "msg": "Invalid exchange account"
    },
    {
      "code": 340,
      "name": "InvalidOracleType",
      "msg": "Invalid oracle type"
    }
  ]
};

export const IDL: Exchange = {
  "version": "0.0.0",
  "name": "exchange",
  "instructions": [
    {
      "name": "createExchangeAccount",
      "accounts": [
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createList",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "collateralToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralTokenFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "snyReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "snyLiquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setAssetsList",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "setAssetsPrices",
      "accounts": [
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "stakingFundAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "nonce",
          "type": "u8"
        },
        {
          "name": "stakingRoundLength",
          "type": "u32"
        },
        {
          "name": "amountPerRound",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "mint",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swap",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenIn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenFor",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountIn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountFor",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "burn",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountBurn",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "liquidate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorUsdAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "checkAccountCollateralization",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "claimRewards",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "withdrawRewards",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "exchangeAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stakingFundAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "withdrawLiquidationPenalty",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "addNewAsset",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "newAssetFeedAddress",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "withdrawSwapTax",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawAccumulatedDebtInterest",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setSwapTaxRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "swapTaxRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setDebtInterestRate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setLiquidationBuffer",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "liquidationBuffer",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setLiquidationRate",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "liquidationRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setFee",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "fee",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setMaxDelay",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "maxDelay",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setHalted",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setHealthFactor",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "factor",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setStakingAmountPerRound",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amountPerRound",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setStakingRoundLength",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "roundLength",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setMaxSupply",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "assetAddress",
          "type": "publicKey"
        },
        {
          "name": "newMaxSupply",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setPriceFeed",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "priceFeed",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "oldFeedAddress",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "setLiquidationPenalties",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "penaltyToExchange",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToLiquidator",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "addCollateral",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetAddress",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAccount",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feedAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "reserveBalance",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "maxCollateral",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setCollateralRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setMaxCollateral",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxCollateral",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setAdmin",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "newAdmin",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setSettlementSlot",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "syntheticAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "settlementSlot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "addSynthetic",
      "accounts": [
        {
          "name": "state",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetAddress",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "feedAddress",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxSupply",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleSynthetic",
      "accounts": [
        {
          "name": "settlement",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenToSettle",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "settlementReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "swapSettledSynthetic",
      "accounts": [
        {
          "name": "settlement",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenToSettle",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSettledTokenAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userUsdAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "settlementReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "usdToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSwapline",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "limit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawSwaplineFee",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setHaltedSwapline",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "nativeToSynthetic",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "syntheticToNative",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "swapline",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "signer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        },
        {
          "name": "vaultType",
          "type": "u8"
        },
        {
          "name": "openFee",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "maxBorrow",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "liquidationThreshold",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToLiquidator",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "penaltyToExchange",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "liquidationRatio",
          "type": {
            "defined": "Decimal"
          }
        },
        {
          "name": "oracleType",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createVaultEntry",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "bump",
          "type": "u8"
        }
      ]
    },
    {
      "name": "depositVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "borrowVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "reserveAddress",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "repayVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "userTokenAccountRepay",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "liquidateVault",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateralPriceFeed",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateralReserve",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorSyntheticAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidatorCollateralAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "liquidator",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "triggerVaultEntryDebtAdjustment",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vaultEntry",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "setVaultHalted",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setVaultCollateralRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "collateralRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultDebtInterestRate",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "debtInterestRate",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationThreshold",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationThreshold",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultSetLiquidationRatio",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationRatio",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationPenaltyLiquidator",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationPenaltyLiquidator",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultLiquidationPenaltyExchange",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "liquidationPenaltyExchange",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "setVaultMaxBorrow",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "maxBorrow",
          "type": {
            "defined": "Decimal"
          }
        }
      ]
    },
    {
      "name": "withdrawVaultAccumulatedInterest",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "assetsList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawVaultLiquidationPenalty",
      "accounts": [
        {
          "name": "state",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "vault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "synthetic",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "collateral",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "exchangeAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "to",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "liquidationFund",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "settlement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "reserveAddress",
            "type": "publicKey"
          },
          {
            "name": "tokenInAddress",
            "type": "publicKey"
          },
          {
            "name": "tokenOutAddress",
            "type": "publicKey"
          },
          {
            "name": "decimalsIn",
            "type": "u8"
          },
          {
            "name": "decimalsOut",
            "type": "u8"
          },
          {
            "name": "ratio",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "state",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "publicKey"
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "nonce",
            "type": "u8"
          },
          {
            "name": "debtShares",
            "type": "u64"
          },
          {
            "name": "assetsList",
            "type": "publicKey"
          },
          {
            "name": "healthFactor",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxDelay",
            "type": "u32"
          },
          {
            "name": "fee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swapTaxRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swapTaxReserve",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "penaltyToLiquidator",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "penaltyToExchange",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationBuffer",
            "type": "u32"
          },
          {
            "name": "debtInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedDebtInterest",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastDebtAdjustment",
            "type": "i64"
          },
          {
            "name": "staking",
            "type": {
              "defined": "Staking"
            }
          },
          {
            "name": "exchangeAuthority",
            "type": "publicKey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "padding",
            "type": {
              "array": [
                "u8",
                1620
              ]
            }
          }
        ]
      }
    },
    {
      "name": "exchangeAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "version",
            "type": "u8"
          },
          {
            "name": "debtShares",
            "type": "u64"
          },
          {
            "name": "liquidationDeadline",
            "type": "u64"
          },
          {
            "name": "userStakingData",
            "type": {
              "defined": "UserStaking"
            }
          },
          {
            "name": "head",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "collaterals",
            "type": {
              "array": [
                {
                  "defined": "CollateralEntry"
                },
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "swapline",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "synthetic",
            "type": "publicKey"
          },
          {
            "name": "collateral",
            "type": "publicKey"
          },
          {
            "name": "fee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedFee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "balance",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "limit",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralReserve",
            "type": "publicKey"
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "assetsList",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "headAssets",
            "type": "u8"
          },
          {
            "name": "headCollaterals",
            "type": "u8"
          },
          {
            "name": "headSynthetics",
            "type": "u8"
          },
          {
            "name": "assets",
            "type": {
              "array": [
                {
                  "defined": "Asset"
                },
                255
              ]
            }
          },
          {
            "name": "collaterals",
            "type": {
              "array": [
                {
                  "defined": "Collateral"
                },
                255
              ]
            }
          },
          {
            "name": "synthetics",
            "type": {
              "array": [
                {
                  "defined": "Synthetic"
                },
                255
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "synthetic",
            "type": "publicKey"
          },
          {
            "name": "collateral",
            "type": "publicKey"
          },
          {
            "name": "collateralPriceFeed",
            "type": "publicKey"
          },
          {
            "name": "oracleType",
            "type": "u8"
          },
          {
            "name": "openFee",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "debtInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationThreshold",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationPenaltyLiquidator",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationPenaltyExchange",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedInterest",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "accumulatedInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "liquidationFund",
            "type": "publicKey"
          },
          {
            "name": "collateralReserve",
            "type": "publicKey"
          },
          {
            "name": "mintAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxBorrow",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastUpdate",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultType",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vaultEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "vault",
            "type": "publicKey"
          },
          {
            "name": "lastAccumulatedInterestRate",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "syntheticAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralAmount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "StakingRound",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "start",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "allPoints",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Staking",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fundAccount",
            "type": "publicKey"
          },
          {
            "name": "roundLength",
            "type": "u32"
          },
          {
            "name": "amountPerRound",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "finishedRound",
            "type": {
              "defined": "StakingRound"
            }
          },
          {
            "name": "currentRound",
            "type": {
              "defined": "StakingRound"
            }
          },
          {
            "name": "nextRound",
            "type": {
              "defined": "StakingRound"
            }
          }
        ]
      }
    },
    {
      "name": "UserStaking",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amountToClaim",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "finishedRoundPoints",
            "type": "u64"
          },
          {
            "name": "currentRoundPoints",
            "type": "u64"
          },
          {
            "name": "nextRoundPoints",
            "type": "u64"
          },
          {
            "name": "lastUpdate",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Asset",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedAddress",
            "type": "publicKey"
          },
          {
            "name": "price",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "lastUpdate",
            "type": "u64"
          },
          {
            "name": "twap",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "twac",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "confidence",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "Collateral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "collateralAddress",
            "type": "publicKey"
          },
          {
            "name": "reserveAddress",
            "type": "publicKey"
          },
          {
            "name": "liquidationFund",
            "type": "publicKey"
          },
          {
            "name": "reserveBalance",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "collateralRatio",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxCollateral",
            "type": {
              "defined": "Decimal"
            }
          }
        ]
      }
    },
    {
      "name": "Synthetic",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetIndex",
            "type": "u8"
          },
          {
            "name": "assetAddress",
            "type": "publicKey"
          },
          {
            "name": "supply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "maxSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "borrowedSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "swaplineSupply",
            "type": {
              "defined": "Decimal"
            }
          },
          {
            "name": "settlementSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CollateralEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "collateralAddress",
            "type": "publicKey"
          },
          {
            "name": "index",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Decimal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "val",
            "type": "u128"
          },
          {
            "name": "scale",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "OracleType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Pyth"
          },
          {
            "name": "Chainlink"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 300,
      "name": "Unauthorized",
      "msg": "You are not admin"
    },
    {
      "code": 301,
      "name": "NotSyntheticUsd",
      "msg": "Not synthetic USD asset"
    },
    {
      "code": 302,
      "name": "OutdatedOracle",
      "msg": "Oracle price is outdated"
    },
    {
      "code": 303,
      "name": "MintLimit",
      "msg": "Mint limit"
    },
    {
      "code": 304,
      "name": "WithdrawLimit",
      "msg": "Withdraw limit"
    },
    {
      "code": 305,
      "name": "CollateralAccountError",
      "msg": "Invalid collateral_account"
    },
    {
      "code": 306,
      "name": "SyntheticCollateral",
      "msg": "Synthetic collateral is not supported"
    },
    {
      "code": 307,
      "name": "InvalidAssetsList",
      "msg": "Invalid Assets List"
    },
    {
      "code": 308,
      "name": "InvalidLiquidation",
      "msg": "Invalid Liquidation"
    },
    {
      "code": 309,
      "name": "InvalidSigner",
      "msg": "Invalid signer"
    },
    {
      "code": 310,
      "name": "WashTrade",
      "msg": "Wash trade"
    },
    {
      "code": 311,
      "name": "ExchangeLiquidationAccount",
      "msg": "Invalid exchange liquidation account"
    },
    {
      "code": 312,
      "name": "LiquidationDeadline",
      "msg": "Liquidation deadline not passed"
    },
    {
      "code": 313,
      "name": "Halted",
      "msg": "Program is currently Halted"
    },
    {
      "code": 314,
      "name": "NoRewards",
      "msg": "No rewards to claim"
    },
    {
      "code": 315,
      "name": "FundAccountError",
      "msg": "Invalid fund_account"
    },
    {
      "code": 317,
      "name": "Initialized",
      "msg": "Assets list already initialized"
    },
    {
      "code": 316,
      "name": "SwapUnavailable",
      "msg": "Swap Unavailable"
    },
    {
      "code": 318,
      "name": "Uninitialized",
      "msg": "Assets list is not initialized"
    },
    {
      "code": 319,
      "name": "NoAssetFound",
      "msg": "No asset with such address was found"
    },
    {
      "code": 320,
      "name": "MaxSupply",
      "msg": "Asset max_supply crossed"
    },
    {
      "code": 321,
      "name": "NotCollateral",
      "msg": "Asset is not collateral"
    },
    {
      "code": 322,
      "name": "AlreadyACollateral",
      "msg": "Asset is already a collateral"
    },
    {
      "code": 323,
      "name": "InsufficientValueTrade",
      "msg": "Insufficient value trade"
    },
    {
      "code": 324,
      "name": "InsufficientAmountAdminWithdraw",
      "msg": "Insufficient amount admin withdraw"
    },
    {
      "code": 325,
      "name": "SettlementNotReached",
      "msg": "Settlement slot not reached"
    },
    {
      "code": 326,
      "name": "UsdSettlement",
      "msg": "Cannot settle xUSD"
    },
    {
      "code": 327,
      "name": "ParameterOutOfRange",
      "msg": "Parameter out of range"
    },
    {
      "code": 328,
      "name": "Overflow",
      "msg": "Overflow"
    },
    {
      "code": 329,
      "name": "DifferentScale",
      "msg": "Scale is different"
    },
    {
      "code": 330,
      "name": "MismatchedTokens",
      "msg": "Tokens does not represent same asset"
    },
    {
      "code": 331,
      "name": "SwaplineLimit",
      "msg": "Limit crossed"
    },
    {
      "code": 332,
      "name": "CollateralLimitExceeded",
      "msg": "Limit of collateral exceeded"
    },
    {
      "code": 333,
      "name": "UserBorrowLimit",
      "msg": "User borrow limit"
    },
    {
      "code": 334,
      "name": "VaultBorrowLimit",
      "msg": "Vault borrow limit"
    },
    {
      "code": 335,
      "name": "VaultWithdrawLimit",
      "msg": "Vault withdraw limit"
    },
    {
      "code": 336,
      "name": "InvalidAccount",
      "msg": "Invalid Account"
    },
    {
      "code": 337,
      "name": "PriceConfidenceOutOfRange",
      "msg": "Price confidence out of range"
    },
    {
      "code": 338,
      "name": "InvalidOracleProgram",
      "msg": "Invalid oracle program"
    },
    {
      "code": 339,
      "name": "InvalidExchangeAccount",
      "msg": "Invalid exchange account"
    },
    {
      "code": 340,
      "name": "InvalidOracleType",
      "msg": "Invalid oracle type"
    }
  ]
};
