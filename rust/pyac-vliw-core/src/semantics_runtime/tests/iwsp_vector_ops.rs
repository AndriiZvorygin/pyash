use super::*;

const SUM_VERB: u32 = 0xbc8a;

fn append_sentence(tokens: &[u32], boundaries: &[usize]) -> std::vec::Vec<u32> {
    let chunks = tokens.chunks(CODELET_WORDS - 1);
    let count = chunks.len();
    let mut words = std::vec::Vec::with_capacity(count * CODELET_WORDS);
    for (index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let final_codelet = index + 1 == count;
        let token_start = index * (CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(final_codelet);
        codelet[1..chunk.len() + 1].copy_from_slice(chunk);
        for (offset, _) in chunk.iter().enumerate() {
            let boundary = boundaries.contains(&(token_start + offset));
            if boundary == final_codelet {
                codelet[0] |= 1 << (offset + 1);
            }
        }
        words.extend(codelet);
    }
    words
}

fn f32_vector(values: &[f32]) -> std::vec::Vec<u32> {
    let mut tokens = std::vec::Vec::new();
    let header = match values.len() {
        2 => 0xd11d,
        3 => 0xd71d,
        4 => 0xd21d,
        8 => 0xd31d,
        16 => 0xd41d,
        _ => {
            tokens.extend([0xd61d, values.len() as u32]);
            for value in values {
                let bits = value.to_bits();
                tokens.extend([bits & 0xffff, bits >> 16]);
            }
            return tokens;
        }
    };
    tokens.push(header);
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    tokens
}

#[cfg(feature = "shader-f64")]
fn f64_vector(values: &[f64]) -> std::vec::Vec<u32> {
    let mut tokens = std::vec::Vec::new();
    let header = match values.len() {
        2 => 0xd91d,
        3 => 0xdf1d,
        4 => 0xda1d,
        8 => 0xdb1d,
        16 => 0xdc1d,
        _ => {
            tokens.extend([0xde1d, values.len() as u32]);
            for value in values {
                let bits = value.to_bits();
                tokens.extend([
                    bits as u16 as u32,
                    (bits >> 16) as u16 as u32,
                    (bits >> 32) as u16 as u32,
                    (bits >> 48) as u16 as u32,
                ]);
            }
            return tokens;
        }
    };
    tokens.push(header);
    for value in values {
        let bits = value.to_bits();
        tokens.extend([
            bits as u16 as u32,
            (bits >> 16) as u16 as u32,
            (bits >> 32) as u16 as u32,
            (bits >> 48) as u16 as u32,
        ]);
    }
    tokens
}

fn f32_scalar(value: f32) -> [u32; 3] {
    let bits = value.to_bits();
    [0xd01d, bits & 0xffff, bits >> 16]
}

fn scale_f32(values: &[f32], factor: f32) -> std::vec::Vec<u32> {
    let mut tokens = f32_vector(values);
    let accusative = tokens.len();
    tokens.push(ACCUSATIVE);
    tokens.extend(f32_scalar(factor));
    let destination = tokens.len();
    tokens.extend([DESTINATION, MULTIPLY, DEONTIC]);
    append_sentence(&tokens, &[accusative, destination, destination + 2])
}

#[cfg(feature = "shader-f64")]
fn scale_f64(values: &[f64], factor: f32) -> std::vec::Vec<u32> {
    let mut tokens = f64_vector(values);
    let accusative = tokens.len();
    tokens.push(ACCUSATIVE);
    tokens.extend(f32_scalar(factor));
    let destination = tokens.len();
    tokens.extend([DESTINATION, MULTIPLY, DEONTIC]);
    append_sentence(&tokens, &[accusative, destination, destination + 2])
}

fn add_f32(left: &[f32], right: &[f32]) -> std::vec::Vec<u32> {
    let mut tokens = f32_vector(left);
    let accusative = tokens.len();
    tokens.push(ACCUSATIVE);
    tokens.extend(f32_vector(right));
    let destination = tokens.len();
    tokens.extend([DESTINATION, PLUS, DEONTIC]);
    append_sentence(&tokens, &[accusative, destination, destination + 2])
}

fn sum_f32(values: &[f32]) -> std::vec::Vec<u32> {
    let mut tokens = f32_vector(values);
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, SUM_VERB, DEONTIC]);
    append_sentence(&tokens, &[accusative, accusative + 2])
}

fn named_f32(name: u32, values: &[f32]) -> std::vec::Vec<u32> {
    let mut tokens = std::vec![name, NOMINATIVE];
    tokens.extend(f32_vector(values));
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    append_sentence(&tokens, &[1, accusative, accusative + 1])
}

#[test]
fn scales_float32_vectors_and_rejects_non_finite_results() {
    let words = scale_f32(&[1.5, -2.0, 0.25], 2.0);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 3);
    assert_eq!(
        &result.values[..3],
        &[3.0f32.to_bits(), (-4.0f32).to_bits(), 0.5f32.to_bits()]
    );

    let overflow = scale_f32(&[f32::MAX, 1.0], 2.0);
    assert_eq!(
        interpret_group(&overflow, 0, overflow.len() / CODELET_WORDS).error,
        ERROR_FLOAT_DOMAIN
    );
}

#[test]
fn adds_equal_width_float32_vectors_across_codelet_continuations() {
    let left = (1..=8)
        .map(|value| value as f32)
        .collect::<std::vec::Vec<_>>();
    let right = (11..=18)
        .map(|value| value as f32)
        .collect::<std::vec::Vec<_>>();
    let words = add_f32(&left, &right);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 8);
    for lane in 0..8 {
        assert_eq!(result.values[lane], (left[lane] + right[lane]).to_bits());
    }

    let mismatch = add_f32(&[1.0, 2.0], &[3.0]);
    assert_eq!(
        interpret_group(&mismatch, 0, mismatch.len() / CODELET_WORDS).error,
        ERROR_VECTOR_WIDTH
    );
}

#[test]
fn sums_float32_lanes_in_order_and_rejects_empty_vectors() {
    let words = sum_f32(&[1.0, 2.0, 3.0]);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(result.values[0], 6.0f32.to_bits());
    assert_eq!(
        result.consumed_codelets as usize,
        words.len() / CODELET_WORDS
    );

    let empty = sum_f32(&[]);
    assert_eq!(
        interpret_group(&empty, 0, empty.len() / CODELET_WORDS).error,
        ERROR_VECTOR_WIDTH
    );

    let overflow = sum_f32(&[f32::MAX, f32::MAX]);
    assert_eq!(
        interpret_group(&overflow, 0, overflow.len() / CODELET_WORDS).error,
        ERROR_FLOAT_DOMAIN
    );
}

#[test]
fn adds_and_sums_preceding_named_vectors_and_scales_a_named_vector() {
    let left_name = 0x4123;
    let right_name = 0x4567;
    let mut words = named_f32(left_name, &[1.0, 2.0, 3.0]);
    words.extend(named_f32(right_name, &[4.0, 5.0, 6.0]));
    let mut tokens = std::vec![NAME_TYPE, left_name, ACCUSATIVE, NAME_TYPE, right_name];
    let destination = tokens.len();
    tokens.extend([DESTINATION, PLUS, DEONTIC]);
    words.extend(append_sentence(&tokens, &[2, destination, destination + 2]));
    let start = 2;
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(
        &result.values[..3],
        &[5.0f32.to_bits(), 7.0f32.to_bits(), 9.0f32.to_bits()]
    );

    let mut tokens = std::vec![NAME_TYPE, left_name, ACCUSATIVE];
    tokens.extend(f32_scalar(2.0));
    let destination = tokens.len();
    tokens.extend([DESTINATION, MULTIPLY, DEONTIC]);
    let start = words.len() / CODELET_WORDS;
    words.extend(append_sentence(&tokens, &[2, destination, destination + 2]));
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(
        &result.values[..3],
        &[2.0f32.to_bits(), 4.0f32.to_bits(), 6.0f32.to_bits()]
    );

    let tokens = std::vec![NAME_TYPE, left_name, ACCUSATIVE, SUM_VERB, DEONTIC];
    let accusative = 2;
    let operation = append_sentence(&tokens, &[accusative, accusative + 2]);
    let start = words.len() / CODELET_WORDS;
    words.extend(operation);
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(result.values[0], 6.0f32.to_bits());
}

#[cfg(feature = "shader-f64")]
#[test]
fn adds_and_sums_float64_vectors() {
    let left_values = (0..16)
        .map(|lane| lane as f64 + 0.25)
        .collect::<std::vec::Vec<_>>();
    let right_values = (0..16)
        .map(|lane| lane as f64 * 0.5 + 0.75)
        .collect::<std::vec::Vec<_>>();
    let left = f64_vector(&left_values);
    let mut tokens = left;
    let accusative = tokens.len();
    tokens.push(ACCUSATIVE);
    tokens.extend(f64_vector(&right_values));
    let destination = tokens.len();
    tokens.extend([DESTINATION, PLUS, DEONTIC]);
    let words = append_sentence(&tokens, &[accusative, destination, destination + 2]);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT64);
    assert_eq!(result.length, 16);
    for lane in 0..16 {
        let value = left_values[lane] + right_values[lane];
        let bits = value.to_bits();
        assert_eq!(result.values[lane * 2], bits as u32);
        assert_eq!(result.values[lane * 2 + 1], (bits >> 32) as u32);
    }

    let mut tokens = f64_vector(&[1.25, 2.75]);
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, SUM_VERB, DEONTIC]);
    let words = append_sentence(&tokens, &[accusative, accusative + 2]);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT64);
    let bits = 4.0f64.to_bits();
    assert_eq!(result.values[0], bits as u32);
    assert_eq!(result.values[1], (bits >> 32) as u32);

    let words = scale_f64(&[1.5, -2.0, 0.25], 0.5);
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT64);
    for (lane, value) in [0.75f64, -1.0, 0.125].iter().enumerate() {
        let bits = value.to_bits();
        assert_eq!(result.values[lane * 2], bits as u32);
        assert_eq!(result.values[lane * 2 + 1], (bits >> 32) as u32);
    }
}
