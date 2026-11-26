use pyac_vliw_core::{
    Codelets, EncodeField, EncodeSentence, decode_sentence, validate_encode,
    word_code::decode as decode_word, word_code::encode as encode_word,
};

/// Compose the spoken form of a decoded sentence, fusing a value with the case
/// word that closes it and the verb with its mood — the way PyAC is written.
fn spoken(words: &[u32], sentence: &pyac_vliw_core::DecodedSentence) -> String {
    fn spell(word: u32) -> String {
        let mut buffer = [0u8; 8];
        match decode_word(word as u16, &mut buffer) {
            Ok(length) => String::from_utf8_lossy(&buffer[..length]).into_owned(),
            Err(_) => format!("0x{word:04x}"),
        }
    }
    let mut out = String::new();
    for field in sentence.fields() {
        for index in 0..field.length {
            out.push_str(&spell(words[field.start + index]));
        }
        // The case word fuses onto the value it closes.
        out.push_str(&spell(field.case));
        out.push(' ');
    }
    let (verb_start, verb_length) = sentence.verb();
    for index in 0..verb_length {
        out.push_str(&spell(words[verb_start + index]));
    }
    out.push_str(&spell(sentence.mood()));
    out
}

#[test]
fn sana_pyanli_encodes_and_decodes_to_the_same_pyac() {
    // The pyac base form: `sa na pyan li`, four words, no type marker.
    let subject = [encode_word("sa").unwrap() as u32];
    let verb = [encode_word("pyan").unwrap() as u32];
    let fields = [EncodeField {
        case: encode_word("na").unwrap() as u32,
        value: &subject,
    }];
    let sentence = EncodeSentence {
        fields: &fields,
        verb: &verb,
        mood: encode_word("li").unwrap() as u32,
    };
    validate_encode(&sentence).expect("valid");

    // Encode.
    let codelets: Vec<_> = Codelets::new(&sentence).collect();
    assert_eq!(codelets.len(), 1);
    // Slot 0 is the header; the payload follows it.
    let words: Vec<u32> = codelets[0].to_vec();

    // Decode.
    let (decoded, token_count) = decode_sentence(&words, 1, 0).expect("decodes");
    assert_eq!(token_count, 4, "sa na pyan li");

    // Speak it: the case word fuses onto the value, the mood onto the verb.
    let rendered = spoken(&words[1..], &decoded);
    assert_eq!(rendered.trim(), "sana pyanli");
}

#[test]
fn the_encoded_codelet_is_the_expected_four_words() {
    let subject = [0x253eu32]; // sa
    let verb = [0x6904u32]; // pyan
    let fields = [EncodeField {
        case: 0x24de, // na
        value: &subject,
    }];
    let sentence = EncodeSentence {
        fields: &fields,
        verb: &verb,
        mood: 0x217e, // li
    };
    let codelet = Codelets::new(&sentence).next().expect("one codelet");
    // Payload slots are 1=sa, 2=na, 3=pyan, 4=li. Boundaries sit on the slots
    // holding the case word and the mood, so header = 1 (complete) | 1<<2 | 1<<4.
    assert_eq!(codelet[..5], [0x0015, 0x253e, 0x24de, 0x6904, 0x217e]);
}
