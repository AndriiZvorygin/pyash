use super::float::is_finite_f32;
#[cfg(feature = "shader-f64")]
use super::float::is_finite_f64;
use super::programlet_vector_values::{read_programlet_float, write_programlet_float};
use super::*;

const STANDARD_DEVIATION_FIRST: u32 = 0xe833;
const STANDARD_DEVIATION_SECOND: u32 = 0x4922;

fn sqrt_f32(value: f32) -> f32 {
    if value == 0.0 {
        return value;
    }
    let (scaled, divisor) = if value < f32::MIN_POSITIVE {
        (value * 16_777_216.0, 4096.0)
    } else {
        (value, 1.0)
    };
    let mut estimate = f32::from_bits((scaled.to_bits() >> 1) + 0x1fc0_0000);
    let mut iteration = 0;
    while iteration < 6 {
        estimate = 0.5 * (estimate + scaled / estimate);
        iteration += 1;
    }
    estimate / divisor
}

#[cfg(feature = "shader-f64")]
fn sqrt_f64(value: f64) -> f64 {
    if value == 0.0 {
        return value;
    }
    let (scaled, divisor) = if value < f64::MIN_POSITIVE {
        (value * 18_014_398_509_481_984.0, 134_217_728.0)
    } else {
        (value, 1.0)
    };
    let mut estimate = f64::from_bits((scaled.to_bits() >> 1) + 0x1ff8_0000_0000_0000);
    let mut iteration = 0;
    while iteration < 8 {
        estimate = 0.5 * (estimate + scaled / estimate);
        iteration += 1;
    }
    estimate / divisor
}

pub(super) fn is_programlet_standard_deviation(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
) -> bool {
    sentence.mood == DEONTIC
        && matches!(sentence.field_count, 2 | 3)
        && sentence.verb_length == 2
        && sentence_at!(*tokens, sentence.verb_start) == STANDARD_DEVIATION_FIRST
        && sentence_at!(*tokens, sentence.verb_start + 1) == STANDARD_DEVIATION_SECOND
}

pub(super) fn apply_programlet_standard_deviation(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_, impl VliwWord>,
    symbols: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    symbol_used: &mut usize,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    slots: &mut [NumericLocalSlot; MAX_PROGRAMLET_LOCAL_SLOTS],
) -> Result<(), u32> {
    let epsilon_field = sentence.field(COMITATIVE);
    if sentence.field(SOURCE).is_none()
        || sentence.field(DESTINATION).is_none()
        || (epsilon_field.is_some() && sentence.field_count != 3)
        || (epsilon_field.is_none() && sentence.field_count != 2)
    {
        return Err(ERROR_MALFORMED);
    }
    let mut input = read_programlet_float(
        tokens,
        sentence.field(SOURCE).ok_or(ERROR_MALFORMED)?,
        symbols,
        arguments,
        slots,
    )?;
    if let Some(epsilon_field) = epsilon_field {
        let epsilon = read_programlet_float(tokens, epsilon_field, symbols, arguments, slots)?;
        if epsilon.kind != input.kind {
            return Err(ERROR_UNSUPPORTED);
        }
        match input.kind {
            VALUE_FLOAT32 => {
                let variance = f32::from_bits(input.bits);
                let epsilon = f32::from_bits(epsilon.bits);
                if !is_finite_f32(variance)
                    || variance < 0.0
                    || !is_finite_f32(epsilon)
                    || epsilon < 0.0
                {
                    return Err(ERROR_FLOAT_DOMAIN);
                }
                let adjusted = variance + epsilon;
                if !is_finite_f32(adjusted) {
                    return Err(ERROR_FLOAT_DOMAIN);
                }
                input.bits = adjusted.to_bits();
            }
            VALUE_FLOAT64 => {
                #[cfg(not(feature = "shader-f64"))]
                return Err(ERROR_UNSUPPORTED);
                #[cfg(feature = "shader-f64")]
                {
                    let variance =
                        f64::from_bits(u64::from(input.bits) | (u64::from(input.high) << 32));
                    let epsilon =
                        f64::from_bits(u64::from(epsilon.bits) | (u64::from(epsilon.high) << 32));
                    if !is_finite_f64(variance)
                        || variance < 0.0
                        || !is_finite_f64(epsilon)
                        || epsilon < 0.0
                    {
                        return Err(ERROR_FLOAT_DOMAIN);
                    }
                    let adjusted = variance + epsilon;
                    if !is_finite_f64(adjusted) {
                        return Err(ERROR_FLOAT_DOMAIN);
                    }
                    let bits = adjusted.to_bits();
                    input.bits = bits as u32;
                    input.high = (bits >> 32) as u32;
                }
            }
            _ => return Err(ERROR_UNSUPPORTED),
        }
    }
    let output = match input.kind {
        VALUE_FLOAT32 => {
            let value = f32::from_bits(input.bits);
            if !is_finite_f32(value) || value < 0.0 {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            let result = sqrt_f32(value);
            if !is_finite_f32(result) {
                return Err(ERROR_FLOAT_DOMAIN);
            }
            ProgramletNumber {
                bits: result.to_bits(),
                high: 0,
                kind: VALUE_FLOAT32,
            }
        }
        VALUE_FLOAT64 => {
            #[cfg(not(feature = "shader-f64"))]
            return Err(ERROR_UNSUPPORTED);
            #[cfg(feature = "shader-f64")]
            {
                let value = f64::from_bits(u64::from(input.bits) | (u64::from(input.high) << 32));
                if !is_finite_f64(value) || value < 0.0 {
                    return Err(ERROR_FLOAT_DOMAIN);
                }
                let result = sqrt_f64(value);
                if !is_finite_f64(result) {
                    return Err(ERROR_FLOAT_DOMAIN);
                }
                let bits = result.to_bits();
                ProgramletNumber {
                    bits: bits as u32,
                    high: (bits >> 32) as u32,
                    kind: VALUE_FLOAT64,
                }
            }
        }
        _ => return Err(ERROR_UNSUPPORTED),
    };
    write_programlet_float(
        tokens,
        sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?,
        symbols,
        symbol_used,
        VALUE_FLOAT,
        output,
        slots,
    )
}

#[cfg(test)]
mod tests {
    use super::sqrt_f32;
    #[cfg(feature = "shader-f64")]
    use super::sqrt_f64;

    #[test]
    fn square_root_handles_normal_and_subnormal_values() {
        assert!((sqrt_f32(0.25) - 0.5).abs() < 1.0e-7);
        assert!((sqrt_f32(f32::from_bits(1)) - 3.743_392e-23).abs() < 1.0e-28);
        #[cfg(feature = "shader-f64")]
        {
            assert!((sqrt_f64(2.0) - core::f64::consts::SQRT_2).abs() < 1.0e-15);
            assert!((sqrt_f64(f64::from_bits(1)) - 2.222_758_749_485_077_5e-162).abs() < 1.0e-167);
        }
    }
}
