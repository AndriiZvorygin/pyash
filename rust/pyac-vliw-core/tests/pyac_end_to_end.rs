//! End-to-end check: does plain PyAC text encode to codelets and decode back?
//!
//! This is the contract that matters for building on top: a `.pyac` sentence goes
//! in, the packed codelets come out, and reading them structurally returns the
//! same sentence. Nothing here executes anything — it is encode, pack, unpack,
//! decode.

use pyac_vliw_core::{
    Codelets, EncodeField, EncodeSentence, decode_sentence, word_code::decode as spell,
    word_code::encode as spell_word,
};

const WORDS: usize = 16;

const NAME_TYPE: u32 = 0x225e; // gi
const SA: u32 = 0x253e; // you_
const NA: u32 = 0x24de; // nominative
const PYAN: u32 = 0x6904; // love
const LI: u32 = 0x217e; // realis

/// Read a decoded sentence back into its spoken form.
fn spoken(words: &[u32], sentence: &pyac_vliw_core::DecodedSentence) -> String {
    fn glyph(word: u32) -> String {
        let mut buffer = [0u8; 8];
        match spell(word as u16, &mut buffer) {
            Ok(length) => String::from_utf8_lossy(&buffer[..length]).into_owned(),
            Err(_) => format!("0x{word:04x}"),
        }
    }
    let mut out = String::new();
    for field in sentence.fields() {
        for index in 0..field.length {
            out.push_str(&glyph(words[field.start + index]));
        }
        // The case word fuses onto the value it closes.
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

/// Encode a sentence to codelets, pack them, unpack, and decode.
fn round_trip(fields: &[EncodeField<'_>], verb: &[u32]) -> (String, Vec<u32>) {
    let sentence = EncodeSentence {
        fields,
        verb,
        mood: LI,
    };
    pyac_vliw_core::validate_encode(&sentence).expect("valid sentence");

    // Codelets, as the pack layer sees them.
    let codelets: Vec<[u32; WORDS]> = Codelets::new(&sentence).collect();
    let flattened: Vec<u32> = codelets.iter().flat_map(|c| c.iter().copied()).collect();

    // Decode the first codelet group.
    let (decoded, token_count) = decode_sentence(&flattened, codelets.len(), 0).expect("decodes");
    let payload = &flattened[1..1 + token_count];
    (spoken(payload, &decoded), payload.to_vec())
}

#[test]
fn sana_pyanli_round_trips_through_codelets() {
    let subject = [SA];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let (text, payload) = round_trip(&fields, &[PYAN]);
    assert_eq!(text.trim(), "sana pyanli");
    // The pyac base form, word for word, with no type tag.
    assert_eq!(payload, [SA, NA, PYAN, LI]);
}

#[test]
fn a_name_round_trips_as_gi_plus_a_root() {
    let hnim = spell_word("hnim").unwrap() as u32;
    let subject = [NAME_TYPE, hnim];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let (text, payload) = round_trip(&fields, &[PYAN]);
    // gi hnim na pyan li -> "gihnimna pyanli": the name tag leads, as agreed.
    assert_eq!(text.trim(), "gihnimna pyanli");
    assert_eq!(payload, [NAME_TYPE, hnim, NA, PYAN, LI]);
}

#[test]
fn a_width_tagged_value_round_trips_without_a_name_tag() {
    let width = spell_word("do").unwrap() as u32;
    let subject = [width, 4930];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let (text, payload) = round_trip(&fields, &[PYAN]);
    // 4930 is a raw literal, not a dictionary word, so it spells as its own
    // glyphs: `kse7m`. The width word leads and no `gi` appears.
    assert_eq!(text.trim(), "dokse7mna pyanli");
    assert_eq!(payload, [width, 4930, NA, PYAN, LI]);
}

#[test]
fn two_fields_round_trip_in_order() {
    let ka = spell_word("ka").unwrap() as u32;
    let left = [SA];
    let right = [spell_word("hnim").unwrap() as u32];
    let fields = [
        EncodeField {
            case: NA,
            value: &left,
        },
        EncodeField {
            case: ka,
            value: &right,
        },
    ];
    let (text, payload) = round_trip(&fields, &[PYAN]);
    assert_eq!(payload, [SA, NA, right[0], ka, PYAN, LI]);
    assert!(text.contains("sana"), "{text}");
    assert!(text.contains("hnimka"), "{text}");
}
