import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('3V7ZLhTi3EFSQ3j1szadrfM5Am8368RPQVPRnYqUsbBB'),
  oracle: new PublicKey('DUTaRHQcejLHkDdsnR8cUUv2BakxCJfJQmWQNK2hzizE'),
  exchangeAuthority: new PublicKey('Gs1oPECd79PkytEaUPutykRoZomXVY8T68yMQ6Lpbo7i')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
