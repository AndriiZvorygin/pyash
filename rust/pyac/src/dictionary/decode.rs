//! Reverse of `encode_dictionary`: read a volume back into the editable model.
//!
//! The encoder emits, for each entry, a run of sentences of the form
//! `subject <value> <case> …`. Values precede their case words, so decoding is
//! positional: read a value, then assert the case word that follows it. The
//! record kind falls out of how many fields the sentence has and what type each
//! carries, which is exactly what the encoder varied.
//!
//! Authored definitions are the one thing not reconstructed. Their codelets are
//! already lowered and the encoder copies them verbatim, so a sentence that
//! belongs to a definition is copied back verbatim too. Re-lowering it would not
//! be the inverse.
//!
//! `decode_dictionary` is only trustworthy if `encode_dictionary` reproduces the
//! input bytes. `tests/dictionary_roundtrip.rs` asserts that; do not build an
//! edit command on this without it passing, because a lossy decode corrupts
//! every entry it touches and reports success.

use std::io::{Read, Seek};

use super::operation::{ArgumentSlot, OperationArgument, OperationResult, OperationSignature};
use super::reader::DictionaryFileReader;
use super::reader_codec::{
    Sentence, expect_end, take_record_subject, take_text,
    take_uint32, take_vector,
};
use super::volume::{
    DictionaryMetadata, DictionaryVolume, DictionaryVolumeEntry, DictionaryVolumeError,
};
use crate::WORDS_PER_CODELET;
use super::words::{
    DESTINATION, COMITATIVE, SOURCE, ESSIVE, INSTRUMENTAL,
};

/// Read every entry of a v4 volume into the editable model.
pub fn decode_dictionary<R: Read + Seek>(
    source: R,
) -> Result<DictionaryVolume, DictionaryVolumeError> {
    let mut reader = DictionaryFileReader::open(source)
        .map_err(|error| fail(error.to_string()))?;
    if reader.profile_version() != super::volume_records::PROFILE_VERSION {
        return Err(DictionaryVolumeError::InvalidEntry(
            "decode requires a pyac-vliw-dictionary/4 volume",
        ));
    }
    let metadata = DictionaryMetadata {
        kind: reader.metadata().kind.clone(),
        title: reader.metadata().title.clone(),
        revision: reader.metadata().revision,
        languages: reader.metadata().languages.clone(),
        normalization_policy: reader.metadata().normalization_policy.clone(),
    };
    let keys = reader.canonical_keys().map_err(|error| fail(error.to_string()))?;

    let mut entries = Vec::with_capacity(keys.len());
    for key in keys {
        let codelets = reader
            .read_entry(&key)
            .map_err(|error| fail(error.to_string()))?;
        let sentences = reader
            .entry_sentences(&key)
            .map_err(|error| fail(error.to_string()))?;
        entries.push(decode_entry(&key, &codelets, &sentences)?);
    }
    Ok(DictionaryVolume { metadata, entries })
}

/// `DictionaryVolumeError` carries `&'static str` but reader errors are dynamic.
/// Decode failures are terminal — the caller reports and exits — so leaking the
/// message once is acceptable and keeps the public error type unchanged.
fn fail(message: String) -> DictionaryVolumeError {
    DictionaryVolumeError::InvalidEntry(Box::leak(message.into_boxed_str()))
}

/// One field of a record: a value and the case word that names its role.
pub(super) enum Field {
    Text(u16, String),
    Vector(u16, Vec<u16>),
    Uint32(u16, #[allow(dead_code)] u32),
}

impl Field {
    fn case(&self) -> u16 {
        match self {
            Field::Text(case, _) | Field::Vector(case, _) | Field::Uint32(case, _) => *case,
        }
    }
}

fn decode_entry(
    key: &[u16],
    codelets: &[[u16; WORDS_PER_CODELET]],
    sentences: &[Sentence],
) -> Result<DictionaryVolumeEntry, DictionaryVolumeError> {
    let mut entry = DictionaryVolumeEntry {
        key: key.to_vec(),
        lexical_forms: Vec::new(),
        source_links: Vec::new(),
        source_glosses: Vec::new(),
        component_keys: Vec::new(),
        task_keys: Vec::new(),
        references: Vec::new(),
        operation_signatures: Vec::new(),
        definition: None,
    };
    let mut definition: Vec<[u16; WORDS_PER_CODELET]> = Vec::new();
    // Arguments and results attach to the signature that precedes them, exactly
    // as the encoder emits them.
    let mut pending_signature = false;
    let mut codelet_offset = 0usize;

    for sentence in sentences {
        // A definition is already-lowered ordinary Pyash, not a `gi`-subject
        // record. Copy its codelets verbatim instead of parsing them as a record
        // — re-lowering would not be the inverse of copying.
        let span = codelet_offset..codelet_offset + sentence.consumed as usize;
        codelet_offset = span.end;
        if !is_record_sentence(sentence) {
            definition.extend_from_slice(&codelets[span]);
            continue;
        }
        let fields = read_fields(sentence)?;
        let cases: Vec<u16> = fields.iter().map(Field::case).collect();
        match (cases.as_slice(), fields.as_slice()) {
            ([ESSIVE, SOURCE, DESTINATION], [Field::Text(_, language), Field::Text(_, surface), Field::Text(_, normalized)]) => {
                entry.lexical_forms.push(super::model::LexicalForm {
                    language: language.clone(),
                    surface: surface.clone(),
                    normalized: normalized.clone(),
                });
            }
            ([ESSIVE, SOURCE, DESTINATION, INSTRUMENTAL], [Field::Text(_, dataset), Field::Text(_, release), Field::Text(_, identifier), Field::Text(_, relation)]) => {
                entry.source_links.push(super::model::SourceLink {
                    dataset: dataset.clone(),
                    release: release.clone(),
                    identifier: identifier.clone(),
                    relation: relation.clone(),
                });
            }
            ([ESSIVE, SOURCE, DESTINATION, INSTRUMENTAL, COMITATIVE], [Field::Text(_, language), Field::Text(_, dataset), Field::Text(_, release), Field::Text(_, identifier), Field::Text(_, text)]) => {
                entry.source_glosses.push(super::model::SourceGloss {
                    language: language.clone(),
                    text: text.clone(),
                    dataset: dataset.clone(),
                    release: release.clone(),
                    identifier: identifier.clone(),
                });
            }
            ([SOURCE], [Field::Vector(_, component)]) => {
                entry.component_keys.push(component.clone());
            }
            ([COMITATIVE], [Field::Vector(_, task)]) => {
                entry.task_keys.push(task.clone());
            }
            ([DESTINATION], [Field::Vector(_, reference)]) => {
                entry.references.push(reference.clone());
            }
            ([INSTRUMENTAL], [Field::Vector(_, dispatch)]) => {
                entry.operation_signatures.push(decode_signature(dispatch)?);
                pending_signature = true;
            }
            ([ESSIVE, SOURCE, DESTINATION], [Field::Vector(_, slot), Field::Text(_, label), Field::Text(_, description)]) => {
                if !pending_signature {
                    return Err(DictionaryVolumeError::InvalidEntry(
                        "operation argument precedes its signature",
                    ));
                }
                let case_type = decode_slot(slot)?;
                entry
                    .operation_signatures
                    .last_mut()
                    .expect("signature present")
                    .arguments
                    .push(OperationArgument {
                        case_type,
                        label: label.clone(),
                        description: description.clone(),
                    });
            }
            ([ESSIVE, DESTINATION, COMITATIVE], [Field::Vector(_, noun_class), Field::Text(_, label), Field::Text(_, description)]) => {
                if !pending_signature {
                    return Err(DictionaryVolumeError::InvalidEntry(
                        "operation result precedes its signature",
                    ));
                }
                entry
                    .operation_signatures
                    .last_mut()
                    .expect("signature present")
                    .results
                    .push(OperationResult {
                        noun_class: noun_class.clone(),
                        label: label.clone(),
                        description: description.clone(),
                    });
            }
            _ => {
                return Err(DictionaryVolumeError::InvalidEntry(
                    "entry sentence does not match any record shape",
                ));
            }
        }
    }
    if !definition.is_empty() {
        entry.definition = Some(definition);
    }
    Ok(entry)
}

/// Whether a sentence is a `gi`-subject dictionary record rather than part of an
/// authored definition. Definitions are ordinary lowered Pyash and may start
/// with any subject word, so the only reliable test is the record subject.
pub(super) fn is_record_sentence(sentence: &Sentence) -> bool {
    sentence.words.first() == Some(&super::words::NAME_MARKER)
}

/// Read every `value, case` pair in a sentence, after the subject.
///
/// The layout the encoder writes is: subject, `na`, then a value followed by the
/// case word that names it, repeated, then the verb `hwus` and the mood `li`.
/// The trailing verb and mood are not fields, so stop before them.
pub(super) fn read_fields(sentence: &Sentence) -> Result<Vec<Field>, DictionaryVolumeError> {
    let words = &sentence.words;
    let mut cursor = 0;
    take_record_subject(sentence, &mut cursor).map_err(|error| fail(error.to_string()))?;
    // `take_record_subject` already consumes the subject's closing `na`.
    let mut fields = Vec::new();
    loop {
        let Some(next) = words.get(cursor).copied() else {
            return Err(fail("record has no closing verb".to_owned()));
        };
        // The closing pair is the text verb then the realis mood.
        if next == super::words::TEXT_VERB {
            break;
        }
        let value = read_value(words, &mut cursor)?;
        let case = *words
            .get(cursor)
            .ok_or_else(|| fail("record field has no case word".to_owned()))?;
        cursor += 1;
        fields.push(match value {
            Value::Text(text) => Field::Text(case, text),
            Value::Vector(vector) => Field::Vector(case, vector),
            Value::Uint32(number) => Field::Uint32(case, number),
        });
    }
    // `expect_end` already consumes the closing verb (`hwus`) and mood (`li`),
    // then requires the cursor to be at the end. Consuming them here first was
    // the bug: it read past both and then reported "end of sentence".
    expect_end(words, &mut cursor)
        .map_err(|error| fail(format!("{error}; record was {words:04x?}")))?;
    Ok(fields)
}

enum Value {
    Text(String),
    Vector(Vec<u16>),
    Uint32(u32),
}

fn read_value(words: &[u16], cursor: &mut usize) -> Result<Value, DictionaryVolumeError> {
    let header = *words
        .get(*cursor)
        .ok_or_else(|| fail("record field is truncated".to_owned()))?;
    // A text literal is its own header word; a uint16 vector is a quote header
    // with sort 4 and two-byte scalars; anything else is a plain uint32 quote.
    // Deciding from the header keeps the readers as the only validators.
    if header == super::words::TEXT_QUOTE {
        return take_text(words, cursor)
            .map(Value::Text)
            .map_err(|error| fail(error.to_string()));
    }
    let quote = crate::literal::decode_quote_header(header);
    let is_uint16_vector = quote
        .is_some_and(|item| item.sort == 4 && item.scalar_bytes == 2);
    if is_uint16_vector {
        return take_vector(words, cursor)
            .map(Value::Vector)
            .map_err(|error| fail(error.to_string()));
    }
    take_uint32(words, cursor)
        .map(Value::Uint32)
        .map_err(|error| fail(error.to_string()))
}

fn decode_signature(dispatch: &[u16]) -> Result<OperationSignature, DictionaryVolumeError> {
    let mut cursor = 0;
    let verb = take_sequence(dispatch, &mut cursor)?;
    let mood = take_sequence(dispatch, &mut cursor)?;
    let count = *dispatch
        .get(cursor)
        .ok_or_else(|| fail("signature has no argument count".to_owned()))?
        as usize;
    cursor += 1;
    let mut arguments = Vec::with_capacity(count);
    for _ in 0..count {
        let case = take_sequence(dispatch, &mut cursor)?;
        let noun_class = take_sequence(dispatch, &mut cursor)?;
        arguments.push(OperationArgument {
            case_type: ArgumentSlot {
                grammatical_case: case,
                noun_class,
            },
            label: String::new(),
            description: String::new(),
        });
    }
    if cursor != dispatch.len() {
        return Err(DictionaryVolumeError::InvalidEntry(
            "operation signature dispatch has trailing words",
        ));
    }
    Ok(OperationSignature {
        verb,
        mood,
        arguments,
        results: Vec::new(),
    })
}

/// An argument's descriptor packs the case sequence then the noun-class sequence,
/// each length-prefixed.
fn decode_slot(slot: &[u16]) -> Result<ArgumentSlot, DictionaryVolumeError> {
    let mut cursor = 0;
    let grammatical_case = take_sequence(slot, &mut cursor)?;
    let noun_class = take_sequence(slot, &mut cursor)?;
    if cursor != slot.len() {
        return Err(DictionaryVolumeError::InvalidEntry(
            "operation argument descriptor has trailing words",
        ));
    }
    Ok(ArgumentSlot {
        grammatical_case,
        noun_class,
    })
}

fn take_sequence(
    words: &[u16],
    cursor: &mut usize,
) -> Result<Vec<u16>, DictionaryVolumeError> {
    let count = *words
        .get(*cursor)
        .ok_or_else(|| fail("sequence has no length prefix".to_owned()))?
        as usize;
    *cursor += 1;
    let end = cursor
        .checked_add(count)
        .ok_or_else(|| fail("sequence length overflows".to_owned()))?;
    let values = words
        .get(*cursor..end)
        .ok_or_else(|| fail("sequence is truncated".to_owned()))?
        .to_vec();
    *cursor = end;
    Ok(values)
}
