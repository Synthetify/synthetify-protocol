use std::convert::TryInto;

use crate::math::ACCURACY;
use crate::*;

pub const U8_PERCENT_SCALE: u8 = 4;

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
impl MulUp<Decimal> for Decimal {
    fn mul_up(self, value: Decimal) -> Self {
        return Self {
            val: self.mul(value.val).div_up(value.denominator()),
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
impl Sub<Decimal> for Decimal {
    fn sub(self, value: Decimal) -> Result<Self> {
        require!(self.scale == value.scale, DifferentScale);
        Ok(Self {
            val: self.val.checked_sub(value.val).unwrap(),
            scale: self.scale,
        })
    }
}
impl Div<Decimal> for Decimal {
    fn div(self, other: Decimal) -> Self {
        Self {
            val: self
                .val
                .checked_mul(other.denominator())
                .unwrap()
                .checked_div(other.val)
                .unwrap(),
            scale: self.scale,
        }
    }
}
impl DivUp<Decimal> for Decimal {
    fn div_up(self, other: Decimal) -> Self {
        self.add(other.val.checked_sub(1).unwrap())
            .unwrap()
            .div(other)
    }
}
impl Into<u64> for Decimal {
    fn into(self) -> u64 {
        self.val.try_into().unwrap()
    }
}
impl Ltq<Decimal> for Decimal {
    fn ltq(self, other: Decimal) -> Result<bool> {
        require!(self.scale == other.scale, DifferentScale);
        Ok(self.val <= other.val)
    }
}
pub trait Sub<T>: Sized {
    fn sub(self, rhs: T) -> Result<Self>;
}
pub trait Add<T>: Sized {
    fn add(self, rhs: T) -> Result<Self>;
}
pub trait Div<T>: Sized {
    fn div(self, rhs: T) -> Self;
}
pub trait DivUp<T>: Sized {
    fn div_up(self, rhs: T) -> Self;
}
pub trait Mul<T>: Sized {
    fn mul(self, rhs: T) -> Self;
}
pub trait MulUp<T>: Sized {
    fn mul_up(self, rhs: T) -> Self;
}
pub trait MulInverse<T>: Sized {
    fn mul_inverse(self, rhs: T) -> Self;
}
pub trait Ltq<T>: Sized {
    fn ltq(self, rhs: T) -> Result<bool>;
}
// #[cfg(test)]
// mod test {
//     use super::*;

//     #[test]
//     fn test_scaler() {
//         assert_eq!(U192::exp10(SCALE), Decimal::wad());
//     }
// }
