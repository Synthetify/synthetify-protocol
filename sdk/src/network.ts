import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('2MDpnAdPjS6EJgRiVEGMFK9mgNgxYv2tvUpPCxJrmrJX'),
  oracle: new PublicKey('J9p6hixvj9FT2niHAogKzWnEuB4SRodwfM3ivUewi1JC'),
  exchangeAuthority: new PublicKey('HTsnsmNsZhU4jhinASoKam7umiRzmYtt3AX8BHEvcuHL')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
