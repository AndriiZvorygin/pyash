//! The whole pipeline: pyac text in, codelets out, pyac text back.
//!
//! `encode_sentence` is the front half — it ports the C tablet writer, which
//! encodes a whole line and breaks at each mood. `decode_sentence` is the back
//! half — it decodes one sentence up to its mood.

use pyac_vliw_core::text_encode::{CODELET_WIDTH, encode_sentence};
use pyac_vliw_core::{decode_sentence, word_code::decode as spell};

fn glyph(word: u32) -> String {
    let mut buffer = [0u8; 8];
    match spell(word as u16, &mut buffer) {
        Ok(length) => String::from_utf8_lossy(&buffer[..length]).into_owned(),
        Err(_) => format!("0x{word:04x}"),
    }
}

/// Spell one decoded sentence back into PyAC words.
fn spoken(words: &[u32], sentence: &pyac_vliw_core::DecodedSentence) -> String {
    let mut out = String::new();
    for field in sentence.fields() {
        for index in 0..field.length {
            out.push_str(&glyph(words[field.start + index]));
        }
        out.push_str(&glyph(field.case));
        out.push(' ');
    }
    let (verb_start, verb_length) = sentence.verb();
    for index in 0..verb_length {
        out.push_str(&glyph(words[verb_start + index]));
    }
    out.push_str(&glyph(sentence.mood()));
    out
}

/// Encode `text` and return the whole tablet, flattened, with its codelet count.
fn tablet(text: &str) -> (std::vec::Vec<u32>, usize) {
    let mut codelets = [[0u32; CODELET_WIDTH]; 4];
    let count = encode_sentence(text, &mut codelets).expect("encodes");
    let flat: std::vec::Vec<u32> = codelets[..count]
        .iter()
        .flat_map(|codelet| codelet.iter().copied())
        .collect();
    (flat, count)
}

#[test]
fn a_plain_sentence_survives_the_round_trip() {
    let (flat, count) = tablet("sana pyanli");
    let (decoded, _) = decode_sentence(&flat, count, 0).expect("decodes");
    // Spans are payload-relative and the payload starts after the summary word.
    assert_eq!(spoken(&flat[1..], &decoded).trim(), "sana pyanli");
}

#[test]
fn a_numeric_literal_encodes_to_the_c_tablet() {
    let (flat, _) = tablet("doka");
    // The C's own tablet for this: {0x9, 0x881D, 0x0, 0x245E}.
    assert_eq!(&flat[..4], &[0x9, 0x881d, 0x0, 0x245e]);
}

#[test]
fn a_conditional_sentence_breaks_where_the_c_breaks() {
    // "cuplustu" is `cu` (conditional) then `tu` (deontic); the C writes one
    // tablet with a boundary at each mood.
    let (flat, count) = tablet("cuplustu");
    assert_eq!(&flat[..4], &[0xb, 0x29be, 0x8a64, 0x295e]);
    assert_eq!(flat[0] & 1, 1, "complete");
    assert_eq!(flat[0] & (1 << 1), 1 << 1, "boundary at the conditional");
    assert_eq!(flat[0] & (1 << 3), 1 << 3, "boundary at the deontic");
    let _ = count;
}

#[test]
fn a_multi_clause_tablet_matches_the_c() {
    // "hyikdopwih prifgika djancu plustu" mixes a realis-less conditional (`cu`)
    // into the line, so the tablet has two clauses. The whole tablet is what the
    // encoder produces, and it matches the C's except for the stale `pwih` entry
    // documented in the oracle test.
    let (flat, _) = tablet("hyikdopwih prifgika djancu plustu");
    assert_eq!(
        &flat[..11],
        &[0x0549, 0x881d, 0x0001, 0x4127, 0xc8c4, 0x225e, 0x245e, 0x69b3, 0x29be, 0x8a64, 0x295e]
    );
    // The conditional `cu` is where the C breaks the line, so the tablet's first
    // clause ends there even though the whole line is one tablet.
    assert_eq!(flat[0] & (1 << 8), 1 << 8, "boundary at the conditional");
}
