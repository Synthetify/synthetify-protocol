---
title: Parameters

slug: /Parameters
---

### Basic parameters

|         Name          |          Value          |
| :-------------------: | :---------------------: |
|          Fee          |          0,3%           |
|  Rewards round time   | 1209600 slots (~7 days) |
| SNY per rewards round |          10000          |
|     Health factor     |           90%           |
|  Debt interest rate   |           1%            |
|     Protocol fee      |           20%           |
| Penalty to liquidator |           8%            |
|  Penalty to exchange  |           1%            |
|  Liquidation buffer   |           80            |
|   Liquidation rate    |           20%           |

- **_Fee_** - percentage paid as a fee on swap
- **_Health factor_** - ratio of mint limit to max debt
- **_Debt interest rate_** - amount of interest rate charged on debt
- **_Protocol fee_** - percentage of the fee going to the protocol reserve
- **_Penalty to liquidator_** - penalty on liquidation going to the user that is liquidating
- **_Penalty to exchange_** - liquidation penalty going to liquidation fund
- **_Liquidation buffer_** - number of slots between exceeding max debt and liquidation
- **_Liquidation rate_** - maximum part of user's debt repaid on liquidation

### Collateral parameters

|  Name  |                   Address                    | Ratio | Maximum deposit |
| :----: | :------------------------------------------: | :---: | :-------------: |
|  SNY   | 4dmKkXNHdgYsXqBHCuMikNQWwVomZURhYvkkX5c4pQ7y |  35%  |    unlimited    |
|  WSOL  | So11111111111111111111111111111111111111112  |  70%  |     100000      |
|  USDC  | EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v |  85%  |    10000000     |
| renBTC | CDJWUqTcYTVAKXAVXoQZFes5JUFc7owSeq7eMQcDSbo5 |  80%  |       100       |
| whFTT  | EzfgjvkSwthhgHaceR3LnKXUoRkP6NUhfghdaHAj1tUv |  60%  |     100000      |
| whETH  | 7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs |  70%  |      2000       |
|  mSOL  | mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So  |  70%  |     200000      |

### Synthetic parameters

| Name  |                   Address                    | Maximum supply |
| :---: | :------------------------------------------: | :------------: |
| xUSD  | 83LGLCm7QKpYZbX8q4W2kYWbtt8NJBwbVwEepzkVnJ9y |   unlimited    |
| xBTC  | HWxpSV3QAGzLQzGAtvhSYAEr7sTQugQygnni1gnUGh1D |      100       |
| xSOL  | BdUJucPJyjkHxLMv6ipKNUhSeY3DWrVtgxAES1iSBAov |     30000      |
| xFTT  | Fr3W7NPVvdVbwMcHgA7Gx2wUxP43txdsn3iULJGFbKz9 |     40000      |
| xETH  | 8bqjz8DeSuim1sEAsQatjJN4zseyxSPdhHQcuuhL8PCK |      1000      |
| xLUNA | 6MeoZEcUMhAB788YXTQN4x7K8MnwSt6RHWsLkuq9GJb2 |     20000      |
| xDOT  | 82Afat35Wr9v4fsZfSqGh8dnXFjxeaiQBfm5G9TK1BNj |     50000      |
| xAVAX | HtxznfExBatdX28kMFDvmvU1rXVwiG3JSWcNPdFQ4PLh |     10000      |
