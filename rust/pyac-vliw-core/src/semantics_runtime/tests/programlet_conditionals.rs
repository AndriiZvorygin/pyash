use super::*;
use crate::boolean::{evaluate_boolean_expression, evaluate_boolean_leaf};

#[test]
fn scans_sectioned_programlets_with_inline_conditional_bodies() {
    let codelets = [
        [
            0x0049, 0x225e, 0x2818, 0x24de, 0xec01, 0x6a84, 0x5217, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        [
            0x0a11, 0x225e, 0xaaa2, 0x8918, 0x24de, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xe8c9,
            0x5217, 0, 0, 0, 0,
        ],
        [
            0xf6b6, 0x881d, 0x0003, 0x245e, 0x881d, 0x0005, 0x313e, 0x6c0d, 0x29be, 0x881d, 0x0002,
            0x245e, 0x225e, 0x327e, 0x225e, 0x4930,
        ],
        [
            0x000b, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        [
            0x0019, 0x225e, 0x4930, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        [
            0x0051, 0x225e, 0xaaa2, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        [
            0x0121, 0x225e, 0x327e, 0x225e, 0x4930, 0x243e, 0xaaa2, 0x8918, 0x295e, 0, 0, 0, 0, 0,
            0, 0,
        ],
        [
            0x0049, 0x225e, 0x2818, 0x24de, 0xec01, 0x6a84, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    ];
    let words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().copied())
        .collect::<std::vec::Vec<_>>();
    let mut sections = [ProgramletSection::EMPTY; MAX_PROGRAMLET_SECTIONS];

    let count = scan_numeric_programlet_sections(&words, codelets.len(), &mut sections).unwrap();

    assert_eq!(count, 1);
    assert_eq!(sections[0].codelet_start, 1);
    assert_eq!(sections[0].codelet_count, 6);
    assert_eq!(sections[0].name_words[0], 0x2818);
}

#[test]
fn composes_boolean_literals_in_nested_pyash_clauses() {
    let not_truth = [
        0x02a9,
        DEPENDENT_CLAUSE,
        TRUTH,
        ACCUSATIVE,
        BOOLEAN_VERB,
        REALIS,
        CLAUSE_TAIL,
        ACCUSATIVE,
        NEGATORY_QUANTIFIER,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let and_truth_lie = [
        [
            0xab56,
            DEPENDENT_CLAUSE,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            ACCUSATIVE,
            DEPENDENT_CLAUSE,
            LIE,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            COMITATIVE,
            AND_GRAMMAR,
        ],
        [0x0003, DEONTIC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    let or_lie_truth = [
        [
            0xab56,
            DEPENDENT_CLAUSE,
            LIE,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            ACCUSATIVE,
            DEPENDENT_CLAUSE,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            COMITATIVE,
            OR_GRAMMAR,
        ],
        [0x0003, DEONTIC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    let nested_and_not = [
        [
            0x5756,
            DEPENDENT_CLAUSE,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            ACCUSATIVE,
            DEPENDENT_CLAUSE,
            DEPENDENT_CLAUSE,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            CLAUSE_TAIL,
            ACCUSATIVE,
        ],
        [
            0x0055,
            NEGATORY_QUANTIFIER,
            DEONTIC,
            CLAUSE_TAIL,
            COMITATIVE,
            AND_GRAMMAR,
            DEONTIC,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ],
    ];

    let flat_not = not_truth
        .iter()
        .map(|word| *word as u32)
        .collect::<std::vec::Vec<_>>();
    let (token_count, _) = collect_sentence(&flat_not, 1, 0).expect("nested not sentence collects");
    let tokens = SentenceView::new(&flat_not, 0, token_count);
    let mut root = ParsedSentence::empty();
    assert_eq!(parse_sentence(&tokens, &mut root), 0);
    let (child_start, child_end) =
        embedded_clause_range(&tokens, root.field(ACCUSATIVE).expect("not has ob"))
            .expect("not ob contains a clause");
    let mut child = ParsedSentence::empty();
    assert_eq!(
        parse_sentence_range(&tokens, child_start, child_end, &mut child),
        0
    );
    assert_eq!(evaluate_boolean_leaf(&child, &tokens), Ok(true));
    assert_eq!(
        evaluate_boolean_expression(&tokens, 0, tokens.len()),
        Ok(false)
    );

    let result = interpret(&[not_truth]);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);

    let result = interpret(&and_truth_lie);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);
    assert_eq!(result.consumed_codelets, 2);

    let result = interpret(&or_lie_truth);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);
    assert_eq!(result.consumed_codelets, 2);

    let result = interpret(&nested_and_not);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 0);
    assert_eq!(result.consumed_codelets, 2);
}

#[test]
fn compares_literal_values_as_boolean_expression_leaves() {
    let equally = [
        0x0149,
        NUMBER_QUOTE,
        5,
        0x24de,
        NUMBER_QUOTE,
        5,
        SOURCE,
        EQUALLY,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let tiny = [
        0x0149,
        NUMBER_QUOTE,
        4,
        0x24de,
        NUMBER_QUOTE,
        5,
        SOURCE,
        TINY,
        DEONTIC,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ];
    let not_unequal = [[
        0x2a91,
        DEPENDENT_CLAUSE,
        NUMBER_QUOTE,
        5,
        0x24de,
        NUMBER_QUOTE,
        4,
        SOURCE,
        EQUALLY,
        DEONTIC,
        CLAUSE_TAIL,
        ACCUSATIVE,
        NEGATORY_QUANTIFIER,
        DEONTIC,
        0,
        0,
    ]];

    for (codelet, expected) in [(equally, true), (tiny, true)] {
        let result = interpret(&[codelet]);
        assert_eq!(result.error, 0);
        assert_eq!(result.value_kind, VALUE_BOOLEAN);
        assert_eq!(result.values[0], u32::from(expected));
    }

    let result = interpret(&not_unequal);
    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);
}

#[test]
fn conditional_uses_all_three_pyash_numeric_comparators() {
    for (operator, left, right, expected) in [
        (EQUALLY, 5, 5, 7),
        (EQUALLY, 4, 5, 9),
        (TINY, 3, 5, 7),
        (TINY, 5, 3, 9),
        (GIANT, 5, 3, 7),
        (GIANT, 3, 5, 9),
    ] {
        let branch = [
            [
                0xd6b6,
                NUMBER_QUOTE,
                left,
                ACCUSATIVE,
                NUMBER_QUOTE,
                right,
                SOURCE,
                operator,
                CONDITIONAL,
                NUMBER_QUOTE,
                7,
                ACCUSATIVE,
                NUMBER_VERB,
                REALIS,
                NUMBER_QUOTE,
                9,
            ],
            [
                0x000b,
                ACCUSATIVE,
                NUMBER_VERB,
                REALIS,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ],
        ];
        let result = interpret(&branch);
        assert_eq!(result.error, 0, "operator 0x{operator:04x}");
        assert_eq!(result.value_kind, VALUE_UNSIGNED);
        assert_eq!(result.values[0], expected, "operator 0x{operator:04x}");
    }
}

#[test]
fn returns_a_boolean_from_a_canonical_comparison_branch() {
    let codelets = [
        [
            0xaab6,
            NUMBER_QUOTE,
            3,
            ACCUSATIVE,
            NUMBER_QUOTE,
            5,
            SOURCE,
            TINY,
            CONDITIONAL,
            TRUTH,
            ACCUSATIVE,
            BOOLEAN_VERB,
            REALIS,
            LIE,
            ACCUSATIVE,
            BOOLEAN_VERB,
        ],
        [0x0003, REALIS, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    let result = interpret(&codelets);

    assert_eq!(result.error, 0);
    assert_eq!(result.value_kind, VALUE_BOOLEAN);
    assert_eq!(result.values[0], 1);
    assert_eq!(result.consumed_codelets, 2);
}
