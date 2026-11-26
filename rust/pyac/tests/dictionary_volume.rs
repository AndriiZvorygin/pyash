use std::fs::File;
use std::io::Cursor;

use pyac::dictionary::{
    DictionaryField, DictionaryFileReader, DictionaryMetadata, DictionaryValue, DictionaryVolume,
    DictionaryVolumeEntry, LexicalForm, OperationArgument, OperationArgumentType,
    OperationSignature, OperationSignatureKey, SourceGloss, SourceLink, encode_dictionary,
    encode_text_sentence,
};

const ENTRY_KEY: [u16; 2] = [0xa96a, 0x6c22]; // tlat kwon

fn sample_volume() -> DictionaryVolume {
    let definition = encode_text_sentence(
        &ENTRY_KEY,
        &[DictionaryField {
            grammatical_case: 0x245e,
            value: DictionaryValue::Text(
                "A long definition uses ordinary Pyash text quote continuation.",
            ),
        }],
    )
    .expect("lower definition sentence");
    DictionaryVolume {
        metadata: DictionaryMetadata {
            kind: "English Pyash dictionary".into(),
            title: "Reference dictionary with a sufficiently long title".into(),
            revision: 0x1234_5678,
            languages: vec!["en".into()],
            normalization_policy: "NFC".into(),
        },
        entries: vec![DictionaryVolumeEntry {
            key: ENTRY_KEY.to_vec(),
            lexical_forms: vec![
                LexicalForm {
                    language: "en".into(),
                    surface: "Dictionary".into(),
                    normalized: "Dictionary".into(),
                },
                LexicalForm {
                    language: "en".into(),
                    surface: "cafe\u{301}".into(),
                    normalized: "café".into(),
                },
                LexicalForm {
                    language: "en".into(),
                    surface: "café".into(),
                    normalized: "café".into(),
                },
            ],
            source_links: vec![SourceLink {
                dataset: "wordnet".into(),
                release: "OEWN 2025".into(),
                identifier: "n:06311813-n".into(),
                relation: "exact-sense".into(),
            }],
            source_glosses: vec![SourceGloss {
                language: "en".into(),
                text: "A sense-specific interim gloss.".into(),
                dataset: "wordnet".into(),
                release: "OEWN 2025".into(),
                identifier: "n:06311813-n".into(),
            }],
            component_keys: vec![],
            task_keys: vec![],
            references: vec![],
            operation_signatures: vec![OperationSignature {
                verb: vec![0x1111],
                mood: vec![0x217e],
                arguments: vec![OperationArgument {
                    key: OperationArgumentType {
                        grammatical_case: vec![0x245e],
                        value_type: vec![0x0e1d],
                    },
                    name: "subject".into(),
                    description: "the value being evaluated".into(),
                }],
                results: vec![],
            }],
            definition: Some(definition),
        }],
    }
}

#[test]
fn writer_emits_reproducible_pack_and_seek_reader_reads_entry_on_demand() {
    let volume = sample_volume();
    let bytes = encode_dictionary(&volume).expect("encode volume");
    assert_eq!(bytes, encode_dictionary(&volume).expect("repeat encoding"));

    let mut reader = DictionaryFileReader::open(Cursor::new(bytes.clone())).expect("open volume");
    assert_eq!(reader.profile_version(), "pyac-vliw-dictionary/4");
    assert_eq!(reader.metadata().kind, "English Pyash dictionary");
    assert_eq!(reader.metadata().title, volume.metadata.title);
    assert_eq!(reader.metadata().revision, volume.metadata.revision);
    assert_eq!(reader.metadata().languages, ["en"]);
    assert_eq!(reader.metadata().normalization_policy, "NFC");
    assert_eq!(reader.sections().len(), 6);
    assert_eq!(reader.sections()[0].role, "metadata");
    assert_eq!(reader.sections()[1].role, "canonical-index");

    let range = reader
        .location(&ENTRY_KEY)
        .expect("lookup location")
        .expect("entry location posting");
    let entry = reader
        .read_entry(&ENTRY_KEY)
        .expect("read only matching range");
    assert_eq!(entry.len(), (range.end - range.start) as usize);
    let definition_range = reader
        .definition_location(&ENTRY_KEY)
        .expect("definition lookup")
        .expect("definition range");
    assert!(definition_range.start >= range.start);
    assert!(definition_range.end <= range.end);
    assert_eq!(
        reader.read_definition(&ENTRY_KEY).expect("read definition"),
        volume.entries[0].definition.clone().unwrap()
    );
    assert_eq!(reader.read_section("entries").unwrap().len(), entry.len());
    assert_eq!(reader.location(&[0xffff]).unwrap(), None);
    let surface_offsets = reader.lookup_surface("en", "Dictionary").unwrap();
    assert_eq!(surface_offsets, [range.start]);
    assert!(
        reader
            .lookup_surface("en", "dictionary")
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        reader.lookup_surface("en", "cafe\u{301}").unwrap(),
        [range.start]
    );
    let source = reader
        .lookup_source("wordnet", "OEWN 2025", "n:06311813-n")
        .unwrap();
    assert_eq!(source.len(), 1);
    assert_eq!(source[0], range.start);
    assert_eq!(reader.read_entry_at(source[0]).unwrap(), entry);
    let signature = OperationSignatureKey::new(
        vec![0x1111],
        vec![0x217e],
        vec![OperationArgumentType {
            grammatical_case: vec![0x245e],
            value_type: vec![0x0e1d],
        }],
    );
    assert_eq!(
        reader.lookup_operation_signature(&signature).unwrap(),
        [range.start]
    );
}

#[test]
fn reader_rejects_a_pack_with_the_wrong_profile_synset() {
    let mut bytes = encode_dictionary(&sample_volume()).expect("encode volume");
    // First codelet: slot 2 is `lyin`, the electronic-dictionary subject atom.
    let offset = 32 + 2 * 2;
    bytes[offset..offset + 2].copy_from_slice(&0x1234u16.to_le_bytes());
    assert!(DictionaryFileReader::open(Cursor::new(bytes)).is_err());
}

#[test]
fn volume_rejects_unresolved_definition_references_before_writing() {
    let mut volume = sample_volume();
    volume.entries[0].references.push(vec![0x7777]);
    assert!(encode_dictionary(&volume).is_err());
}

#[test]
fn source_gloss_only_entry_is_searchable_without_an_authored_definition() {
    let mut volume = sample_volume();
    volume.entries[0].definition = None;
    let bytes = encode_dictionary(&volume).expect("encode gloss-only dictionary");
    let mut reader = DictionaryFileReader::open(Cursor::new(bytes)).expect("open v4 volume");

    assert_eq!(reader.profile_version(), "pyac-vliw-dictionary/4");
    assert_eq!(
        reader.lookup_surface("en", "Dictionary").unwrap(),
        [reader.location(&ENTRY_KEY).unwrap().unwrap().start]
    );
    assert!(!reader.has_definition(&ENTRY_KEY).unwrap());
    assert!(reader.read_definition(&ENTRY_KEY).unwrap().is_empty());
    assert!(!reader.read_entry(&ENTRY_KEY).unwrap().is_empty());
}

#[test]
fn source_gloss_must_match_an_exact_source_link() {
    let mut volume = sample_volume();
    volume.entries[0].source_glosses[0].identifier = "n:99999999-n".into();
    assert!(encode_dictionary(&volume).is_err());
}

#[test]
fn reader_rejects_a_v4_pack_misdeclared_as_v3() {
    let volume = sample_volume();
    let mut bytes = encode_dictionary(&volume).expect("encode profile volume");
    let profile = b"pyac-vliw-dictionary/4"
        .iter()
        .flat_map(|byte| [*byte, 0])
        .collect::<Vec<_>>();
    let start = bytes
        .windows(profile.len())
        .position(|window| window == profile)
        .expect("profile version text");
    bytes[start + profile.len() - 2] = b'3';

    assert!(DictionaryFileReader::open(Cursor::new(bytes)).is_err());
}

#[test]
fn writer_rejects_two_exact_wordnet_senses_of_one_part_of_speech_for_one_pyac_key() {
    let mut volume = sample_volume();
    volume.entries[0].source_links.push(SourceLink {
        dataset: "wordnet".into(),
        release: "OEWN 2025".into(),
        identifier: "n:99999999-n".into(),
        relation: "exact-sense".into(),
    });
    let error = encode_dictionary(&volume).expect_err("conflicting senses must be rejected");
    assert!(error.to_string().contains("multiple exact WordNet senses"));
}

#[test]
fn writer_accepts_exact_wordnet_senses_of_different_parts_of_speech_for_one_pyac_key() {
    let mut volume = sample_volume();
    volume.entries[0].source_links.push(SourceLink {
        dataset: "wordnet".into(),
        release: "OEWN 2025".into(),
        identifier: "v:06311813-v".into(),
        relation: "exact-sense".into(),
    });
    volume.entries[0].source_glosses.push(SourceGloss {
        language: "en".into(),
        text: "A verb sense for the same key.".into(),
        dataset: "wordnet".into(),
        release: "OEWN 2025".into(),
        identifier: "v:06311813-v".into(),
    });
    encode_dictionary(&volume).expect("senses of different parts of speech must be accepted");
}

#[test]
fn v4_index_and_entry_sentences_have_no_textual_schema_labels() {
    let bytes = encode_dictionary(&sample_volume()).expect("encode v4 volume");
    let words = bytes[32..]
        .chunks_exact(32)
        .flat_map(|codelet| {
            codelet
                .chunks_exact(2)
                .skip(1)
                .map(|word| u16::from_le_bytes([word[0], word[1]]))
        })
        .collect::<Vec<_>>();
    let decoded = String::from_utf16_lossy(&words);
    for obsolete_label in ["canonical", "entry-location", "lexical-form", "source-link"] {
        assert!(!decoded.contains(obsolete_label));
    }
}

#[test]
fn direct_raw_binary_search_handles_multicodelet_text_and_false_marker_bits() {
    let entries = (0..240u16)
        .map(|index| {
            let surface = format!(
                "long lexical surface {index:04} whose raw words contain marker-like bits {}",
                "payload ".repeat(index as usize % 19 + 1)
            );
            DictionaryVolumeEntry {
                key: vec![0x2000 + index],
                lexical_forms: vec![LexicalForm {
                    language: "en".into(),
                    surface: surface.clone(),
                    normalized: surface,
                }],
                source_links: vec![],
                source_glosses: vec![],
                component_keys: vec![],
                task_keys: vec![],
                references: vec![],
                operation_signatures: vec![],
                definition: None,
            }
        })
        .collect();
    let volume = DictionaryVolume {
        metadata: DictionaryMetadata {
            kind: "test dictionary".into(),
            title: "long surface direct-search test".into(),
            revision: 1,
            languages: vec!["en".into()],
            normalization_policy: "NFC".into(),
        },
        entries,
    };
    let bytes = encode_dictionary(&volume).expect("encode multicodelet index");
    let mut reader = DictionaryFileReader::open(Cursor::new(bytes)).expect("open v4 volume");

    for index in 0u16..240 {
        let surface = format!(
            "long lexical surface {index:04} whose raw words contain marker-like bits {}",
            "payload ".repeat(index as usize % 19 + 1)
        );
        let offsets = reader
            .lookup_surface("en", &surface)
            .expect("binary search");
        assert_eq!(offsets.len(), 1, "surface query {surface:?}");
        let entry = reader.read_entry_at(offsets[0]).expect("read by offset");
        assert!(!entry.is_empty());
        let key = [0x2000 + index];
        assert_eq!(
            entry,
            reader.read_entry(&key).expect("read by canonical key"),
            "offset lookup must return only entry {index}"
        );
    }
    assert!(
        reader
            .lookup_surface("en", "long lexical surface 9999 absent from the volume")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn canonical_ranges_end_at_the_next_entry_even_for_multicodelet_keys() {
    let keys = vec![vec![0x1000], vec![0x2000; 40], vec![0x3000]];
    let entries = keys
        .iter()
        .enumerate()
        .map(|(index, key)| {
            let surface = format!("entry {index} ");
            DictionaryVolumeEntry {
                key: key.clone(),
                lexical_forms: vec![LexicalForm {
                    language: "en".into(),
                    surface: surface.repeat((index + 1) * 20),
                    normalized: surface.repeat((index + 1) * 20),
                }],
                source_links: vec![],
                source_glosses: vec![],
                component_keys: vec![],
                task_keys: vec![],
                references: vec![],
                operation_signatures: vec![],
                definition: None,
            }
        })
        .collect();
    let volume = DictionaryVolume {
        metadata: DictionaryMetadata {
            kind: "test dictionary".into(),
            title: "canonical entry boundary test".into(),
            revision: 1,
            languages: vec!["en".into()],
            normalization_policy: "NFC".into(),
        },
        entries,
    };
    let bytes = encode_dictionary(&volume).expect("encode v4 volume");
    let mut reader = DictionaryFileReader::open(Cursor::new(bytes)).expect("open v4 volume");

    let ranges = keys
        .iter()
        .map(|key| reader.location(key).unwrap().expect("canonical key found"))
        .collect::<Vec<_>>();
    assert!(ranges.windows(2).all(|pair| pair[0].end == pair[1].start));
    for (key, range) in keys.iter().zip(ranges) {
        let by_key = reader.read_entry(key).expect("read entry by canonical key");
        let by_offset = reader
            .read_entry_at(range.start)
            .expect("read entry by secondary-index offset");
        assert_eq!(by_key.len(), (range.end - range.start) as usize);
        assert_eq!(by_offset, by_key);
    }
}

/// Every canonical entry must be readable back by its own key.
///
/// This is the regression guard for the `na` defect: the reader used to find the
/// end of a name subject by scanning for the SU word value, so any key whose
/// word *is* SU could not be read, and its neighbours in the same codelet group
/// failed with it. A sampled test missed it; walking the whole index cannot.
#[test]
fn every_canonical_entry_reads_back_by_its_own_key() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../program/library/dictionary/reference.pyac");
    let mut reader = DictionaryFileReader::open(
        File::open(path).expect("tracked reference dictionary is available"),
    )
    .expect("open reference dictionary by seeking");

    // Every key mentioned by the canonical index must read back. The index row
    // addresses an entry offset, so this covers the whole volume without
    // guessing entry boundaries.
    let keys = reader.canonical_keys().expect("enumerate canonical keys");
    assert!(
        keys.len() > 1_000,
        "the canonical index must list the whole vocabulary, saw {}",
        keys.len()
    );

    let mut failures: Vec<String> = Vec::new();
    for key in &keys {
        match reader.read_entry(key) {
            Ok(words) if !words.is_empty() => {}
            Ok(_) => failures.push(format!("key {key:x?} decoded as empty")),
            Err(error) => failures.push(format!("key {key:x?}: {error}")),
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} entries failed to read back: {:?}",
        failures.len(),
        keys.len(),
        &failures[..failures.len().min(10)]
    );
}

#[test]
fn published_reference_volume_indexes_the_promoted_sumo_concepts() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../program/library/dictionary/reference.pyac");
    let mut reader = DictionaryFileReader::open(
        File::open(path).expect("tracked reference dictionary is available"),
    )
    .expect("open reference dictionary by seeking");

    assert_eq!(reader.profile_version(), "pyac-vliw-dictionary/4");
    assert_eq!(reader.entry_count(), 64_595);
    let offsets = reader
        .lookup_surface("en", "map")
        .expect("scan reference surface index");
    assert!(!offsets.is_empty());
    assert!(
        offsets
            .iter()
            .all(|offset| *offset < reader.codelet_count())
    );

    // The SUMO concept links the sweep promoted are part of the volume, so a
    // concept that only the promoted catalog carries resolves here too.
    let sumo_release = "WordNet 3.0 mapping snapshot f0c126842d098a312e390479b38ecfbac018f8ed";
    for concept in ["AAA_Rating", "AariyaLanguage", "Love"] {
        let matches = reader
            .lookup_source("sumo", sumo_release, concept)
            .expect("look up a promoted SUMO concept");
        assert!(!matches.is_empty(), "the volume must index {concept}");
        assert!(
            matches
                .iter()
                .all(|offset| *offset < reader.codelet_count())
        );
    }
}

#[test]
fn published_reference_volume_indexes_current_iwsp_vocabulary() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../program/library/dictionary/reference.pyac");
    let mut reader = DictionaryFileReader::open(
        File::open(path).expect("tracked reference dictionary is available"),
    )
    .expect("open reference dictionary by seeking");

    let vocabulary: [(&[u16], &str); 10] = [
        (&[0xab44, 0xa9b2], "tensor"), // pset gjat
        (&[0xec4a, 0xa948], "lookup"), // tsoc hsat
        (&[0x2b73], "vector"),         // dlek
        (&[0xe90b], "learn"),          // lyac
        (&[0xaad3, 0xea30], "data"),   // drut hnuc
        (&[0xaaa2], "choose"),         // kcut
        (&[0xbc8a], "tot"),            // tfo2t
        (&[0x8928], "question"),       // hwas; reviewed IWSP query representation
        (&[0x8850, 0x2b48], "key"),    // htis hsek; attention-key label
        (&[0xea30, 0xa9b2], "value"),  // hnuc gjat; attention-value label
    ];

    for (key, surface) in vocabulary {
        let range = reader
            .location(key)
            .expect("search canonical Pyac key")
            .unwrap_or_else(|| panic!("reference volume must contain {surface}"));
        assert!(
            reader
                .lookup_surface("en", surface)
                .expect("search English surface")
                .contains(&range.start),
            "surface {surface} must resolve to its Pyac key"
        );
        assert!(
            !reader
                .read_entry(key)
                .expect("read the referenced entry")
                .is_empty(),
            "entry for {surface} must be readable"
        );
    }

    let query_range = reader
        .location(&[0x8928])
        .expect("search reviewed query atom")
        .expect("hwas entry exists");
    assert!(
        reader
            .lookup_surface("en", "query")
            .expect("search query lemma")
            .contains(&query_range.start),
        "WordNet lemma query must resolve to the reviewed hwas entry"
    );

    let wordnet_release = "Open English WordNet 2025";
    for (key, sense) in [
        (&[0xab44, 0xa9b2][..], "n:05873065-n"),
        (&[0xec4a, 0xa948][..], "n:13574763-n"),
        (&[0xaad3, 0xea30][..], "n:08479331-n"),
        (&[0x8928][..], "n:07208256-n"),
        (&[0x8850, 0x2b48][..], "n:05802065-n"),
        (&[0xea30, 0xa9b2][..], "n:05864972-n"),
    ] {
        let range = reader
            .location(key)
            .expect("search the source-linked Pyac key")
            .expect("source-linked Pyac key exists");
        assert!(
            reader
                .lookup_source("wordnet", wordnet_release, sense)
                .expect("search exact WordNet source")
                .contains(&range.start),
            "WordNet sense {sense} must index its Pyac entry"
        );
    }
}

#[test]
fn throughput_benchmark_runs_on_the_published_v4_volume() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../program/library/dictionary/reference.pyac");
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_pyac-dictionary"))
        .args([
            "benchmark",
            path.to_str().expect("dictionary path is UTF-8"),
            "100",
            "surface",
            "en",
            "map",
        ])
        .output()
        .expect("run dictionary CLI benchmark");

    assert!(
        output.status.success(),
        "benchmark failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}
