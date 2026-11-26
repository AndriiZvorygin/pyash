//! Storage descriptors are sentences, not a compact tag layout:
//! `from num <start> to num <end> as <type> be kcot kyut def <data> prah`.

use pyac_vliw_core::word_code::encode;

const CODELET_WORDS: usize = 16;

fn w(word: &str) -> u32 {
    encode(word).unwrap() as u32
}

#[test]
fn the_storage_verb_is_gather_computer() {
    assert_eq!(w("kcot"), 0xaca2, "kcot is gather");
    assert_eq!(w("kyut"), 0xaa02, "kyut is computer");
}

#[test]
fn the_type_words_are_the_quantity_class() {
    // po uint8, do uint16, pu uint32, tl6h uint64.
    assert_eq!(w("po"), 0x309e);
    assert_eq!(w("do"), 0x327e);
    assert_eq!(w("pu"), 0x289e);
    assert_eq!(w("tl6h"), 0x6b57);
    // fyih is the floating-point class; flut is the lexical root "float".
    assert_eq!(w("fyih"), 0x4067);
    assert_ne!(w("fyih"), w("flut"));
}

#[test]
fn the_descriptor_cases_are_source_destination_and_essive() {
    // from -> SOURCE, to -> DESTINATION, as -> ESSIVE.
    assert_eq!(w("so"), 0x313e);
    assert_eq!(w("ma"), 0x243e);
    assert_eq!(w("swih"), 0x414f);
}

#[test]
fn a_descriptor_names_a_root_not_a_grammar_width() {
    use pyac_vliw_core::word_code::{WordClass, classify_identity};
    let is_root = |value: u32| {
        matches!(
            classify_identity(value as u16),
            Some(WordClass::LongRoot) | Some(WordClass::ShortRoot)
        )
    };
    // Width words are grammar words, so they cannot be a name payload.
    for width in ["po", "do", "pu", "tl6h", "gi"] {
        assert!(
            !is_root(w(width)),
            "{width} is a grammar word, not a name payload"
        );
    }
    // Roots can be.
    for root in ["hnim", "kcot", "kyut", "flut"] {
        assert!(is_root(w(root)), "{root} is a root");
    }
}
