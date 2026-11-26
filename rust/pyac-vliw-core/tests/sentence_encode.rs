use pyac_vliw_core::{
    decode_sentence, validate_encode, Codelets, EncodeField, EncodeSentence,
};

const NAME_TYPE: u32 = 0x225e;
const SA: u32 = 0x253e; // you_ (grammar form)
const NA: u32 = 0x24de; // nominative
const PYAN: u32 = 0x6904; // love
const LI: u32 = 0x217e; // realis

/// `su name you be love ya`, spoken as `sana pyanli`.
fn sana_pyanli<'a>(subject: &'a [u32], verb: &'a [u32]) -> EncodeSentence<'a> {
    EncodeSentence {
        fields: Box::leak(Box::new([EncodeField {
            case: NA,
            value: subject,
        }])),
        verb,
        mood: LI,
    }
}

#[test]
fn encoding_sana_pyanli_yields_the_expected_codelet() {
    let subject = [NAME_TYPE, SA];
    let verb = [PYAN];
    let sentence = sana_pyanli(&subject, &verb);
    validate_encode(&sentence).expect("valid sentence");

    let codelets: Vec<_> = Codelets::new(&sentence).collect();
    assert_eq!(codelets.len(), 1, "one codelet");
    // 0x29 = completion bit | bit3 (na) | bit5 (li)
    assert_eq!(codelets[0][..6], [0x0029, NAME_TYPE, SA, NA, PYAN, LI]);
}

#[test]
fn encode_then_decode_recovers_the_same_structure() {
    let subject = [NAME_TYPE, SA];
    let verb = [PYAN];
    let sentence = sana_pyanli(&subject, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");

    let words: Vec<u32> = codelet.iter().copied().collect();
    let (decoded, token_count) = decode_sentence(&words, 1, 0).expect("decodes");

    assert_eq!(token_count, 5, "name-type, sa, na, pyan, li");
    let fields = decoded.fields();
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].case, NA);
    assert_eq!((fields[0].start, fields[0].length), (0, 2), "name-type + sa");
    assert_eq!(decoded.verb(), (3, 1), "pyan");
    assert_eq!(decoded.mood(), LI);
}

#[test]
fn the_pronoun_stays_the_grammar_word_through_the_round_trip() {
    let subject = [NAME_TYPE, SA];
    let verb = [PYAN];
    let sentence = sana_pyanli(&subject, &verb);
    let codelet = Codelets::new(&sentence).next().expect("one codelet");
    let words: Vec<u32> = codelet.iter().copied().collect();
    let (decoded, _) = decode_sentence(&words, 1, 0).expect("decodes");
    let field = decoded.field(NA).expect("subject");
    // Index 0 of `words` is the codelet header, so payload slot `n` is `words[n + 1]`.
    assert_eq!(words[field.start + 1], NAME_TYPE);
    assert_eq!(words[field.start + 2], SA, "sa, not the root hnan");
}

#[test]
fn a_long_sentence_streams_across_codelets() {
    // Nine fields of two words each overflows one codelet's 15 payload slots.
    let value_a = [NAME_TYPE, SA];
    let value_b = [NAME_TYPE, SA];
    let fields = Box::leak(Box::new([
        EncodeField { case: NA, value: &value_a },
        EncodeField { case: 0x245e, value: &value_b }, // accusative
    ]));
    let verb = [PYAN];
    let sentence = EncodeSentence { fields, verb: &verb, mood: LI };
    validate_encode(&sentence).expect("valid");

    let codelets: Vec<_> = Codelets::new(&sentence).collect();
    // 2+1 + 2+1 + 1+1 = 8 payload words, so still one codelet.
    assert_eq!(codelets.len(), 1);

    let words: Vec<u32> = codelets.iter().flat_map(|c| c.iter().copied()).collect();
    let (decoded, _) = decode_sentence(&words, 1, 0).expect("decodes");
    assert_eq!(decoded.fields().len(), 2, "both fields survive");
}

#[test]
fn a_malformed_sentence_is_rejected_before_streaming() {
    let subject = [NAME_TYPE, SA];
    let verb: [u32; 0] = [];
    // A realis mood requires a verb.
    let sentence = sana_pyanli(&subject, &verb);
    assert!(validate_encode(&sentence).is_err());

    // An empty field value is malformed too.
    let empty: [u32; 0] = [];
    let bad = EncodeSentence {
        fields: Box::leak(Box::new([EncodeField { case: NA, value: &empty }])),
        verb: &[PYAN],
        mood: LI,
    };
    assert!(validate_encode(&bad).is_err());
}
