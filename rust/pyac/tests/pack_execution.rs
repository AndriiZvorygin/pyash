use pyac::{
    PyacValue, SemanticError, VectorElements, WORDS_PER_CODELET, decode_pack, encode_pack,
    execute_pack,
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
