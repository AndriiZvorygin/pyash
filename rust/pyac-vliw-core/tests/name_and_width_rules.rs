use pyac_vliw_core::word_code::{WordClass, classify_identity, encode};

const NOMINATIVE: u32 = 0x24de;
const WIDTH_U8: u32 = 0x309e;
const WIDTH_U16: u32 = 0x327e;

fn is_root(value: u16) -> bool {
    matches!(
        classify_identity(value),
        Some(WordClass::LongRoot) | Some(WordClass::ShortRoot)
    )
}

fn is_grammar(value: u16) -> bool {
    matches!(
        classify_identity(value),
        Some(WordClass::ShortGrammar) | Some(WordClass::LongGrammar)
    )
}

#[test]
fn a_name_payload_is_a_root_word() {
    // hnim "name", hnap "answer": roots.
    assert!(is_root(encode("hnim").unwrap()));
    assert!(is_root(encode("hnap").unwrap()));
}

#[test]
fn a_name_payload_is_never_a_grammar_word() {
    // sa "you", na nominative: grammar words serving their grammatical purpose.
    assert!(is_grammar(encode("sa").unwrap()));
    assert!(is_grammar(encode("na").unwrap()));
    // So `gi sa` is not a name, which is why `sagina` is not a name phrase.
    assert!(!is_root(encode("sa").unwrap()));
}

#[test]
fn width_words_are_quantity_words_not_name_markers() {
    for width in ["po", "do", "pu", "tl6h"] {
        assert!(
            is_grammar(encode(width).unwrap()),
            "{width} is a grammar word"
        );
    }
    // gi marks names and is itself a grammar word, never a width.
    assert!(is_grammar(encode("gi").unwrap()));
    assert_ne!(encode("gi").unwrap(), WIDTH_U16 as u16);
}
