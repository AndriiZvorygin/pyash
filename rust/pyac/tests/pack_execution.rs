use pyac::{
    PyacValue, SemanticError, VectorElements, WORDS_PER_CODELET, decode_pack, encode_pack,
    execute_pack, index_word,
};

const PLUS: [u16; WORDS_PER_CODELET] = [
    0x0149, 0x881d, 1, 0x245e, 0x881d, 1, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0,
];

const INVERT: [u16; WORDS_PER_CODELET] = [
    0x0149, 0x881d, 5, 0x245e, 0x881d, 0, 0x207e, 0xaad2, 0x295e, 0, 0, 0, 0, 0, 0, 0,
];

const DATE: [u16; WORDS_PER_CODELET] = [
    0x00c1, 0x981d, 0x9c00, 0x8924, 0x0196, 0, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0,
];

const VECTOR: [u16; WORDS_PER_CODELET] = [
    0x0061, 0x8f1d, 1, 2, 3, 0x245e, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

#[test]
fn executes_mixed_supported_codelet_families_in_pack_order() {
    let bytes = encode_pack(&[PLUS, INVERT, DATE, VECTOR]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Unsigned(2),
            PyacValue::Signed(-5),
            PyacValue::DateEpochMs(1_746_057_600_000),
            PyacValue::Vector(VectorElements::Numbers(vec![1, 2, 3])),
        ])
    );
}

#[test]
fn mixed_pack_failure_reports_the_original_codelet_index() {
    let bytes = encode_pack(&[PLUS, [0; WORDS_PER_CODELET]]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    let error = execute_pack(&pack).expect_err("unknown codelet is unsupported");
    assert_eq!(error.index, 1);
    assert_eq!(error.source, SemanticError::UnsupportedCodelet);
    assert_eq!(error.code(), "unsupported-codelet");
}

fn vector_arithmetic(elements: &[u16], operand: u16, operator: u16) -> [u16; WORDS_PER_CODELET] {
    let explicit = !matches!(elements.len(), 2 | 3 | 4 | 8);
    let quote = match (elements.len(), explicit) {
        (2, _) => 0x891d,
        (3, _) => 0x8f1d,
        (4, _) => 0x8a1d,
        (8, _) => 0x8c1d,
        (_, true) => 0x8e1d,
        _ => unreachable!(),
    };
    let mut words = [0; WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote;
    offset += 1;
    if explicit {
        words[offset] = elements.len() as u16;
        offset += 1;
    }
    words[offset..offset + elements.len()].copy_from_slice(elements);
    offset += elements.len();
    let accusative = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = 0x881d;
    words[offset + 1] = operand;
    offset += 2;
    let case = offset;
    words[offset] = 0x243e;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    let mood = offset + 2;
    words[0] = index_word(&[accusative, case, mood]);
    words
}

fn vector_vector_arithmetic(
    left: &[u16],
    right: &[u16],
    operator: u16,
    operand_case: u16,
) -> [u16; WORDS_PER_CODELET] {
    let quote = |length| match length {
        2 => 0x891d,
        3 => 0x8f1d,
        4 => 0x8a1d,
        _ => unreachable!(),
    };
    let mut words = [0; WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote(left.len());
    offset += 1;
    words[offset..offset + left.len()].copy_from_slice(left);
    offset += left.len();
    let accusative = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = quote(right.len());
    offset += 1;
    words[offset..offset + right.len()].copy_from_slice(right);
    offset += right.len();
    let case = offset;
    words[offset] = operand_case;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    let mood = offset + 2;
    words[0] = index_word(&[accusative, case, mood]);
    words
}

#[test]
fn vector_arithmetic_executes_inline_quotes_and_preserves_element_width() {
    let plus = vector_arithmetic(&[1, 2, 3, 4], 2, 0x8a64);
    let saturated_plus = vector_arithmetic(&[u16::MAX, 3], 2, 0x8a64);
    let product = vector_arithmetic(&[u16::MAX, 3], u16::MAX, 0xec90);
    let explicit = vector_arithmetic(&[1, 2, 3, 4, 5], 1, 0xabd2);
    let bytes = encode_pack(&[plus, saturated_plus, product, explicit]).expect("vector pack fits");
    let pack = decode_pack(&bytes).expect("vector pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Vector(VectorElements::Numbers(vec![3, 4, 5, 6])),
            PyacValue::Vector(VectorElements::Numbers(vec![u16::MAX, 5])),
            PyacValue::Vector(VectorElements::Numbers32(vec![4_294_836_225, 196_605])),
            PyacValue::Vector(VectorElements::Numbers(vec![0, 1, 2, 3, 4])),
        ])
    );
}

#[test]
fn vector_arithmetic_division_by_zero_reports_its_pack_index() {
    let divide = vector_arithmetic(&[8, 9], 0, 0x8893);
    let bytes = encode_pack(&[divide]).expect("vector pack fits");
    let error = execute_pack(&decode_pack(&bytes).expect("vector pack decodes"))
        .expect_err("vector division by zero fails");
    assert_eq!(error.index, 0);
    assert_eq!(error.source, SemanticError::DivisionByZero);
}

#[test]
fn vector_vector_arithmetic_executes_existing_cases_elementwise() {
    let plus = vector_vector_arithmetic(&[1, 2, 3, 4], &[5, 6, 7, 8], 0x8a64, 0x243e);
    let multiply = vector_vector_arithmetic(&[3, 4], &[5, 6], 0xec90, 0x490f);
    let wide_product =
        vector_vector_arithmetic(&[u16::MAX, 3], &[u16::MAX, u16::MAX], 0xec90, 0x243e);
    let divide = vector_vector_arithmetic(&[8, 9], &[2, 3], 0x8893, 0x490f);
    let bytes =
        encode_pack(&[plus, multiply, wide_product, divide]).expect("vector-vector pack fits");
    let pack = decode_pack(&bytes).expect("vector-vector pack decodes");

    assert_eq!(
        execute_pack(&pack),
        Ok(vec![
            PyacValue::Vector(VectorElements::Numbers(vec![6, 8, 10, 12])),
            PyacValue::Vector(VectorElements::Numbers32(vec![15, 24])),
            PyacValue::Vector(VectorElements::Numbers32(vec![4_294_836_225, 196_605])),
            PyacValue::Vector(VectorElements::Numbers(vec![4, 3])),
        ])
    );
}

#[test]
fn vector_vector_arithmetic_rejects_different_widths() {
    let mismatch = vector_vector_arithmetic(&[1, 2], &[3, 4, 5], 0x8a64, 0x243e);
    let bytes = encode_pack(&[mismatch]).expect("mismatch codelet fits the pack");
    let error = execute_pack(&decode_pack(&bytes).expect("pack decodes"))
        .expect_err("unequal vector widths must fail");
    assert_eq!(error.index, 0);
    assert_eq!(
        error.source,
        SemanticError::VectorWidthMismatch { left: 2, right: 3 }
    );
}

#[test]
fn mixed_pack_preserves_semantic_errors_with_their_codelet_index() {
    let divide_by_zero = [
        0x0149, 0x881d, 8, 0x245e, 0x881d, 0, 0x243e, 0x8893, 0x295e, 0, 0, 0, 0, 0, 0, 0,
    ];
    let bytes = encode_pack(&[PLUS, divide_by_zero]).expect("pack fits");
    let pack = decode_pack(&bytes).expect("pack decodes");

    let error = execute_pack(&pack).expect_err("division by zero fails");
    assert_eq!(error.index, 1);
    assert_eq!(error.source, SemanticError::DivisionByZero);
}
