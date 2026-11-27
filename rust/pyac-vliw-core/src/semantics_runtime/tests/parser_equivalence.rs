use super::*;
use crate::sentence_parse_state::parse_sentence_range_legacy;

fn codelet(tokens: &[u32], boundaries: &[usize]) -> [u32; CODELET_WORDS] {
    assert!(tokens.len() <= CODELET_WORDS - 1);
    let mut words = [0u32; CODELET_WORDS];
    words[0] = 1;
    for &index in boundaries {
        words[0] |= 1 << (index + 1);
    }
    words[1..=tokens.len()].copy_from_slice(tokens);
    words
}

fn snapshot(
    sentence: &ParsedSentence,
) -> (usize, std::vec::Vec<(u32, usize, usize)>, usize, usize, u32) {
    let mut fields = std::vec::Vec::new();
    let mut index = 0;
    while index < sentence.field_count {
        let field = array_at!(sentence.fields, index);
        fields.push((field.role, field.start, field.length));
        index += 1;
    }
    (
        sentence.field_count,
        fields,
        sentence.verb_start,
        sentence.verb_length,
        sentence.mood,
    )
}

fn check(codelets: &[[u32; CODELET_WORDS]], start: usize, end: usize) {
    let words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().copied())
        .collect::<std::vec::Vec<_>>();
    let token_count = codelets.len() * (CODELET_WORDS - 1);
    assert!(start < end && end <= token_count);
    let view = SentenceView::new(&words, 0, token_count);
    let mut legacy = ParsedSentence::empty();
    let mut current = ParsedSentence::empty();
    let legacy_error = parse_sentence_range_legacy(&view, start, end, &mut legacy);
    let current_error = parse_sentence_range(&view, start, end, &mut current);
    assert_eq!(
        legacy_error, current_error,
        "error mismatch for start={start} end={end} codelets={codelets:?}"
    );
    if legacy_error == 0 {
        assert_eq!(
            snapshot(&legacy),
            snapshot(&current),
            "field mismatch for start={start} end={end} codelets={codelets:?}"
        );
    }
}

fn fixtures() -> std::vec::Vec<std::vec::Vec<[u32; CODELET_WORDS]>> {
    let mut out = std::vec::Vec::new();
    out.push(std::vec![codelet(
        &[
            NUMBER_QUOTE,
            1,
            ACCUSATIVE,
            NUMBER_QUOTE,
            1,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    )]);
    out.push(std::vec![codelet(
        &[
            NAME_TYPE,
            0x0065,
            NOMINATIVE,
            NUMBER_QUOTE,
            7,
            ACCUSATIVE,
            REALIS,
        ],
        &[2, 5, 6],
    )]);
    out.push(std::vec![codelet(
        &[TRUTH, ACCUSATIVE, NUMBER_VERB, REALIS],
        &[1, 3],
    )]);
    out.push(std::vec![codelet(&[MOOD_RETURN], &[0])]);
    out.push(std::vec![
        codelet(
            &[
                NUMBER_QUOTE,
                5,
                ACCUSATIVE,
                NUMBER_QUOTE,
                5,
                SOURCE,
                EQUALLY,
                CONDITIONAL,
            ],
            &[2, 5, 7],
        ),
        codelet(&[NUMBER_QUOTE, 7, ACCUSATIVE, NUMBER_VERB, REALIS], &[2, 4],),
    ]);
    out.push(std::vec![codelet(
        &[
            NUMBER_QUOTE,
            1,
            ACCUSATIVE,
            NUMBER_QUOTE,
            2,
            ACCUSATIVE,
            PLUS,
            DEONTIC,
        ],
        &[2, 5, 7],
    )]);
    out.push(std::vec![codelet(
        &[NUMBER_QUOTE, 1, DATIVE, PLUS, DEONTIC],
        &[2, 4],
    )]);
    out.push(std::vec![codelet(
        &[ACCUSATIVE, NUMBER_QUOTE, 1, PLUS, DEONTIC],
        &[0, 4],
    )]);
    out.push(std::vec![codelet(
        &[NUMBER_QUOTE, 1, ACCUSATIVE, REALIS, PLUS, DEONTIC],
        &[2, 3, 5],
    )]);
    out.push(std::vec![codelet(&[NUMBER_QUOTE, 1, ACCUSATIVE], &[2],)]);
    out.push(std::vec![codelet(
        &[
            DEPENDENT_CLAUSE,
            NUMBER_QUOTE,
            1,
            ACCUSATIVE,
            CLAUSE_TAIL,
            NUMBER_QUOTE,
            1,
            DESTINATION,
            PLUS,
            DEONTIC,
        ],
        &[3, 6, 7, 9],
    )]);
    out.push(std::vec![codelet(
        &[DEPENDENT_CLAUSE, NUMBER_QUOTE, 1, ACCUSATIVE, PLUS, DEONTIC,],
        &[3, 5],
    )]);
    out
}

#[test]
fn bitmap_decoder_matches_the_state_machine_on_fixtures_and_corruptions() {
    for codelets in fixtures() {
        let token_count = codelets.len() * (CODELET_WORDS - 1);
        for start in 0..token_count {
            for end in start + 1..=token_count {
                check(&codelets, start, end);
            }
        }

        for codelet_index in 0..codelets.len() {
            for bit in 0..CODELET_WORDS {
                let mut mutated = codelets.clone();
                mutated[codelet_index][0] ^= 1 << bit;
                check(&mutated, 0, token_count);
                if token_count > 2 {
                    check(&mutated, 1, token_count);
                }
            }
        }

        let replacements = [
            NOMINATIVE,
            ACCUSATIVE,
            DATIVE,
            ESSIVE,
            DESTINATION,
            SOURCE,
            COMITATIVE,
            INSTRUMENTAL,
            FROM_INDEX,
            TO_INDEX,
            LOCATIVE,
            MULTIPLICATIVE,
            DEPENDENT_CLAUSE,
            CLAUSE_TAIL,
            MOOD_RETURN,
            REALIS,
            0,
            0x1_0000,
        ];
        for codelet_index in 0..codelets.len() {
            for slot in 1..CODELET_WORDS {
                for &replacement in &replacements {
                    let mut mutated = codelets.clone();
                    mutated[codelet_index][slot] = replacement;
                    check(&mutated, 0, token_count);
                }
            }
        }
    }
}

fn next(seed: &mut u64) -> u32 {
    *seed = seed
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    (*seed >> 33) as u32
}

#[test]
fn bitmap_decoder_matches_the_state_machine_on_random_headers_and_tokens() {
    let pool = [
        NOMINATIVE,
        ACCUSATIVE,
        DATIVE,
        ESSIVE,
        DESTINATION,
        SOURCE,
        COMITATIVE,
        INSTRUMENTAL,
        FROM_INDEX,
        TO_INDEX,
        LOCATIVE,
        MULTIPLICATIVE,
        NUMBER_QUOTE,
        NAME_TYPE,
        PLUS,
        REALIS,
        DEONTIC,
        CONDITIONAL,
        MOOD_RETURN,
        MOOD_DEFINITION,
        MOOD_PARAGRAPH,
        DEPENDENT_CLAUSE,
        CLAUSE_TAIL,
        0,
        7,
        0x1_0000,
    ];
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    for _ in 0..4_000 {
        let length = (next(&mut seed) as usize) % (CODELET_WORDS - 1) + 1;
        let mut words = [0u32; CODELET_WORDS];
        words[0] = next(&mut seed) & 0xffff;
        for token in words.iter_mut().skip(1).take(length) {
            *token = pool[(next(&mut seed) as usize) % pool.len()];
        }
        let start = (next(&mut seed) as usize) % length;
        let end = start + 1 + (next(&mut seed) as usize) % (length - start);
        check(&[words], start, end);
    }
}
