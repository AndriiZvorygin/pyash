use std::fmt::{Display, Formatter};

use super::operation::OperationSignature;
use super::volume_records::{
    TOC_ROLES_V4, encode_entry_v4, index_records_v4, profile_records_v4, toc_records_v4,
};
use super::{DictionaryIndex, DictionaryIndexError, LexicalForm, SourceGloss, SourceLink};
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
    pub source_glosses: Vec<SourceGloss>,
    pub component_keys: Vec<Vec<u16>>,
    pub task_keys: Vec<Vec<u16>>,
    pub references: Vec<Vec<u16>>,
    pub operation_signatures: Vec<OperationSignature>,
    /// Already-lowered ordinary Pyash sentence codelets; copied without reinterpretation.
    pub definition: Option<Vec<[u16; WORDS_PER_CODELET]>>,
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
    ConflictingExactWordNetSenses {
        key: Vec<u16>,
        release: String,
        identifiers: Vec<String>,
    },
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
            Self::ConflictingExactWordNetSenses {
                key,
                release,
                identifiers,
            } => write!(
                formatter,
                "dictionary key {key:?} links to multiple exact WordNet senses of one part of speech in {release}: {identifiers:?}"
            ),
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
    entry.source_glosses.sort_by(|left, right| {
        (
            &left.language,
            &left.dataset,
            &left.release,
            &left.identifier,
            &left.text,
        )
            .cmp(&(
                &right.language,
                &right.dataset,
                &right.release,
                &right.identifier,
                &right.text,
            ))
    });
    entry.source_glosses.dedup();
    entry.task_keys.sort();
    entry.task_keys.dedup();
    entry.references.sort();
    entry.references.dedup();
    for signature in &mut entry.operation_signatures {
        signature
            .arguments
            .sort_by(|left, right| left.case_type.cmp(&right.case_type));
        signature.results.sort_by(|left, right| {
            (&left.noun_class, &left.tag_label, &left.descriptive_specification).cmp(&(
                &right.noun_class,
                &right.tag_label,
                &right.descriptive_specification,
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
                    .map(|arg| (&arg.case_type, &arg.tag_label, &arg.descriptive_specification))
                    .cmp(
                        right
                            .arguments
                            .iter()
                            .map(|arg| (&arg.case_type, &arg.tag_label, &arg.descriptive_specification)),
                    )
            })
            .then_with(|| {
                left.results
                    .iter()
                    .map(|result| (&result.noun_class, &result.tag_label, &result.descriptive_specification))
                    .cmp(
                        right
                            .results
                            .iter()
                            .map(|result| (&result.noun_class, &result.tag_label, &result.descriptive_specification)),
                    )
            })
    });
}

/// The part of speech a WordNet identifier names. The accepted snapshot keeps
/// one sense per Pyash key and part of speech, so senses of different parts of
/// speech may sit on one key. Two senses of the same part of speech do not.
fn wordnet_part_of_speech(identifier: &str) -> &str {
    match identifier.split_once(':') {
        Some((part_of_speech, _))
            if part_of_speech.len() == 1
                && matches!(part_of_speech, "n" | "v" | "a" | "r" | "s") =>
        {
            part_of_speech
        }
        _ => identifier,
    }
}

pub fn encode_dictionary(volume: &DictionaryVolume) -> Result<Vec<u8>, DictionaryVolumeError> {
    validate_metadata(&volume.metadata)?;
    let mut metadata_copy = volume.metadata.clone();
    metadata_copy.languages.sort();
    let mut input_entries = volume.entries.clone();
    input_entries.iter_mut().for_each(canonicalize_entry);
    input_entries.sort_unstable_by(|left, right| left.key.cmp(&right.key));
    let keys = input_entries
        .iter()
        .map(|entry| entry.key.as_slice())
        .collect::<std::collections::BTreeSet<_>>();
    for entry in &input_entries {
        let mut exact_wordnet_senses = std::collections::BTreeMap::<
            &str,
            std::collections::BTreeMap<&str, std::collections::BTreeSet<&str>>,
        >::new();
        for link in &entry.source_links {
            if link.dataset == "wordnet" && link.relation == "exact-sense" {
                exact_wordnet_senses
                    .entry(&link.release)
                    .or_default()
                    .entry(wordnet_part_of_speech(&link.identifier))
                    .or_default()
                    .insert(&link.identifier);
            }
        }
        if let Some((release, identifiers)) = exact_wordnet_senses
            .into_iter()
            .filter_map(|(release, by_part_of_speech)| {
                by_part_of_speech
                    .into_iter()
                    .find(|(_, identifiers)| identifiers.len() > 1)
                    .map(|(_, identifiers)| (release, identifiers))
            })
            .next()
        {
            return Err(DictionaryVolumeError::ConflictingExactWordNetSenses {
                key: entry.key.clone(),
                release: release.to_owned(),
                identifiers: identifiers.into_iter().map(str::to_owned).collect(),
            });
        }
        if entry
            .component_keys
            .iter()
            .any(|key| !keys.contains(key.as_slice()))
        {
            return Err(DictionaryVolumeError::InvalidEntry(
                "component key does not resolve to a dictionary entry",
            ));
        }
        for gloss in &entry.source_glosses {
            if gloss.language.trim().is_empty()
                || gloss.text.trim().is_empty()
                || gloss.dataset.trim().is_empty()
                || gloss.release.trim().is_empty()
                || gloss.identifier.trim().is_empty()
            {
                return Err(DictionaryVolumeError::InvalidEntry(
                    "source gloss language, text, and source identity are required",
                ));
            }
            if !entry.source_links.iter().any(|link| {
                link.dataset == gloss.dataset
                    && link.release == gloss.release
                    && link.identifier == gloss.identifier
            }) {
                return Err(DictionaryVolumeError::InvalidEntry(
                    "source gloss must identify a source linked to the entry",
                ));
            }
        }
    }
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
    if input_entries
        .iter()
        .flat_map(|entry| &entry.source_glosses)
        .any(|gloss| {
            metadata_copy
                .languages
                .binary_search(&gloss.language)
                .is_err()
        })
    {
        return Err(DictionaryVolumeError::InvalidMetadata(
            "every source gloss language must be declared by the volume",
        ));
    }
    let (marker, metadata) = profile_records_v4(&metadata_copy, input_entries.len())?;
    let entry_group_sizes = input_entries
        .iter()
        .map(|entry| encode_entry_v4(entry).map(|group| group.codelets.len()))
        .collect::<Result<Vec<_>, _>>()?;
    // The placeholder offsets keep the grouping of the real ones: an offset is
    // part of the index row identity, so equal placeholders would collapse the
    // rows of two entries that share a surface and change the index size.
    let placeholder_offsets = (0..input_entries.len() as u32).collect::<Vec<_>>();
    let placeholder_index_groups = index_records_v4(&input_entries, &placeholder_offsets)?;
    let mut toc_ranges = vec![(0usize, 0usize); TOC_ROLES_V4.len()];
    let toc_placeholder = toc_records_v4(&toc_ranges)?;
    let marker_count = marker.len();
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
    let mut entry_offsets = Vec::new();
    let mut descriptors = Vec::new();
    let mut entry_start = entries_start;
    for (entry, count) in input_entries.iter().zip(entry_group_sizes) {
        let mut actual = encode_entry_v4(entry)?;
        actual.entry.codelet_start =
            u32::try_from(entry_start).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
        actual.entry.codelet_count =
            u32::try_from(count).map_err(|_| DictionaryVolumeError::TooManyCodelets)?;
        entry_offsets.push(actual.entry.codelet_start);
        descriptors.push(actual.entry.clone());
        actual_entries.push(actual);
        entry_start += count;
    }
    let index_groups = index_records_v4(&input_entries, &entry_offsets)?;
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
    let index = DictionaryIndex::new(total_count, descriptors)?;

    toc_ranges[..4].copy_from_slice(&index_ranges);
    toc_ranges[4] = (entries_start, entries_count);
    let toc = toc_records_v4(&toc_ranges)?;
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
