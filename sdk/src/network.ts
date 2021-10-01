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
  exchange: new PublicKey('9drf22jv2L8HvW3uDu7cmQTaYVoJM1W8cEjqD3NfDmAM'),
  oracle: new PublicKey('4nopYr9nYL5MN1zVgvQQfLhDdqAyVHtR5ZkpPcS12M5b'),
  exchangeAuthority: new PublicKey('AHhuSXACqtyPfYZ7DZUg5xqPGViKux34hXTGqRNw392B')
}
export const MAIN_NET = {
  exchange: new PublicKey('5TeGDBaMNPc2uxvx6YLDycsoxFnBuqierPt3a8Bk4xFX'),
  // oracle: new PublicKey('4nopYr9nYL5MN1zVgvQQfLhDdqAyVHtR5ZkpPcS12M5b'),
  exchangeAuthority: new PublicKey('4f1XgkC1dSvvovZ9EU85pY8pwNdJRhqy7jjq188b1DjJ')
}
