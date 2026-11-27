use super::*;
use pyac::{PyacValue, VectorElements};

#[derive(Debug)]
pub(super) struct DecodedSectionResult {
    pub(super) section_index: usize,
    pub(super) name_words: Vec<u32>,
    pub(super) completion_order: usize,
    pub(super) value: PyacValue,
}

fn decode_value(kind: u32, length: usize, data: &[u32]) -> Result<PyacValue, String> {
    let scalar = |value| {
        if length != 1 {
            Err(format!("scalar result has invalid length {length}"))
        } else {
            Ok(value)
        }
    };
    match kind {
        pyac_vliw_core::VALUE_UNSIGNED => scalar(PyacValue::Unsigned(u64::from(data[0]))),
        pyac_vliw_core::VALUE_SIGNED => scalar(PyacValue::Signed(i64::from(data[0] as i32))),
        pyac_vliw_core::VALUE_FLOAT32 => scalar(PyacValue::Float32(data[0])),
        pyac_vliw_core::VALUE_FLOAT64 => scalar(PyacValue::Float64(
            u64::from(data[0]) | (u64::from(data[1]) << 32),
        )),
        pyac_vliw_core::VALUE_FIXED16 => scalar(PyacValue::Fixed16(data[0] as u16)),
        pyac_vliw_core::VALUE_BOOLEAN => scalar(PyacValue::Boolean(data[0] != 0)),
        pyac_vliw_core::VALUE_VECTOR_U16 if length <= data.len() => Ok(PyacValue::Vector(
            VectorElements::Numbers(data[..length].iter().map(|value| *value as u16).collect()),
        )),
        pyac_vliw_core::VALUE_VECTOR_U32 if length <= data.len() => Ok(PyacValue::Vector(
            VectorElements::Numbers32(data[..length].to_vec()),
        )),
        pyac_vliw_core::VALUE_VECTOR_BOOL if length <= data.len() => Ok(PyacValue::Vector(
            VectorElements::Booleans(data[..length].iter().map(|value| *value != 0).collect()),
        )),
        pyac_vliw_core::VALUE_VECTOR_FLOAT32 if length <= data.len() => Ok(PyacValue::Vector(
            VectorElements::Float32(data[..length].to_vec()),
        )),
        pyac_vliw_core::VALUE_VECTOR_FLOAT64 if length <= data.len() / 2 => {
            Ok(PyacValue::Vector(VectorElements::Float64(
                data[..length * 2]
                    .chunks_exact(2)
                    .map(|pair| u64::from(pair[0]) | (u64::from(pair[1]) << 32))
                    .collect(),
            )))
        }
        _ => Err(format!(
            "unsupported or malformed GPU result kind {kind} length {length}"
        )),
    }
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
    if output[3] as usize != codelet_count {
        return Err(format!(
            "programlet: invalid GPU result record (kind={}, length={}, consumed={}, expected={codelet_count})",
            output[0], output[2], output[3]
        ));
    }
    let value = decode_value(output[0], output[2] as usize, &output[4..])?;
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
        if result[3] as usize != codelet_count {
            return Err(format!(
                "sectioned programlet {section_index}: invalid result record (kind={}, length={}, consumed={}, expected={codelet_count})",
                result[0], result[2], result[3]
            ));
        }
        let value = decode_value(result[0], result[2] as usize, &result[4..])
            .map_err(|error| format!("sectioned programlet {section_index}: {error}"))?;
        records.push(DecodedSectionResult {
            section_index,
            name_words,
            completion_order,
            value,
        });
    }
    Ok(records)
}
