use super::*;

pub(super) const DIRECTORY_MAGIC: u32 = 0x5059_0001;
pub(super) const HEADER_WORDS: usize = 3;
pub(super) const ENTRY_WORDS: usize = 10;
pub(super) const ENTRY_BASE: usize = HEADER_WORDS;
pub(super) const SIGNATURE_BASE: usize = ENTRY_BASE + MAX_PROGRAMLET_ROUTINES * ENTRY_WORDS;

pub const PROGRAMLET_ROUTINE_DIRECTORY_WORDS: usize = SIGNATURE_BASE + MAX_PROGRAMLET_SYMBOL_WORDS;

pub fn read_programlet_routine_directory_header(
    words: &[u32],
    offset: usize,
) -> Result<(usize, usize), u32> {
    if offset > words.len() || PROGRAMLET_ROUTINE_DIRECTORY_WORDS > words.len() - offset {
        return Err(ERROR_MALFORMED);
    }
    if read_word(words, offset) != Some(DIRECTORY_MAGIC) {
        return Err(ERROR_MALFORMED);
    }
    let entry_count = read_word(words, offset + 1).ok_or(ERROR_MALFORMED)? as usize;
    let signature_used = read_word(words, offset + 2).ok_or(ERROR_MALFORMED)? as usize;
    if entry_count > MAX_PROGRAMLET_ROUTINES || signature_used > MAX_PROGRAMLET_SYMBOL_WORDS {
        return Err(ERROR_MALFORMED);
    }
    Ok((entry_count, signature_used))
}

pub fn validate_programlet_routine_directory_words(
    words: &[u32],
    offset: usize,
) -> Result<(usize, usize), u32> {
    let (entry_count, signature_used) = read_programlet_routine_directory_header(words, offset)?;
    let mut index = 0;
    while index < entry_count {
        let entry = read_programlet_routine_entry(words, offset, index, entry_count);
        if !range_fits(
            entry.signature_start,
            entry.signature_length,
            signature_used,
        ) || !range_fits(entry.verb_start, entry.verb_length, signature_used)
            || !range_fits(
                entry.output_name_start,
                entry.output_name_length,
                signature_used,
            )
        {
            return Err(ERROR_MALFORMED);
        }
        index += 1;
    }
    Ok((entry_count, signature_used))
}

pub(super) fn read_programlet_routine_entry(
    words: &[u32],
    offset: usize,
    index: usize,
    entry_count: usize,
) -> RoutineEntry {
    if index >= entry_count || entry_count > MAX_PROGRAMLET_ROUTINES {
        return RoutineEntry::EMPTY;
    }
    let start = offset + ENTRY_BASE + index * ENTRY_WORDS;
    RoutineEntry {
        signature_start: read_word_unchecked(words, start),
        signature_length: read_word_unchecked(words, start + 1),
        verb_start: read_word_unchecked(words, start + 2),
        verb_length: read_word_unchecked(words, start + 3),
        definition_start: read_word_unchecked(words, start + 4),
        routine_start: read_word_unchecked(words, start + 5),
        routine_end: read_word_unchecked(words, start + 6),
        output_name_start: read_word_unchecked(words, start + 7),
        output_name_length: read_word_unchecked(words, start + 8),
        output_kind: read_word_unchecked(words, start + 9),
    }
}

pub(super) fn read_programlet_routine_signature_word(
    words: &[u32],
    offset: usize,
    index: usize,
    signature_used: usize,
) -> u32 {
    if index >= signature_used || signature_used > MAX_PROGRAMLET_SYMBOL_WORDS {
        return 0;
    }
    read_word_unchecked(words, offset + SIGNATURE_BASE + index)
}

fn read_word(words: &[u32], index: usize) -> Option<u32> {
    if index >= words.len() {
        return None;
    }
    #[cfg(target_arch = "spirv")]
    {
        // SAFETY: the length check proves the index is within the supplied wire buffer.
        Some(read_word_unchecked(words, index))
    }
    #[cfg(not(target_arch = "spirv"))]
    {
        Some(words[index])
    }
}

#[cfg(target_arch = "spirv")]
fn read_word_unchecked(words: &[u32], index: usize) -> u32 {
    // SAFETY: callers establish the index from the validated fixed directory layout.
    unsafe { *<[u32] as spirv_std::arch::IndexUnchecked<u32>>::index_unchecked(words, index) }
}

#[cfg(not(target_arch = "spirv"))]
fn read_word_unchecked(words: &[u32], index: usize) -> u32 {
    words[index]
}

#[cfg(not(target_arch = "spirv"))]
pub fn build_programlet_routine_directory_words(
    words: &[u32],
    base_codelet: usize,
    codelet_count: usize,
    output: &mut [u32; PROGRAMLET_ROUTINE_DIRECTORY_WORDS],
) -> Result<(), u32> {
    let mut directory = ProgramletRoutineDirectory::EMPTY;
    build_programlet_routine_directory(words, base_codelet, codelet_count, &mut directory)?;
    encode_directory(&directory, output);
    Ok(())
}

#[cfg(not(target_arch = "spirv"))]
fn encode_directory(
    directory: &ProgramletRoutineDirectory,
    output: &mut [u32; PROGRAMLET_ROUTINE_DIRECTORY_WORDS],
) {
    *output = [0; PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
    output[0] = DIRECTORY_MAGIC;
    output[1] = directory.entry_count as u32;
    output[2] = directory.signature_used as u32;
    let mut index = 0;
    while index < MAX_PROGRAMLET_ROUTINES {
        let entry = array_at!(&directory.entries, index);
        let start = ENTRY_BASE + index * ENTRY_WORDS;
        output[start] = entry.signature_start;
        output[start + 1] = entry.signature_length;
        output[start + 2] = entry.verb_start;
        output[start + 3] = entry.verb_length;
        output[start + 4] = entry.definition_start;
        output[start + 5] = entry.routine_start;
        output[start + 6] = entry.routine_end;
        output[start + 7] = entry.output_name_start;
        output[start + 8] = entry.output_name_length;
        output[start + 9] = entry.output_kind;
        index += 1;
    }
    index = 0;
    while index < MAX_PROGRAMLET_SYMBOL_WORDS {
        output[SIGNATURE_BASE + index] = array_at!(&directory.signatures, index);
        index += 1;
    }
}

fn range_fits(start: u32, length: u32, used: usize) -> bool {
    let start = start as usize;
    let length = length as usize;
    start <= used && length <= used - start
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_header_accepts_bounded_counts_without_scanning_entries() {
        let mut words = std::vec![0; PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
        words[0] = DIRECTORY_MAGIC;
        words[1] = MAX_PROGRAMLET_ROUTINES as u32;
        words[2] = MAX_PROGRAMLET_SYMBOL_WORDS as u32;

        assert_eq!(
            read_programlet_routine_directory_header(&words, 0),
            Ok((MAX_PROGRAMLET_ROUTINES, MAX_PROGRAMLET_SYMBOL_WORDS))
        );
    }

    #[test]
    fn directory_header_rejects_truncated_or_unbounded_headers() {
        let mut words = std::vec![0; PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
        words[0] = DIRECTORY_MAGIC;
        words[1] = MAX_PROGRAMLET_ROUTINES as u32 + 1;
        assert_eq!(
            read_programlet_routine_directory_header(&words, 0),
            Err(ERROR_MALFORMED)
        );

        words[1] = 0;
        words[2] = MAX_PROGRAMLET_SYMBOL_WORDS as u32 + 1;
        assert_eq!(
            read_programlet_routine_directory_header(&words, 0),
            Err(ERROR_MALFORMED)
        );
        assert_eq!(
            read_programlet_routine_directory_header(&words, 1),
            Err(ERROR_MALFORMED)
        );
    }
}
