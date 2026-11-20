use super::*;

const PLUK: u32 = 0x2a64;
const TLAS: u32 = 0x896a;
const PREDICTION: u32 = 0x68b1;
const ANSWER: u32 = 0x4930;
const CORRECT_COUNT: u32 = 0xaa90;

fn append_group(
    words: &mut std::vec::Vec<u32>,
    tokens: &[u32],
    boundary_offsets: &[usize],
) -> usize {
    let start = words.len() / CODELET_WORDS;
    let chunks = tokens.chunks(CODELET_WORDS - 1);
    let chunk_count = chunks.len();
    for (chunk_index, chunk) in tokens.chunks(CODELET_WORDS - 1).enumerate() {
        let complete = chunk_index + 1 == chunk_count;
        let token_start = chunk_index * (CODELET_WORDS - 1);
        let mut codelet = [0u32; CODELET_WORDS];
        codelet[0] = u32::from(complete);
        codelet[1..chunk.len() + 1].copy_from_slice(chunk);
        for (offset, _) in chunk.iter().enumerate() {
            let boundary = boundary_offsets.contains(&(token_start + offset));
            if boundary == complete {
                codelet[0] |= 1 << (offset + 1);
            }
        }
        words.extend(codelet);
    }
    start
}

fn append_f32_vector(words: &mut std::vec::Vec<u32>, name: u32, values: &[f32]) {
    let quote = match values.len() {
        1 => 0xd61d,
        2 => 0xd11d,
        3 => 0xd71d,
        4 => 0xd21d,
        8 => 0xd31d,
        16 => 0xd41d,
        _ => panic!("unsupported vector size in test"),
    };
    let mut tokens = std::vec![name, NOMINATIVE, quote];
    if values.len() == 1 {
        tokens.push(1);
    }
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    let realis = tokens.len() - 1;
    append_group(words, &tokens, &[1, accusative, realis]);
}

fn append_f64_vector(words: &mut std::vec::Vec<u32>, name: u32, values: &[f64]) {
    let quote = match values.len() {
        1 => 0xde1d,
        2 => 0xd91d,
        3 => 0xdf1d,
        4 => 0xda1d,
        8 => 0xdb1d,
        16 => 0xdc1d,
        _ => panic!("unsupported vector size in test"),
    };
    let mut tokens = std::vec![name, NOMINATIVE, quote];
    if values.len() == 1 {
        tokens.push(1);
    }
    for value in values {
        let bits = value.to_bits();
        tokens.extend([
            bits as u16 as u32,
            (bits >> 16) as u16 as u32,
            (bits >> 32) as u16 as u32,
            (bits >> 48) as u16 as u32,
        ]);
    }
    let accusative = tokens.len();
    tokens.extend([ACCUSATIVE, REALIS]);
    let realis = tokens.len() - 1;
    append_group(words, &tokens, &[1, accusative, realis]);
}

fn append_evaluation(words: &mut std::vec::Vec<u32>, prediction: u32, answer: u32) -> usize {
    let tokens = [
        NAME_TYPE,
        prediction,
        ACCUSATIVE,
        NAME_TYPE,
        NUMBER_TYPE,
        NAME_TYPE,
        CORRECT_COUNT,
        DESTINATION,
        NAME_TYPE,
        answer,
        INSTRUMENTAL,
        PLUK,
        TLAS,
        DEONTIC,
    ];
    append_group(words, &tokens, &[2, 7, 10, 13])
}

fn append_mutable_vector(words: &mut std::vec::Vec<u32>, name: u32, length: u32) {
    let mut tokens = std::vec![NAME_TYPE, name, NOMINATIVE, QUOTED_GRAMMAR, 0];
    for text in [
        b"state".as_slice(),
        b"vector float32".as_slice(),
        b"state".as_slice(),
    ] {
        tokens.extend([0x0e1d, text.len() as u32]);
        tokens.extend(text.iter().map(|byte| u32::from(*byte)));
        tokens.push(0);
    }
    tokens.push(QUOTED_GRAMMAR);
    tokens.extend([ESSIVE, NUMBER_QUOTE, length, INSTRUMENTAL, VARIABLE, REALIS]);
    append_group(
        words,
        &tokens,
        &[2, tokens.len() - 6, tokens.len() - 3, tokens.len() - 1],
    );
}

fn append_f32_pair(tokens: &mut std::vec::Vec<u32>, values: [f32; 2]) {
    tokens.push(0xd11d);
    for value in values {
        let bits = value.to_bits();
        tokens.extend([bits & 0xffff, bits >> 16]);
    }
}

fn append_dot_store(
    words: &mut std::vec::Vec<u32>,
    name: u32,
    index: u32,
    left: [f32; 2],
    right: [f32; 2],
) {
    let mut tokens = std::vec::Vec::new();
    append_f32_pair(&mut tokens, left);
    tokens.extend([
        ACCUSATIVE,
        NAME_TYPE,
        name,
        DESTINATION,
        NUMBER_QUOTE,
        index,
        LOCATIVE,
    ]);
    append_f32_pair(&mut tokens, right);
    tokens.extend([INSTRUMENTAL, 0x0d62, 0x8944, DEONTIC]);
    append_group(words, &tokens, &[5, 8, 11, 17, 20]);
}

fn evaluate(predicted: &[f32], expected: &[f32]) -> CoreResult {
    let mut words = std::vec::Vec::new();
    append_f32_vector(&mut words, PREDICTION, predicted);
    append_f32_vector(&mut words, ANSWER, expected);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);
    interpret_group(&words, start, words.len() / CODELET_WORDS)
}

#[test]
fn counts_exact_float32_matches_between_named_vectors() {
    let mut words = std::vec::Vec::new();
    append_f32_vector(&mut words, PREDICTION, &[1.0, 2.0, 3.0]);
    append_f32_vector(&mut words, ANSWER, &[1.0, 2.0, 4.0]);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);
    assert_eq!(words[start * CODELET_WORDS], 0x4909, "{words:?}");
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_UNSIGNED);
    assert_eq!(result.length, 1);
    assert_eq!(result.values[0], 2);
    assert_eq!(result.consumed_codelets, 1);
}

#[test]
fn declares_a_zero_initialized_float32_vector_from_tagged_state_and_length() {
    let mut words = std::vec::Vec::new();
    append_mutable_vector(&mut words, PREDICTION, 3);
    let decoded = super::super::mutable_vector::mutable_vector_declaration(
        &words,
        0,
        words.len() / CODELET_WORDS,
    );
    assert_eq!(decoded.map(|(_, length)| length), Ok(3));
    let result = interpret_group(&words, 0, words.len() / CODELET_WORDS);
    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_VECTOR_FLOAT32);
    assert_eq!(result.length, 3);
    assert_eq!(&result.values[..3], &[0, 0, 0]);
}

#[test]
fn pluk_tlas_collects_indexed_dot_products_and_leaves_unwritten_lanes_zero() {
    let mut words = std::vec::Vec::new();
    append_mutable_vector(&mut words, PREDICTION, 3);
    append_dot_store(&mut words, PREDICTION, 1, [2.0, 1.0], [1.0, 2.0]);
    append_f32_vector(&mut words, ANSWER, &[0.0, 4.0, 0.0]);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.value_kind, VALUE_UNSIGNED);
    assert_eq!(result.values[0], 3);
}

#[test]
fn pluk_tlas_uses_source_order_for_repeated_indexed_writes() {
    let mut words = std::vec::Vec::new();
    append_mutable_vector(&mut words, PREDICTION, 2);
    append_dot_store(&mut words, PREDICTION, 0, [1.0, 1.0], [1.0, 1.0]);
    append_dot_store(&mut words, PREDICTION, 0, [2.0, 1.0], [1.0, 2.0]);
    append_f32_vector(&mut words, ANSWER, &[4.0, 0.0]);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);
    let result = interpret_group(&words, start, words.len() / CODELET_WORDS);

    assert_eq!(result.error, 0, "{result:?}");
    assert_eq!(result.values[0], 2);
}

#[test]
fn rejects_a_dot_product_store_outside_the_declared_vector() {
    let mut words = std::vec::Vec::new();
    append_mutable_vector(&mut words, PREDICTION, 2);
    append_dot_store(&mut words, PREDICTION, 2, [1.0, 1.0], [1.0, 1.0]);
    append_f32_vector(&mut words, ANSWER, &[1.0, 1.0]);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);

    assert_eq!(
        interpret_group(&words, start, words.len() / CODELET_WORDS).error,
        ERROR_VECTOR_WIDTH
    );
}

#[test]
fn uses_exact_float32_equality_and_treats_signed_zero_as_equal() {
    assert_eq!(
        evaluate(&[1.0, 2.0], &[1.0, f32::from_bits(2.0f32.to_bits() + 1)]).values[0],
        1
    );
    assert_eq!(evaluate(&[0.0, -0.0], &[-0.0, 0.0]).values[0], 2);
}

#[test]
fn resolves_float32_vectors_across_indexed_codelets_up_to_maximum_width() {
    let prediction = (0..16)
        .map(|lane| lane as f32)
        .collect::<std::vec::Vec<_>>();
    let mut answer = prediction.clone();
    answer[7] = 100.0;
    assert_eq!(evaluate(&prediction, &answer).values[0], 15);
}

#[test]
fn rejects_missing_duplicate_mistyped_and_width_mismatched_inputs() {
    let mut missing = std::vec::Vec::new();
    append_f32_vector(&mut missing, PREDICTION, &[1.0]);
    let start = append_evaluation(&mut missing, PREDICTION, ANSWER);
    assert_eq!(
        interpret_group(&missing, start, missing.len() / CODELET_WORDS).error,
        ERROR_UNSUPPORTED
    );

    let mut duplicate = std::vec::Vec::new();
    append_f32_vector(&mut duplicate, PREDICTION, &[1.0]);
    append_f32_vector(&mut duplicate, PREDICTION, &[1.0]);
    append_f32_vector(&mut duplicate, ANSWER, &[1.0]);
    let start = append_evaluation(&mut duplicate, PREDICTION, ANSWER);
    assert_eq!(
        interpret_group(&duplicate, start, duplicate.len() / CODELET_WORDS).error,
        ERROR_MALFORMED
    );

    assert_eq!(evaluate(&[1.0, 2.0], &[1.0]).error, ERROR_VECTOR_WIDTH);

    let mut float64 = std::vec::Vec::new();
    append_f64_vector(&mut float64, PREDICTION, &[1.0, 2.0]);
    append_f64_vector(&mut float64, ANSWER, &[1.0, 2.0]);
    let start = append_evaluation(&mut float64, PREDICTION, ANSWER);
    assert_eq!(
        interpret_group(&float64, start, float64.len() / CODELET_WORDS).error,
        ERROR_UNSUPPORTED
    );
}

#[test]
fn rejects_an_evaluation_signature_with_a_non_vector_binding() {
    let mut words = std::vec::Vec::new();
    append_f32_vector(&mut words, PREDICTION, &[1.0]);
    let mut scalar_tokens = std::vec![ANSWER, NOMINATIVE, 0xd01d];
    let bits = 1.0f32.to_bits();
    scalar_tokens.extend([bits & 0xffff, bits >> 16, ACCUSATIVE, REALIS]);
    append_group(&mut words, &scalar_tokens, &[1, 5]);
    let start = append_evaluation(&mut words, PREDICTION, ANSWER);
    assert_eq!(
        interpret_group(&words, start, words.len() / CODELET_WORDS).error,
        ERROR_UNSUPPORTED
    );
}
