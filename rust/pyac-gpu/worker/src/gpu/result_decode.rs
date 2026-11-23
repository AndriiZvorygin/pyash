use super::*;

#[derive(Debug)]
pub(super) struct DecodedSectionResult {
    pub(super) section_index: usize,
    pub(super) name_words: Vec<u32>,
    pub(super) completion_order: usize,
    pub(super) value: PyacValue,
}

pub(super) fn decode_programlet_result(
    codelet_count: usize,
    output: &[u32],
) -> Result<Vec<PyacValue>, String> {
    if output.len() < RESULT_STRIDE {
        return Err("programlet: GPU result is truncated".to_owned());
    }
    if output[1] != 0 {
        return Err(format!(
            "programlet: shared VLIW runtime error {}",
            output[1]
        ));
    }
    if output[2] != 1 || output[3] as usize != codelet_count {
        return Err(format!(
            "programlet: invalid GPU result record (kind={}, length={}, consumed={}, expected={codelet_count})",
            output[0], output[2], output[3]
        ));
    }
    let value = match output[0] {
        pyac_vliw_core::VALUE_UNSIGNED => PyacValue::Unsigned(u64::from(output[4])),
        pyac_vliw_core::VALUE_SIGNED => PyacValue::Signed(i64::from(output[4] as i32)),
        pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(output[4]),
        pyac_vliw_core::VALUE_FLOAT64 => {
            PyacValue::Float64(u64::from(output[4]) | (u64::from(output[5]) << 32))
        }
        pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(output[4] as u16),
        pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(output[4] != 0),
        kind => return Err(format!("programlet: unsupported GPU result kind {kind}")),
    };
    Ok(vec![value])
}

pub(super) fn decode_section_records(
    section_count: usize,
    output: &[u32],
) -> Result<Vec<DecodedSectionResult>, String> {
    if output.len() < section_count * SECTION_RESULT_STRIDE {
        return Err("sectioned programlet: GPU result buffer is truncated".to_owned());
    }

    let mut records = Vec::with_capacity(section_count);
    for completion_order in 0..section_count {
        let record_start = completion_order * SECTION_RESULT_STRIDE;
        let section_index = output[record_start] as usize;
        let name_length = output[record_start + 1] as usize;
        let codelet_count = output[record_start + 3] as usize;
        if section_index >= section_count
            || name_length == 0
            || name_length > MAX_SECTION_NAME_WORDS
            || codelet_count == 0
        {
            return Err(format!(
                "sectioned programlet: invalid result metadata at completion slot {completion_order}"
            ));
        }
        let name_words = output[record_start + 4..record_start + 4 + name_length].to_vec();
        let result_start = record_start + 4 + MAX_SECTION_NAME_WORDS;
        let result = &output[result_start..result_start + RESULT_STRIDE];
        if result[1] != 0 {
            return Err(format!(
                "sectioned programlet {section_index} ({name_words:04x?}): shared VLIW runtime error {}",
                result[1]
            ));
        }
        if result[2] != 1 || result[3] as usize != codelet_count {
            return Err(format!(
                "sectioned programlet {section_index}: invalid result record (kind={}, length={}, consumed={}, expected={codelet_count})",
                result[0], result[2], result[3]
            ));
        }
        let value = match result[0] {
            pyac_vliw_core::VALUE_UNSIGNED => PyacValue::Unsigned(u64::from(result[4])),
            pyac_vliw_core::VALUE_SIGNED => PyacValue::Signed(i64::from(result[4] as i32)),
            pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(result[4]),
            pyac_vliw_core::VALUE_FLOAT64 => {
                PyacValue::Float64(u64::from(result[4]) | (u64::from(result[5]) << 32))
            }
            pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(result[4] as u16),
            pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(result[4] != 0),
            kind => {
                return Err(format!(
                    "sectioned programlet {section_index}: unsupported GPU result kind {kind}"
                ));
            }
        };
        records.push(DecodedSectionResult {
            section_index,
            name_words,
            completion_order,
            value,
        });
    }
    Ok(records)
}
