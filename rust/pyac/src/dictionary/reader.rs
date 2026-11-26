use super::OperationSignatureKey;
use super::reader_codec::{
    parse_location, parse_marker, parse_metadata, parse_toc, parse_toc_v4, read_codelet,
    RecordSubject, Sentence, read_sentence, read_sentence_v4, take_record_subject,
    validate_header, validate_sections, validate_sections_v4,
};
use super::reader_index::{
    DirectIndexLookup, lookup_legacy_operation, lookup_legacy_source, lookup_legacy_surface,
    lookup_v4, next_canonical_offset_after,
};
use super::volume::{DictionaryMetadata, DictionaryVolumeError};
use super::volume_records::{
    PROFILE_VERSION, PROFILE_VERSION_V2, PROFILE_VERSION_V3, TOC_ROLES, TOC_ROLES_V4,
};
use super::wire::{AS, BY, FROM, TO, WITH};
use crate::{HEADER_BYTES, PyacError, WORDS_PER_CODELET};
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DictionarySection {
    pub role: String,
    pub codelet_start: u32,
    pub codelet_count: u32,
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

struct ProfileRecords {
    kind: String,
    marker_count: u32,
    metadata_count: u32,
    metadata: DictionaryMetadata,
    toc_count: usize,
    profile_version: String,
    metadata_entry_count: Option<u32>,
    version_four: bool,
}

pub struct DictionaryFileReader<R> {
    source: R,
    codelet_count: u32,
    profile_version: String,
    metadata: DictionaryMetadata,
    sections: Vec<DictionarySection>,
    entry_count: usize,
    version_four: bool,
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
        let ProfileRecords {
            kind,
            marker_count,
            metadata_count,
            mut metadata,
            toc_count,
            profile_version,
            metadata_entry_count,
            version_four,
        } = read_profile_records(&mut source, count)?;
        let expected_toc_count = if version_four {
            TOC_ROLES_V4.len()
        } else {
            TOC_ROLES.len()
        };
        if kind.trim().is_empty()
            || metadata.title.trim().is_empty()
            || metadata.normalization_policy != "NFC"
            || metadata.languages.is_empty()
            || metadata.languages.iter().any(String::is_empty)
            || metadata.languages.windows(2).any(|pair| pair[0] >= pair[1])
            || toc_count != expected_toc_count
            || (version_four && metadata_entry_count.is_none())
            || (!version_four && metadata_entry_count.is_some())
        {
            return Err(DictionaryReadError::InvalidRecord(
                "profile kind, metadata, or TOC count is invalid",
            ));
        }
        metadata.kind = kind;
        let toc_start = marker_count + metadata_count;
        let mut ordinal = toc_start;
        let mut sections = Vec::with_capacity(toc_count + usize::from(version_four));
        if version_four {
            sections.push(DictionarySection {
                role: "metadata".into(),
                codelet_start: marker_count,
                codelet_count: metadata_count,
            });
            let mut toc_sections = Vec::with_capacity(toc_count);
            for (index, role) in TOC_ROLES_V4.iter().enumerate() {
                let Sentence { words, consumed, .. } = read_sentence(&mut source, ordinal, count)?;
                let section = parse_toc_v4(&words, index as u16, role).map_err(|error| {
                    DictionaryReadError::Context(format!("TOC record {index}"), Box::new(error))
                })?;
                toc_sections.push(section.clone());
                sections.push(section);
                ordinal = ordinal
                    .checked_add(consumed)
                    .ok_or(DictionaryReadError::InvalidRecord("TOC ordinal overflow"))?;
            }
            validate_sections_v4(
                &toc_sections,
                ordinal,
                count,
                metadata_entry_count.expect("checked above"),
            )?;
        } else {
            for role in TOC_ROLES {
                let Sentence { words, consumed, .. } = read_sentence(&mut source, ordinal, count)?;
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
        }
        let mut reader = Self {
            source,
            codelet_count: count,
            profile_version,
            metadata,
            sections,
            entry_count: metadata_entry_count.unwrap_or(0) as usize,
            version_four,
        };
        if !reader.version_four {
            reader.entry_count = reader.validate_legacy_entries().map_err(|error| {
                DictionaryReadError::Context("entry-location index".into(), Box::new(error))
            })?;
        }
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
        self.entry_count
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

    /// Every canonical key the volume indexes, in index order.
    ///
    /// A verification pass needs this to check that each advertised entry is
    /// actually readable; `entry_count` alone cannot tell a corrupt record from
    /// a missing one.
    pub fn canonical_keys(&mut self) -> Result<Vec<Vec<u16>>, DictionaryReadError> {
        let section = self.section("canonical-index")?;
        let mut keys = Vec::new();
        let mut ordinal = section.codelet_start;
        let end = section.codelet_start + section.codelet_count;
        while ordinal < end {
            let sentence = read_sentence_v4(&mut self.source, ordinal, end)?;
            let mut cursor = 0;
            if let Ok(RecordSubject::Name(name)) = take_record_subject(&sentence, &mut cursor) {
                keys.push(name);
            }
            ordinal = ordinal
                .checked_add(sentence.consumed)
                .ok_or(DictionaryReadError::InvalidRecord("index ordinal overflow"))?;
        }
        Ok(keys)
    }

    pub fn location(&mut self, key: &[u16]) -> Result<Option<Range<u32>>, DictionaryReadError> {
        if !self.version_four {
            return Ok(self.find_legacy_location(key)?.map(|(entry, _)| entry));
        }
        let section = self.section("canonical-index")?;
        let Some(offset) = lookup_v4(
            &mut self.source,
            &section,
            DirectIndexLookup::Canonical(key),
        )?
        .first()
        .copied() else {
            return Ok(None);
        };
        let entries = self.section("entries")?;
        let entries_end = entries.codelet_start + entries.codelet_count;
        if offset < entries.codelet_start || offset >= entries_end {
            return Err(DictionaryReadError::InvalidRecord(
                "canonical index points outside the entries section",
            ));
        }
        let next =
            next_canonical_offset_after(&mut self.source, &section, offset)?.unwrap_or(entries_end);
        if next <= offset || next > entries_end {
            return Err(DictionaryReadError::InvalidRecord(
                "canonical index offsets are not strictly increasing within entries",
            ));
        }
        Ok(Some(offset..next))
    }

    pub fn definition_location(
        &mut self,
        key: &[u16],
    ) -> Result<Option<Range<u32>>, DictionaryReadError> {
        if !self.version_four {
            return Ok(self
                .find_legacy_location(key)?
                .map(|(_, definition)| definition));
        }
        let Some(entry_range) = self.location(key)? else {
            return Ok(None);
        };
        let mut ordinal = entry_range.start;
        let mut definition_start = entry_range.end;
        while ordinal < entry_range.end {
            let sentence = read_sentence(&mut self.source, ordinal, entry_range.end)?;
            let consumed = sentence.consumed;
            if !is_v4_entry_metadata(&sentence, key)? {
                definition_start = ordinal;
                break;
            }
            ordinal += consumed;
        }
        Ok(Some(definition_start..entry_range.end))
    }

    pub fn has_definition(&mut self, key: &[u16]) -> Result<bool, DictionaryReadError> {
        Ok(self
            .definition_location(key)?
            .is_some_and(|range| !range.is_empty()))
    }

    pub fn lookup_surface(
        &mut self,
        language: &str,
        surface: &str,
    ) -> Result<Vec<u32>, DictionaryReadError> {
        if self.version_four {
            let section = self.section("surface-index")?;
            let normalized: String = surface.nfc().collect();
            return lookup_v4(
                &mut self.source,
                &section,
                DirectIndexLookup::Surface(language, &normalized),
            );
        }
        let section = self.section("surface-index")?;
        let keys = lookup_legacy_surface(
            &mut self.source,
            &section,
            self.codelet_count,
            language,
            surface,
        )?;
        self.offsets_for_legacy_keys(&keys)
    }

    pub fn lookup_source(
        &mut self,
        dataset: &str,
        release: &str,
        identifier: &str,
    ) -> Result<Vec<u32>, DictionaryReadError> {
        if self.version_four {
            let section = self.section("source-index")?;
            return lookup_v4(
                &mut self.source,
                &section,
                DirectIndexLookup::Source(dataset, release, identifier),
            );
        }
        let section = self.section("source-index")?;
        let keys = lookup_legacy_source(
            &mut self.source,
            &section,
            self.codelet_count,
            dataset,
            release,
            identifier,
        )?;
        self.offsets_for_legacy_keys(&keys)
    }

    pub fn lookup_operation_signature(
        &mut self,
        key: &OperationSignatureKey,
    ) -> Result<Vec<u32>, DictionaryReadError> {
        if self.version_four {
            let section = self.section("operation-signature-index")?;
            return lookup_v4(
                &mut self.source,
                &section,
                DirectIndexLookup::Operation(key),
            );
        }
        let section = self.section("operation-signature-index")?;
        let keys = lookup_legacy_operation(&mut self.source, &section, self.codelet_count, key)?;
        self.offsets_for_legacy_keys(&keys)
    }

    pub fn read_entry(
        &mut self,
        key: &[u16],
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        let range = self
            .location(key)?
            .ok_or_else(|| DictionaryReadError::MissingEntry(key.to_vec()))?;
        self.read_range(range)
    }

    pub fn read_entry_at(
        &mut self,
        offset: u32,
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        if !self.version_four {
            let range = self.find_legacy_range_by_offset(offset)?.ok_or(
                DictionaryReadError::InvalidRecord("legacy entry offset is not indexed"),
            )?;
            return self.read_range(range);
        }
        let entries = self.section("entries")?;
        let entries_end = entries.codelet_start + entries.codelet_count;
        if offset < entries.codelet_start || offset >= entries_end {
            return Err(DictionaryReadError::InvalidRecord(
                "entry offset is outside the entries section",
            ));
        }
        let canonical = self.section("canonical-index")?;
        let next = next_canonical_offset_after(&mut self.source, &canonical, offset)?
            .unwrap_or(entries_end);
        if next <= offset || next > entries_end {
            return Err(DictionaryReadError::InvalidRecord(
                "entry offsets are not strictly increasing within entries",
            ));
        }
        self.read_range(offset..next)
    }

    pub fn read_definition(
        &mut self,
        key: &[u16],
    ) -> Result<Vec<[u16; WORDS_PER_CODELET]>, DictionaryReadError> {
        let range = self
            .definition_location(key)?
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

    fn section(&self, role: &str) -> Result<DictionarySection, DictionaryReadError> {
        self.sections
            .iter()
            .find(|section| section.role == role)
            .cloned()
            .ok_or_else(|| DictionaryReadError::MissingSection(role.into()))
    }

    fn offsets_for_legacy_keys(
        &mut self,
        keys: &[Vec<u16>],
    ) -> Result<Vec<u32>, DictionaryReadError> {
        let mut offsets = Vec::with_capacity(keys.len());
        for key in keys {
            let Some((entry, _)) = self.find_legacy_location(key)? else {
                return Err(DictionaryReadError::MissingEntry(key.clone()));
            };
            offsets.push(entry.start);
        }
        offsets.sort_unstable();
        offsets.dedup();
        Ok(offsets)
    }

    fn find_legacy_location(
        &mut self,
        key: &[u16],
    ) -> Result<Option<(Range<u32>, Range<u32>)>, DictionaryReadError> {
        let section = self.section("entry-location-index")?;
        let end = section.codelet_start + section.codelet_count;
        let mut ordinal = section.codelet_start;
        while ordinal < end {
            let Sentence { words, consumed, .. } = read_sentence(&mut self.source, ordinal, end)?;
            let (candidate, entry, definition) = parse_location(&words)?;
            match candidate.as_slice().cmp(key) {
                std::cmp::Ordering::Less => ordinal += consumed,
                std::cmp::Ordering::Equal => return Ok(Some((entry, definition))),
                std::cmp::Ordering::Greater => return Ok(None),
            }
        }
        Ok(None)
    }

    fn find_legacy_range_by_offset(
        &mut self,
        offset: u32,
    ) -> Result<Option<Range<u32>>, DictionaryReadError> {
        let section = self.section("entry-location-index")?;
        let end = section.codelet_start + section.codelet_count;
        let mut ordinal = section.codelet_start;
        while ordinal < end {
            let Sentence { words, consumed, .. } = read_sentence(&mut self.source, ordinal, end)?;
            let (_, entry, _) = parse_location(&words)?;
            if entry.start == offset {
                return Ok(Some(entry));
            }
            ordinal += consumed;
        }
        Ok(None)
    }

    fn validate_legacy_entries(&mut self) -> Result<usize, DictionaryReadError> {
        let locations = self.section("entry-location-index")?;
        let entries = self.section("entries")?;
        let entries_end = entries.codelet_start + entries.codelet_count;
        let locations_end = locations.codelet_start + locations.codelet_count;
        let mut ordinal = locations.codelet_start;
        let mut expected_entry_start = entries.codelet_start;
        let mut previous_key: Option<Vec<u16>> = None;
        let mut count = 0usize;
        while ordinal < locations_end {
            let Sentence { words, consumed, .. } = read_sentence(&mut self.source, ordinal, locations_end)?;
            let (key, entry, definition) = parse_location(&words)?;
            if previous_key
                .as_ref()
                .is_some_and(|previous| previous >= &key)
            {
                return Err(DictionaryReadError::InvalidRecord(
                    "entry-location index is not strictly sorted",
                ));
            }
            if entry.start != expected_entry_start
                || entry.is_empty()
                || entry.end > entries_end
                || definition.start < entry.start
                || definition.end > entry.end
                || (definition.is_empty()
                    && (self.profile_version != PROFILE_VERSION_V3
                        || definition.start != entry.end))
                || (!definition.is_empty()
                    && self.profile_version == PROFILE_VERSION_V2
                    && definition.end != entry.end)
            {
                return Err(DictionaryReadError::InvalidRecord(
                    "legacy entry or definition range is invalid",
                ));
            }
            previous_key = Some(key);
            expected_entry_start = entry.end;
            ordinal += consumed;
            count += 1;
        }
        if ordinal != locations_end || expected_entry_start != entries_end || count == 0 {
            return Err(DictionaryReadError::InvalidRecord(
                "legacy entry-location index does not cover entries",
            ));
        }
        Ok(count)
    }
}

fn read_profile_records<R: Read + Seek>(
    source: &mut R,
    limit: u32,
) -> Result<ProfileRecords, DictionaryReadError> {
    let Sentence { words: marker, consumed: marker_count, .. } = read_sentence(source, 0, limit)?;
    let kind = parse_marker(&marker)
        .map_err(|error| DictionaryReadError::Context("profile marker".into(), Box::new(error)))?;
    let Sentence { words: metadata_words, consumed: metadata_count, .. } = read_sentence(source, marker_count, limit)?;
    let (metadata, toc_count, profile_version, metadata_entry_count) =
        parse_metadata(&metadata_words).map_err(|error| {
            DictionaryReadError::Context("profile metadata".into(), Box::new(error))
        })?;
    let version_four = profile_version == PROFILE_VERSION;
    Ok(ProfileRecords {
        kind,
        marker_count,
        metadata_count,
        metadata,
        toc_count,
        profile_version,
        metadata_entry_count,
        version_four,
    })
}

fn is_v4_entry_metadata(sentence: &Sentence, key: &[u16]) -> Result<bool, DictionaryReadError> {
    use super::reader_codec::{
        RecordSubject, expect_end, expect_word, take_record_subject, take_text, take_vector,
    };

    let words = &sentence.words;
    let mut cursor = 0;
    if take_record_subject(sentence, &mut cursor)? != RecordSubject::Name(key.to_vec()) {
        return Ok(false);
    }
    let text_shapes: [&[u16]; 3] = [
        &[AS, FROM, TO],
        &[AS, FROM, TO, BY],
        &[AS, FROM, TO, BY, WITH],
    ];
    for cases in text_shapes {
        let mut position = cursor;
        let matched = cases.iter().all(|case| {
            take_text(words, &mut position).is_ok()
                && expect_word(words, &mut position, *case).is_ok()
        });
        if matched && expect_end(words, &mut position).is_ok() {
            return Ok(true);
        }
    }
    for case in [FROM, WITH, TO, BY] {
        let mut position = cursor;
        if take_vector(words, &mut position).is_ok()
            && expect_word(words, &mut position, case).is_ok()
            && expect_end(words, &mut position).is_ok()
        {
            return Ok(true);
        }
    }
    {
        let mut position = cursor;
        if take_vector(words, &mut position).is_ok()
            && expect_word(words, &mut position, FROM).is_ok()
            && expect_end(words, &mut position).is_ok()
        {
            return Ok(true);
        }
    }
    for cases in [&[AS, FROM, TO][..], &[AS, BY, WITH][..]] {
        let mut position = cursor;
        if take_vector(words, &mut position).is_ok()
            && expect_word(words, &mut position, cases[0]).is_ok()
            && take_text(words, &mut position).is_ok()
            && expect_word(words, &mut position, cases[1]).is_ok()
            && take_text(words, &mut position).is_ok()
            && expect_word(words, &mut position, cases[2]).is_ok()
            && expect_end(words, &mut position).is_ok()
        {
            return Ok(true);
        }
    }
    Ok(false)
}
