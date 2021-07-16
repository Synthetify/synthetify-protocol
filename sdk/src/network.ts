import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('Fka99HSG9ErxA3zURgoLeSkSdvoKFAHHaHV1iYup12De'),
  oracle: new PublicKey('FqcnGwHttTjRzb87bDsDHbkEzhZwG8Nht86NziRN2qiw'),
  exchangeAuthority: new PublicKey('6Ngr2N3CGjvWQMA15u4xEgPShfdyKWJ4mpDw7J7rWCx4')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
