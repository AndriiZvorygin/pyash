use pyac::{CatalogError, parse_catalog_pya};

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
fn rejects_noisy_catalog_rows_with_a_stable_error() {
    let noisy = CATALOG.replace("be codelet ya", "be codelet noise");
    let error = parse_catalog_pya(&noisy).expect_err("noisy row must be rejected");
    assert!(matches!(error, CatalogError::InvalidSentence(_)));
    assert_eq!(error.code(), "invalid-catalog-sentence");
}
