import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('4Kk77Wf4MZCaWxt9Anm2FwtqG9WpgePZzixS4G1uKvxz'),
  oracle: new PublicKey('7U2Ue9gTqhBxWnWPPEAVyLe4fiij9EjnJfuMA5Rm8LvG'),
  manager: new PublicKey('Dt6hw2QcyNkyick4Gm17Ub5sxtgKU6LFNrQRrpxLmJZX'),
  exchangeAuthority: new PublicKey('6u2H1tDwwdD4p3Cy5DkaRq8cd6h8Yto7SbYgCuf7Aevj')
}
export const TEST_NET = {
  exchange: new PublicKey('9buhRrePiSBr6no7mR8is5UAx19YXjLTJuPcuvg2LSSd'),
  oracle: new PublicKey('8B1scSRf6xnYsQHdrwusF8kpSdEUZDcnFcNjRciSG96W'),
  manager: new PublicKey('2joXgqZtcTsSnBotkxmyYiZo3xPEzeGq7r4UZFXX2Kqu'),
  exchangeAuthority: new PublicKey('AddxzY6F4KEEEwgjfbwdpRuucxWcEzmEm1A1Yikc2SLW')
}
