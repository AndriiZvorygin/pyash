use super::reader::{DictionaryReadError, DictionarySection};
use super::reader_codec::{
    RecordSubject, Sentence, expect_end, expect_word, read_codelet, read_sentence, read_sentence_v4,
    subject_end, take_record_subject, take_text, take_uint32, take_uint32_vector, take_vector,
};
use super::volume_records::INDEX_SUBJECT;
use super::words::{
    ACCUSATIVE, LOCATIVE, DESTINATION, COMITATIVE, SOURCE, ESSIVE,
    INSTRUMENTAL,
};
use super::{ArgumentSlot, OperationSignatureKey};
use std::io::{Read, Seek};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Copy)]
pub(super) enum DirectIndexLookup<'a> {
    Canonical(&'a [u16]),
    Surface(&'a str, &'a str),
    Source(&'a str, &'a str, &'a str),
    Operation(&'a OperationSignatureKey),
}

#[derive(Debug)]
struct DirectIndexRecord {
    key: DirectIndexKey,
    offsets: Vec<u32>,
    next: u32,
}

#[derive(Debug, PartialEq, Eq)]
enum DirectIndexKey {
    Canonical(Vec<u16>),
    Surface(Vec<u16>, String),
    Source(String, String, String),
    Operation(Vec<u16>),
}

pub(super) fn lookup_v4<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    lookup: DirectIndexLookup<'_>,
) -> Result<Vec<u32>, DictionaryReadError> {
    let mut low = section.codelet_start;
    let mut high = section.codelet_start + section.codelet_count;
    while low < high {
        let probe = low + (high - low) / 2;
        let Some(record) = find_next_record(source, section, probe, high)? else {
            high = probe;
            continue;
        };
        match compare_lookup(&record.key, lookup) {
            std::cmp::Ordering::Less => low = record.next,
            std::cmp::Ordering::Equal => return Ok(record.offsets),
            std::cmp::Ordering::Greater => high = probe,
        }
    }

    let section_end = section.codelet_start + section.codelet_count;
    let mut ordinal = low;
    while ordinal < high && ordinal < section_end {
        let sentence = read_sentence_v4(source, ordinal, section_end)?;
        let record = parse_v4_record(&sentence, ordinal + sentence.consumed)?;
        match compare_lookup(&record.key, lookup) {
            std::cmp::Ordering::Less => ordinal = record.next,
            std::cmp::Ordering::Equal => return Ok(record.offsets),
            std::cmp::Ordering::Greater => break,
        }
    }
    Ok(Vec::new())
}

pub(super) fn next_canonical_offset_after<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    wanted: u32,
) -> Result<Option<u32>, DictionaryReadError> {
    let mut low = section.codelet_start;
    let mut high = section.codelet_start + section.codelet_count;
    while low < high {
        let probe = low + (high - low) / 2;
        let Some((record_start, record)) =
            find_canonical_record_at_or_before(source, section, probe)?
        else {
            high = probe;
            continue;
        };
        let offset = match record.key {
            DirectIndexKey::Canonical(_) => record.offsets[0],
            _ => return Err(invalid("canonical index contains a noncanonical row")),
        };
        if offset <= wanted {
            low = record.next;
        } else {
            high = record_start;
        }
    }
    let section_end = section.codelet_start + section.codelet_count;
    if low < section_end {
        let sentence = read_sentence_v4(source, low, section_end)?;
        let record = parse_v4_record(&sentence, low + sentence.consumed)?;
        let offset = match record.key {
            DirectIndexKey::Canonical(_) => record.offsets[0],
            _ => return Err(invalid("canonical index contains a noncanonical row")),
        };
        if offset > wanted {
            return Ok(Some(offset));
        }
    }
    Ok(None)
}

fn find_canonical_record_at_or_before<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    probe: u32,
) -> Result<Option<(u32, DirectIndexRecord)>, DictionaryReadError> {
    let mut start = probe;
    while start > section.codelet_start {
        if read_codelet(source, start - 1)?[0] & 1 != 0 {
            break;
        }
        start -= 1;
    }
    let section_end = section.codelet_start + section.codelet_count;
    let sentence = read_sentence_v4(source, start, section_end)?;
    let record = parse_v4_record(&sentence, start + sentence.consumed)?;
    if !matches!(record.key, DirectIndexKey::Canonical(_)) {
        return Err(invalid("canonical index contains a noncanonical row"));
    }
    Ok(Some((start, record)))
}

fn find_next_record<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    probe: u32,
    search_end: u32,
) -> Result<Option<DirectIndexRecord>, DictionaryReadError> {
    let section_end = section.codelet_start + section.codelet_count;
    let mut ordinal = probe;
    while ordinal < search_end {
        let starts_here = ordinal == section.codelet_start
            || (ordinal > section.codelet_start && read_codelet(source, ordinal - 1)?[0] & 1 != 0);
        if starts_here {
            match read_sentence_v4(source, ordinal, section_end) {
                Ok(sentence) => {
                    if let Ok(record) = parse_v4_record(&sentence, ordinal + sentence.consumed) {
                        return Ok(Some(record));
                    }
                }
                Err(DictionaryReadError::Io(error)) => {
                    return Err(DictionaryReadError::Io(error));
                }
                Err(_) => {}
            }
        }
        ordinal += 1;
    }
    Ok(None)
}

fn parse_v4_record(
    sentence: &Sentence,
    next: u32,
) -> Result<DirectIndexRecord, DictionaryReadError> {
    let words = &sentence.words;
    let mut cursor = 0;
    let subject = take_record_subject(sentence, &mut cursor)?;
    let key = match subject {
        RecordSubject::Name(name) => {
            let offset = take_uint32(words, &mut cursor)?;
            expect_word(words, &mut cursor, LOCATIVE)?;
            DirectIndexKey::Canonical(name).with_offsets(vec![offset], next)
        }
        RecordSubject::Text(surface) => {
            let first = take_text(words, &mut cursor)?;
            expect_word(words, &mut cursor, ESSIVE)?;
            let (key, offsets) = if words.get(cursor).copied() == Some(0x0e1d) {
                let release = take_text(words, &mut cursor)?;
                expect_word(words, &mut cursor, SOURCE)?;
                let dataset = first;
                let offsets = take_offsets(words, &mut cursor)?;
                expect_word(words, &mut cursor, LOCATIVE)?;
                (DirectIndexKey::Source(surface, dataset, release), offsets)
            } else {
                let offsets = take_offsets(words, &mut cursor)?;
                expect_word(words, &mut cursor, LOCATIVE)?;
                (
                    DirectIndexKey::Surface(surface.encode_utf16().collect(), first),
                    offsets,
                )
            };
            key.with_offsets(offsets, next)
        }
        RecordSubject::Uint16Vector(signature) => {
            let offsets = take_offsets(words, &mut cursor)?;
            expect_word(words, &mut cursor, LOCATIVE)?;
            DirectIndexKey::Operation(signature).with_offsets(offsets, next)
        }
    };
    expect_end(words, &mut cursor)?;
    Ok(key)
}

impl DirectIndexKey {
    fn with_offsets(self, offsets: Vec<u32>, next: u32) -> DirectIndexRecord {
        DirectIndexRecord {
            key: self,
            offsets,
            next,
        }
    }
}

fn take_offsets(words: &[u16], cursor: &mut usize) -> Result<Vec<u32>, DictionaryReadError> {
    let offsets = if words.get(*cursor).copied() == Some(0x901d) {
        vec![take_uint32(words, cursor)?]
    } else {
        take_uint32_vector(words, cursor)?
    };
    if offsets.is_empty() || offsets.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid(
            "index offsets must be non-empty and strictly increasing",
        ));
    }
    Ok(offsets)
}

fn compare_lookup(key: &DirectIndexKey, lookup: DirectIndexLookup<'_>) -> std::cmp::Ordering {
    match (key, lookup) {
        (DirectIndexKey::Canonical(key), DirectIndexLookup::Canonical(needle)) => {
            key.as_slice().cmp(needle)
        }
        (DirectIndexKey::Surface(surface, language), DirectIndexLookup::Surface(lang, form)) => {
            surface
                .as_slice()
                .cmp(form.encode_utf16().collect::<Vec<_>>().as_slice())
                .then_with(|| language.as_str().cmp(lang))
        }
        (
            DirectIndexKey::Source(identifier, dataset, release),
            DirectIndexLookup::Source(needle_dataset, needle_release, needle_identifier),
        ) => (identifier.as_str(), dataset.as_str(), release.as_str()).cmp(&(
            needle_identifier,
            needle_dataset,
            needle_release,
        )),
        (DirectIndexKey::Operation(signature), DirectIndexLookup::Operation(needle)) => signature
            .as_slice()
            .cmp(operation_key_words(needle).as_slice()),
        _ => std::cmp::Ordering::Greater,
    }
}

fn operation_key_words(key: &OperationSignatureKey) -> Vec<u16> {
    let mut words = Vec::new();
    append_sequence(&mut words, key.verb());
    append_sequence(&mut words, key.mood());
    words.push(key.arguments().len() as u16);
    for argument in key.arguments() {
        append_sequence(&mut words, &argument.grammatical_case);
        append_sequence(&mut words, &argument.noun_class);
    }
    words
}

fn append_sequence(output: &mut Vec<u16>, sequence: &[u16]) {
    output.push(sequence.len() as u16);
    output.extend(sequence);
}

pub(super) fn lookup_legacy_surface<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    limit: u32,
    language: &str,
    surface: &str,
) -> Result<Vec<Vec<u16>>, DictionaryReadError> {
    let normalized: String = surface.nfc().collect();
    let mut matches = Vec::new();
    for_each_sentence(source, section, limit, |_, words| {
        let mut cursor = index_subject(words)?;
        expect_text(words, &mut cursor, ACCUSATIVE, "language-surface")?;
        let candidate_language = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, ESSIVE)?;
        let candidate_surface = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, SOURCE)?;
        let key = take_vector(words, &mut cursor)?;
        expect_word(words, &mut cursor, DESTINATION)?;
        expect_end(words, &mut cursor)?;
        if candidate_language == language && candidate_surface == normalized {
            matches.push(key);
        }
        Ok(())
    })?;
    matches.sort_unstable();
    matches.dedup();
    Ok(matches)
}

pub(super) fn lookup_legacy_source<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    limit: u32,
    dataset: &str,
    release: &str,
    identifier: &str,
) -> Result<Vec<Vec<u16>>, DictionaryReadError> {
    let mut matches = Vec::new();
    for_each_sentence(source, section, limit, |_, words| {
        let mut cursor = index_subject(words)?;
        expect_text(words, &mut cursor, ACCUSATIVE, "external-source")?;
        let candidate_dataset = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, ESSIVE)?;
        let candidate_release = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, SOURCE)?;
        let candidate_identifier = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, DESTINATION)?;
        let key = take_vector(words, &mut cursor)?;
        expect_word(words, &mut cursor, INSTRUMENTAL)?;
        let _relation = take_text(words, &mut cursor)?;
        expect_word(words, &mut cursor, COMITATIVE)?;
        expect_end(words, &mut cursor)?;
        if candidate_dataset == dataset
            && candidate_release == release
            && candidate_identifier == identifier
        {
            matches.push(key);
        }
        Ok(())
    })?;
    matches.sort_unstable();
    matches.dedup();
    Ok(matches)
}

pub(super) fn lookup_legacy_operation<R: Read + Seek>(
    source: &mut R,
    section: &DictionarySection,
    limit: u32,
    lookup: &OperationSignatureKey,
) -> Result<Vec<Vec<u16>>, DictionaryReadError> {
    let mut matches = Vec::new();
    for_each_sentence(source, section, limit, |_, words| {
        let mut cursor = index_subject(words)?;
        expect_text(words, &mut cursor, ACCUSATIVE, "operation-signature")?;
        let dispatch = take_vector(words, &mut cursor)?;
        expect_word(words, &mut cursor, SOURCE)?;
        let key = take_vector(words, &mut cursor)?;
        expect_word(words, &mut cursor, DESTINATION)?;
        expect_end(words, &mut cursor)?;
        if &decode_signature(&dispatch)? == lookup {
            matches.push(key);
        }
        Ok(())
    })?;
    matches.sort_unstable();
    matches.dedup();
    Ok(matches)
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
        let sentence = read_sentence(source, ordinal, limit)?;
        visit(ordinal, &sentence.words)?;
        ordinal = ordinal
            .checked_add(sentence.consumed)
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
        let noun_class = take_sequence(words, &mut cursor)?;
        if grammatical_case.is_empty() || noun_class.is_empty() {
            return Err(invalid("operation argument type is empty"));
        }
        arguments.push(ArgumentSlot {
            grammatical_case,
            noun_class,
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
