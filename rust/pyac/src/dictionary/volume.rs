use std::fmt::{Display, Formatter};

use super::operation::OperationSignature;
use super::volume_records::{
    TOC_ROLES, encode_entry, index_records, profile_records, range_pair, toc_records,
};
use super::{DictionaryIndex, DictionaryIndexError, LexicalForm, SourceLink};
use crate::{PyacError, WORDS_PER_CODELET, encode_pack};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionaryMetadata {
    /// Human-readable dictionary kind placed in the profile marker's `ob` case.
    pub kind: String,
    pub title: String,
    pub revision: u32,
    pub languages: Vec<String>,
    pub normalization_policy: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionaryVolumeEntry {
    pub key: Vec<u16>,
    pub lexical_forms: Vec<LexicalForm>,
    pub source_links: Vec<SourceLink>,
    pub task_keys: Vec<Vec<u16>>,
    pub references: Vec<Vec<u16>>,
    pub operation_signatures: Vec<OperationSignature>,
    /// Already-lowered ordinary Pyash sentence codelets; copied without reinterpretation.
    pub definition: Vec<[u16; WORDS_PER_CODELET]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionaryVolume {
    pub metadata: DictionaryMetadata,
    pub entries: Vec<DictionaryVolumeEntry>,
}

#[derive(Debug)]
pub enum DictionaryVolumeError {
    InvalidMetadata(&'static str),
    InvalidEntry(&'static str),
    TooManyCodelets,
    Wire(super::wire::DictionaryWireError),
    Pack(PyacError),
    Index(DictionaryIndexError),
}

impl Display for DictionaryVolumeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidMetadata(reason) => {
                write!(formatter, "invalid dictionary metadata: {reason}")
            }
            Self::InvalidEntry(reason) => write!(formatter, "invalid dictionary entry: {reason}"),
            Self::TooManyCodelets => {
                formatter.write_str("dictionary volume exceeds 32-bit codelet ranges")
            }
            Self::Wire(error) => {
                write!(formatter, "dictionary sentence encoding failed: {error:?}")
            }
            Self::Pack(error) => write!(formatter, "dictionary pack encoding failed: {error}"),
            Self::Index(error) => write!(formatter, "dictionary index validation failed: {error}"),
        }
    }
}

impl std::error::Error for DictionaryVolumeError {}

impl From<super::wire::DictionaryWireError> for DictionaryVolumeError {
    fn from(error: super::wire::DictionaryWireError) -> Self {
        Self::Wire(error)
    }
}
impl From<PyacError> for DictionaryVolumeError {
    fn from(error: PyacError) -> Self {
        Self::Pack(error)
    }
}
impl From<DictionaryIndexError> for DictionaryVolumeError {
    fn from(error: DictionaryIndexError) -> Self {
        Self::Index(error)
    }
}

fn validate_metadata(metadata: &DictionaryMetadata) -> Result<(), DictionaryVolumeError> {
    if metadata.kind.trim().is_empty() || metadata.title.trim().is_empty() {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "kind and title are required",
        ));
    }
    if metadata.languages.is_empty()
        || metadata
            .languages
            .iter()
            .any(|language| language.trim().is_empty() || language.contains(','))
    {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "language tags must be non-empty and comma-free",
        ));
    }
    if metadata.normalization_policy != "NFC" {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "v1 normalization policy is NFC",
        ));
    }
    if metadata
        .languages
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != metadata.languages.len()
    {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "language tags must be unique",
        ));
    }
    Ok(())
}

fn canonicalize_entry(entry: &mut DictionaryVolumeEntry) {
    entry.lexical_forms.sort_by(|left, right| {
        (&left.language, &left.normalized, &left.surface).cmp(&(
            &right.language,
            &right.normalized,
            &right.surface,
        ))
    });
    entry.lexical_forms.dedup();
    entry.source_links.sort_by(|left, right| {
        (
            &left.dataset,
            &left.release,
            &left.identifier,
            &left.relation,
        )
            .cmp(&(
                &right.dataset,
                &right.release,
                &right.identifier,
                &right.relation,
            ))
    });
    entry.source_links.dedup();
    entry.task_keys.sort();
    entry.task_keys.dedup();
    entry.references.sort();
    entry.references.dedup();
    for signature in &mut entry.operation_signatures {
        signature
            .arguments
            .sort_by(|left, right| left.key.cmp(&right.key));
        signature.results.sort_by(|left, right| {
            (&left.value_type, &left.name, &left.description).cmp(&(
                &right.value_type,
                &right.name,
                &right.description,
            ))
        });
    }
    entry.operation_signatures.sort_by(|left, right| {
        left.verb
            .cmp(&right.verb)
            .then(left.mood.cmp(&right.mood))
            .then_with(|| {
                left.arguments
                    .iter()
                    .map(|arg| (&arg.key, &arg.name, &arg.description))
                    .cmp(
                        right
                            .arguments
                            .iter()
                            .map(|arg| (&arg.key, &arg.name, &arg.description)),
                    )
            })
            .then_with(|| {
                left.results
                    .iter()
                    .map(|result| (&result.value_type, &result.name, &result.description))
                    .cmp(
                        right
                            .results
                            .iter()
                            .map(|result| (&result.value_type, &result.name, &result.description)),
                    )
            })
    });
}

pub fn encode_dictionary(volume: &DictionaryVolume) -> Result<Vec<u8>, DictionaryVolumeError> {
    validate_metadata(&volume.metadata)?;
    let mut metadata_copy = volume.metadata.clone();
    metadata_copy.languages.sort();
    let mut input_entries = volume.entries.clone();
    input_entries.iter_mut().for_each(canonicalize_entry);
    input_entries.sort_unstable_by(|left, right| left.key.cmp(&right.key));
    if input_entries
        .iter()
        .flat_map(|entry| &entry.lexical_forms)
        .any(|form| {
            metadata_copy
                .languages
                .binary_search(&form.language)
                .is_err()
        })
    {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "every lexical form language must be declared by the volume",
        ));
    }
    let (marker, metadata) = profile_records(&metadata_copy)?;
    let zero_range = [0; 4];
    let entry_group_sizes = input_entries
        .iter()
        .map(|entry| encode_entry(entry, zero_range).map(|group| group.codelets.len()))
        .collect::<Result<Vec<_>, _>>()?;
    let placeholder_locations = vec![zero_range; input_entries.len()];
    let placeholder_index_groups = index_records(&input_entries, &placeholder_locations)?;
    let mut toc_ranges = vec![(0usize, 0usize); TOC_ROLES.len()];
    let toc_placeholder = toc_records(&toc_ranges)?;
    let marker_count = marker.len();
    let metadata_range = (marker_count, metadata.len());
    let toc_start = marker_count + metadata.len();
    let indexes_start = toc_start + toc_placeholder.len();
    let mut index_ranges = Vec::new();
    let mut next = indexes_start;
    for group in &placeholder_index_groups {
        index_ranges.push((next, group.len()));
        next += group.len();
    }
    let entries_start = next;
    let mut actual_entries = Vec::new();
    let mut locations = Vec::new();
    let mut entry_start = entries_start;
    for (entry, count) in input_entries.iter().zip(entry_group_sizes) {
        let range = range_pair(entry_start, count)?;
        let mut actual = encode_entry(entry, range)?;
        actual.entry.codelet_start =
            u32::try_from(entry_start).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
        actual_entries.push(actual);
        locations.push(range);
        entry_start += count;
    }
    let index_groups = index_records(&input_entries, &locations)?;
    if index_groups
        .iter()
        .zip(&placeholder_index_groups)
        .any(|(actual, placeholder)| actual.len() != placeholder.len())
    {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "index encoding size changed while resolving entry ranges",
        ));
    }
    let entries_count = actual_entries
        .iter()
        .map(|item| item.codelets.len())
        .sum::<usize>();
    let total_count = entries_start + entries_count;
    if total_count > u32::MAX as usize {
        return Err(DictionaryVolumeError::TooManyCodelets);
    }
    let index = DictionaryIndex::new(
        total_count,
        actual_entries
            .iter()
            .map(|item| item.entry.clone())
            .collect(),
    )?;

    toc_ranges[0] = metadata_range;
    toc_ranges[1..6].copy_from_slice(&index_ranges);
    toc_ranges[6] = (entries_start, entries_count);
    let toc = toc_records(&toc_ranges)?;
    if toc.len() != toc_placeholder.len() {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "TOC encoding size changed while resolving ranges",
        ));
    }

    let mut codelets = Vec::with_capacity(total_count);
    codelets.extend(marker);
    codelets.extend(metadata);
    codelets.extend(toc);
    for group in index_groups {
        codelets.extend(group);
    }
    for group in actual_entries {
        codelets.extend(group.codelets);
    }
    debug_assert_eq!(codelets.len(), total_count);
    let _validated_index = index;
    Ok(encode_pack(&codelets)?)
}
