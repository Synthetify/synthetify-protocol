import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('8RXWQoGYb9saCXces3STYcxvaJznvQiy7uW1pkuYTXXv'),
  oracle: new PublicKey('5qTeBcsCvvGyQwVDCbKrsTD9mxLfvokZkJLwWyW4Fg63'),
  exchangeAuthority: new PublicKey('3rBAzG4ZUUK1wQur6BhiNCTvXBZkLsniVWgDueZmdEHJ')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
