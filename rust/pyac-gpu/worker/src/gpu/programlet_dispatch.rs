use pyac_vliw_core::{
    CODELET_WORDS, MAX_PROGRAMLET_SECTIONS, PROGRAMLET_ROUTINE_DIRECTORY_WORDS, ProgramletSection,
    build_programlet_routine_directory_words,
};

pub(crate) fn prepare_dispatch_words(
    input_words: &[u32],
    programlet: bool,
    sections: &[ProgramletSection],
) -> Result<Vec<u32>, String> {
    let directory_count = if sections.is_empty() {
        usize::from(programlet)
    } else {
        sections.len()
    };
    if directory_count == 0 {
        return Ok(vec![0]);
    }
    if directory_count > MAX_PROGRAMLET_SECTIONS {
        return Err(format!(
            "programlet dispatch directory count exceeds {MAX_PROGRAMLET_SECTIONS}"
        ));
    }

    let mut output = vec![0u32; directory_count * PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
    let mut index = 0;
    while index < directory_count {
        let (base_codelet, codelet_count) = if sections.is_empty() {
            (0, input_words.len() / CODELET_WORDS)
        } else {
            let section = sections[index];
            (
                section.codelet_start as usize,
                section.codelet_count as usize,
            )
        };
        let range_start = index * PROGRAMLET_ROUTINE_DIRECTORY_WORDS;
        let range_end = range_start + PROGRAMLET_ROUTINE_DIRECTORY_WORDS;
        let directory_words: &mut [u32; PROGRAMLET_ROUTINE_DIRECTORY_WORDS] = (&mut output
            [range_start..range_end])
            .try_into()
            .map_err(|_| "programlet dispatch buffer has an invalid directory stride".to_owned())?;
        build_programlet_routine_directory_words(
            input_words,
            base_codelet,
            codelet_count,
            directory_words,
        )
        .map_err(|error| {
            format!("could not prepare programlet dispatch directory (core error {error})")
        })?;
        index += 1;
    }
    Ok(output)
}
