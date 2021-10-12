import { PublicKey } from '@solana/web3.js'

export enum Network {
  DEV,
  TEST,
  MAIN,
  LOCAL
}

export const DEV_NET = {
  exchange: new PublicKey('HcyCw29qWC77CTnmJkwjnW1whbTppv4xh2SQQzjMin55'),
  oracle: new PublicKey('DUTaRHQcejLHkDdsnR8cUUv2BakxCJfJQmWQNK2hzizE'),
  exchangeAuthority: new PublicKey('6dcLU83ferGcEAjeUeLuJ8q7JbSV2vK3EGajW895tZBj')
}
export const TEST_NET = {
  exchange: new PublicKey('HcyCw29qWC77CTnmJkwjnW1whbTppv4xh2SQQzjMin55'),
  oracle: new PublicKey('4nopYr9nYL5MN1zVgvQQfLhDdqAyVHtR5ZkpPcS12M5b'),
  exchangeAuthority: new PublicKey('6dcLU83ferGcEAjeUeLuJ8q7JbSV2vK3EGajW895tZBj')
}
export const MAIN_NET = {
  exchange: new PublicKey('5TeGDBaMNPc2uxvx6YLDycsoxFnBuqierPt3a8Bk4xFX'),
  // oracle: new PublicKey('4nopYr9nYL5MN1zVgvQQfLhDdqAyVHtR5ZkpPcS12M5b'),
  exchangeAuthority: new PublicKey('4f1XgkC1dSvvovZ9EU85pY8pwNdJRhqy7jjq188b1DjJ')
}
