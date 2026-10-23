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
fn rejects_noisy_catalog_rows_with_a_stable_error() {
    let noisy = CATALOG.replace("be codelet ya", "be codelet noise");
    let error = parse_catalog_pya(&noisy).expect_err("noisy row must be rejected");
    assert!(matches!(error, CatalogError::InvalidSentence(_)));
    assert_eq!(error.code(), "invalid-catalog-sentence");
}
