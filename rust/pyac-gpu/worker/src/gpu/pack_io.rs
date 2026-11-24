use super::*;

pub(super) struct PreparedPack {
    pub(super) input_words: Vec<u32>,
    pub(super) section_words: Vec<u32>,
    pub(super) dispatch_words: Vec<u32>,
    pub(super) section_count: usize,
    pub(super) programlet: bool,
    pub(super) result_records: usize,
}

pub(super) fn prepare_pack(
    codelets: &[[u16; pyac::WORDS_PER_CODELET]],
) -> Result<PreparedPack, String> {
    let input_words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    let sectioned = pyac_vliw_core::has_programlet_section_header(&input_words, codelets.len());
    let mut section_descriptors =
        [pyac_vliw_core::ProgramletSection::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_SECTIONS];
    let section_count = if sectioned {
        match pyac_vliw_core::scan_numeric_programlet_sections(
            &input_words,
            codelets.len(),
            &mut section_descriptors,
        ) {
            Ok(count) => count,
            Err(error) => {
                return Err(format!(
                    "malformed VLIW section packet (core error {error})"
                ));
            }
        }
    } else {
        0
    };
    let programlet =
        !sectioned && pyac_vliw_core::is_numeric_programlet(&input_words, codelets.len());
    let result_records = if sectioned {
        section_count * SECTION_RESULT_STRIDE
    } else if programlet {
        RESULT_STRIDE
    } else {
        codelets.len() * RESULT_STRIDE
    };
    let dispatch_words = prepare_dispatch_words(
        &input_words,
        programlet,
        &section_descriptors[..section_count],
    )?;
    let mut section_words = Vec::with_capacity(section_count.max(1) * SECTION_DESCRIPTOR_STRIDE);
    for section in &section_descriptors[..section_count] {
        section_words.push(section.codelet_start);
        section_words.push(section.codelet_count);
        section_words.push(section.name_length);
        section_words.extend_from_slice(&section.name_words);
    }
    if section_words.is_empty() {
        section_words.push(0);
    }
    Ok(PreparedPack {
        input_words,
        section_words,
        dispatch_words,
        section_count,
        programlet,
        result_records,
    })
}

pub(super) fn decode_pack_result(
    codelets: &[[u16; pyac::WORDS_PER_CODELET]],
    output: &[u32],
    section_count: usize,
    programlet: bool,
    backend: &str,
    device: &str,
    timings: &mut GpuExecutionTiming,
) -> Result<Value, String> {
    let sectioned = section_count > 0;
    let result_decode_started = Instant::now();
    let decode_result = (|| {
        let section_records = if sectioned {
            Some(decode_section_records(section_count, output)?)
        } else {
            None
        };
        let values = if let Some(records) = &section_records {
            records.iter().map(|record| record.value.clone()).collect()
        } else if programlet {
            decode_programlet_result(codelets.len(), output)?
        } else {
            decode_results(codelets, output)?
        };
        Ok::<_, String>((section_records, values))
    })();
    timings.result_decode_ms = result_decode_started.elapsed().as_secs_f64() * 1000.0;
    let (section_records, values) = decode_result?;
    let section_json = section_records.as_ref().map(|records| {
        records
            .iter()
            .map(|record| {
                json!({
                    "sectionIndex": record.section_index,
                    "nameWords": record.name_words,
                    "completionOrder": record.completion_order,
                    "value": value_json(&record.value),
                })
            })
            .collect::<Vec<_>>()
    });

    let mut response = json!({
        "ok": true,
        "backend": backend,
        "device": device,
        "values": values.iter().map(value_json).collect::<Vec<_>>(),
    });
    if let Some(section_json) = section_json {
        response["sections"] = Value::Array(section_json);
        response["completionOrder"] = Value::Array(
            section_records
                .as_ref()
                .expect("section records exist for section packets")
                .iter()
                .map(|record| Value::from(record.section_index as u64))
                .collect(),
        );
    }
    Ok(response)
}
