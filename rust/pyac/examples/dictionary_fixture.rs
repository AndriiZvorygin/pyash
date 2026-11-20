use std::io::{self, Write};

use pyac::dictionary::{
    DictionaryField, DictionaryMetadata, DictionaryValue, DictionaryVolume, DictionaryVolumeEntry,
    LexicalForm, SourceLink, encode_dictionary, encode_text_sentence,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = [0xa96a, 0x6c22]; // tlat kwon
    let definition = encode_text_sentence(
        &key,
        &[DictionaryField {
            grammatical_case: 0x245e,
            value: DictionaryValue::Text("A dictionary entry definition."),
        }],
    )?;
    let volume = DictionaryVolume {
        metadata: DictionaryMetadata {
            kind: "English Pyash dictionary".into(),
            title: "Fixture volume".into(),
            revision: 1,
            languages: vec!["en".into()],
            normalization_policy: "NFC".into(),
        },
        entries: vec![DictionaryVolumeEntry {
            key: key.to_vec(),
            lexical_forms: vec![LexicalForm {
                language: "en".into(),
                surface: "dictionary".into(),
                normalized: "dictionary".into(),
            }],
            source_links: vec![SourceLink {
                dataset: "wordnet".into(),
                release: "OEWN 2025".into(),
                identifier: "n:06311813-n".into(),
                relation: "exact-sense".into(),
            }],
            task_keys: vec![],
            references: vec![],
            operation_signatures: vec![],
            definition,
        }],
    };
    io::stdout()
        .lock()
        .write_all(&encode_dictionary(&volume)?)?;
    Ok(())
}
