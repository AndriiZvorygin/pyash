use std::io::Cursor;

use pyac::dictionary::{
    DictionaryField, DictionaryFileReader, DictionaryMetadata, DictionaryValue, DictionaryVolume,
    DictionaryVolumeEntry, LexicalForm, OperationArgument, OperationArgumentType,
    OperationSignature, OperationSignatureKey, SourceLink, encode_dictionary, encode_text_sentence,
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
            definition,
        }],
    }
}

#[test]
fn writer_emits_reproducible_pack_and_seek_reader_reads_entry_on_demand() {
    let volume = sample_volume();
    let bytes = encode_dictionary(&volume).expect("encode volume");
    assert_eq!(bytes, encode_dictionary(&volume).expect("repeat encoding"));

    let mut reader = DictionaryFileReader::open(Cursor::new(bytes.clone())).expect("open volume");
    assert_eq!(reader.metadata().kind, "English Pyash dictionary");
    assert_eq!(reader.metadata().title, volume.metadata.title);
    assert_eq!(reader.metadata().revision, volume.metadata.revision);
    assert_eq!(reader.metadata().languages, ["en"]);
    assert_eq!(reader.metadata().normalization_policy, "NFC");
    assert_eq!(reader.sections().len(), 7);
    assert_eq!(reader.sections()[4].role, "entry-location-index");

    let range = reader.location(&ENTRY_KEY).expect("entry location posting");
    let entry = reader
        .read_entry(&ENTRY_KEY)
        .expect("read only matching range");
    assert_eq!(entry.len(), (range.end - range.start) as usize);
    let definition_range = reader
        .definition_location(&ENTRY_KEY)
        .expect("definition range");
    assert!(definition_range.start >= range.start);
    assert!(definition_range.end <= range.end);
    assert_eq!(
        reader.read_definition(&ENTRY_KEY).expect("read definition"),
        volume.entries[0].definition
    );
    assert_eq!(reader.read_section("entries").unwrap().len(), entry.len());
    assert_eq!(reader.location(&[0xffff]), None);
    assert_eq!(
        reader.lookup_surface("en", "Dictionary"),
        [ENTRY_KEY.to_vec()]
    );
    assert!(reader.lookup_surface("en", "dictionary").is_empty());
    assert_eq!(
        reader.lookup_surface("en", "cafe\u{301}"),
        [ENTRY_KEY.to_vec()]
    );
    let source = reader.lookup_source("wordnet", "OEWN 2025", "n:06311813-n");
    assert_eq!(source.len(), 1);
    assert_eq!(source[0].key, ENTRY_KEY);
    assert_eq!(source[0].relation, "exact-sense");
    let signature = OperationSignatureKey::new(
        vec![0x1111],
        vec![0x217e],
        vec![OperationArgumentType {
            grammatical_case: vec![0x245e],
            value_type: vec![0x0e1d],
        }],
    );
    assert_eq!(
        reader.lookup_operation_signature(&signature),
        [ENTRY_KEY.to_vec()]
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
