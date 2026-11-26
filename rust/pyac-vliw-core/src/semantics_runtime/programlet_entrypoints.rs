use super::*;

#[cfg(not(target_arch = "spirv"))]
pub fn execute_numeric_programlet(
    words: &[impl VliwWord],
    codelet_count: usize,
    step_budget: u32,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    execute_numeric_programlet_at(words, 0, codelet_count, step_budget, symbol_words, frames)
}

#[cfg(not(target_arch = "spirv"))]
pub fn execute_numeric_programlet_at(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    let mut routine_directory_words = [0; PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
    if let Err(error) = build_programlet_routine_directory_words(
        words,
        base_codelet,
        codelet_count,
        &mut routine_directory_words,
    ) {
        return CoreResult::failure(error, 0);
    }
    execute_numeric_programlet_at_with_directory_words(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        &routine_directory_words,
        0,
        symbol_words,
        frames,
    )
}

pub fn execute_numeric_programlet_at_with_directory_words(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    routine_directory_words: &[u32],
    directory_offset: usize,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    execute_numeric_programlet_at_with_directory_words_and_storage(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        routine_directory_words,
        directory_offset,
        &StorageView::EMPTY,
        symbol_words,
        frames,
    )
}

pub fn execute_numeric_programlet_at_with_directory_words_and_storage(
    words: &[impl VliwWord],
    base_codelet: usize,
    codelet_count: usize,
    step_budget: u32,
    routine_directory_words: &[u32],
    directory_offset: usize,
    storage: &StorageView<'_>,
    symbol_words: &mut [u32; MAX_PROGRAMLET_SYMBOL_WORDS],
    frames: &mut ProgramletStack,
) -> CoreResult {
    programlet_execute::execute_numeric_programlet_at_with_directory_words_and_storage(
        words,
        base_codelet,
        codelet_count,
        step_budget,
        routine_directory_words,
        directory_offset,
        storage,
        symbol_words,
        frames,
    )
}
