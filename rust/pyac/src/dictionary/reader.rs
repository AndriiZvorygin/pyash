use super::OperationSignatureKey;
use super::reader_codec::{
    parse_location, parse_marker, parse_metadata, parse_toc, read_codelet, read_sentence,
    validate_header, validate_sections,
};
use super::reader_index::IndexPostings;
use super::volume::{DictionaryMetadata, DictionaryVolumeError};
use super::volume_records::{PROFILE_VERSION, PROFILE_VERSION_V2, TOC_ROLES};
use crate::{HEADER_BYTES, PyacError, WORDS_PER_CODELET};
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionarySection {
    pub role: String,
    pub codelet_start: u32,
    pub codelet_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionarySourceMatch {
    pub key: Vec<u16>,
    pub relation: String,
}

impl DictionarySection {
    pub fn range(&self) -> Range<u32> {
        self.codelet_start..self.codelet_start + self.codelet_count
    }
}

#[derive(Debug)]
pub enum DictionaryReadError {
    Io(std::io::Error),
    Pack(PyacError),
    Volume(DictionaryVolumeError),
    InvalidRecord(&'static str),
    UnexpectedWord {
        expected: u16,
        actual: Option<u16>,
        offset: usize,
    },
    Context(String, Box<DictionaryReadError>),
    MissingSection(String),
    MissingEntry(Vec<u16>),
}

impl std::fmt::Display for DictionaryReadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "dictionary read failed: {error}"),
            Self::Pack(error) => write!(f, "invalid PyAC dictionary pack: {error}"),
            Self::Volume(error) => write!(f, "invalid PyAC dictionary volume: {error}"),
            Self::InvalidRecord(reason) => write!(f, "invalid dictionary record: {reason}"),
            Self::UnexpectedWord {
                expected,
                actual,
                offset,
            } => write!(
                f,
                "invalid dictionary record: expected case/verb 0x{expected:04x} at word {offset}, found {}",
                actual.map_or_else(|| "end of sentence".into(), |word| format!("0x{word:04x}"))
            ),
            Self::Context(context, error) => write!(f, "{context}: {error}"),
            Self::MissingSection(role) => write!(f, "dictionary has no {role} section"),
            Self::MissingEntry(key) => write!(f, "dictionary has no entry for Pyac key {key:?}"),
        }
    }
}

impl std::error::Error for DictionaryReadError {}
impl From<std::io::Error> for DictionaryReadError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl From<PyacError> for DictionaryReadError {
    fn from(error: PyacError) -> Self {
        Self::Pack(error)
    }
}
impl From<DictionaryVolumeError> for DictionaryReadError {
    fn from(error: DictionaryVolumeError) -> Self {
        Self::Volume(error)
    }
}

pub struct DictionaryFileReader<R> {
    source: R,
    codelet_count: u32,
    profile_version: String,
    metadata: DictionaryMetadata,
    sections: Vec<DictionarySection>,
    locations: Vec<(Vec<u16>, Range<u32>)>,
    definitions: Vec<(Vec<u16>, Range<u32>)>,
    postings: IndexPostings,
}

impl<R: Read + Seek> DictionaryFileReader<R> {
    pub fn open(mut source: R) -> Result<Self, DictionaryReadError> {
        let mut header = [0u8; HEADER_BYTES];
        source.seek(SeekFrom::Start(0))?;
        source.read_exact(&mut header)?;
        let count = validate_header(&header)?;
        let declared_bytes = u32::from_le_bytes(header[24..28].try_into().expect("header field"));
        let actual_bytes = source.seek(SeekFrom::End(0))? as usize;
        if actual_bytes != declared_bytes as usize {
            return Err(PyacError::LengthMismatch {
                expected: declared_bytes as usize,
                declared: declared_bytes,
                actual: actual_bytes,
            }
            .into());
        }
        let (marker, marker_count) = read_sentence(&mut source, 0, count)?;
        let kind = parse_marker(&marker).map_err(|error| {
            DictionaryReadError::Context("profile marker".into(), Box::new(error))
        })?;
        let (metadata_words, metadata_count) = read_sentence(&mut source, marker_count, count)?;
        let (mut metadata, toc_count, profile_version) =
            parse_metadata(&metadata_words).map_err(|error| {
                DictionaryReadError::Context("profile metadata".into(), Box::new(error))
            })?;
        if kind.trim().is_empty()
            || metadata.title.trim().is_empty()
            || metadata.normalization_policy != "NFC"
            || metadata.languages.is_empty()
            || metadata.languages.iter().any(String::is_empty)
            || metadata.languages.windows(2).any(|pair| pair[0] >= pair[1])
            || toc_count != TOC_ROLES.len()
        {
            return Err(DictionaryReadError::InvalidRecord(
                "profile kind, metadata, or TOC count is invalid",
            ));
        }
        metadata.kind = kind;
        let toc_start = marker_count + metadata_count;
        let mut ordinal = toc_start;
        let mut sections = Vec::with_capacity(toc_count);
        for role in TOC_ROLES {
            let (words, consumed) = read_sentence(&mut source, ordinal, count)?;
            let section = parse_toc(&words).map_err(|error| {
                DictionaryReadError::Context(format!("TOC record for {role}"), Box::new(error))
            })?;
            if section.role != role {
                return Err(DictionaryReadError::InvalidRecord(
                    "TOC records are not in canonical role order",
                ));
            }
            sections.push(section);
            ordinal = ordinal
                .checked_add(consumed)
                .ok_or(DictionaryReadError::InvalidRecord("TOC ordinal overflow"))?;
        }
        validate_sections(&sections, marker_count, metadata_count, ordinal, count)?;
        let mut reader = Self {
            source,
            codelet_count: count,
            profile_version,
            metadata,
            sections,
            locations: Vec::new(),
            definitions: Vec::new(),
            postings: IndexPostings::default(),
        };
        reader.load_locations().map_err(|error| {
            DictionaryReadError::Context("entry-location index".into(), Box::new(error))
        })?;
        reader.postings =
            IndexPostings::load(&mut reader.source, &reader.sections, reader.codelet_count)
                .map_err(|error| {
                    DictionaryReadError::Context("lookup indexes".into(), Box::new(error))
                })?;
        reader
            .postings
            .validate_targets(&reader.locations, &reader.metadata.languages)?;
        Ok(reader)
    }

    pub fn metadata(&self) -> &DictionaryMetadata {
        &self.metadata
    }
    pub fn profile_version(&self) -> &str {
        &self.profile_version
    }
    pub fn sections(&self) -> &[DictionarySection] {
        &self.sections
    }
    pub fn codelet_count(&self) -> u32 {
        self.codelet_count
    }

    pub fn entry_count(&self) -> usize {
        self.locations.len()
    }

    pub fn read_section(
        &mut self,
        role: &str,
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        let section = self
            .sections
            .iter()
            .find(|section| section.role == role)
            .ok_or_else(|| DictionaryReadError::MissingSection(role.into()))?;
        self.read_range(section.range())
    }

    pub fn location(&self, key: &[u16]) -> Option<Range<u32>> {
        self.locations
            .binary_search_by(|(candidate, _)| candidate.as_slice().cmp(key))
            .ok()
            .map(|index| self.locations[index].1.clone())
    }

    pub fn definition_location(&self, key: &[u16]) -> Option<Range<u32>> {
        self.definitions
            .binary_search_by(|(candidate, _)| candidate.as_slice().cmp(key))
            .ok()
            .map(|index| self.definitions[index].1.clone())
    }

    pub fn has_definition(&self, key: &[u16]) -> bool {
        self.definition_location(key)
            .is_some_and(|range| !range.is_empty())
    }

    pub fn lookup_surface(&self, language: &str, surface: &str) -> Vec<Vec<u16>> {
        self.postings.lookup_surface(language, surface)
    }

    pub fn lookup_source(
        &self,
        dataset: &str,
        release: &str,
        identifier: &str,
    ) -> Vec<DictionarySourceMatch> {
        self.postings.lookup_source(dataset, release, identifier)
    }

    pub fn lookup_operation_signature(&self, key: &OperationSignatureKey) -> Vec<Vec<u16>> {
        self.postings.lookup_operation(key)
    }

    pub fn read_entry(
        &mut self,
        key: &[u16],
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        let range = self
            .location(key)
            .ok_or_else(|| DictionaryReadError::MissingEntry(key.to_vec()))?;
        self.read_range(range)
    }

    pub fn read_definition(
        &mut self,
        key: &[u16],
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        let range = self
            .definition_location(key)
            .ok_or_else(|| DictionaryReadError::MissingEntry(key.to_vec()))?;
        self.read_range(range)
    }

    fn read_range(
        &mut self,
        range: Range<u32>,
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        if range.start > range.end || range.end > self.codelet_count {
            return Err(DictionaryReadError::InvalidRecord(
                "requested codelet range is outside the pack",
            ));
        }
        let mut result = Vec::with_capacity((range.end - range.start) as usize);
        for ordinal in range {
            result.push(read_codelet(&mut self.source, ordinal)?);
        }
        Ok(result)
    }

    fn load_locations(&mut self) -> Result<(), DictionaryReadError> {
        let section = self
            .sections
            .iter()
            .find(|item| item.role == "entry-location-index")
            .ok_or_else(|| DictionaryReadError::MissingSection("entry-location-index".into()))?;
        let end = section.codelet_start + section.codelet_count;
        let mut ordinal = section.codelet_start;
        let mut locations = Vec::new();
        let mut definitions = Vec::new();
        while ordinal < end {
            let (words, consumed) = read_sentence(&mut self.source, ordinal, self.codelet_count)?;
            let (key, range, definition_range) = parse_location(&words)?;
            if locations
                .last()
                .is_some_and(|(previous, _): &(Vec<u16>, Range<u32>)| previous >= &key)
            {
                return Err(DictionaryReadError::InvalidRecord(
                    "entry-location index is not strictly sorted",
                ));
            }
            definitions.push((key.clone(), definition_range));
            locations.push((key, range));
            ordinal += consumed;
        }
        if ordinal != end {
            return Err(DictionaryReadError::InvalidRecord(
                "location index ends inside a sentence",
            ));
        }
        let entries = self
            .sections
            .iter()
            .find(|item| item.role == "entries")
            .ok_or_else(|| DictionaryReadError::MissingSection("entries".into()))?;
        let entries_end = entries.codelet_start + entries.codelet_count;
        if locations.iter().any(|(_, range)| {
            range.start < entries.codelet_start || range.end > entries_end || range.is_empty()
        }) {
            return Err(DictionaryReadError::InvalidRecord(
                "entry-location posting points outside the entries section",
            ));
        }
        if definitions.len() != locations.len()
            || definitions.iter().zip(&locations).any(
                |((definition_key, definition), (entry_key, entry))| {
                    definition_key != entry_key
                        || definition.start < entry.start
                        || definition.end > entry.end
                        || (definition.is_empty()
                            && (self.profile_version != PROFILE_VERSION
                                || definition.start != entry.end))
                        || (!definition.is_empty()
                            && self.profile_version == PROFILE_VERSION_V2
                            && definition.end != entry.end)
                },
            )
        {
            return Err(DictionaryReadError::InvalidRecord(
                "definition ranges do not match their entry locations",
            ));
        }
        let mut by_range = locations
            .iter()
            .map(|(key, range)| (range, key))
            .collect::<Vec<_>>();
        by_range.sort_unstable_by_key(|(range, _)| range.start);
        let mut expected = entries.codelet_start;
        for (range, _) in by_range {
            if range.start != expected {
                return Err(DictionaryReadError::InvalidRecord(
                    "entry ranges overlap or leave gaps in the entries section",
                ));
            }
            expected = range.end;
        }
        if expected != entries_end {
            return Err(DictionaryReadError::InvalidRecord(
                "entry-location index does not cover the entries section",
            ));
        }
        self.locations = locations;
        self.definitions = definitions;
        Ok(())
    }
}
