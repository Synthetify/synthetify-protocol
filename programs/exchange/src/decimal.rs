use std::convert::TryInto;

use crate::math::ACCURACY;
use crate::*;

impl Decimal {
    pub fn denominator(self) -> u128 {
        return 10u128.pow(self.scale.into());
    }
    pub fn from_percent(percent: u128) -> Self {
        return Decimal {
            val: percent.checked_mul(10u128.pow(9)).unwrap(),
            scale: 9,
        };
    }

    pub fn to_usd(self) -> u64 {
        let decimal_difference = self.scale as i32 - ACCURACY as i32;
        if decimal_difference < 0 {
            let amount = (self.val)
                .checked_div(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap();
            return amount.try_into().unwrap();
        } else {
            let amount = (self.val)
                .checked_mul(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap();
            return amount.try_into().unwrap();
        }
    }

    pub fn to_u64(self) -> u64 {
        self.val.try_into().unwrap()
    }
    // pub fn try_mul_inverse(self, value: u128) -> Result<u128> {
    //     return Ok(self
    //         .val
    //         .checked_mul(self.denominator())
    //         .unwrap()
    //         .checked_div(value)
    //         .unwrap());
    // }
}

impl Mul<Decimal> for Decimal {
    fn mul(self, value: Decimal) -> Self {
        return Self {
            val: self
                .val
                .checked_mul(value.val)
                .unwrap()
                .checked_div(value.denominator())
                .unwrap(),
            scale: self.scale,
        };
    }
}
impl MulInverse<Decimal> for Decimal {
    fn mul_inverse(self, value: Decimal) -> Self {
        return Self {
            val: self
                .val
                .checked_mul(self.denominator())
                .unwrap()
                .checked_div(value.val)
                .unwrap(),
            scale: self.scale,
        };
    }
}
impl Add<Decimal> for Decimal {
    fn add(self, value: Decimal) -> Result<Self> {
        require!(self.scale == value.scale, DifferentScale);

        Ok(Self {
            val: self.val.checked_add(value.val).unwrap(),
            scale: self.scale,
        })
    }
}
impl Add<u64> for Decimal {
    fn add(self, value: u64) -> Result<Self> {
        Ok(Self {
            val: self.val.checked_add(value.into()).unwrap(),
            scale: self.scale,
        })
    }
}
impl Into<u64> for Decimal {
    fn into(self) -> u64 {
        self.val.try_into().unwrap()
    }
}
pub trait Sub: Sized {
    fn sub(self, rhs: Self) -> Self;
}
pub trait Add<T>: Sized {
    fn add(self, rhs: T) -> Result<Self>;
}
pub trait Div<T>: Sized {
    fn div(self, rhs: T) -> Self;
}
pub trait Mul<T>: Sized {
    fn mul(self, rhs: T) -> Self;
}
pub trait MulInverse<T>: Sized {
    fn mul_inverse(self, rhs: T) -> Self;
}
// #[cfg(test)]
// mod test {
//     use super::*;

//     #[test]
//     fn test_scaler() {
//         assert_eq!(U192::exp10(SCALE), Decimal::wad());
//     }
// }