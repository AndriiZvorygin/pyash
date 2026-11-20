use super::operation::{OperationArgumentType, OperationSignature, OperationSignatureKey};
use super::volume::{DictionaryMetadata, DictionaryVolumeError};
use super::wire::{AS, AT, BY, FROM, Field, OB, TO, Value, WITH, encode_text_sentence};
use super::{DictionaryEntry, DictionaryVolumeEntry};
use crate::WORDS_PER_CODELET;

pub(super) const PROFILE_SUBJECT: [u16; 2] = [0x680b, 0x6c22]; // lyin kwon: machine-readable dictionary.
pub(super) const CONTENTS_SUBJECT: [u16; 2] = [0x8893, 0x2c30]; // dvis hnok.
pub(super) const INDEX_SUBJECT: [u16; 2] = [0xa92b, 0x28ea]; // lwat txik.
pub(super) const ENTRY_SUBJECT: [u16; 2] = [0xa96a, 0x6c22]; // tlat kwon.
pub(super) const PROFILE_VERSION: &str = "pyac-vliw-dictionary/2";
pub(super) const TOC_ROLES: [&str; 7] = [
    "metadata",
    "canonical-index",
    "surface-index",
    "source-index",
    "entry-location-index",
    "operation-signature-index",
    "entries",
];
#[derive(Clone)]
pub(super) struct EncodedEntry {
    pub(super) entry: DictionaryEntry,
    pub(super) codelets: Vec<[u16; WORDS_PER_CODELET]>,
}

fn sentence(
    subject: &[u16],
    fields: &[Field<'_>],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryVolumeError> {
    Ok(encode_text_sentence(subject, fields)?)
}

fn text_field(case: u16, value: &str) -> Field<'_> {
    Field {
        grammatical_case: case,
        value: Value::Text(value),
    }
}

fn vector_field(case: u16, value: &[u16]) -> Field<'_> {
    Field {
        grammatical_case: case,
        value: Value::Uint16Vector(value),
    }
}

fn range_words(start: usize, count: usize) -> Result<[u16; 4], DictionaryVolumeError> {
    let start = u32::try_from(start).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
    let count = u32::try_from(count).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
    Ok([
        start as u16,
        (start >> 16) as u16,
        count as u16,
        (count >> 16) as u16,
    ])
}

pub(super) fn range_pair(start: usize, count: usize) -> Result<[u16; 4], DictionaryVolumeError> {
    range_words(start, count)
}

fn signature_words(signature: &OperationSignature) -> Result<Vec<u16>, DictionaryVolumeError> {
    let mut words = Vec::new();
    append_sequence(&mut words, &signature.verb)?;
    append_sequence(&mut words, &signature.mood)?;
    let count = u16::try_from(signature.arguments.len())
        .map_err(|_| DictionaryVolumeError::InvalidEntry("too many operation arguments"))?;
    words.push(count);
    for argument in &signature.arguments {
        append_argument_type(&mut words, &argument.key)?;
    }
    Ok(words)
}

fn append_sequence(output: &mut Vec<u16>, words: &[u16]) -> Result<(), DictionaryVolumeError> {
    output.push(u16::try_from(words.len()).map_err(|_| {
        DictionaryVolumeError::InvalidEntry("operation signature component exceeds 65535 words")
    })?);
    output.extend(words);
    Ok(())
}

fn append_argument_type(
    output: &mut Vec<u16>,
    key: &OperationArgumentType,
) -> Result<(), DictionaryVolumeError> {
    append_sequence(output, &key.grammatical_case)?;
    append_sequence(output, &key.value_type)
}

pub(super) fn profile_records(
    metadata: &DictionaryMetadata,
) -> Result<(Vec<[u16; WORDS_PER_CODELET]>, Vec<[u16; WORDS_PER_CODELET]>), DictionaryVolumeError> {
    let marker = sentence(
        PROFILE_SUBJECT.as_slice(),
        &[text_field(OB, &metadata.kind)],
    )?;
    let revision = [metadata.revision as u16, (metadata.revision >> 16) as u16];
    let languages = metadata.languages.join(",");
    let metadata_record = sentence(
        PROFILE_SUBJECT.as_slice(),
        &[
            text_field(OB, &metadata.title),
            vector_field(AS, &revision),
            text_field(FROM, &languages),
            text_field(TO, &metadata.normalization_policy),
            Field {
                grammatical_case: BY,
                value: Value::Uint16(TOC_ROLES.len() as u16),
            },
            text_field(WITH, PROFILE_VERSION),
        ],
    )?;
    Ok((marker, metadata_record))
}

pub(super) fn toc_records(
    ranges: &[(usize, usize)],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryVolumeError> {
    let mut output = Vec::new();
    for (role, (start, count)) in TOC_ROLES.iter().zip(ranges) {
        let words = range_pair(*start, *count)?;
        output.extend(sentence(
            CONTENTS_SUBJECT.as_slice(),
            &[text_field(OB, role), vector_field(FROM, &words)],
        )?);
    }
    Ok(output)
}

pub(super) fn encode_entry(
    entry: &DictionaryVolumeEntry,
    range: [u16; 4],
) -> Result<EncodedEntry, DictionaryVolumeError> {
    if entry.key.is_empty() || entry.definition.is_empty() {
        return Err(DictionaryVolumeError::InvalidEntry(
            "key and definition must be non-empty",
        ));
    }
    if entry
        .definition
        .last()
        .is_none_or(|codelet| codelet[0] & 1 == 0)
    {
        return Err(DictionaryVolumeError::InvalidEntry(
            "definition ends in an incomplete codelet group",
        ));
    }
    let key = &entry.key;
    let mut output = sentence(
        ENTRY_SUBJECT.as_slice(),
        &[vector_field(OB, key), vector_field(AT, &range)],
    )?;
    for form in &entry.lexical_forms {
        output.extend(sentence(
            ENTRY_SUBJECT.as_slice(),
            &[
                vector_field(OB, key),
                text_field(AS, &form.language),
                text_field(FROM, &form.surface),
                text_field(TO, &form.normalized),
                text_field(AT, "lexical-form"),
            ],
        )?);
    }
    for link in &entry.source_links {
        output.extend(sentence(
            ENTRY_SUBJECT.as_slice(),
            &[
                vector_field(OB, key),
                text_field(AS, &link.dataset),
                text_field(FROM, &link.release),
                text_field(TO, &link.identifier),
                text_field(BY, &link.relation),
                text_field(AT, "source-link"),
            ],
        )?);
    }
    for task in &entry.task_keys {
        output.extend(sentence(
            ENTRY_SUBJECT.as_slice(),
            &[
                vector_field(OB, key),
                vector_field(WITH, task),
                text_field(AT, "task"),
            ],
        )?);
    }
    for reference in &entry.references {
        output.extend(sentence(
            ENTRY_SUBJECT.as_slice(),
            &[
                vector_field(OB, key),
                vector_field(TO, reference),
                text_field(AT, "reference"),
            ],
        )?);
    }
    for signature in &entry.operation_signatures {
        let dispatch = signature_words(signature)?;
        output.extend(sentence(
            ENTRY_SUBJECT.as_slice(),
            &[
                vector_field(OB, key),
                vector_field(FROM, &dispatch),
                text_field(AT, "operation-signature"),
            ],
        )?);
        for argument in &signature.arguments {
            let mut key_words = Vec::new();
            append_argument_type(&mut key_words, &argument.key)?;
            output.extend(sentence(
                ENTRY_SUBJECT.as_slice(),
                &[
                    vector_field(OB, key),
                    vector_field(AS, &key_words),
                    text_field(FROM, &argument.name),
                    text_field(TO, &argument.description),
                    text_field(AT, "operation-argument"),
                ],
            )?);
        }
        for result in &signature.results {
            output.extend(sentence(
                ENTRY_SUBJECT.as_slice(),
                &[
                    vector_field(OB, key),
                    vector_field(AS, &result.value_type),
                    text_field(FROM, &result.name),
                    text_field(TO, &result.description),
                    text_field(AT, "operation-result"),
                ],
            )?);
        }
    }
    output.extend(entry.definition.iter().copied());
    let mut descriptor = DictionaryEntry {
        key: key.clone(),
        codelet_start: 0,
        codelet_count: 0,
        lexical_forms: entry.lexical_forms.clone(),
        source_links: entry.source_links.clone(),
        task_keys: entry.task_keys.clone(),
        references: entry.references.clone(),
        operation_signatures: entry.operation_signatures.clone(),
    };
    descriptor.codelet_count =
        u32::try_from(output.len()).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
    Ok(EncodedEntry {
        entry: descriptor,
        codelets: output,
    })
}

pub(super) fn index_records(
    entries: &[DictionaryVolumeEntry],
    entry_ranges: &[[u16; 4]],
) -> Result<Vec<Vec<[u16; WORDS_PER_CODELET]>>, DictionaryVolumeError> {
    let mut canonical = Vec::new();
    let mut surfaces = Vec::new();
    let mut sources = Vec::new();
    let mut locations = Vec::new();
    let mut operations = Vec::new();
    let mut surface_rows = Vec::new();
    let mut source_rows = Vec::new();
    let mut operation_rows: Vec<(OperationSignatureKey, Vec<u16>, &[u16])> = Vec::new();
    for (entry, location) in entries.iter().zip(entry_ranges) {
        canonical.extend(sentence(
            INDEX_SUBJECT.as_slice(),
            &[
                text_field(OB, "canonical"),
                vector_field(FROM, &entry.key),
                vector_field(TO, &entry.key),
            ],
        )?);
        let entry_start = location[0] as usize | ((location[1] as usize) << 16);
        let entry_count = location[2] as usize | ((location[3] as usize) << 16);
        let definition_start = entry_start
            .checked_add(entry_count.saturating_sub(entry.definition.len()))
            .ok_or(DictionaryVolumeError::TooManyCodelets)?;
        let definition_range = range_pair(definition_start, entry.definition.len())?;
        locations.extend(sentence(
            INDEX_SUBJECT.as_slice(),
            &[
                text_field(OB, "entry-location"),
                vector_field(FROM, &entry.key),
                vector_field(TO, location),
                vector_field(WITH, &definition_range),
            ],
        )?);
        for form in &entry.lexical_forms {
            surface_rows.push((
                form.language.as_str(),
                form.normalized.as_str(),
                entry.key.as_slice(),
            ));
        }
        for link in &entry.source_links {
            source_rows.push((
                link.dataset.as_str(),
                link.release.as_str(),
                link.identifier.as_str(),
                entry.key.as_slice(),
                link.relation.as_str(),
            ));
        }
        for signature in &entry.operation_signatures {
            let key = OperationSignatureKey::new(
                signature.verb.clone(),
                signature.mood.clone(),
                signature
                    .arguments
                    .iter()
                    .map(|argument| argument.key.clone())
                    .collect(),
            );
            operation_rows.push((key, signature_words(signature)?, entry.key.as_slice()));
        }
    }
    surface_rows.sort_unstable();
    surface_rows.dedup();
    source_rows.sort_unstable();
    operation_rows.sort_unstable_by(|left, right| (&left.0, left.2).cmp(&(&right.0, right.2)));
    operation_rows.dedup_by(|left, right| left.0 == right.0 && left.2 == right.2);
    for (language, normalized, key) in surface_rows {
        surfaces.extend(sentence(
            INDEX_SUBJECT.as_slice(),
            &[
                text_field(OB, "language-surface"),
                text_field(AS, language),
                text_field(FROM, normalized),
                vector_field(TO, key),
            ],
        )?);
    }
    for (dataset, release, identifier, key, relation) in source_rows {
        sources.extend(sentence(
            INDEX_SUBJECT.as_slice(),
            &[
                text_field(OB, "external-source"),
                text_field(AS, dataset),
                text_field(FROM, release),
                text_field(TO, identifier),
                vector_field(BY, key),
                text_field(WITH, relation),
            ],
        )?);
    }
    for (_, dispatch, key) in operation_rows {
        operations.extend(sentence(
            INDEX_SUBJECT.as_slice(),
            &[
                text_field(OB, "operation-signature"),
                vector_field(FROM, &dispatch),
                vector_field(TO, key),
            ],
        )?);
    }
    Ok(vec![canonical, surfaces, sources, locations, operations])
}
