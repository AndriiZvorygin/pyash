use pyac::dictionary::{
    ArgumentSlot, DictionaryEntry, DictionaryIndex, DictionaryIndexError, LexicalForm,
    OperationParameter, OperationResult, OperationSignature, OperationSignatureKey, SourceLink,
};

fn entry(key: &[u16], start: u32) -> DictionaryEntry {
    DictionaryEntry {
        key: key.to_vec(),
        codelet_start: start,
        codelet_count: 1,
        lexical_forms: Vec::new(),
        source_links: Vec::new(),
        task_keys: Vec::new(),
        references: Vec::new(),
        operation_signatures: Vec::new(),
    }
}

#[test]
fn exact_pyac_key_lookup_uses_numeric_lexicographic_order() {
    let index = DictionaryIndex::new(3, vec![entry(&[9], 2), entry(&[1, 8], 1), entry(&[1], 0)])
        .expect("valid index");

    assert_eq!(
        index
            .entries()
            .iter()
            .map(|item| item.key.as_slice())
            .collect::<Vec<_>>(),
        [&[1][..], &[1, 8][..], &[9][..],]
    );
    assert_eq!(index.by_key(&[1]).unwrap().codelet_range(), 0..1);
    assert_eq!(index.by_key(&[1, 8]).unwrap().codelet_range(), 1..2);
    assert!(index.by_key(&[1, 8, 0]).is_none());
}

#[test]
fn normalized_surface_lookup_returns_every_sense_without_duplicate_entries() {
    let mut first = entry(&[11], 0);
    first.lexical_forms = vec![
        LexicalForm {
            language: "en".into(),
            surface: "lead".into(),
            normalized: "lead".into(),
        },
        LexicalForm {
            language: "en".into(),
            surface: "LEAD".into(),
            normalized: "LEAD".into(),
        },
    ];
    let mut second = entry(&[12], 1);
    second.lexical_forms.push(LexicalForm {
        language: "en".into(),
        surface: "lead".into(),
        normalized: "lead".into(),
    });
    let index = DictionaryIndex::new(2, vec![second, first]).expect("valid index");

    let keys: Vec<_> = index
        .by_surface("en", "lead")
        .map(|item| item.key.as_slice())
        .collect();
    assert_eq!(keys, [&[11][..], &[12][..],]);
    assert_eq!(index.by_surface("EN", "lead").count(), 0);
    assert_eq!(index.by_surface("en", "Lead").count(), 0);
}

#[test]
fn lexical_normalization_is_nfc_without_case_folding() {
    let mut composed = entry(&[13], 0);
    composed.lexical_forms.push(LexicalForm {
        language: "en".into(),
        surface: "Cafe\u{301}".into(),
        normalized: "Caf\u{e9}".into(),
    });
    let index = DictionaryIndex::new(1, vec![composed]).expect("NFC surface");
    assert_eq!(index.by_surface("en", "Caf\u{e9}").count(), 1);
    assert_eq!(index.by_surface("en", "café").count(), 0);

    let mut invalid = entry(&[14], 0);
    invalid.lexical_forms.push(LexicalForm {
        language: "en".into(),
        surface: "Cafe\u{301}".into(),
        normalized: "café".into(),
    });
    assert!(matches!(
        DictionaryIndex::new(1, vec![invalid]),
        Err(DictionaryIndexError::InvalidNormalization { .. })
    ));
}

#[test]
fn external_lookup_is_qualified_by_dataset_and_release() {
    let mut first = entry(&[21], 0);
    first.source_links.push(SourceLink {
        dataset: "wordnet".into(),
        release: "3.0".into(),
        identifier: "n:06300823".into(),
        relation: "crosswalk".into(),
    });
    let mut second = entry(&[22], 1);
    second.source_links.push(SourceLink {
        dataset: "wordnet".into(),
        release: "3.1".into(),
        identifier: "n:06300823".into(),
        relation: "crosswalk".into(),
    });
    let index = DictionaryIndex::new(2, vec![first, second]).expect("valid index");

    let matches: Vec<_> = index
        .by_source("wordnet", "3.0", "n:06300823")
        .map(|(entry, link)| (entry.key.as_slice(), link.release.as_str()))
        .collect();
    assert_eq!(matches, [(&[21][..], "3.0")]);
    assert_eq!(index.by_source("wordnet", "3.1", "n:06300823").count(), 1);
    assert_eq!(index.by_source("sumo", "3.0", "n:06300823").count(), 0);
}

#[test]
fn language_and_task_projections_keep_transitive_definition_references() {
    let mut requested = entry(&[31], 0);
    requested.lexical_forms.push(LexicalForm {
        language: "fr".into(),
        surface: "forme".into(),
        normalized: "forme".into(),
    });
    requested.task_keys.push(vec![90]);
    requested.references.push(vec![32]);

    let mut support = entry(&[32], 1);
    support.references.push(vec![31]);
    let unrelated = entry(&[33], 2);
    let index = DictionaryIndex::new(3, vec![unrelated, support, requested])
        .expect("valid index with a reference cycle");

    let selected: Vec<_> = index
        .project(Some("fr"), Some(&[90]))
        .iter()
        .map(|item| item.key.as_slice())
        .collect();
    assert_eq!(selected, [&[31][..], &[32][..]]);
    assert_eq!(index.project(Some("en"), Some(&[90])).len(), 0);
    assert_eq!(index.project(None, None).len(), 3);
}

#[test]
fn index_rejects_duplicate_keys_invalid_ranges_and_missing_references() {
    assert!(matches!(
        DictionaryIndex::new(2, vec![entry(&[1], 0), entry(&[1], 1)]),
        Err(DictionaryIndexError::DuplicateKey(_))
    ));
    assert!(matches!(
        DictionaryIndex::new(2, vec![entry(&[1], 2)]),
        Err(DictionaryIndexError::InvalidCodeletRange { .. })
    ));
    let mut overlapping = entry(&[2], 1);
    overlapping.codelet_count = 2;
    let mut first_range = entry(&[1], 0);
    first_range.codelet_count = 2;
    assert!(matches!(
        DictionaryIndex::new(3, vec![first_range, overlapping]),
        Err(DictionaryIndexError::OverlappingCodeletRanges { .. })
    ));
    let mut missing = entry(&[1], 0);
    missing.references.push(vec![2]);
    assert!(matches!(
        DictionaryIndex::new(1, vec![missing]),
        Err(DictionaryIndexError::MissingReference { .. })
    ));
}

#[test]
fn binary_search_scales_to_a_wordnet_sized_key_set() {
    const ENTRY_COUNT: usize = 100_000;
    let entries = (0..ENTRY_COUNT)
        .map(|index| {
            entry(
                &[(index & 0xffff) as u16, (index >> 16) as u16],
                index as u32,
            )
        })
        .collect();
    let index = DictionaryIndex::new(ENTRY_COUNT, entries).expect("valid large index");

    for value in [0usize, 1, 65_535, 65_536, ENTRY_COUNT - 1] {
        let key = [(value & 0xffff) as u16, (value >> 16) as u16];
        assert_eq!(index.by_key(&key).unwrap().codelet_start, value as u32);
    }
}

#[test]
fn operation_signature_lookup_uses_structure_not_argument_labels_or_order() {
    let mut first = entry(&[41], 0);
    first.operation_signatures.push(OperationSignature {
        verb: vec![7],
        mood: vec![8],
        arguments: vec![
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![2],
                    noun_class: vec![20],
                },
                tag_label: "right operand".into(),
                descriptive_specification: "the second value".into(),
            },
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![1],
                    noun_class: vec![20],
                },
                tag_label: "left operand".into(),
                descriptive_specification: "the first value".into(),
            },
        ],
        results: vec![OperationResult {
            noun_class: vec![20],
            tag_label: "sum".into(),
            descriptive_specification: "the computed result".into(),
        }],
    });
    let mut second = entry(&[42], 1);
    second.operation_signatures.push(OperationSignature {
        verb: vec![7],
        mood: vec![8],
        arguments: vec![
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![1],
                    noun_class: vec![20],
                },
                tag_label: "first".into(),
                descriptive_specification: "first input".into(),
            },
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![2],
                    noun_class: vec![20],
                },
                tag_label: "second".into(),
                descriptive_specification: "second input".into(),
            },
        ],
        results: Vec::new(),
    });
    let index = DictionaryIndex::new(2, vec![first, second]).expect("valid signatures");
    let key = OperationSignatureKey::new(
        vec![7],
        vec![8],
        vec![
            ArgumentSlot {
                grammatical_case: vec![2],
                noun_class: vec![20],
            },
            ArgumentSlot {
                grammatical_case: vec![1],
                noun_class: vec![20],
            },
        ],
    );

    let matches: Vec<_> = index
        .by_operation_signature(&key)
        .map(|(entry, _)| entry.key.as_slice())
        .collect();
    assert_eq!(matches, [&[41][..], &[42][..]]);

    let wrong_type = OperationSignatureKey::new(
        vec![7],
        vec![8],
        vec![ArgumentSlot {
            grammatical_case: vec![1],
            noun_class: vec![21],
        }],
    );
    assert_eq!(index.by_operation_signature(&wrong_type).count(), 0);
}

#[test]
fn operation_signature_rejects_repeated_cases() {
    let mut invalid = entry(&[51], 0);
    invalid.operation_signatures.push(OperationSignature {
        verb: vec![7],
        mood: vec![8],
        arguments: vec![
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![1],
                    noun_class: vec![20],
                },
                tag_label: "first".into(),
                descriptive_specification: "first input".into(),
            },
            OperationParameter {
                case_type: ArgumentSlot {
                    grammatical_case: vec![1],
                    noun_class: vec![21],
                },
                tag_label: "second".into(),
                descriptive_specification: "second input".into(),
            },
        ],
        results: Vec::new(),
    });
    assert!(matches!(
        DictionaryIndex::new(1, vec![invalid]),
        Err(DictionaryIndexError::InvalidOperationSignature { .. })
    ));
}
