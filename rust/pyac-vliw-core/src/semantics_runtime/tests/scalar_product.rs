use super::*;

const SCALAR_WORD: u32 = 0x0d62;
const PRODUCE_WORD: u32 = 0x8944;
const INSTRUMENTAL: u32 = 0x287e;

fn append_float_vector(tokens: &mut std::vec::Vec<u32>, values: &[f64], width: usize) {
    let quote = match (width, values.len()) {
        (4, 1) => 0xd61d,
        (4, 2) => 0xd11d,
        (4, 3) => 0xd71d,
        (4, 4) => 0xd21d,
        (4, 8) => 0xd31d,
        (4, 16) => 0xd41d,
        (8, 1) => 0xde1d,
        (8, 2) => 0xd91d,
        (8, 3) => 0xdf1d,
        (8, 4) => 0xda1d,
        (8, 8) => 0xdb1d,
        (8, 16) => 0xdc1d,
        _ => panic!("test vector count does not have a fixed legacy quote"),
    };
    tokens.push(quote);
    if values.len() == 1 {
        tokens.push(1);
    }
    for value in values {
        if width == 4 {
            let bits = (*value as f32).to_bits();
            tokens.extend([bits as u16 as u32, (bits >> 16) as u16 as u32]);
        } else {
            let bits = value.to_bits();
            tokens.extend([
                bits as u16 as u32,
                (bits >> 16) as u16 as u32,
                (bits >> 32) as u16 as u32,
                (bits >> 48) as u16 as u32,
            ]);
        }
    }
}

fn scalar_product_codelets(
    left: &[f64],
    right: &[f64],
    left_width: usize,
    right_width: usize,
) -> std::vec::Vec<[u32; CODELET_WORDS]> {
    let mut tokens = std::vec::Vec::new();
    let mut boundaries = std::vec::Vec::new();
    append_float_vector(&mut tokens, left, left_width);
    tokens.push(ACCUSATIVE);
    boundaries.push(tokens.len());
    append_float_vector(&mut tokens, right, right_width);
    tokens.push(INSTRUMENTAL);
    boundaries.push(tokens.len());
    tokens.extend([SCALAR_WORD, PRODUCE_WORD, DEONTIC]);
    boundaries.push(tokens.len());

    let chunks = tokens.chunks(CODELET_WORDS - 1);
    let chunk_count = chunks.len();
    tokens
        .chunks(CODELET_WORDS - 1)
        .enumerate()
        .map(|(chunk_index, chunk)| {
            let complete = chunk_index + 1 == chunk_count;
            let token_start = chunk_index * (CODELET_WORDS - 1);
            let mut codelet = [0u32; CODELET_WORDS];
            codelet[0] = u32::from(complete);
            codelet[1..chunk.len() + 1].copy_from_slice(chunk);
            for (offset, _) in chunk.iter().enumerate() {
                let is_boundary = boundaries.contains(&(token_start + offset + 1));
                if is_boundary == complete {
                    codelet[0] |= 1 << (offset + 1);
                }
            }
            codelet
        })
        .collect()
}

fn execute(left: &[f64], right: &[f64], width: usize) -> CoreResult {
    let codelets = scalar_product_codelets(left, right, width, width);
    interpret(&codelets)
}

fn append_group(
    words: &mut std::vec::Vec<u32>,
    tokens: &[u32],
    boundary_offsets: &[usize],
) -> usize {
    let start = words.len() / CODELET_WORDS;
    let chunk_count = tokens.chunks(CODELET_WORDS - 1).len();
    for (chunk_index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let complete = chunk_index + 1 == chunk_count;
        let token_start = chunk_index * (CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(complete);
        codelet[1..chunk.len() + 1].copy_from_slice(chunk);
        for (offset, _) in chunk.iter().enumerate() {
            if boundary_offsets.contains(&(token_start + offset)) == complete {
                codelet[0] |= 1 << (offset + 1);
            }
        }
        words.extend(codelet);
    }
    start
}

fn append_named_f32(words: &mut std::vec::Vec<u32>, name: u32, values: [f32; 2]) {
    let mut tokens = std::vec![name, NOMINATIVE, 0xd11d];
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    append_group(words, &tokens, &[1, accusative, accusative + 1]);
}

fn append_named_f32_three(words: &mut std::vec::Vec<u32>, name: u32, values: [f32; 3]) {
    let mut tokens = std::vec![name, NOMINATIVE, 0xd71d];
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    append_group(words, &tokens, &[1, accusative, accusative + 1]);
}

fn append_named_dot(words: &mut std::vec::Vec<u32>, left: u32, right: u32) -> usize {
    append_group(
        words,
        &[
            NAME_TYPE,
            left,
            ACCUSATIVE,
            NAME_TYPE,
            right,
            INSTRUMENTAL,
            SCALAR_WORD,
            PRODUCE_WORD,
            DEONTIC,
        ],
        &[2, 5, 8],
    )
}

#[test]
fn computes_float32_dot_product_from_pyash_compound_signature() {
    let result = execute(&[1.0, 2.0, 3.0], &[4.0, 5.0, 6.0], 4);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(f32::from_bits(result.values[0]), 32.0);
    assert_eq!(result.consumed_codelets, 2);
}

#[test]
fn computes_a_dot_product_from_preceding_named_vectors() {
    let mut words = std::vec::Vec::new();
    append_named_f32(&mut words, 0x4123, [1.0, 2.0]);
    append_named_f32(&mut words, 0x4567, [4.0, 5.0]);
    assert_eq!(
        super::super::signature_dispatch::select_signature_route(&words, 0, 1),
        Ok(super::super::signature_dispatch::ROUTE_FLOAT)
    );
    assert_eq!(interpret_group(&words, 0, 1).error, 0);
    assert_eq!(interpret_group(&words, 1, 2).error, 0);
    let start = append_named_dot(&mut words, 0x4123, 0x4567);
    assert_eq!(
        super::super::signature_dispatch::select_signature_route(
            &words,
            start,
            words.len() / CODELET_WORDS - start,
        ),
        Ok(super::super::signature_dispatch::ROUTE_SCALAR_PRODUCT)
    );
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(f32::from_bits(result.values[0]), 14.0);
}

#[test]
fn computes_a_dot_product_from_payload_backed_vectors_beyond_inline_lane_limit() {
    const LANES: usize = 32;
    let mut words = std::vec::Vec::new();
    let start = append_named_dot(&mut words, 0x4123, 0x4567);
    let mut payload = std::vec::Vec::with_capacity(LANES * 2);
    let mut expected = 0.0f32;
    for lane in 0..LANES {
        let left = lane as f32 + 1.0;
        payload.push(left.to_bits());
        expected += left * 2.0;
    }
    for _ in 0..LANES {
        payload.push(2.0f32.to_bits());
    }
    let byte_length = (LANES * std::mem::size_of::<f32>()) as u32;
    let descriptors = [
        2,
        0,
        1,
        0,
        byte_length,
        4,
        LANES as u32,
        0xaa6c,
        1,
        1,
        1,
        byte_length,
        byte_length,
        4,
        LANES as u32,
        0xaa6c,
        1,
    ];
    let names = [0x4123, 0x4567];
    let storage = StorageView::new(&descriptors, &names, &payload);
    assert_eq!(storage.section_count(), 2);
    let mut cursor = super::super::scalar_product::Cursor {
        start,
        codelet: start,
        slot: 1,
        end: start + words.len() / CODELET_WORDS,
    };
    let operand = super::super::scalar_product::read_operand(
        &mut cursor,
        &words,
        start,
        words.len() / CODELET_WORDS,
        words.len() / CODELET_WORDS,
        &storage,
    );
    assert_eq!(operand.err(), None);

    let result = interpret_group_with_storage(&words, start, words.len() / CODELET_WORDS, &storage);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(f32::from_bits(result.values[0]), expected);
}

#[test]
fn computes_a_float64_dot_product_from_payload_backed_vectors_beyond_inline_lane_limit() {
    const LANES: usize = 17;
    let mut words = std::vec::Vec::new();
    let start = append_named_dot(&mut words, 0x4123, 0x4567);
    let mut payload = std::vec::Vec::with_capacity(LANES * 4);
    let mut expected = 0.0f64;
    for lane in 0..LANES {
        let value = lane as f64 + 1.0;
        let bits = value.to_bits();
        payload.extend([bits as u32, (bits >> 32) as u32]);
        expected += value * 0.25;
    }
    for _ in 0..LANES {
        let bits = 0.25f64.to_bits();
        payload.extend([bits as u32, (bits >> 32) as u32]);
    }
    let byte_length = (LANES * std::mem::size_of::<f64>()) as u32;
    let descriptors = [
        2,
        0,
        1,
        0,
        byte_length,
        8,
        LANES as u32,
        0xaa6c,
        1,
        1,
        1,
        byte_length,
        byte_length,
        8,
        LANES as u32,
        0xaa6c,
        1,
    ];
    let names = [0x4123, 0x4567];
    let storage = StorageView::new(&descriptors, &names, &payload);

    let result = interpret_group_with_storage(&words, start, words.len() / CODELET_WORDS, &storage);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT64);
    let actual = f64::from_bits(u64::from(result.values[0]) | (u64::from(result.values[1]) << 32));
    assert_eq!(actual, expected);
}

#[test]
fn rejects_unbound_duplicate_and_width_mismatched_named_dot_operands() {
    let mut unbound = std::vec::Vec::new();
    append_named_f32(&mut unbound, 0x4123, [1.0, 2.0]);
    let start = append_named_dot(&mut unbound, 0x4123, 0x4567);
    assert_eq!(
        interpret_group(&unbound, start, unbound.len() / CODELET_WORDS).error,
        ERROR_UNSUPPORTED
    );

    let mut duplicate = std::vec::Vec::new();
    append_named_f32(&mut duplicate, 0x4123, [1.0, 2.0]);
    append_named_f32(&mut duplicate, 0x4123, [3.0, 4.0]);
    append_named_f32(&mut duplicate, 0x4567, [4.0, 5.0]);
    let start = append_named_dot(&mut duplicate, 0x4123, 0x4567);
    assert_eq!(
        interpret_group(&duplicate, start, duplicate.len() / CODELET_WORDS).error,
        ERROR_MALFORMED
    );

    let mut mismatched = std::vec::Vec::new();
    append_named_f32(&mut mismatched, 0x4123, [1.0, 2.0]);
    append_named_f32_three(&mut mismatched, 0x4567, [4.0, 5.0, 6.0]);
    let start = append_named_dot(&mut mismatched, 0x4123, 0x4567);
    assert_eq!(
        interpret_group(&mismatched, start, mismatched.len() / CODELET_WORDS).error,
        ERROR_VECTOR_WIDTH
    );
}

#[test]
#[cfg(feature = "shader-f64")]
fn computes_float64_dot_product_and_preserves_full_scalar_result() {
    let result = execute(&[0.1, 2.0, -3.0], &[0.2, 4.0, -5.0], 8);
    let expected = [0.1f64, 2.0, -3.0]
        .iter()
        .zip([0.2f64, 4.0, -5.0])
        .fold(0.0f64, |sum, (left, right)| sum + left * right);
    let actual = u64::from(result.values[0]) | (u64::from(result.values[1]) << 32);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT64);
    assert_eq!(actual, expected.to_bits());
}

#[test]
#[cfg(not(feature = "shader-f64"))]
fn rejects_float64_dot_product_without_shader_f64_capability() {
    assert_eq!(
        execute(&[1.0, 2.0], &[3.0, 4.0], 8).error,
        ERROR_UNSUPPORTED
    );
}

#[test]
fn reduces_sixteen_float_lanes_across_codelet_boundaries() {
    let left = (1..=16).map(f64::from).collect::<std::vec::Vec<_>>();
    let right = (1..=16)
        .map(|value| f64::from(value * 2))
        .collect::<std::vec::Vec<_>>();
    let expected = (1..=16).fold(0.0f32, |sum, value| {
        sum + (value as f32) * (value as f32 * 2.0)
    });
    let result = execute(&left, &right, 4);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_FLOAT32);
    assert_eq!(result.length, 1);
    assert_eq!(f32::from_bits(result.values[0]), expected);
    assert_eq!(result.consumed_codelets, 5);
}

#[test]
fn rejects_mismatched_lengths_types_and_non_finite_results() {
    assert_eq!(execute(&[1.0, 2.0], &[1.0], 4).error, ERROR_VECTOR_WIDTH);
    let mixed = scalar_product_codelets(&[1.0, 2.0], &[1.0, 2.0], 4, 8);
    assert_eq!(interpret(&mixed).error, ERROR_UNSUPPORTED);
    assert_eq!(
        execute(&[f32::MAX as f64, f32::MAX as f64], &[2.0, 2.0], 4).error,
        ERROR_FLOAT_DOMAIN
    );
}

#[test]
fn rejects_scalar_product_with_missing_case_boundary() {
    let mut codelets = scalar_product_codelets(&[1.0, 2.0], &[3.0, 4.0], 4, 4);
    codelets[0][0] ^= 1 << 8;
    assert_eq!(interpret(&codelets).error, ERROR_MALFORMED);
}
