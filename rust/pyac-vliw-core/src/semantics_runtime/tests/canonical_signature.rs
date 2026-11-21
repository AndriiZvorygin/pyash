use super::*;

fn codelet(tokens: &[u32], boundaries: &[usize]) -> [u32; CODELET_WORDS] {
    assert!(tokens.len() < CODELET_WORDS);
    let mut result = [0; CODELET_WORDS];
    result[0] = 1;
    result[1..=tokens.len()].copy_from_slice(tokens);
    for boundary in boundaries {
        result[0] |= 1 << (boundary + 1);
    }
    result
}

fn same_key(
    left: &SignatureView,
    left_words: &[u32],
    right: &SignatureView,
    right_words: &[u32],
) -> bool {
    if left.verb_length != right.verb_length || left.case_count != right.case_count {
        return false;
    }
    for index in 0..left.verb_length {
        if token_at(left_words, 0, 1, left.verb_start + index)
            != token_at(right_words, 0, 1, right.verb_start + index)
        {
            return false;
        }
    }
    left.cases[..left.case_count] == right.cases[..right.case_count]
}

fn parse(words: &[u32]) -> SignatureView {
    let signature = signature(words, 0, 1);
    assert_eq!(signature.error, 0, "signature should parse");
    signature
}

#[test]
fn sorts_numeric_case_hnucs_and_keeps_each_type_attached() {
    let left = codelet(
        &[
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            DATE_QUOTE,
            1,
            2,
            3,
            4,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 8, 10],
    );
    let right = codelet(
        &[
            DATE_QUOTE,
            1,
            2,
            3,
            4,
            DESTINATION,
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            PLUS,
            DEONTIC,
        ],
        &[5, 8, 10],
    );
    let left_signature = parse(&left);
    let right_signature = parse(&right);

    assert_eq!(left_signature.cases[0].case, DESTINATION);
    assert_eq!(
        left_signature.cases[0].value_type,
        right_signature.cases[0].value_type
    );
    assert_eq!(left_signature.cases[1].case, ACCUSATIVE);
    assert_eq!(
        left_signature.cases[1].value_type,
        right_signature.cases[1].value_type
    );
    assert!(same_key(&left_signature, &left, &right_signature, &right));
}

#[test]
fn typed_signature_and_verb_identity_change_the_key() {
    let numeric = codelet(
        &[
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            NUMBER_QUOTE,
            8,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    let float = codelet(
        &[
            0xd01d,
            0,
            0,
            ACCUSATIVE,
            0xd01d,
            0,
            0,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[3, 7, 9],
    );
    let different_verb = codelet(
        &[
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            NUMBER_QUOTE,
            8,
            DESTINATION,
            SUBTRACT,
            DEONTIC,
        ],
        &[2, 5, 7],
    );
    let numeric_signature = parse(&numeric);
    let float_signature = parse(&float);
    let different_verb_signature = parse(&different_verb);

    assert_ne!(numeric_signature.cases, float_signature.cases);
    assert!(!same_key(
        &numeric_signature,
        &numeric,
        &float_signature,
        &float
    ));
    assert!(!same_key(
        &numeric_signature,
        &numeric,
        &different_verb_signature,
        &different_verb
    ));
}

#[test]
fn identifier_payload_is_not_part_of_the_signature_type() {
    let left = codelet(
        &[0x4123, NOMINATIVE, NUMBER_QUOTE, 7, ACCUSATIVE, REALIS],
        &[1, 4, 5],
    );
    let right = codelet(
        &[0x4567, NOMINATIVE, NUMBER_QUOTE, 7, ACCUSATIVE, REALIS],
        &[1, 4, 5],
    );
    let left_signature = parse(&left);
    let right_signature = parse(&right);
    assert_eq!(case_type(&left_signature, NOMINATIVE), Some(TYPE_NAME));
    assert!(same_key(&left_signature, &left, &right_signature, &right));
}
