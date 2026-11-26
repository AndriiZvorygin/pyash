//! Sentence encoding: the structural inverse of the decoder.
//!
//! The pyac base form carries no tag at all — `sa na pyan li` is `sana pyanli`.
//! A name adds `gi` and its payload must be root words, so `gi hnim na` is
//! `gihnimna`, while a bare pronoun stays a grammar word.

use pyac_vliw_core::{decode_sentence, validate_encode, Codelets, EncodeField, EncodeSentence};

const NAME_TYPE: u32 = 0x225e; // gi
const SA: u32 = 0x253e; // you_ (grammar form)
const HNIM: u32 = 0x0830; // name (root)
const NA: u32 = 0x24de; // nominative
const KA: u32 = 0x245e; // accusative
const PYAN: u32 = 0x6904; // love
const LI: u32 = 0x217e; // realis

fn sentence<'a>(fields: &'a [EncodeField<'a>], verb: &'a [u32]) -> EncodeSentence<'a> {
    EncodeSentence {
        fields,
        verb,
        mood: LI,
    }
}

#[test]
fn the_base_form_carries_no_tag() {
    // sa na pyan li
    let subject = [SA];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    validate_encode(&sentence).expect("valid sentence");

    let codelets: Vec<_> = Codelets::new(&sentence).collect();
    assert_eq!(codelets.len(), 1, "one codelet");
    // Payload slots: 1=sa, 2=na, 3=pyan, 4=li. Boundaries sit on the case word
    // and the mood, so the header is 1 (complete) | 1<<2 | 1<<4 = 0x15.
    assert_eq!(codelets[0][..5], [0x0015, SA, NA, PYAN, LI]);
}

#[test]
fn encode_then_decode_recovers_the_same_structure() {
    let subject = [SA];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");

    let words: Vec<u32> = codelet.iter().copied().collect();
    let (decoded, token_count) = decode_sentence(&words, 1, 0).expect("decodes");

    assert_eq!(token_count, 4, "sa, na, pyan, li");
    let fields = decoded.fields();
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].case, NA);
    assert_eq!((fields[0].start, fields[0].length), (0, 1), "sa");
    assert_eq!(decoded.verb(), (2, 1), "pyan");
    assert_eq!(decoded.mood(), LI);
}

#[test]
fn a_bare_pronoun_stays_the_grammar_word() {
    let subject = [SA];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");
    let words: Vec<u32> = codelet.iter().copied().collect();
    let (decoded, _) = decode_sentence(&words, 1, 0).expect("decodes");
    let field = decoded.field(NA).expect("subject");
    // Header occupies slot 0, so payload slot `n` is `words[n + 1]`.
    assert_eq!(words[field.start + 1], SA, "sa, never the root hnim");
}

#[test]
fn a_name_is_gi_plus_a_root() {
    // gi hnim na pyan li -> gihnimna pyanli
    let subject = [NAME_TYPE, HNIM];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");
    let words: Vec<u32> = codelet.iter().copied().collect();
    let (decoded, _) = decode_sentence(&words, 1, 0).expect("decodes");
    let field = decoded.field(NA).expect("subject");
    assert_eq!((field.start, field.length), (0, 2), "gi + hnim");
    assert_eq!(words[field.start + 1], NAME_TYPE);
    assert_eq!(words[field.start + 2], HNIM);
}

#[test]
fn a_name_of_a_grammar_word_is_rejected() {
    // gi sa is not a name: `sa` is a pronoun doing its grammatical job.
    let subject = [NAME_TYPE, SA];
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");
    let words: Vec<u32> = codelet.iter().copied().collect();
    assert!(
        decode_sentence(&words, 1, 0).is_err(),
        "gi sa must not decode as a name"
    );
}

#[test]
fn two_fields_survive_the_round_trip() {
    let value_a = [SA];
    let value_b = [HNIM];
    let fields = [
        EncodeField {
            case: NA,
            value: &value_a,
        },
        EncodeField {
            case: KA,
            value: &value_b,
        },
    ];
    let verb = [PYAN];
    let sentence = sentence(&fields, &verb);
    validate_encode(&sentence).expect("valid");

    let codelets: Vec<_> = Codelets::new(&sentence).collect();
    let words: Vec<u32> = codelets.iter().flat_map(|c| c.iter().copied()).collect();
    let (decoded, _) = decode_sentence(&words, codelets.len(), 0).expect("decodes");
    assert_eq!(decoded.fields().len(), 2, "both fields survive");
}

#[test]
fn a_malformed_sentence_is_rejected_before_streaming() {
    let subject = [SA];
    let verb: [u32; 0] = [];
    // A realis mood requires a verb.
    let fields = [EncodeField {
        case: NA,
        value: &subject,
    }];
    let bad = sentence(&fields, &verb);
    assert!(validate_encode(&bad).is_err());

    // An empty field value is malformed too.
    let empty: [u32; 0] = [];
    let bad = EncodeSentence {
        fields: Box::leak(Box::new([EncodeField {
            case: NA,
            value: &empty,
        }])),
        verb: &[PYAN],
        mood: LI,
    };
    assert!(validate_encode(&bad).is_err());
}
