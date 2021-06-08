use std::convert::TryInto;

pub const CONFIDENCE_OFFSET: u8 = 6u8;

// confidence is in range 0 - 1000000
// 0 -> perfect price
// 100 -> 0.01% accuracy
// 1000 -> 0.1% accuracy
// 10000 -> 1% accuracy
pub fn calculate_confidence(conf: u64, price: i64) -> u32 {
    return (conf as u128)
        .checked_mul(10u128.pow(CONFIDENCE_OFFSET.into()))
        .unwrap()
        .checked_div(price.try_into().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_calculate_confidence() {
        let offset = 10u32.pow(CONFIDENCE_OFFSET.into());
        // 100% -> 1 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 100_000_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (1f64 * f64::from(offset)) as u32)
        }
        // 1% -> 0.01 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 1_000_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.01 * f64::from(offset)) as u32)
        }
        // 0.1% -> 0.001 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 100_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.001 * f64::from(offset)) as u32)
        }
        // 0.01% -> 0.0001 * 10 ** CONFIDENCE_OFFSET
        {
            let price = 100_000_000i64;
            let conf = 10_000u64;
            let confidence = calculate_confidence(conf, price);
            assert_eq!(confidence, (0.0001 * f64::from(offset)) as u32)
        }
    }
}
