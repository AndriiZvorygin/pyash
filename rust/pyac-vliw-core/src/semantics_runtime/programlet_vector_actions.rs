use super::*;

const SUBTRACT_VERB: u32 = 0xabd2;
const EXPONENTIAL_VERB: u32 = 0x8c29;
const DIVIDE_VERB: u32 = 0x8893;
const SUM_VERB: u32 = 0xbc8a;
const MAXIMUM_FIRST: u32 = 0xa9b2;
const MAXIMUM_SECOND: u32 = 0xa831;

fn exp_f32(value: f32) -> Result<f32, u32> {
    if value == f32::NEG_INFINITY || value < -104.0 {
        return Ok(0.0);
    }
    if !value.is_finite() || value > 88.0 {
        return Err(ERROR_FLOAT_DOMAIN);
    }
    let scaled = value * 1.442_695_1_f32;
    let mut exponent = scaled as i32;
    if exponent as f32 > scaled {
        exponent -= 1;
    }
    let reduced = value - exponent as f32 * 0.693_147_2_f32;
    let coefficients = [
        1.0_f32,
        1.0,
        0.5,
        0.166_666_67,
        0.041_666_668,
        0.008_333_334,
        0.001_388_888_9,
        0.000_198_412_7,
        0.000_024_801_588,
        0.000_002_755_731_9,
    ];
    let mut polynomial = coefficients[9];
    let mut index = 9;
    while index > 0 {
        index -= 1;
        polynomial = array_at!(coefficients, index) + reduced * polynomial;
    }
    let scale = if exponent >= -126 {
        f32::from_bits(((exponent + 127) as u32) << 23)
    } else if exponent >= -149 {
        f32::from_bits(1u32 << (exponent + 149))
    } else {
        0.0
    };
    let output = polynomial * scale;
    if !output.is_finite() {
        return Err(ERROR_FLOAT_DOMAIN);
    }
    Ok(output)
}

#[cfg(feature = "shader-f64")]
fn exp_f64(value: f64) -> Result<f64, u32> {
    if value == f64::NEG_INFINITY || value < -746.0 {
        return Ok(0.0);
    }
    if !value.is_finite() || value > 709.0 {
        return Err(ERROR_FLOAT_DOMAIN);
    }
    let scaled = value * 1.442_695_040_888_963_4_f64;
    let mut exponent = scaled as i32;
    if exponent as f64 > scaled {
        exponent -= 1;
    }
    let reduced = value - exponent as f64 * 0.693_147_180_559_945_3_f64;
    let coefficients = [
        1.0_f64,
        1.0,
        0.5,
        0.166_666_666_666_666_66,
        0.041_666_666_666_666_664,
        0.008_333_333_333_333_333,
        0.001_388_888_888_888_889,
        0.000_198_412_698_412_698_4,
        0.000_024_801_587_301_587_3,
        0.000_002_755_731_922_398_589_3,
        0.000_000_275_573_192_239_858_9,
        0.000_000_025_052_108_385_441_72,
    ];
    let mut polynomial = coefficients[11];
    let mut index = 11;
    while index > 0 {
        index -= 1;
        polynomial = array_at!(coefficients, index) + reduced * polynomial;
    }
    let scale = if exponent >= -1022 {
        f64::from_bits(((exponent + 1023) as u64) << 52)
    } else if exponent >= -1074 {
        f64::from_bits(1u64 << (exponent + 1074))
    } else {
        0.0
    };
    let output = polynomial * scale;
    if !output.is_finite() {
        return Err(ERROR_FLOAT_DOMAIN);
    }
    Ok(output)
}

fn vector_precision_matches(vector_kind: u32, scalar_kind: u32) -> bool {
    matches!(
        (vector_kind, scalar_kind),
        (VALUE_VECTOR_FLOAT32, VALUE_FLOAT32) | (VALUE_VECTOR_FLOAT64, VALUE_FLOAT64)
    )
}

fn apply_f32(
    vector: &ProgramletVectorValue,
    scalar: Option<ProgramletNumber>,
    verb: u32,
) -> Result<ProgramletVectorValue, u32> {
    let mut result = *vector;
    let scalar_value = scalar.map(|value| f32::from_bits(value.bits));
    let mut lane = 0;
    while lane < vector.length {
        let input = f32::from_bits(array_at!(vector.values, lane));
        let output = match verb {
            SUBTRACT_VERB => input - scalar_value.ok_or(ERROR_MALFORMED)?,
            DIVIDE_VERB => {
                let divisor = scalar_value.ok_or(ERROR_MALFORMED)?;
                if divisor == 0.0 {
                    return Err(ERROR_DIVISION_BY_ZERO);
                }
                input / divisor
            }
            EXPONENTIAL_VERB => exp_f32(input)?,
            _ => return Err(ERROR_UNSUPPORTED),
        };
        if !output.is_finite() && !(verb == SUBTRACT_VERB && output == f32::NEG_INFINITY) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        array_put!(&mut result.values, lane, output.to_bits());
        lane += 1;
    }
    Ok(result)
}

#[cfg(feature = "shader-f64")]
fn apply_f64(
    vector: &ProgramletVectorValue,
    scalar: Option<ProgramletNumber>,
    verb: u32,
) -> Result<ProgramletVectorValue, u32> {
    let mut result = *vector;
    let scalar_value =
        scalar.map(|value| f64::from_bits(u64::from(value.bits) | (u64::from(value.high) << 32)));
    let mut lane = 0;
    while lane < vector.length {
        let offset = lane * 2;
        let input = f64::from_bits(
            u64::from(array_at!(vector.values, offset))
                | (u64::from(array_at!(vector.values, offset + 1)) << 32),
        );
        let output = match verb {
            SUBTRACT_VERB => input - scalar_value.ok_or(ERROR_MALFORMED)?,
            DIVIDE_VERB => {
                let divisor = scalar_value.ok_or(ERROR_MALFORMED)?;
                if divisor == 0.0 {
                    return Err(ERROR_DIVISION_BY_ZERO);
                }
                input / divisor
            }
            EXPONENTIAL_VERB => exp_f64(input)?,
            _ => return Err(ERROR_UNSUPPORTED),
        };
        if !output.is_finite() && !(verb == SUBTRACT_VERB && output == f64::NEG_INFINITY) {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        let bits = output.to_bits();
        array_put!(&mut result.values, offset, bits as u32);
        array_put!(&mut result.values, offset + 1, (bits >> 32) as u32);
        lane += 1;
    }
    Ok(result)
}

fn reduce_vector(vector: &ProgramletVectorValue, verb: u32) -> Result<ProgramletNumber, u32> {
    if vector.length == 0 {
        return Err(ERROR_VECTOR_WIDTH);
    }
    if vector.kind == VALUE_VECTOR_FLOAT32 {
        let mut value = f32::from_bits(array_at!(vector.values, 0));
        let mut lane = 1;
        while lane < vector.length {
            let next = f32::from_bits(array_at!(vector.values, lane));
            value = if verb == SUM_VERB {
                value + next
            } else if next > value {
                next
            } else {
                value
            };
            lane += 1;
        }
        if !value.is_finite() {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        return Ok(ProgramletNumber {
            bits: value.to_bits(),
            high: 0,
            kind: VALUE_FLOAT32,
        });
    }
    #[cfg(feature = "shader-f64")]
    if vector.kind == VALUE_VECTOR_FLOAT64 {
        let bits =
            u64::from(array_at!(vector.values, 0)) | (u64::from(array_at!(vector.values, 1)) << 32);
        let mut value = f64::from_bits(bits);
        let mut lane = 1;
        while lane < vector.length {
            let offset = lane * 2;
            let next = f64::from_bits(
                u64::from(array_at!(vector.values, offset))
                    | (u64::from(array_at!(vector.values, offset + 1)) << 32),
            );
            value = if verb == SUM_VERB {
                value + next
            } else if next > value {
                next
            } else {
                value
            };
            lane += 1;
        }
        if !value.is_finite() {
            return Err(ERROR_FLOAT_DOMAIN);
        }
        let bits = value.to_bits();
        return Ok(ProgramletNumber {
            bits: bits as u32,
            high: (bits >> 32) as u32,
            kind: VALUE_FLOAT64,
        });
    }
    Err(ERROR_UNSUPPORTED)
}

pub(super) fn is_programlet_vector_verb(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
) -> bool {
    matches!(
        (sentence.verb_length, array_at!(tokens, sentence.verb_start)),
        (1, SUBTRACT_VERB | EXPONENTIAL_VERB | DIVIDE_VERB | SUM_VERB) | (2, MAXIMUM_FIRST)
    )
}

pub(super) fn is_programlet_vector_action(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &[u32; PROGRAMLET_SCRATCH_WORDS],
    frame: &ProgramletFrame,
) -> bool {
    is_programlet_vector_verb(sentence, tokens)
        && sentence.field(SOURCE).is_some_and(|source| {
            programlet_field_is_vector(
                tokens,
                source,
                symbols,
                &frame.arguments,
                &frame.vector_slots,
            )
        })
}

pub(super) fn apply_programlet_vector_action(
    sentence: &ParsedSentence,
    tokens: &[u32; PROGRAMLET_SCRATCH_WORDS],
    symbols: &mut [u32; PROGRAMLET_SCRATCH_WORDS],
    symbol_used: &mut usize,
    frame: &mut ProgramletFrame,
) -> Result<(), u32> {
    if sentence.mood != DEONTIC || !is_programlet_vector_verb(sentence, tokens) {
        return Err(ERROR_UNSUPPORTED);
    }
    let source = sentence.field(SOURCE).ok_or(ERROR_MALFORMED)?;
    let output = sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?;
    if sentence.field_count
        != if sentence.field(COMITATIVE).is_some() {
            3
        } else {
            2
        }
    {
        return Err(ERROR_MALFORMED);
    }
    let vector = read_programlet_vector(
        tokens,
        source,
        symbols,
        &frame.arguments,
        &frame.vector_slots,
    )?;
    let verb = if sentence.verb_length == 2 {
        if array_at!(tokens, sentence.verb_start + 1) != MAXIMUM_SECOND
            || sentence.field(COMITATIVE).is_some()
        {
            return Err(ERROR_MALFORMED);
        }
        MAXIMUM_FIRST
    } else {
        array_at!(tokens, sentence.verb_start)
    };
    if matches!(verb, SUM_VERB | MAXIMUM_FIRST) {
        if sentence.field(COMITATIVE).is_some() {
            return Err(ERROR_MALFORMED);
        }
        let result = reduce_vector(&vector, verb)?;
        return write_programlet_float(
            tokens,
            output,
            symbols,
            symbol_used,
            VALUE_FLOAT,
            result,
            &mut frame.slots,
        );
    }
    let scalar = sentence
        .field(COMITATIVE)
        .map(|field| read_programlet_float(tokens, field, symbols, &frame.arguments, &frame.slots))
        .transpose()?;
    if verb != EXPONENTIAL_VERB && scalar.is_none() {
        return Err(ERROR_MALFORMED);
    }
    if let Some(value) = scalar
        && !vector_precision_matches(vector.kind, value.kind)
    {
        return Err(ERROR_UNSUPPORTED);
    }
    let result = if vector.kind == VALUE_VECTOR_FLOAT32 {
        apply_f32(&vector, scalar, verb)?
    } else {
        #[cfg(not(feature = "shader-f64"))]
        return Err(ERROR_UNSUPPORTED);
        #[cfg(feature = "shader-f64")]
        apply_f64(&vector, scalar, verb)?
    };
    write_programlet_vector(
        tokens,
        output,
        symbols,
        symbol_used,
        result,
        &mut frame.vector_slots,
    )
}
