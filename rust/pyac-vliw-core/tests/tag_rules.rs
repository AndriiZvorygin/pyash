//! Structural decode rules: one tag per field, names are roots, widths bound values.

use pyac_vliw_core::{decode_sentence, word_code::encode};

fn w(word: &str) -> u32 {
    encode(word).unwrap() as u32
}

/// Build a one-codelet sentence: `<field…> <case> <verb> <mood>`.
fn codelet(tokens: &[u32], boundaries: &[usize]) -> std::vec::Vec<u32> {
    assert!(tokens.len() < 16);
    let mut words = std::vec![1u32; 16];
    words[1..=tokens.len()].copy_from_slice(tokens);
    for boundary in boundaries {
        words[0] |= 1 << (boundary + 1);
    }
    words
}

#[test]
fn a_name_field_is_gi_then_root_then_case() {
    // gi hnim na pyan li: a name, then the verb and mood.
    let words = codelet(&[w("gi"), w("hnim"), w("na"), w("pyan"), w("li")], &[2, 4]);
    let (sentence, _) = decode_sentence(&words, 1, 0).expect("decodes");
    let field = sentence.field(w("na")).expect("nominative field");
    assert_eq!(field.length, 2, "gi + hnim");
    assert_eq!(words[1 + field.start], w("gi"));
    assert_eq!(words[1 + field.start + 1], w("hnim"));
}

#[test]
fn a_grammar_word_is_not_a_name_payload() {
    // gi sa na: `sa` is the pronoun serving its grammatical purpose, not a name.
    let words = codelet(&[w("gi"), w("sa"), w("na"), w("pyan"), w("li")], &[2, 4]);
    assert!(
        decode_sentence(&words, 1, 0).is_err(),
        "gi sa is not a name"
    );
}

#[test]
fn a_width_word_leads_a_value_and_carries_no_gi() {
    // do 4930 na: one tag, the width word.
    let words = codelet(&[w("do"), 4930, w("na"), w("pyan"), w("li")], &[2, 4]);
    let (sentence, _) = decode_sentence(&words, 1, 0).expect("decodes");
    let field = sentence.field(w("na")).expect("nominative field");
    assert_eq!(field.length, 2);
    assert_eq!(words[1 + field.start], w("do"));
    assert_eq!(words[1 + field.start + 1], 4930);
}

#[test]
fn two_name_tags_in_one_field_are_rejected() {
    // gi gi hnan na: `gi` marks a name once; a second is malformed.
    let words = codelet(
        &[w("gi"), w("gi"), w("hnan"), w("na"), w("pyan"), w("li")],
        &[3, 5],
    );
    assert!(
        decode_sentence(&words, 1, 0).is_err(),
        "a field carries the name tag at most once"
    );
}

#[test]
fn sana_pyanli_still_has_no_tags_at_all() {
    // The pyac base form: sa na pyan li.
    let words = codelet(&[w("sa"), w("na"), w("pyan"), w("li")], &[1, 3]);
    let (sentence, token_count) = decode_sentence(&words, 1, 0).expect("decodes");
    assert_eq!(token_count, 4);
    assert_eq!(sentence.field(w("na")).expect("nominative").length, 1);
}
