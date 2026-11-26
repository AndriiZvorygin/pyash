//! Text to codelets, checked against the C implementation's own fixtures.
//!
//! `~/pyac/lwonprom/program/quiz.c` asserts exact tablets for short sentences.
//! Those assertions are the oracle: the port is correct when it produces the same
//! summary word and the same payload words.
//!
//! A tablet line in the C is `{summary, word1, word2, ...}` where `summary` packs
//! the completion bit and the boundary bits, so comparing them word for word
//! compares the whole encoding.

use pyac_vliw_core::text_encode::{CODELET_WIDTH, encode_sentence, encode_sentence_with};

/// Encode `text` and return the first codelet, or the error.
fn encode(text: &str) -> Result<[u32; CODELET_WIDTH], &'static str> {
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence(text, &mut codelets).map_err(|_| "encode failed")?;
    assert_eq!(count, 1, "{text}: expected one codelet");
    Ok(codelets[0])
}

/// Compare against a C tablet line, which is summary-first and unpadded.
fn assert_tablet(text: &str, expected: &[u32]) {
    let codelet = encode(text).unwrap_or_else(|e| panic!("{text}: {e}"));
    assert_eq!(
        &codelet[..expected.len()],
        expected,
        "{text}: summary {:#06x}, payload {:?}",
        codelet[0],
        &codelet[1..expected.len()]
    );
}

#[test]
fn doka_matches_the_c_tablet() {
    // quiz.c `number_hollow`: NewTextPage(fyak, 1, "doka")
    //   line_t perfect_tablet[1] = {{0x9, 0x881D, 0x0, 0x245E}};
    assert_tablet("doka", &[0x9, 0x881d, 0x0, 0x245e]);
}

#[test]
fn cuplustu_matches_the_c_tablet() {
    // quiz.c `quiz_conditional_encoding_basic`: "cuplustu"
    //   {{0xB, 0x29BE, 0x8A64, 0x295E}};
    assert_tablet("cuplustu", &[0xb, 0x29be, 0x8a64, 0x295e]);
}

#[test]
fn doyi_tyutplos_ksuh_matches_the_c_tablet() {
    // quiz.c `quiz_ksim_encoding_basic`: "doyi tyutplos ksuh"
    //   {{0x49, 0x881D, 0x0, 0x207E, 0xAA0A, 0x8C64, 0x5217}};
    assert_tablet(
        "doyi tyutplos ksuh",
        &[0x49, 0x881d, 0x0, 0x207e, 0xaa0a, 0x8c64, 0x5217],
    );
}

#[test]
fn doyi_doka_tyutplos_ksuh_matches_the_c_tablet() {
    // quiz.c `quiz_ksim_encoding_two_param`: "doyi doka tyutplos ksuh"
    //   {{0x249, 0x881D, 0x0, 0x207E, 0x881D, 0x0, 0x245E, 0xAA0A, 0x8C64, 0x5217}};
    assert_tablet(
        "doyi doka tyutplos ksuh",
        &[0x249, 0x881d, 0x0, 0x207e, 0x881d, 0x0, 0x245e, 0xaa0a, 0x8c64, 0x5217],
    );
}

#[test]
fn dohyikpwih_prifgika_djancu_plustu_matches_the_c_tablet_except_a_stale_word() {
    // quiz.c `quiz_conditional_encoding_basic2`:
    //   "dohyikpwih prifgika djancu plustu"
    //   {{0x0549, 0x881D, 0x0001, 0x4127, 0xC8C4, 0x225E, 0x245E, 0x69B3,
    //     0x29BE, 0x8A64, 0x295E}};
    //
    // Every word matches except `pwih`: the C tablet in the quiz expects
    // 0x41A7, which is `zwih`, while the C's own `pyashWords.h` and the shipped
    // dictionary both give `ablative_case_GRAMMAR = 0x4127 // pwih`. The quiz
    // entry is stale, so the port follows the dictionary.
    assert_tablet(
        "dohyikpwih prifgika djancu plustu",
        &[
            0x0549, 0x881d, 0x0001, 0x4127, 0xc8c4, 0x225e, 0x245e, 0x69b3, 0x29be, 0x8a64,
            0x295e,
        ],
    );
}


#[test]
fn a_two_digit_number_reads_left_to_right() {
    // `do hyik tyut` in the written order: twelve, not twenty-one.
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence("dohyiktyut", &mut codelets).unwrap();
    let flat: std::vec::Vec<u32> = codelets[..count]
        .iter()
        .flat_map(|c| c.iter().copied())
        .collect();
    assert_eq!(&flat[..3], &[0x1, 0x881d, 12]);
}

#[test]
fn a_word_containing_the_vowel_glyph_one_parses() {
    // `l1` is valid short-grammar PyAC (vowel code 6). The C's `consonant_group`
    // lists `1` as a consonant, which would make this unparseable even though the
    // codec encodes it, so the port follows the codec.
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence("l1ka", &mut codelets).expect("l1 is a word");
    assert_eq!(count, 1);
    let flat: std::vec::Vec<u32> = codelets[..count]
        .iter()
        .flat_map(|c| c.iter().copied())
        .collect();
    // `l1` then `ka`: the accusative closes the field.
    assert_eq!(flat[1], 0x397e, "l1");
    assert_eq!(flat[2], 0x245e, "ka");
}

#[test]
fn a_leading_do_reads_decimal_big_endian() {
    // `do hyik tyut` = 12: the terminator leads and the digits read in order.
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence("dohyiktyut", &mut codelets).expect("encodes");
    let flat: std::vec::Vec<u32> = codelets[..count]
        .iter()
        .flat_map(|c| c.iter().copied())
        .collect();
    assert_eq!(&flat[..3], &[0x1, 0x881d, 12]);
}

#[test]
fn number_order_does_not_depend_on_length() {
    // A single digit and a three-digit number both read left to right.
    for (text, value) in [("dohyik", 1u32), ("dohyiktyuttyin", 123)] {
        let mut codelets = [[0u32; CODELET_WIDTH]; 4];
        let count = encode_sentence(text, &mut codelets).expect("encodes");
        let flat: std::vec::Vec<u32> = codelets[..count]
            .iter()
            .flat_map(|c| c.iter().copied())
            .collect();
        assert_eq!(flat[2], value, "{text}");
    }
}

#[test]
fn the_legacy_hex_little_endian_format_still_works() {
    // For reading packs written by the C: `do hyik tyut` is 1 + 2*16 = 0x21.
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence_with(
        "dohyiktyut",
        &mut codelets,
        pyac_vliw_core::text_encode::NumberFormat::LEGACY_HEX_LITTLE_ENDIAN,
    )
    .expect("encodes");
    let flat: std::vec::Vec<u32> = codelets[..count]
        .iter()
        .flat_map(|c| c.iter().copied())
        .collect();
    assert_eq!(flat[2], 0x21, "legacy little-endian hex");
}
