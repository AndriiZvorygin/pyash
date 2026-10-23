use pyac::{
    CatalogError, WORDS_PER_CODELET, decode_pack, encode_pack, execute_numeric_arithmetic_pack,
    parse_catalog_pya,
};

const CATALOG: &str = include_str!("fixture_catalog.pya");

#[test]
fn reads_the_parser_backed_catalog_fixture() {
    let catalog = parse_catalog_pya(CATALOG).expect("catalog fixture is valid");

    assert_eq!(catalog.format, "pyac-catalog-v1");
    assert_eq!(catalog.pack_format, "pyac-vliw-1");
    assert_eq!(catalog.record_count, 1);
    assert_eq!(catalog.executable_count, 1);
    assert_eq!(catalog.unsupported_count, 0);
    assert_eq!(catalog.pack_locator.as_deref(), Some("fixture.pyac"));
    assert_eq!(catalog.records[0]["semantic"], "numeric-plus");
    assert_eq!(catalog.records[0]["words"][0], 329);
}

#[test]
fn executes_words_recovered_from_the_catalog_fixture() {
    let catalog = parse_catalog_pya(CATALOG).expect("catalog fixture is valid");
    let values = catalog.records[0]["words"]
        .as_array()
        .expect("record words are an array");
    let mut words = [0u16; WORDS_PER_CODELET];
    for (index, value) in values.iter().enumerate() {
        words[index] = value
            .as_u64()
            .expect("record word is numeric")
            .try_into()
            .expect("record word fits u16");
    }

    let bytes = encode_pack(&[words]).expect("catalog codelet fits");
    let pack = decode_pack(&bytes).expect("encoded catalog codelet is valid");
    assert_eq!(execute_numeric_arithmetic_pack(&pack), Ok(vec![2]));
}

#[test]
fn executes_the_corpus_numeric_pack_in_source_order() {
    fn arithmetic_codelet(ob: u16, to: u16, operator: u16) -> [u16; WORDS_PER_CODELET] {
        [
            0x0149, 0x881d, ob, 0x287e, 0x881d, to, 0x245e, operator, 0x295e, 0, 0, 0, 0, 0, 0, 0,
        ]
    }

    let codelets = [
        arithmetic_codelet(1, 1, 0x8a64),
        arithmetic_codelet(9, 4, 0xabd2),
        arithmetic_codelet(3, 4, 0xec90),
        arithmetic_codelet(8, 2, 0x8893),
        arithmetic_codelet(7, 3, 0xa810),
    ];
    let bytes = encode_pack(&codelets).expect("corpus numeric pack fits");
    let pack = decode_pack(&bytes).expect("corpus numeric pack is valid");

    assert_eq!(
        execute_numeric_arithmetic_pack(&pack),
        Ok(vec![2, 5, 12, 4, 4])
    );
}

#[test]
fn rejects_noisy_catalog_rows_with_a_stable_error() {
    let noisy = CATALOG.replace("be codelet ya", "be codelet noise");
    let error = parse_catalog_pya(&noisy).expect_err("noisy row must be rejected");
    assert!(matches!(error, CatalogError::InvalidSentence(_)));
    assert_eq!(error.code(), "invalid-catalog-sentence");
}
