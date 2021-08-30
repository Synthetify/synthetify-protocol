import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('CjqA761CQoT9S3GpVBRzMfjcemDR65yxxd7gTiCAiZMA'),
  oracle: new PublicKey('8vDDTGeiRFZMjK26fsXACuLMo4BL8tAKEyvv7r3tDVtF'),
  exchangeAuthority: new PublicKey('DfGmNC4M2FTzxFGJkzBY8R2NVzXSPJ2SfxBuFB2trsPc')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
