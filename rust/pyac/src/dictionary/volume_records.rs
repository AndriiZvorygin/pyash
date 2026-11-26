use super::operation::{OperationArgumentType, OperationSignature};
use super::volume::{DictionaryMetadata, DictionaryVolumeError};
use super::wire::{
    Field, Subject, Value, encode_index_sentence_v4, encode_sentence, encode_text_sentence,
};
use super::words::{
    KA_ACCUSATIVE, LWOH_LOCATIVE, MA_DESTINATION, MWAH_COMITATIVE, SO_SOURCE, SWIH_ESSIVE,
    YU_INSTRUMENTAL,
};
use super::{DictionaryEntry, DictionaryVolumeEntry};
use crate::WORDS_PER_CODELET;

pub(super) const PROFILE_SUBJECT: [u16; 2] = [0x680b, 0x6c22]; // lyin kwon: machine-readable dictionary.
pub(super) const CONTENTS_SUBJECT: [u16; 2] = [0x8893, 0x2c30]; // dvis hnok.
pub(super) const INDEX_SUBJECT: [u16; 2] = [0xa92b, 0x28ea]; // lwat txik.
pub(super) const PROFILE_VERSION_V2: &str = "pyac-vliw-dictionary/2";
pub(super) const PROFILE_VERSION_V3: &str = "pyac-vliw-dictionary/3";
pub(super) const PROFILE_VERSION: &str = "pyac-vliw-dictionary/4";
pub(super) const TOC_ROLES: [&str; 7] = [
    "metadata",
    "canonical-index",
    "surface-index",
    "source-index",
    "entry-location-index",
    "operation-signature-index",
    "entries",
];
pub(super) const TOC_ROLES_V4: [&str; 5] = [
    "canonical-index",
    "surface-index",
    "source-index",
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

pub(super) fn profile_records_v4(
    metadata: &DictionaryMetadata,
    entry_count: usize,
) -> Result<(Vec<[u16; WORDS_PER_CODELET]>, Vec<[u16; WORDS_PER_CODELET]>), DictionaryVolumeError> {
    let marker = sentence(
        PROFILE_SUBJECT.as_slice(),
        &[text_field(KA_ACCUSATIVE, &metadata.kind)],
    )?;
    let revision = [metadata.revision as u16, (metadata.revision >> 16) as u16];
    let languages = metadata.languages.join(",");
    let metadata_record = sentence(
        PROFILE_SUBJECT.as_slice(),
        &[
            text_field(KA_ACCUSATIVE, &metadata.title),
            vector_field(SWIH_ESSIVE, &revision),
            text_field(SO_SOURCE, &languages),
            text_field(MA_DESTINATION, &metadata.normalization_policy),
            Field {
                grammatical_case: YU_INSTRUMENTAL,
                value: Value::Uint16(TOC_ROLES_V4.len() as u16),
            },
            text_field(MWAH_COMITATIVE, PROFILE_VERSION),
            Field {
                grammatical_case: LWOH_LOCATIVE,
                value: Value::Uint32(
                    u32::try_from(entry_count)
                        .map_err(|_| DictionaryVolumeError::TooManyCodelets)?,
                ),
            },
        ],
    )?;
    Ok((marker, metadata_record))
}

pub(super) fn toc_records_v4(
    ranges: &[(usize, usize)],
) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryVolumeError> {
    if ranges.len() != TOC_ROLES_V4.len() {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "v4 TOC must declare all five fixed sections",
        ));
    }
    let mut output = Vec::new();
    for (ordinal, (start, count)) in ranges.iter().enumerate() {
        let words = range_pair(*start, *count)?;
        output.extend(sentence(
            CONTENTS_SUBJECT.as_slice(),
            &[
                Field {
                    grammatical_case: KA_ACCUSATIVE,
                    value: Value::Uint16(ordinal as u16),
                },
                vector_field(SO_SOURCE, &words),
            ],
        )?);
    }
    Ok(output)
}

pub(super) fn encode_entry_v4(
    entry: &DictionaryVolumeEntry,
) -> Result<EncodedEntry, DictionaryVolumeError> {
    if entry.key.is_empty() {
        return Err(DictionaryVolumeError::InvalidEntry("key must be non-empty"));
    }
    if let Some(definition) = &entry.definition {
        if definition.is_empty() {
            return Err(DictionaryVolumeError::InvalidEntry(
                "an authored definition cannot be empty; omit it instead",
            ));
        }
        if definition.last().is_none_or(|codelet| codelet[0] & 1 == 0) {
            return Err(DictionaryVolumeError::InvalidEntry(
                "definition ends in an incomplete codelet group",
            ));
        }
    }
    let key = &entry.key;
    let mut output = Vec::new();
    for form in &entry.lexical_forms {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[
                text_field(SWIH_ESSIVE, &form.language),
                text_field(SO_SOURCE, &form.surface),
                text_field(MA_DESTINATION, &form.normalized),
            ],
        )?);
    }
    for link in &entry.source_links {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[
                text_field(SWIH_ESSIVE, &link.dataset),
                text_field(SO_SOURCE, &link.release),
                text_field(MA_DESTINATION, &link.identifier),
                text_field(YU_INSTRUMENTAL, &link.relation),
            ],
        )?);
    }
    for gloss in &entry.source_glosses {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[
                text_field(SWIH_ESSIVE, &gloss.language),
                text_field(SO_SOURCE, &gloss.dataset),
                text_field(MA_DESTINATION, &gloss.release),
                text_field(YU_INSTRUMENTAL, &gloss.identifier),
                text_field(MWAH_COMITATIVE, &gloss.text),
            ],
        )?);
    }
    for component in &entry.component_keys {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[vector_field(SO_SOURCE, component)],
        )?);
    }
    for task in &entry.task_keys {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[vector_field(MWAH_COMITATIVE, task)],
        )?);
    }
    for reference in &entry.references {
        output.extend(encode_sentence(
            Subject::Name(key),
            &[vector_field(MA_DESTINATION, reference)],
        )?);
    }
    for signature in &entry.operation_signatures {
        let dispatch = signature_words(signature)?;
        output.extend(encode_sentence(
            Subject::Name(key),
            &[vector_field(YU_INSTRUMENTAL, &dispatch)],
        )?);
        for argument in &signature.arguments {
            let mut key_words = Vec::new();
            append_argument_type(&mut key_words, &argument.key)?;
            output.extend(encode_sentence(
                Subject::Name(key),
                &[
                    vector_field(SWIH_ESSIVE, &key_words),
                    text_field(SO_SOURCE, &argument.name),
                    text_field(MA_DESTINATION, &argument.description),
                ],
            )?);
        }
        for result in &signature.results {
            output.extend(encode_sentence(
                Subject::Name(key),
                &[
                    vector_field(SWIH_ESSIVE, &result.value_type),
                    text_field(YU_INSTRUMENTAL, &result.name),
                    text_field(MWAH_COMITATIVE, &result.description),
                ],
            )?);
        }
    }
    if let Some(definition) = &entry.definition {
        output.extend(definition.iter().copied());
    }
    if output.is_empty() {
        return Err(DictionaryVolumeError::InvalidEntry(
            "entry must contain at least one sentence",
        ));
    }
    let descriptor = DictionaryEntry {
        key: key.clone(),
        codelet_start: 0,
        codelet_count: u32::try_from(output.len())
            .map_err(|_| DictionaryVolumeError::TooManyCodelets)?,
        lexical_forms: entry.lexical_forms.clone(),
        source_links: entry.source_links.clone(),
        task_keys: entry.task_keys.clone(),
        references: entry.references.clone(),
        operation_signatures: entry.operation_signatures.clone(),
    };
    Ok(EncodedEntry {
        entry: descriptor,
        codelets: output,
    })
}

pub(super) fn index_records_v4(
    entries: &[DictionaryVolumeEntry],
    entry_offsets: &[u32],
) -> Result<Vec<Vec<[u16; WORDS_PER_CODELET]>>, DictionaryVolumeError> {
    if entries.len() != entry_offsets.len() {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "entry offset count does not match entries",
        ));
    }
    let mut canonical = Vec::new();
    let mut surface_rows = Vec::new();
    let mut source_rows = Vec::new();
    let mut operation_rows = Vec::new();
    for (entry, offset) in entries.iter().zip(entry_offsets.iter().copied()) {
        canonical.extend(encode_index_sentence_v4(
            Subject::Name(&entry.key),
            &[Field {
                grammatical_case: LWOH_LOCATIVE,
                value: Value::Uint32(offset),
            }],
        )?);
        for form in &entry.lexical_forms {
            surface_rows.push((
                form.normalized.encode_utf16().collect::<Vec<_>>(),
                form.language.as_str(),
                offset,
            ));
        }
        for link in &entry.source_links {
            source_rows.push((
                link.identifier.as_str(),
                link.dataset.as_str(),
                link.release.as_str(),
                offset,
            ));
        }
        for signature in &entry.operation_signatures {
            operation_rows.push((signature_words(signature)?, offset));
        }
    }
    surface_rows.sort_unstable_by(|left, right| {
        (&left.0, left.1, left.2).cmp(&(&right.0, right.1, right.2))
    });
    surface_rows.dedup();
    source_rows.sort_unstable();
    source_rows.dedup();
    operation_rows.sort_unstable();
    operation_rows.dedup();

    let mut surfaces = Vec::new();
    let mut cursor = 0;
    while cursor < surface_rows.len() {
        let end = surface_rows[cursor..]
            .iter()
            .position(|row| row.0 != surface_rows[cursor].0 || row.1 != surface_rows[cursor].1)
            .map_or(surface_rows.len(), |delta| cursor + delta);
        let surface = String::from_utf16(&surface_rows[cursor].0)
            .map_err(|_| DictionaryVolumeError::InvalidEntry("surface is invalid UTF-16"))?;
        let language = surface_rows[cursor].1;
        let offsets = surface_rows[cursor..end]
            .iter()
            .map(|row| row.2)
            .collect::<Vec<_>>();
        surfaces.extend(encode_index_sentence_v4(
            Subject::Text(&surface),
            &[text_field(SWIH_ESSIVE, language), offsets_field(&offsets)],
        )?);
        cursor = end;
    }

    let mut sources = Vec::new();
    cursor = 0;
    while cursor < source_rows.len() {
        let end = source_rows[cursor..]
            .iter()
            .position(|row| {
                row.0 != source_rows[cursor].0
                    || row.1 != source_rows[cursor].1
                    || row.2 != source_rows[cursor].2
            })
            .map_or(source_rows.len(), |delta| cursor + delta);
        let identifier = source_rows[cursor].0;
        let dataset = source_rows[cursor].1;
        let release = source_rows[cursor].2;
        let offsets = source_rows[cursor..end]
            .iter()
            .map(|row| row.3)
            .collect::<Vec<_>>();
        sources.extend(encode_index_sentence_v4(
            Subject::Text(identifier),
            &[
                text_field(SWIH_ESSIVE, dataset),
                text_field(SO_SOURCE, release),
                offsets_field(&offsets),
            ],
        )?);
        cursor = end;
    }

    let mut operations = Vec::new();
    cursor = 0;
    while cursor < operation_rows.len() {
        let end = operation_rows[cursor..]
            .iter()
            .position(|row| row.0 != operation_rows[cursor].0)
            .map_or(operation_rows.len(), |delta| cursor + delta);
        let signature = &operation_rows[cursor].0;
        let offsets = operation_rows[cursor..end]
            .iter()
            .map(|row| row.1)
            .collect::<Vec<_>>();
        operations.extend(encode_index_sentence_v4(
            Subject::Uint16Vector(signature),
            &[offsets_field(&offsets)],
        )?);
        cursor = end;
    }
    Ok(vec![canonical, surfaces, sources, operations])
}

fn offsets_field(offsets: &[u32]) -> Field<'_> {
    if offsets.len() == 1 {
        Field {
            grammatical_case: LWOH_LOCATIVE,
            value: Value::Uint32(offsets[0]),
        }
    } else {
        Field {
            grammatical_case: LWOH_LOCATIVE,
            value: Value::Uint32Vector(offsets),
        }
    }
}
