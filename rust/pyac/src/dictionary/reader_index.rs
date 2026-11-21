use super::reader::{DictionaryReadError, DictionarySection, DictionarySourceMatch};
use super::reader_codec::{
    expect_end, expect_word, read_sentence, subject_end, take_text, take_vector,
};
use super::volume_records::INDEX_SUBJECT;
use super::{OperationArgumentType, OperationSignatureKey};
use std::io::{Read, Seek};
use unicode_normalization::UnicodeNormalization;

const OB: u16 = 0x245e;
const AS: u16 = 0x414f;
const FROM: u16 = 0x313e;
const TO: u16 = 0x243e;
const BY: u16 = 0x287e;
const WITH: u16 = 0x490f;

type SurfacePosting = (String, String, Vec<u16>);
type SourcePosting = (String, String, String, Vec<u16>, String);
type OperationPosting = (OperationSignatureKey, Vec<u16>);

#[derive(Debug, Default)]
pub(super) struct IndexPostings {
    canonical: Vec<Vec<u16>>,
    surfaces: Vec<SurfacePosting>,
    sources: Vec<SourcePosting>,
    operations: Vec<OperationPosting>,
}

impl IndexPostings {
    pub(super) fn load<R: Read + Seek>(
        source: &mut R,
        sections: &[DictionarySection],
        codelet_count: u32,
    ) -> Result<Self, DictionaryReadError> {
        let mut postings = Self::default();
        postings
            .load_canonical(
                source,
                find_section(sections, "canonical-index")?,
                codelet_count,
            )
            .map_err(|error| {
                DictionaryReadError::Context("canonical index".into(), Box::new(error))
            })?;
        postings
            .load_surfaces(
                source,
                find_section(sections, "surface-index")?,
                codelet_count,
            )
            .map_err(|error| {
                DictionaryReadError::Context("surface index".into(), Box::new(error))
            })?;
        postings
            .load_sources(
                source,
                find_section(sections, "source-index")?,
                codelet_count,
            )
            .map_err(|error| {
                DictionaryReadError::Context("source index".into(), Box::new(error))
            })?;
        postings
            .load_operations(
                source,
                find_section(sections, "operation-signature-index")?,
                codelet_count,
            )
            .map_err(|error| {
                DictionaryReadError::Context("operation index".into(), Box::new(error))
            })?;
        Ok(postings)
    }

    pub(super) fn validate_targets(
        &self,
        locations: &[(Vec<u16>, std::ops::Range<u32>)],
        languages: &[String],
    ) -> Result<(), DictionaryReadError> {
        if self.canonical.len() != locations.len()
            || self
                .canonical
                .iter()
                .zip(locations)
                .any(|(key, (location_key, _))| key != location_key)
        {
            return Err(invalid("canonical index does not match entry locations"));
        }
        let exists = |key: &[u16]| {
            locations
                .binary_search_by(|item| item.0.as_slice().cmp(key))
                .is_ok()
        };
        if self.surfaces.iter().any(|(_, _, key)| !exists(key))
            || self.sources.iter().any(|(_, _, _, key, _)| !exists(key))
            || self.operations.iter().any(|(_, key)| !exists(key))
        {
            return Err(invalid("lookup index posting has no entry-location record"));
        }
        if self
            .surfaces
            .iter()
            .any(|(language, _, _)| languages.binary_search(language).is_err())
        {
            return Err(invalid(
                "surface index uses a language absent from volume metadata",
            ));
        }
        Ok(())
    }

    pub(super) fn lookup_surface(&self, language: &str, surface: &str) -> Vec<Vec<u16>> {
        let normalized: String = surface.nfc().collect();
        let needle = (language, normalized.as_str());
        let start = self
            .surfaces
            .partition_point(|(lang, form, _)| (lang.as_str(), form.as_str()) < needle);
        let mut matches = self.surfaces[start..]
            .iter()
            .take_while(|(lang, form, _)| (lang.as_str(), form.as_str()) == needle)
            .map(|(_, _, key)| key.clone())
            .collect::<Vec<_>>();
        matches.dedup();
        matches
    }

    pub(super) fn lookup_source(
        &self,
        dataset: &str,
        release: &str,
        identifier: &str,
    ) -> Vec<DictionarySourceMatch> {
        let needle = (dataset, release, identifier);
        let start = self.sources.partition_point(|(data, version, id, _, _)| {
            (data.as_str(), version.as_str(), id.as_str()) < needle
        });
        let mut matches = self.sources[start..]
            .iter()
            .take_while(|(data, version, id, _, _)| {
                (data.as_str(), version.as_str(), id.as_str()) == needle
            })
            .map(|(_, _, _, key, relation)| DictionarySourceMatch {
                key: key.clone(),
                relation: relation.clone(),
            })
            .collect::<Vec<_>>();
        matches.dedup();
        matches
    }

    pub(super) fn lookup_operation(&self, key: &OperationSignatureKey) -> Vec<Vec<u16>> {
        let start = self
            .operations
            .partition_point(|(candidate, _)| candidate < key);
        let mut matches = self.operations[start..]
            .iter()
            .take_while(|(candidate, _)| candidate == key)
            .map(|(_, entry_key)| entry_key.clone())
            .collect::<Vec<_>>();
        matches.dedup();
        matches
    }

    fn load_canonical<R: Read + Seek>(
        &mut self,
        source: &mut R,
        section: &DictionarySection,
        limit: u32,
    ) -> Result<(), DictionaryReadError> {
        for_each_sentence(source, section, limit, |_, words| {
            let mut cursor = index_subject(words)?;
            expect_text(words, &mut cursor, OB, "canonical")?;
            let key = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, FROM)?;
            let target = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, TO)?;
            expect_end(words, &mut cursor)?;
            if key.is_empty() || key != target {
                return Err(invalid("canonical index key and target differ"));
            }
            self.canonical.push(key);
            Ok(())
        })?;
        if self.canonical.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err(invalid("canonical index is not strictly sorted"));
        }
        Ok(())
    }

    fn load_surfaces<R: Read + Seek>(
        &mut self,
        source: &mut R,
        section: &DictionarySection,
        limit: u32,
    ) -> Result<(), DictionaryReadError> {
        for_each_sentence(source, section, limit, |ordinal, words| {
            let mut cursor = index_subject(words)?;
            expect_text(words, &mut cursor, OB, "language-surface")?;
            let language = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, AS)?;
            let surface = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, FROM).map_err(|error| {
                DictionaryReadError::Context(
                    format!("surface posting at codelet {ordinal}: {language:?} {surface:?}"),
                    Box::new(error),
                )
            })?;
            let key = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, TO)?;
            expect_end(words, &mut cursor)?;
            if language.is_empty() || surface.is_empty() || key.is_empty() {
                return Err(invalid("empty language-surface posting field"));
            }
            let normalized: String = surface.nfc().collect();
            if normalized != surface {
                return Err(invalid("surface index is not stored in NFC"));
            }
            self.surfaces.push((language, surface, key));
            Ok(())
        })?;
        if self.surfaces.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err(invalid("surface index is not in canonical order"));
        }
        Ok(())
    }

    fn load_sources<R: Read + Seek>(
        &mut self,
        source: &mut R,
        section: &DictionarySection,
        limit: u32,
    ) -> Result<(), DictionaryReadError> {
        for_each_sentence(source, section, limit, |_, words| {
            let mut cursor = index_subject(words)?;
            expect_text(words, &mut cursor, OB, "external-source")?;
            let dataset = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, AS)?;
            let release = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, FROM)?;
            let identifier = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, TO)?;
            let key = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, BY)?;
            let relation = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, WITH)?;
            expect_end(words, &mut cursor)?;
            if dataset.is_empty()
                || release.is_empty()
                || identifier.is_empty()
                || key.is_empty()
                || relation.is_empty()
            {
                return Err(invalid("empty external-source posting field"));
            }
            self.sources
                .push((dataset, release, identifier, key, relation));
            Ok(())
        })?;
        if self.sources.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err(invalid("source index is not in canonical order"));
        }
        Ok(())
    }

    fn load_operations<R: Read + Seek>(
        &mut self,
        source: &mut R,
        section: &DictionarySection,
        limit: u32,
    ) -> Result<(), DictionaryReadError> {
        for_each_sentence(source, section, limit, |_, words| {
            let mut cursor = index_subject(words)?;
            expect_text(words, &mut cursor, OB, "operation-signature")?;
            let dispatch = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, FROM)?;
            let key = take_vector(words, &mut cursor)?;
            expect_word(words, &mut cursor, TO)?;
            expect_end(words, &mut cursor)?;
            if key.is_empty() {
                return Err(invalid("operation posting has an empty entry key"));
            }
            self.operations.push((decode_signature(&dispatch)?, key));
            Ok(())
        })?;
        if self.operations.windows(2).any(|pair| pair[0] > pair[1]) {
            return Err(invalid("operation index is not in canonical order"));
        }
        Ok(())
    }
}

fn find_section<'a>(
    sections: &'a [DictionarySection],
    role: &str,
) -> Result<&'a DictionarySection, DictionaryReadError> {
    sections
        .iter()
        .find(|section| section.role == role)
        .ok_or_else(|| DictionaryReadError::MissingSection(role.into()))
}

fn for_each_sentence<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    limit: u32,
    mut visit: impl FnMut(u32, &[u16]) -> Result<(), DictionaryReadError>,
) -> Result<(), DictionaryReadError> {
    let range = section.range();
    let mut ordinal = range.start;
    while ordinal < range.end {
        let (words, consumed) = read_sentence(source, ordinal, limit)?;
        visit(ordinal, &words)?;
        ordinal = ordinal
            .checked_add(consumed)
            .ok_or_else(|| invalid("index sentence ordinal overflow"))?;
    }
    if ordinal != range.end {
        return Err(invalid("index section ends inside a sentence"));
    }
    Ok(())
}

fn index_subject(words: &[u16]) -> Result<usize, DictionaryReadError> {
    subject_end(words, &INDEX_SUBJECT)
}

fn expect_text(
    words: &[u16],
    cursor: &mut usize,
    case: u16,
    expected: &str,
) -> Result<(), DictionaryReadError> {
    let actual = take_text(words, cursor)?;
    expect_word(words, cursor, case)?;
    if actual != expected {
        return Err(invalid("index record has an unexpected record kind"));
    }
    Ok(())
}

fn decode_signature(words: &[u16]) -> Result<OperationSignatureKey, DictionaryReadError> {
    let mut cursor = 0;
    let verb = take_sequence(words, &mut cursor)?;
    let mood = take_sequence(words, &mut cursor)?;
    let count = *words
        .get(cursor)
        .ok_or_else(|| invalid("operation signature has no argument count"))?
        as usize;
    cursor += 1;
    let mut arguments = Vec::with_capacity(count);
    for _ in 0..count {
        let grammatical_case = take_sequence(words, &mut cursor)?;
        let value_type = take_sequence(words, &mut cursor)?;
        if grammatical_case.is_empty() || value_type.is_empty() {
            return Err(invalid("operation argument type is empty"));
        }
        arguments.push(OperationArgumentType {
            grammatical_case,
            value_type,
        });
    }
    if cursor != words.len() || verb.is_empty() || mood.is_empty() {
        return Err(invalid("operation signature has trailing or missing words"));
    }
    Ok(OperationSignatureKey::new(verb, mood, arguments))
}

fn take_sequence(words: &[u16], cursor: &mut usize) -> Result<Vec<u16>, DictionaryReadError> {
    let length = *words
        .get(*cursor)
        .ok_or_else(|| invalid("operation signature sequence is truncated"))?
        as usize;
    *cursor += 1;
    let end = (*cursor)
        .checked_add(length)
        .ok_or_else(|| invalid("operation signature sequence length overflow"))?;
    let sequence = words
        .get(*cursor..end)
        .ok_or_else(|| invalid("operation signature sequence is truncated"))?
        .to_vec();
    *cursor = end;
    Ok(sequence)
}

fn invalid(reason: &'static str) -> DictionaryReadError {
    DictionaryReadError::InvalidRecord(reason)
}
