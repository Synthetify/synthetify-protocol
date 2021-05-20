import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('7nQjxBds85XHHA73Y8Nvvs7Dat7Vs1L4cuXJ8yksCTpP'),
  oracle: new PublicKey('8XMb2Fvot4FiERQ6XxNhfoeVeCQ7UyBBKjZzr459bdvv'),
  manager: new PublicKey('3pWcxWE2p1tpvG9H1ZqUo8x9FH8FwqRggQnPQFuRLkRf'),
  exchangeAuthority: new PublicKey('4nddjKsbFxFcsNRin4XGayArV3nFgXayA8KojYyW7DJb')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  manager: new PublicKey('2joXgqZtcTsSnBotkxmyYiZo3xPEzeGq7r4UZFXX2Kqu'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
