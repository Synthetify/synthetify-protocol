---
title: Parameters

slug: /Parameters
---

### Basic parameters

|         Name          |          Value          |
| :-------------------: | :---------------------: |
|          Fee          |          0,3%           |
|  Rewards round time   | 1209600 slots (~7 days) |
| SNY per rewards round |          40000          |
|     Health factor     |           70%           |
|  Debt interest rate   |           1%            |
|     Protocol fee      |           20%           |
| Penalty to liquidator |           5%            |
|  Penalty to exchange  |           5%            |
|  Liquidation buffer   |          2250           |
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

|  Name  |                             Address                              | Ratio | Maximum deposit |
| :----: | :--------------------------------------------------------------: | :---: | :-------------: |
|  SNY   | 35fe161e6828028ece9caa2d89bcd7a1fd1bf140ad838d0c17d7b57c9b1aa238 |  30%  |    unlimited    |
|  WSOL  | 069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001 |  30%  |     100000      |
|  USDC  | c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61 |  30%  |    10000000     |
| renBTC | a6975293cf382d28589c7a079bb5e20e5676f222559bd0473e0ac011fc54e380 |  30%  |       100       |

### Synthetic parameters

| Name |                             Address                              | Maximum supply |
| :--: | :--------------------------------------------------------------: | :------------: |
| xUSD | 689ac099ef657e5d3b7efaf1e36ab8b897e2746232d8a9261b3e49b35c1dead4 |   unlimited    |
| xBTC | f567f2a391b04f0e2830f0b0acf29236936601d5bf9bdab6395941069cd2fe94 |      100       |
| xSOL | 9deca80f54724d6134648c1a6b85fd6678225575bf54ec18e05635a4ef09a525 |     20000      |
| xFTT | dc93e7cfb7e81c47523a07feabb959df06d3f713b83e0908f4b6aacb0dc7b4ca |     10000      |
| xETH | 70eeaaf1cbcabd3da2d73174a6d4bb120ef198200fef79394fc0d3a1dceed3f0 |      1000      |
