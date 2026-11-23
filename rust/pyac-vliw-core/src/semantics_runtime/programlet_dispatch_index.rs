#[cfg(not(target_arch = "spirv"))]
use super::programlet_dispatch_signature::compare_keys;
use super::programlet_dispatch_signature::{
    MAX_ROUTINE_SIGNATURE_CASES, SignatureCase, append_case, canonical_type, formal_type,
    insert_case, sort_cases,
};
use super::programlet_symbols::ProgramletWordSource;
use super::*;

#[cfg(not(target_arch = "spirv"))]
#[path = "programlet_dispatch_index/body_scan.rs"]
mod body_scan;
#[path = "programlet_dispatch_index/wire.rs"]
mod wire;

pub use wire::PROGRAMLET_ROUTINE_DIRECTORY_WORDS;
#[cfg(not(target_arch = "spirv"))]
pub use wire::build_programlet_routine_directory_words;
#[cfg(target_arch = "spirv")]
pub(super) use wire::read_programlet_routine_directory_header;
#[cfg(not(target_arch = "spirv"))]
pub(super) use wire::validate_programlet_routine_directory_words;
use wire::{read_programlet_routine_entry, read_programlet_routine_signature_word};

#[derive(Clone, Copy)]
struct RoutineEntry {
    signature_start: u32,
    signature_length: u32,
    verb_start: u32,
    verb_length: u32,
    definition_start: u32,
    routine_start: u32,
    routine_end: u32,
    output_name_start: u32,
    output_name_length: u32,
    output_kind: u32,
}

impl RoutineEntry {
    const EMPTY: Self = Self {
        signature_start: 0,
        signature_length: 0,
        verb_start: 0,
        verb_length: 0,
        definition_start: 0,
        routine_start: 0,
        routine_end: 0,
        output_name_start: 0,
        output_name_length: 0,
        output_kind: 0,
    };
}

#[cfg(not(target_arch = "spirv"))]
pub(super) struct ProgramletRoutineDirectory {
    entries: [RoutineEntry; MAX_PROGRAMLET_CODELETS],
    signatures: [u32; MAX_PROGRAMLET_PAYLOAD_WORDS],
    entry_count: usize,
    signature_used: usize,
}

#[cfg(not(target_arch = "spirv"))]
impl ProgramletRoutineDirectory {
    pub(super) const EMPTY: Self = Self {
        entries: [RoutineEntry::EMPTY; MAX_PROGRAMLET_CODELETS],
        signatures: [0; MAX_PROGRAMLET_PAYLOAD_WORDS],
        entry_count: 0,
        signature_used: 0,
    };
}

#[derive(Clone, Copy)]
pub(super) struct SelectedProgramletRoutine {
    pub(super) name: NameSpan,
    pub(super) output_name: NameSpan,
    pub(super) output_kind: u32,
    pub(super) definition_start: usize,
    pub(super) routine_start: usize,
    pub(super) routine_end: usize,
}

#[cfg(not(target_arch = "spirv"))]
fn check_status(status: u32) -> Result<(), u32> {
    if status == 0 { Ok(()) } else { Err(status) }
}

#[cfg(not(target_arch = "spirv"))]
fn append_name(
    source: &impl ProgramletWordSource,
    name: NameSpan,
    destination: &mut [u32; MAX_PROGRAMLET_PAYLOAD_WORDS],
    used: &mut usize,
) -> Result<usize, u32> {
    let end = used.checked_add(name.length).ok_or(ERROR_FRAME_CAPACITY)?;
    let source_end = name
        .start
        .checked_add(name.length)
        .ok_or(ERROR_FRAME_CAPACITY)?;
    if end > destination.len() || source_end > source.word_count() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let start = *used;
    let mut index = 0;
    while index < name.length {
        array_put!(
            destination,
            start + index,
            source.word_at(name.start + index).ok_or(ERROR_MALFORMED)?
        );
        index += 1;
    }
    *used = end;
    Ok(start)
}

#[cfg(not(target_arch = "spirv"))]
fn definition_signature(
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    directory: &mut ProgramletRoutineDirectory,
) -> Result<(usize, usize, NameSpan, usize, usize, usize, u32), u32> {
    let name_field = sentence.field(NOMINATIVE).ok_or(ERROR_MALFORMED)?;
    let output_field = sentence.field(DESTINATION).ok_or(ERROR_MALFORMED)?;
    let mut verb = NameSpan::EMPTY;
    check_status(name_span(tokens, name_field, false, &mut verb))?;
    let mut output_name = NameSpan::EMPTY;
    let mut output_kind = 0;
    check_status(typed_output_name(
        tokens,
        output_field,
        &mut output_name,
        &mut output_kind,
    ))?;

    let signature_start = directory.signature_used;
    let mut cases = [SignatureCase::EMPTY; MAX_ROUTINE_SIGNATURE_CASES];
    let mut case_count = 0;
    let fields = sentence.fields;
    let mut field_index = 0;
    while field_index < sentence.field_count {
        let field = array_at!(fields, field_index);
        if field.role != NOMINATIVE
            && field.role != DESTINATION
            && field.role != FROM_INDEX
            && field.role != TO_INDEX
        {
            insert_case(
                &mut cases,
                &mut case_count,
                field.role,
                formal_type(tokens, field)?,
            )?;
        }
        field_index += 1;
    }
    insert_case(
        &mut cases,
        &mut case_count,
        DESTINATION,
        canonical_type(output_kind)?,
    )?;
    sort_cases(&mut cases);
    let mut index = 0;
    while index < case_count {
        append_case(
            &mut directory.signatures,
            &mut directory.signature_used,
            array_at!(cases, index),
        )?;
        index += 1;
    }
    let verb_start = append_name(
        tokens,
        verb,
        &mut directory.signatures,
        &mut directory.signature_used,
    )?;
    let signature_length = directory.signature_used - signature_start;
    let output_name_start = append_name(
        tokens,
        output_name,
        &mut directory.signatures,
        &mut directory.signature_used,
    )?;
    Ok((
        signature_start,
        signature_length,
        verb,
        verb_start,
        output_name_start,
        output_name.length,
        output_kind,
    ))
}

#[cfg(not(target_arch = "spirv"))]
pub(super) fn build_programlet_routine_directory(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    directory: &mut ProgramletRoutineDirectory,
) -> Result<(), u32> {
    directory.entries = [RoutineEntry::EMPTY; MAX_PROGRAMLET_CODELETS];
    directory.signatures = [0; MAX_PROGRAMLET_PAYLOAD_WORDS];
    directory.entry_count = 0;
    directory.signature_used = 0;
    let mut cursor = 0;
    while cursor < codelet_count {
        let (definition_length, definition_end) = collect_sentence_at(
            words,
            base_codelet + codelet_count,
            base_codelet,
            codelet_count,
            cursor,
        )?;
        let definition_view = SentenceView::new(words, base_codelet + cursor, definition_length);
        if sentence_at!(definition_view, definition_view.len() - 1) != MOOD_DEFINITION {
            cursor = definition_end;
            continue;
        }
        let mut definition = ParsedSentence::empty();
        let parse_error = parse_sentence(&definition_view, &mut definition);
        if parse_error != 0 {
            return Err(parse_error);
        }
        if !is_ceremony_definition(&definition, &definition_view) {
            cursor = definition_end;
            continue;
        }
        let (
            signature_start,
            signature_length,
            verb,
            verb_start,
            output_name_start,
            output_name_length,
            output_kind,
        ) = definition_signature(&definition, &definition_view, directory)?;
        let body_start = definition_end;
        let body_end = body_scan::find_routine_body_end(
            words,
            base_codelet,
            codelet_count,
            body_start,
            &directory.signatures,
            verb_start,
            verb.length,
        )?;
        if directory.entry_count == directory.entries.len() {
            return Err(ERROR_PROGRAM_CAPACITY);
        }
        array_put!(
            &mut directory.entries,
            directory.entry_count,
            RoutineEntry {
                signature_start: signature_start as u32,
                signature_length: signature_length as u32,
                verb_start: verb_start as u32,
                verb_length: verb.length as u32,
                definition_start: cursor as u32,
                routine_start: body_start as u32,
                routine_end: body_end as u32,
                output_name_start: output_name_start as u32,
                output_name_length: output_name_length as u32,
                output_kind,
            }
        );
        directory.entry_count += 1;
        cursor = body_end;
    }
    sort_directory(directory)
}

#[cfg(not(target_arch = "spirv"))]
fn sort_directory(directory: &mut ProgramletRoutineDirectory) -> Result<(), u32> {
    let mut index = 1;
    while index < directory.entry_count {
        let entry = array_at!(&directory.entries, index);
        let mut destination = index;
        while destination > 0 {
            let previous = array_at!(&directory.entries, destination - 1);
            if compare_keys(
                &directory.signatures,
                entry.signature_start as usize,
                entry.signature_length as usize,
                previous.signature_start as usize,
                previous.signature_length as usize,
            ) >= 0
            {
                break;
            }
            array_put!(&mut directory.entries, destination, previous);
            destination -= 1;
        }
        array_put!(&mut directory.entries, destination, entry);
        index += 1;
    }
    let mut index = 1;
    while index < directory.entry_count {
        let previous = array_at!(&directory.entries, index - 1);
        let current = array_at!(&directory.entries, index);
        if compare_keys(
            &directory.signatures,
            previous.signature_start as usize,
            previous.signature_length as usize,
            current.signature_start as usize,
            current.signature_length as usize,
        ) == 0
        {
            return Err(ERROR_DUPLICATE_SIGNATURE);
        }
        index += 1;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct CallSignature {
    cases: [SignatureCase; MAX_ROUTINE_SIGNATURE_CASES],
    case_count: usize,
    verb_start: usize,
    length: usize,
}

impl CallSignature {
    fn word_at(&self, index: usize, tokens: &SentenceView<'_>) -> Option<u32> {
        if index >= self.length {
            return None;
        }
        let mut offset = 0;
        macro_rules! case_word {
            ($case_index:literal) => {{
                if self.case_count > $case_index {
                    let case = self.cases[$case_index];
                    if index == offset {
                        return Some(case.value_type.words[0]);
                    }
                    offset += 1;
                    if case.value_type.length > 1 {
                        if index == offset {
                            return Some(case.value_type.words[1]);
                        }
                        offset += 1;
                    }
                    if index == offset {
                        return Some(case.role);
                    }
                    offset += 1;
                }
            }};
        }
        case_word!(0);
        case_word!(1);
        case_word!(2);
        case_word!(3);
        case_word!(4);
        case_word!(5);
        case_word!(6);
        case_word!(7);
        case_word!(8);
        tokens.token(self.verb_start + index - offset)
    }
}

fn make_call_signature(
    sentence: &ParsedSentence,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
    output_kind: u32,
    tokens: &SentenceView<'_>,
) -> Result<CallSignature, u32> {
    if argument_count as usize > arguments.len() {
        return Err(ERROR_FRAME_CAPACITY);
    }
    let mut cases = [SignatureCase::EMPTY; MAX_ROUTINE_SIGNATURE_CASES];
    let mut case_count = 0;
    let mut index = 0;
    while index < argument_count as usize {
        let argument = array_at!(*arguments, index);
        if argument.role != FROM_INDEX && argument.role != TO_INDEX {
            insert_case(
                &mut cases,
                &mut case_count,
                argument.role,
                canonical_type(argument.value_kind)?,
            )?;
        }
        index += 1;
    }
    insert_case(
        &mut cases,
        &mut case_count,
        DESTINATION,
        canonical_type(output_kind)?,
    )?;
    sort_cases(&mut cases);
    let mut case_words = 0;
    index = 0;
    while index < case_count {
        case_words += array_at!(cases, index).value_type.length + 1;
        index += 1;
    }
    if sentence.verb_length == 0 || case_words + sentence.verb_length > MAX_PROGRAMLET_PAYLOAD_WORDS
    {
        return Err(ERROR_MALFORMED);
    }
    index = 0;
    while index < sentence.verb_length {
        let Some(token) = tokens.token(sentence.verb_start + index) else {
            return Err(ERROR_MALFORMED);
        };
        if token > MAX_U16 {
            return Err(ERROR_MALFORMED);
        }
        index += 1;
    }
    Ok(CallSignature {
        cases,
        case_count,
        verb_start: sentence.verb_start,
        length: case_words + sentence.verb_length,
    })
}

pub(super) fn resolve_programlet_routine(
    directory_words: &[u32],
    directory_offset: usize,
    entry_count: usize,
    signature_used: usize,
    sentence: &ParsedSentence,
    tokens: &SentenceView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_PAYLOAD_WORDS],
    symbol_used: &mut usize,
    arguments: &[ProgramletArgument; MAX_PROGRAMLET_ARGUMENTS],
    argument_count: u32,
    output_kind: u32,
) -> Result<SelectedProgramletRoutine, u32> {
    let key = make_call_signature(sentence, arguments, argument_count, output_kind, tokens)?;
    let signature_base = directory_offset + wire::SIGNATURE_BASE;
    let mut low = 0;
    let mut high = entry_count;
    while low < high {
        let middle = low + (high - low) / 2;
        let entry =
            read_programlet_routine_entry(directory_words, directory_offset, middle, entry_count);
        let signature_length = entry.signature_length as usize;
        let common = signature_length.min(key.length);
        let mut index = 0;
        let mut ordering = 0;
        while index < common {
            let left = read_programlet_routine_signature_word(
                directory_words,
                directory_offset,
                entry.signature_start as usize + index,
                signature_used,
            );
            let right = key.word_at(index, tokens).ok_or(ERROR_MALFORMED)?;
            if left != right {
                ordering = if left < right { -1 } else { 1 };
                break;
            }
            index += 1;
        }
        if ordering == 0 {
            ordering = if signature_length < key.length {
                -1
            } else if signature_length > key.length {
                1
            } else {
                0
            };
        }
        if ordering < 0 {
            low = middle + 1;
            continue;
        }
        if ordering > 0 {
            high = middle;
            continue;
        }
        let mut name = NameSpan::EMPTY;
        let name_error = store_name_from_slice(
            directory_words,
            signature_base,
            NameSpan {
                start: entry.verb_start as usize,
                length: entry.verb_length as usize,
            },
            symbol_words,
            symbol_used,
            &mut name,
        );
        if name_error != 0 {
            return Err(name_error);
        }
        let mut output_name = NameSpan::EMPTY;
        let output_name_error = store_name_from_slice(
            directory_words,
            signature_base,
            NameSpan {
                start: entry.output_name_start as usize,
                length: entry.output_name_length as usize,
            },
            symbol_words,
            symbol_used,
            &mut output_name,
        );
        if output_name_error != 0 {
            return Err(output_name_error);
        }
        return Ok(SelectedProgramletRoutine {
            name,
            output_name,
            output_kind: entry.output_kind,
            definition_start: entry.definition_start as usize,
            routine_start: entry.routine_start as usize,
            routine_end: entry.routine_end as usize,
        });
    }
    Err(ERROR_UNSUPPORTED)
}
