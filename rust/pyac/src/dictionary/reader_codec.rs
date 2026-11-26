use super::reader::{DictionaryReadError, DictionarySection};
use super::volume::DictionaryMetadata;
use super::volume_records::{
    CONTENTS_SUBJECT, INDEX_SUBJECT, PROFILE_SUBJECT, PROFILE_VERSION, PROFILE_VERSION_V2,
    PROFILE_VERSION_V3, TOC_ROLES, TOC_ROLES_V4,
};
use super::words::{
    NAME_MARKER, TEXT_VERB, ACCUSATIVE, REALIS, LOCATIVE, DESTINATION, COMITATIVE,
    NOMINATIVE, NUMBER_QUOTE, SOURCE, ESSIVE, TEXT_QUOTE, UINT32_QUOTE,
    INSTRUMENTAL,
};
use crate::literal::decode_quote_header;
use crate::{CODELET_BYTES, FORMAT_VERSION, HEADER_BYTES, MAGIC, PyacError, WORDS_PER_CODELET};
use std::io::{Read, Seek, SeekFrom};
use std::ops::Range;

#[derive(Default)]
struct QuoteScan {
    explicit: Option<crate::literal::QuoteHeader>,
    remaining: usize,
}
pub(super) fn validate_header(header: &[u8; HEADER_BYTES]) -> Result<u32, DictionaryReadError> {
    if &header[..8] != MAGIC {
        return Err(PyacError::InvalidMagic.into());
    }
    let u16_at = |offset| u16::from_le_bytes([header[offset], header[offset + 1]]);
    let u32_at =
        |offset| u32::from_le_bytes(header[offset..offset + 4].try_into().expect("header field"));
    let version = u16_at(8);
    if version != FORMAT_VERSION {
        return Err(PyacError::UnsupportedVersion(version).into());
    }
    let word_bits = u16_at(10);
    let words = u16_at(12);
    if word_bits != 16 || words != WORDS_PER_CODELET as u16 {
        return Err(PyacError::UnsupportedWordLayout {
            word_bits,
            words_per_codelet: words,
        }
        .into());
    }
    let header_bytes = u16_at(14);
    let count = u32_at(16);
    let codelet_bytes = u32_at(20);
    let total_bytes = u32_at(24);
    let reserved = u32_at(28);
    let payload_bytes =
        (count as usize)
            .checked_mul(CODELET_BYTES)
            .ok_or(PyacError::LengthMismatch {
                expected: usize::MAX,
                declared: total_bytes,
                actual: 0,
            })?;
    let expected = HEADER_BYTES
        .checked_add(payload_bytes)
        .ok_or(PyacError::LengthMismatch {
            expected: usize::MAX,
            declared: total_bytes,
            actual: 0,
        })?;
    if header_bytes as usize != HEADER_BYTES
        || codelet_bytes as usize != CODELET_BYTES
        || reserved != 0
    {
        return Err(PyacError::InvalidHeader {
            header_bytes,
            codelet_bytes,
            reserved,
        }
        .into());
    }
    if total_bytes as usize != expected {
        return Err(PyacError::LengthMismatch {
            expected,
            declared: total_bytes,
            actual: expected,
        }
        .into());
    }
    Ok(count)
}

pub(super) fn read_codelet<R: Read + Seek>(
    source: &mut R,
    ordinal: u32,
) -> Result<[u16; WORDS_PER_CODELET], DictionaryReadError> {
    let offset = HEADER_BYTES as u64 + ordinal as u64 * CODELET_BYTES as u64;
    source.seek(SeekFrom::Start(offset))?;
    let mut bytes = [0; CODELET_BYTES];
    source.read_exact(&mut bytes)?;
    let mut words = [0; WORDS_PER_CODELET];
    for (index, word) in words.iter_mut().enumerate() {
        *word = u16::from_le_bytes([bytes[index * 2], bytes[index * 2 + 1]]);
    }
    Ok(words)
}

/// A decoded sentence: its words, and for each word whether a grammatical case
/// boundary follows it. The boundary flags come from the codelet header bitmap,
/// so a decoder never has to look for a delimiter that could also appear inside
/// a value — which is what broke keys such as `na`, whose word is itself the
/// nominative marker `0x24DE`.
pub(crate) struct Sentence {
    pub words: Vec<u16>,
    pub boundaries: Vec<bool>,
    pub consumed: u32,
}

pub(super) fn read_sentence<R: Read + Seek>(
    source: &mut R,
    start: u32,
    limit: u32,
) -> Result<Sentence, DictionaryReadError> {
    read_sentence_with_raw_width(source, start, limit, WORDS_PER_CODELET, false)
}

pub(super) fn read_sentence_v4<R: Read + Seek>(
    source: &mut R,
    start: u32,
    limit: u32,
) -> Result<Sentence, DictionaryReadError> {
    read_sentence_with_raw_width(source, start, limit, WORDS_PER_CODELET - 1, true)
}

/// Whether slot `slot` of `codelet` holds the last word of a case.
///
/// The writer marks boundaries positively in a sentence's final codelet and
/// negatively in earlier ones (`pack_words` sets a bit when
/// `boundary == complete`), so the polarity depends on the completion bit.
fn slot_is_boundary(codelet: &[u16; WORDS_PER_CODELET], slot: usize, complete: bool) -> bool {
    let set = (codelet[0] >> slot) & 1 == 1;
    if complete { set } else { !set }
}

fn read_sentence_with_raw_width<R: Read + Seek>(
    source: &mut R,
    start: u32,
    limit: u32,
    raw_width: usize,
    indexed_raw: bool,
) -> Result<Sentence, DictionaryReadError> {
    let mut words = Vec::new();
    let mut boundaries = Vec::new();
    let mut scan = QuoteScan::default();
    let mut ordinal = start;
    loop {
        if ordinal >= limit {
            return Err(DictionaryReadError::InvalidRecord("sentence is truncated"));
        }
        let codelet = read_codelet(source, ordinal)?;
        ordinal += 1;
        let raw = scan_raw_text(&codelet, &mut scan);
        let used_slots = raw.map_or(WORDS_PER_CODELET - 1, |(_, slot)| slot);
        let complete = codelet[0] & 1 != 0;
        for slot in 1..=used_slots {
            words.push(codelet[slot]);
            boundaries.push(slot_is_boundary(&codelet, slot, complete));
        }
        if let Some((length, _)) = raw {
            let mut remaining = length;
            for _ in 0..length.div_ceil(raw_width) {
                if ordinal >= limit {
                    return Err(DictionaryReadError::InvalidRecord(
                        "raw text quote is truncated",
                    ));
                }
                let raw_codelet = read_codelet(source, ordinal)?;
                ordinal += 1;
                if indexed_raw && raw_codelet[0] != 0 {
                    return Err(DictionaryReadError::InvalidRecord(
                        "raw text continuation has a nonzero codelet index",
                    ));
                }
                let payload_start = usize::from(indexed_raw);
                let used = remaining.min(raw_width);
                for slot in payload_start..payload_start + used {
                    words.push(raw_codelet[slot]);
                    // Continuation payload is literal text, never a case boundary.
                    boundaries.push(false);
                }
                remaining -= used;
            }
        } else if complete {
            while words.last() == Some(&0) {
                words.pop();
                boundaries.pop();
            }
            return Ok(Sentence {
                words,
                boundaries,
                consumed: ordinal - start,
            });
        }
    }
}

fn scan_raw_text(
    codelet: &[u16; WORDS_PER_CODELET],
    scan: &mut QuoteScan,
) -> Option<(usize, usize)> {
    for slot in 1..WORDS_PER_CODELET {
        let word = codelet[slot];
        if scan.remaining > 0 {
            scan.remaining -= 1;
            continue;
        }
        if let Some(header) = scan.explicit.take() {
            let count = word as usize;
            if header.sort == 0 && header.scalar_bytes == 2 && count > 14 {
                return Some((count, slot));
            }
            scan.remaining = count * (header.scalar_bytes / 2);
            continue;
        }
        if let Some(header) = decode_quote_header(word) {
            if header.explicit_vector_length {
                scan.explicit = Some(header);
            } else if let Some(count) = header.vector_words {
                scan.remaining = count * (header.scalar_bytes / 2);
            }
        }
    }
    None
}

pub(super) fn subject_end(words: &[u16], expected: &[u16]) -> Result<usize, DictionaryReadError> {
    if words.len() < expected.len() + 2
        || words[0] != NAME_MARKER
        || words[1..1 + expected.len()] != *expected
    {
        return Err(DictionaryReadError::InvalidRecord(
            "sentence has an unexpected Pyash subject",
        ));
    }
    // `expected` is a fixed constant that never contains a structural marker, so
    // the value check is unambiguous here. Variable dict keys go through
    // `take_record_subject`, which uses the boundary flags instead.
    let case = 1 + expected.len();
    if words[case] != NOMINATIVE {
        return Err(DictionaryReadError::InvalidRecord(
            "subject is missing its nominative case boundary",
        ));
    }
    Ok(case + 1)
}

pub(super) fn take_text(words: &[u16], cursor: &mut usize) -> Result<String, DictionaryReadError> {
    if words.get(*cursor) != Some(&TEXT_QUOTE) {
        return Err(DictionaryReadError::InvalidRecord(
            "expected a typed text quote",
        ));
    }
    let count = *words
        .get(*cursor + 1)
        .ok_or(DictionaryReadError::InvalidRecord("truncated text length"))?
        as usize;
    let end = cursor
        .checked_add(2 + count)
        .ok_or(DictionaryReadError::InvalidRecord("text length overflow"))?;
    let payload = words
        .get(*cursor + 2..end)
        .ok_or(DictionaryReadError::InvalidRecord("truncated text payload"))?;
    let value = String::from_utf16(payload)
        .map_err(|_| DictionaryReadError::InvalidRecord("text quote has invalid UTF-16"))?;
    *cursor = end;
    Ok(value)
}

pub(super) fn take_vector(
    words: &[u16],
    cursor: &mut usize,
) -> Result<Vec<u16>, DictionaryReadError> {
    let header_word = *words
        .get(*cursor)
        .ok_or(DictionaryReadError::InvalidRecord("missing vector quote"))?;
    let header = decode_quote_header(header_word).ok_or(DictionaryReadError::InvalidRecord(
        "invalid vector quote header",
    ))?;
    if header.sort != 4 || header.scalar_bytes != 2 {
        return Err(DictionaryReadError::InvalidRecord(
            "expected a uint16 vector quote",
        ));
    }
    *cursor += 1;
    let count = if header.explicit_vector_length {
        let count = *words
            .get(*cursor)
            .ok_or(DictionaryReadError::InvalidRecord("missing vector length"))?
            as usize;
        *cursor += 1;
        count
    } else {
        header
            .vector_words
            .ok_or(DictionaryReadError::InvalidRecord(
                "unsupported vector thickness",
            ))?
    };
    let end = cursor
        .checked_add(count)
        .ok_or(DictionaryReadError::InvalidRecord("vector length overflow"))?;
    let values = words
        .get(*cursor..end)
        .ok_or(DictionaryReadError::InvalidRecord(
            "truncated vector payload",
        ))?
        .to_vec();
    *cursor = end;
    Ok(values)
}

pub(super) fn take_uint32(words: &[u16], cursor: &mut usize) -> Result<u32, DictionaryReadError> {
    expect_word(words, cursor, UINT32_QUOTE)?;
    let low = *words
        .get(*cursor)
        .ok_or(DictionaryReadError::InvalidRecord("truncated uint32 quote"))?;
    let high = *words
        .get(*cursor + 1)
        .ok_or(DictionaryReadError::InvalidRecord("truncated uint32 quote"))?;
    *cursor += 2;
    Ok(low as u32 | ((high as u32) << 16))
}

pub(super) fn take_uint32_vector(
    words: &[u16],
    cursor: &mut usize,
) -> Result<Vec<u32>, DictionaryReadError> {
    let header_word = *words
        .get(*cursor)
        .ok_or(DictionaryReadError::InvalidRecord(
            "missing uint32 vector quote",
        ))?;
    let header = decode_quote_header(header_word).ok_or(DictionaryReadError::InvalidRecord(
        "invalid uint32 vector quote header",
    ))?;
    if header.sort != 4 || header.scalar_bytes != 4 {
        return Err(DictionaryReadError::InvalidRecord(
            "expected a uint32 vector quote",
        ));
    }
    *cursor += 1;
    let count = if header.explicit_vector_length {
        let count = *words
            .get(*cursor)
            .ok_or(DictionaryReadError::InvalidRecord(
                "missing uint32 vector length",
            ))? as usize;
        *cursor += 1;
        count
    } else {
        header
            .vector_words
            .ok_or(DictionaryReadError::InvalidRecord(
                "unsupported uint32 vector thickness",
            ))?
    };
    let word_count = count
        .checked_mul(2)
        .ok_or(DictionaryReadError::InvalidRecord(
            "uint32 vector length overflow",
        ))?;
    let end = cursor
        .checked_add(word_count)
        .ok_or(DictionaryReadError::InvalidRecord(
            "uint32 vector length overflow",
        ))?;
    let payload = words
        .get(*cursor..end)
        .ok_or(DictionaryReadError::InvalidRecord(
            "truncated uint32 vector payload",
        ))?;
    let values = payload
        .chunks_exact(2)
        .map(|pair| pair[0] as u32 | ((pair[1] as u32) << 16))
        .collect();
    *cursor = end;
    Ok(values)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RecordSubject {
    Name(Vec<u16>),
    Text(String),
    Uint16Vector(Vec<u16>),
}

pub(super) fn take_record_subject(
    sentence: &Sentence,
    cursor: &mut usize,
) -> Result<RecordSubject, DictionaryReadError> {
    let words = &sentence.words;
    match words.get(*cursor).copied() {
        Some(NAME_MARKER) => {
            // The key runs from after NAME_MARKER to the first word whose boundary
            // flag is set. Scanning for the NOMINATIVE *value* is wrong: a key word may
            // itself be NOMINATIVE, which is exactly the `na` case (0x24DE).
            *cursor += 1;
            let start = *cursor;
            let end = sentence
                .boundaries
                .iter()
                .enumerate()
                .skip(start)
                .find(|(_, boundary)| **boundary)
                .map(|(index, _)| index)
                .ok_or(DictionaryReadError::InvalidRecord(
                    "name subject has no case boundary",
                ))?;
            if end == start {
                return Err(DictionaryReadError::InvalidRecord("empty name subject"));
            }
            if words.get(end) != Some(&NOMINATIVE) {
                return Err(DictionaryReadError::InvalidRecord(
                    "name subject does not end at a nominative boundary",
                ));
            }
            *cursor = end + 1;
            Ok(RecordSubject::Name(words[start..end].to_vec()))
        }
        Some(TEXT_QUOTE) => {
            let value = take_text(words, cursor)?;
            expect_word(words, cursor, NOMINATIVE)?;
            Ok(RecordSubject::Text(value))
        }
        Some(header)
            if decode_quote_header(header)
                .is_some_and(|item| item.sort == 4 && item.scalar_bytes == 2) =>
        {
            let value = take_vector(words, cursor)?;
            expect_word(words, cursor, NOMINATIVE)?;
            Ok(RecordSubject::Uint16Vector(value))
        }
        _ => Err(DictionaryReadError::InvalidRecord(
            "unsupported dictionary index subject type",
        )),
    }
}

pub(super) fn expect_word(
    words: &[u16],
    cursor: &mut usize,
    expected: u16,
) -> Result<(), DictionaryReadError> {
    if words.get(*cursor) != Some(&expected) {
        return Err(DictionaryReadError::UnexpectedWord {
            expected,
            actual: words.get(*cursor).copied(),
            offset: *cursor,
        });
    }
    *cursor += 1;
    Ok(())
}

pub(super) fn expect_end(words: &[u16], cursor: &mut usize) -> Result<(), DictionaryReadError> {
    expect_word(words, cursor, TEXT_VERB)?;
    expect_word(words, cursor, REALIS)?;
    if *cursor != words.len() {
        return Err(DictionaryReadError::InvalidRecord(
            "record has trailing words",
        ));
    }
    Ok(())
}

pub(super) fn parse_marker(words: &[u16]) -> Result<String, DictionaryReadError> {
    let mut cursor = subject_end(words, &PROFILE_SUBJECT)?;
    let kind = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, ACCUSATIVE)?;
    expect_end(words, &mut cursor)?;
    Ok(kind)
}

fn take_number(words: &[u16], cursor: &mut usize) -> Result<u16, DictionaryReadError> {
    expect_word(words, cursor, NUMBER_QUOTE)?;
    let value = *words
        .get(*cursor)
        .ok_or(DictionaryReadError::InvalidRecord("truncated uint16 quote"))?;
    *cursor += 1;
    Ok(value)
}

pub(super) fn parse_metadata(
    words: &[u16],
) -> Result<(DictionaryMetadata, usize, String, Option<u32>), DictionaryReadError> {
    let mut cursor = subject_end(words, &PROFILE_SUBJECT)?;
    let title = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, ACCUSATIVE)?;
    let revision_words = take_vector(words, &mut cursor)?;
    if revision_words.len() != 2 {
        return Err(DictionaryReadError::InvalidRecord(
            "revision must be a uint32 pair",
        ));
    }
    expect_word(words, &mut cursor, ESSIVE)?;
    let language_text = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, SOURCE)?;
    let languages = language_text
        .split(',')
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let normalization_policy = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, DESTINATION)?;
    let toc_count = take_number(words, &mut cursor)? as usize;
    expect_word(words, &mut cursor, INSTRUMENTAL)?;
    let profile_version = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, COMITATIVE)?;
    let entry_count = if profile_version == PROFILE_VERSION {
        let value = take_uint32(words, &mut cursor)?;
        expect_word(words, &mut cursor, LOCATIVE)?;
        Some(value)
    } else {
        None
    };
    expect_end(words, &mut cursor)?;
    if ![PROFILE_VERSION, PROFILE_VERSION_V3, PROFILE_VERSION_V2]
        .contains(&profile_version.as_str())
        || languages.iter().any(String::is_empty)
    {
        return Err(DictionaryReadError::InvalidRecord(
            "unsupported profile revision or invalid language list",
        ));
    }
    Ok((
        DictionaryMetadata {
            kind: String::new(),
            title,
            revision: revision_words[0] as u32 | ((revision_words[1] as u32) << 16),
            languages,
            normalization_policy,
        },
        toc_count,
        profile_version,
        entry_count,
    ))
}

pub(super) fn parse_toc_v4(
    words: &[u16],
    expected_ordinal: u16,
    role: &str,
) -> Result<DictionarySection, DictionaryReadError> {
    let mut cursor = subject_end(words, &CONTENTS_SUBJECT)?;
    let ordinal = take_number(words, &mut cursor)?;
    expect_word(words, &mut cursor, ACCUSATIVE)?;
    let range = take_vector(words, &mut cursor)?;
    expect_word(words, &mut cursor, SOURCE)?;
    expect_end(words, &mut cursor)?;
    if ordinal != expected_ordinal || range.len() != 4 {
        return Err(DictionaryReadError::InvalidRecord(
            "v4 TOC ordinal or range shape is invalid",
        ));
    }
    Ok(DictionarySection {
        role: role.to_owned(),
        codelet_start: range[0] as u32 | ((range[1] as u32) << 16),
        codelet_count: range[2] as u32 | ((range[3] as u32) << 16),
    })
}

pub(super) fn parse_toc(words: &[u16]) -> Result<DictionarySection, DictionaryReadError> {
    let mut cursor = subject_end(words, &CONTENTS_SUBJECT)?;
    let role = take_text(words, &mut cursor)?;
    expect_word(words, &mut cursor, ACCUSATIVE)?;
    let range = take_vector(words, &mut cursor)?;
    expect_word(words, &mut cursor, SOURCE)?;
    expect_end(words, &mut cursor)?;
    if range.len() != 4 {
        return Err(DictionaryReadError::InvalidRecord(
            "TOC range must contain four uint16 words",
        ));
    }
    Ok(DictionarySection {
        role,
        codelet_start: range[0] as u32 | ((range[1] as u32) << 16),
        codelet_count: range[2] as u32 | ((range[3] as u32) << 16),
    })
}

pub(super) fn parse_location(
    words: &[u16],
) -> Result<(Vec<u16>, Range<u32>, Range<u32>), DictionaryReadError> {
    let mut cursor = subject_end(words, &INDEX_SUBJECT)?;
    if take_text(words, &mut cursor)? != "entry-location" {
        return Err(DictionaryReadError::InvalidRecord(
            "expected an entry-location posting",
        ));
    }
    expect_word(words, &mut cursor, ACCUSATIVE)?;
    let key = take_vector(words, &mut cursor)?;
    expect_word(words, &mut cursor, SOURCE)?;
    let range = take_vector(words, &mut cursor)?;
    expect_word(words, &mut cursor, DESTINATION)?;
    let definition_words = take_vector(words, &mut cursor)?;
    expect_word(words, &mut cursor, COMITATIVE)?;
    expect_end(words, &mut cursor)?;
    if key.is_empty() || range.len() != 4 || definition_words.len() != 4 {
        return Err(DictionaryReadError::InvalidRecord(
            "invalid entry-location key or ranges",
        ));
    }
    let decode_range = |range: &[u16]| -> Result<Range<u32>, DictionaryReadError> {
        let start = range[0] as u32 | ((range[1] as u32) << 16);
        let count = range[2] as u32 | ((range[3] as u32) << 16);
        Ok(start
            ..start
                .checked_add(count)
                .ok_or(DictionaryReadError::InvalidRecord("entry range overflow"))?)
    };
    let entry_range = decode_range(&range)?;
    let definition_range = decode_range(&definition_words)?;
    if entry_range.is_empty()
        || definition_range.start < entry_range.start
        || definition_range.end > entry_range.end
    {
        return Err(DictionaryReadError::InvalidRecord(
            "definition range is outside its dictionary entry",
        ));
    }
    Ok((key, entry_range, definition_range))
}

pub(super) fn validate_sections(
    sections: &[DictionarySection],
    marker_count: u32,
    metadata_count: u32,
    toc_end: u32,
    pack_count: u32,
) -> Result<(), DictionaryReadError> {
    if sections.len() != TOC_ROLES.len()
        || sections[0].codelet_start != marker_count
        || sections[0].codelet_count != metadata_count
    {
        return Err(DictionaryReadError::InvalidRecord(
            "metadata TOC range does not match its physical range",
        ));
    }
    let mut expected = toc_end;
    for (section, role) in sections.iter().skip(1).zip(TOC_ROLES.iter().skip(1)) {
        if section.role != *role || section.codelet_start != expected {
            return Err(DictionaryReadError::InvalidRecord(
                "TOC section order or range is noncanonical",
            ));
        }
        expected = expected
            .checked_add(section.codelet_count)
            .ok_or(DictionaryReadError::InvalidRecord("TOC range overflow"))?;
    }
    if expected != pack_count {
        return Err(DictionaryReadError::InvalidRecord(
            "TOC does not cover the complete pack",
        ));
    }
    Ok(())
}

pub(super) fn validate_sections_v4(
    sections: &[DictionarySection],
    toc_end: u32,
    pack_count: u32,
    entry_count: u32,
) -> Result<(), DictionaryReadError> {
    if sections.len() != TOC_ROLES_V4.len() || entry_count == 0 {
        return Err(DictionaryReadError::InvalidRecord(
            "v4 section count or dictionary entry count is invalid",
        ));
    }
    let mut expected = toc_end;
    for (section, role) in sections.iter().zip(TOC_ROLES_V4) {
        if section.role != role || section.codelet_start != expected {
            return Err(DictionaryReadError::InvalidRecord(
                "v4 TOC section order or range is noncanonical",
            ));
        }
        expected = expected
            .checked_add(section.codelet_count)
            .ok_or(DictionaryReadError::InvalidRecord("v4 TOC range overflow"))?;
    }
    if expected != pack_count || sections[0].codelet_count == 0 || sections[4].codelet_count == 0 {
        return Err(DictionaryReadError::InvalidRecord(
            "v4 TOC does not cover the pack or required sections are empty",
        ));
    }
    Ok(())
}
