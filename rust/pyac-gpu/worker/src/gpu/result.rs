use pyac::{PyacValue, VectorElements};
use serde_json::{Value, json};

pub(super) const RESULT_WORDS: usize = 32;
pub(super) const RESULT_STRIDE: usize = 4 + RESULT_WORDS;

pub(super) fn decode_results(
    codelets: &[[u16; pyac::WORDS_PER_CODELET]],
    output: &[u32],
) -> Result<Vec<PyacValue>, String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < codelets.len() {
        if index > 0 && codelets[index - 1][0] & 1 == 0 {
            index += 1;
            continue;
        }
        let offset = index * RESULT_STRIDE;
        let result = &output[offset..offset + RESULT_STRIDE];
        if result[1] != 0 {
            return Err(format!(
                "codelet {index}: shared VLIW core error {}",
                result[1]
            ));
        }
        let length = result[2] as usize;
        let data = &result[4..];
        let value = match result[0] {
            pyac_vliw_core::VALUE_UNSIGNED => {
                PyacValue::Unsigned(u64::from(data[0]) | (u64::from(data[1]) << 32))
            }
            pyac_vliw_core::VALUE_SIGNED => {
                PyacValue::Signed((u64::from(data[0]) | (u64::from(data[1]) << 32)) as i64)
            }
            pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(data[0]),
            pyac_vliw_core::VALUE_FLOAT64 => {
                PyacValue::Float64(u64::from(data[0]) | (u64::from(data[1]) << 32))
            }
            pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(data[0] as u16),
            pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(data[0] != 0),
            pyac_vliw_core::VALUE_DATE => {
                PyacValue::DateEpochMs(u64::from(data[0]) | (u64::from(data[1]) << 32))
            }
            pyac_vliw_core::VALUE_VECTOR_U16 => PyacValue::Vector(VectorElements::Numbers(
                data[..length].iter().map(|value| *value as u16).collect(),
            )),
            pyac_vliw_core::VALUE_VECTOR_U32 => {
                PyacValue::Vector(VectorElements::Numbers32(data[..length].to_vec()))
            }
            pyac_vliw_core::VALUE_VECTOR_BOOL => PyacValue::Vector(VectorElements::Booleans(
                data[..length].iter().map(|value| *value != 0).collect(),
            )),
            pyac_vliw_core::VALUE_VECTOR_FLOAT32 => {
                PyacValue::Vector(VectorElements::Float32(data[..length].to_vec()))
            }
            pyac_vliw_core::VALUE_VECTOR_FLOAT64 => {
                let words = &data[..length * 2];
                PyacValue::Vector(VectorElements::Float64(
                    words
                        .chunks_exact(2)
                        .map(|pair| u64::from(pair[0]) | (u64::from(pair[1]) << 32))
                        .collect(),
                ))
            }
            kind => {
                return Err(format!(
                    "codelet {index}: unsupported GPU result kind {kind}"
                ));
            }
        };
        values.push(value);
        let consumed = result[3] as usize;
        if consumed == 0 {
            return Err(format!(
                "codelet {index}: shared VLIW core returned no group length"
            ));
        }
        index += consumed;
    }
    Ok(values)
}

pub(super) fn value_json(value: &PyacValue) -> Value {
    match value {
        PyacValue::Unsigned(value) => json!({"type": "unsigned", "value": value}),
        PyacValue::Signed(value) => json!({"type": "signed", "value": value}),
        PyacValue::Float32(bits) => json!({"type": "float32", "value": f32::from_bits(*bits)}),
        PyacValue::Float64(bits) => json!({"type": "float64", "value": f64::from_bits(*bits)}),
        PyacValue::Fixed16(numerator) => json!({
            "type": "fixed16",
            "value": f64::from(*numerator) / 46_656.0,
            "numerator": numerator,
            "denominator": 46_656
        }),
        PyacValue::Boolean(value) => json!({"type": "boolean", "value": value}),
        PyacValue::DateEpochMs(value) => json!({"type": "date-epoch-ms", "value": value}),
        PyacValue::Vector(VectorElements::Numbers(values)) => {
            json!({"type": "vector", "elementType": "unsigned-16", "values": values})
        }
        PyacValue::Vector(VectorElements::Numbers32(values)) => {
            json!({"type": "vector", "elementType": "unsigned-32", "values": values})
        }
        PyacValue::Vector(VectorElements::Booleans(values)) => {
            json!({"type": "vector", "elementType": "boolean", "values": values})
        }
        PyacValue::Vector(VectorElements::Texts(values)) => {
            json!({"type": "vector", "elementType": "text", "values": values})
        }
        PyacValue::Vector(VectorElements::Float32(values)) => json!({
            "type": "vector",
            "elementType": "float32",
            "values": values.iter().map(|bits| f32::from_bits(*bits)).collect::<Vec<_>>()
        }),
        PyacValue::Vector(VectorElements::Float64(values)) => json!({
            "type": "vector",
            "elementType": "float64",
            "values": values.iter().map(|bits| f64::from_bits(*bits)).collect::<Vec<_>>()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_and_serializes_float64_negative_zero_without_losing_its_sign() {
        let mut output = vec![0; RESULT_STRIDE];
        output[0] = pyac_vliw_core::VALUE_VECTOR_FLOAT64;
        output[2] = 1;
        output[3] = 1;
        output[5] = 0x8000_0000;
        let codelet = [1; pyac::WORDS_PER_CODELET];

        let values = decode_results(&[codelet], &output).unwrap();
        assert_eq!(
            values,
            [PyacValue::Vector(VectorElements::Float64(vec![
                (-0.0f64).to_bits()
            ]))]
        );
        let encoded = value_json(&values[0]);
        assert!(encoded["values"][0].as_f64().unwrap().is_sign_negative());
        let json = serde_json::to_string(&encoded).unwrap();
        let decoded: Value = serde_json::from_str(&json).unwrap();
        assert!(decoded["values"][0].as_f64().unwrap().is_sign_negative());
    }
}
