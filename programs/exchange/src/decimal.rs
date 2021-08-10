use std::convert::TryInto;
use std::ops::{Div, Mul};

use crate::math::{ACCURACY, PRICE_OFFSET};
use crate::*;

const UNIFIED_PERCENT_SCALE: u8 = 4;
const SNY_DECIMAL:u8 = 6;

impl Decimal {
    pub fn denominator(self) -> u128 {
        return 10u128.pow(self.scale.into());
    }
    pub fn from_percent(percent: u16) -> Self {
        return Decimal {
            val: percent.into(),
            scale: UNIFIED_PERCENT_SCALE,
        };
    }
    pub fn from_integer(integer: u64) -> Self {
        return Decimal {
            val: integer.into(),
            scale: 0,
        };
    }
    pub fn from_price(price: u128) -> Self {
        return Decimal {
            val: price,
            scale: PRICE_OFFSET,
        };
    }
    pub fn from_usd(value: u128) -> Self {
        return Decimal {
            val: value.into(),
            scale: ACCURACY,
        };
    }
    pub fn from_sny(value: u128) -> Self {
        Decimal { val: value, scale: SNY_DECIMAL }
    }
    pub fn to_usd(self) -> Decimal {
        self.to_scale(ACCURACY)
    }
    pub fn to_u64(self) -> u64 {
        self.val.try_into().unwrap()
    }
    pub fn to_scale(self, scale: u8) -> Self {
        let mut scaled = self.val;
        if self.scale > scale {
            let scaled = scaled
                .checked_div(10u128.pow((self.scale - scale).into()))
                .unwrap();
        } else {
            let scaled = scaled
                .checked_mul(10u128.pow((scale - self.scale).into()))
                .unwrap();
        }

        Self { val: scaled, scale }
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
impl Mul<u128> for Decimal {
    fn mul(self, value: u128) -> Self {
        val: self
            .val
            .checked_mul(value)
            .unwrap()
            .checked_
    }
}
impl MulUp<Decimal> for Decimal {
    fn mul_up(self, other: Decimal) -> Self {
        let denominator = Decimal {
            val: other.denominator(),
            scale: 0,
        };
        Self {
            val: self.mul(other).div_up(denominator).val,
            scale: self.scale,
        }
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
        let almost_other = Decimal {
            val: other.val.checked_sub(1).unwrap(),
            scale: other.scale,
        };
        self.add(almost_other).unwrap().div(other)
    }
}
impl DivScale<Decimal> for Decimal {
    fn div_to_scale(self, other: Decimal, to_scale: u8) -> Self {
        let decimal_difference = to_scale as i16 - self.scale as i16;

        let val = if decimal_difference < 0 {
            self.val
                .checked_mul(other.denominator())
                .unwrap()
                .checked_div(other.val)
                .unwrap()
                .checked_div(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap()
        } else {
            self.val
                .checked_mul(other.denominator())
                .unwrap()
                .checked_mul(10u128.pow(decimal_difference.try_into().unwrap()))
                .unwrap()
                .checked_div(other.val)
                .unwrap()
        };
        Self {
            val,
            scale: to_scale,
        }
    }
}
impl Into<u64> for Decimal {
    fn into(self) -> u64 {
        self.val.try_into().unwrap()
    }
}
impl Into<u128> for Decimal {
    fn into(self) -> u128 {
        self.val.try_into().unwrap()
    }
}
impl Ltq<Decimal> for Decimal {
    fn ltq(self, other: Decimal) -> Result<bool> {
        require!(self.scale == other.scale, DifferentScale);
        Ok(self.val <= other.val)
    }
}
impl Lt<Decimal> for Decimal {
    fn lt(self, other: Decimal) -> Result<bool> {
        require!(self.scale == other.scale, DifferentScale);
        Ok(self.val < other.val)
    }
}
impl Gt<Decimal> for Decimal {
    fn gt(self, other: Decimal) -> Result<bool> {
        require!(self.scale == other.scale, DifferentScale);
        Ok(self.val > other.val)
    }
}
impl Eq<Decimal> for Decimal {
    fn eq(self, other: Decimal) -> Result<bool> {
        require!(self.scale == other.scale, DifferentScale);
        Ok(self.val == other.val)
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
pub trait DivScale<T> {
    fn div_to_scale(self, rhs: T, to_scale: u8) -> Self;
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
pub trait Lt<T>: Sized {
    fn lt(self, rhs: T) -> Result<bool>;
}
pub trait Gt<T>: Sized {
    fn gt(self, rhs: T) -> Result<bool>;
}
pub trait Eq<T>: Sized {
    fn eq(self, rhs: T) -> Result<bool>;
}
// #[cfg(test)]
// mod test {
//     use super::*;

//     #[test]
//     fn test_scaler() {
//         assert_eq!(U192::exp10(SCALE), Decimal::wad());
//     }
// }
