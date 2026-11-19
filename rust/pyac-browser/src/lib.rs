use pyac::{
    GOLDEN_NUMERIC_PLUS_CODELET, PyacValue, VectorElements, decode_pack, encode_pack, execute_pack,
    index_word,
};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
mod webgpu;

#[cfg(target_arch = "wasm32")]
pub use webgpu::run_pack_webgpu;

#[wasm_bindgen]
pub fn run_pack(pack_bytes: &[u8]) -> String {
    let response = match decode_pack(pack_bytes) {
        Ok(pack) => match execute_pack(&pack) {
            Ok(values) => json!({
                "ok": true,
                "backend": "wasm-cpu",
                "values": values.iter().map(value_to_json).collect::<Vec<_>>(),
            }),
            Err(error) => json!({
                "ok": false,
                "error": {
                    "code": error.code(),
                    "index": error.index,
                    "message": error.to_string(),
                },
            }),
        },
        Err(error) => json!({
            "ok": false,
            "error": {
                "code": error.code(),
                "message": error.to_string(),
            },
        }),
    };
    response.to_string()
}

#[wasm_bindgen]
pub fn run_demo_pack() -> String {
    match encode_pack(&[GOLDEN_NUMERIC_PLUS_CODELET]) {
        Ok(bytes) => run_pack(&bytes),
        Err(error) => json!({
            "ok": false,
            "error": {
                "code": error.code(),
                "message": error.to_string(),
            },
        })
        .to_string(),
    }
}

#[wasm_bindgen]
pub fn demo_pack_bytes() -> Vec<u8> {
    encode_pack(&[GOLDEN_NUMERIC_PLUS_CODELET]).expect("golden codelet encodes")
}

#[wasm_bindgen]
pub fn numeric_batch_demo_pack_bytes() -> Vec<u8> {
    let arithmetic = |ob, operand, operator| {
        [
            0x0149, 0x881d, ob, 0x245e, 0x881d, operand, 0x243e, operator, 0x295e, 0, 0, 0, 0, 0,
            0, 0,
        ]
    };
    encode_pack(&[
        arithmetic(1, 1, 0x8a64),
        arithmetic(9, 4, 0xabd2),
        arithmetic(u16::MAX, u16::MAX, 0xec90),
        arithmetic(8, 2, 0x8893),
        arithmetic(7, 3, 0xa810),
        arithmetic(3, 4, 0x8c29),
        arithmetic(9, 4, 0xe82a),
        arithmetic(u16::MAX, 1, 0x8a64),
        arithmetic(1, 4, 0xabd2),
    ])
    .expect("numeric batch fixture encodes")
}

#[wasm_bindgen]
pub fn vector_arithmetic_demo_pack_bytes() -> Vec<u8> {
    let vectors = [
        (&[1, 2, 3, 4][..], 2, 0x243e, 0x8a64),
        (&[u16::MAX, 3][..], u16::MAX, 0x243e, 0xec90),
        (&[9, 4][..], 2, 0x243e, 0xabd2),
        (&[8, 9][..], 2, 0x490f, 0x8893),
        (&[7, 9][..], 3, 0x243e, 0xa810),
        (&[2, 3][..], 3, 0x313e, 0x8c29),
        (&[9, 10][..], 4, 0x313e, 0xe82a),
        (&[1, 2, 3, 4, 5][..], 1, 0x243e, 0xabd2),
        (&[u16::MAX, 3][..], 2, 0x243e, 0x8a64),
    ];
    let mut codelets = vectors
        .iter()
        .map(|(values, operand, case_word, operator)| {
            numeric_vector_arithmetic_codelet(values, *operand, *case_word, *operator)
        })
        .collect::<Vec<_>>();
    codelets.push(numeric_vector_vector_arithmetic_codelet(
        &[1, 2, 3, 4],
        &[5, 6, 7, 8],
        0x243e,
        0x8a64,
    ));
    encode_pack(&codelets).expect("vector arithmetic fixture encodes")
}

#[wasm_bindgen]
pub fn conditional_number_demo_pack_bytes() -> Vec<u8> {
    conditional_number_pack(false)
}

#[wasm_bindgen]
pub fn conditional_number_alternative_demo_pack_bytes() -> Vec<u8> {
    conditional_number_pack(true)
}

fn conditional_number_pack(unequal: bool) -> Vec<u8> {
    let mut branch = [
        [
            0xd6b6, 0x881d, 5, 0x245e, 0x881d, 5, 0x313e, 0x4809, 0x29be, 0x881d, 7, 0x245e,
            0xea30, 0x217e, 0x881d, 9,
        ],
        [
            0x000b, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    ];
    if unequal {
        branch[0][5] = 4;
    }
    let mut codelets = branch.to_vec();
    codelets.push(GOLDEN_NUMERIC_PLUS_CODELET);
    encode_pack(&codelets).expect("conditional number fixture encodes")
}

fn numeric_vector_arithmetic_codelet(
    values: &[u16],
    operand: u16,
    case_word: u16,
    operator: u16,
) -> [u16; pyac::WORDS_PER_CODELET] {
    let explicit = !matches!(values.len(), 2 | 3 | 4 | 8);
    let quote = match (values.len(), explicit) {
        (2, _) => 0x891d,
        (3, _) => 0x8f1d,
        (4, _) => 0x8a1d,
        (8, _) => 0x8c1d,
        (_, true) => 0x8e1d,
        _ => panic!("fixture vector width is not representable"),
    };
    let mut words = [0; pyac::WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote;
    offset += 1;
    if explicit {
        words[offset] = values.len() as u16;
        offset += 1;
    }
    words[offset..offset + values.len()].copy_from_slice(values);
    offset += values.len();
    let accusative_offset = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = 0x881d;
    words[offset + 1] = operand;
    offset += 2;
    let case_offset = offset;
    words[offset] = case_word;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    words[0] = index_word(&[accusative_offset, case_offset, offset + 2]);
    words
}

fn numeric_vector_vector_arithmetic_codelet(
    left: &[u16],
    right: &[u16],
    case_word: u16,
    operator: u16,
) -> [u16; pyac::WORDS_PER_CODELET] {
    assert_eq!(left.len(), right.len());
    let quote = match left.len() {
        2 => 0x891d,
        3 => 0x8f1d,
        4 => 0x8a1d,
        _ => panic!("fixture vector width is not representable in a codelet"),
    };
    let mut words = [0; pyac::WORDS_PER_CODELET];
    let mut offset = 1;
    words[offset] = quote;
    offset += 1;
    words[offset..offset + left.len()].copy_from_slice(left);
    offset += left.len();
    let accusative_offset = offset;
    words[offset] = 0x245e;
    offset += 1;
    words[offset] = quote;
    offset += 1;
    words[offset..offset + right.len()].copy_from_slice(right);
    offset += right.len();
    let case_offset = offset;
    words[offset] = case_word;
    words[offset + 1] = operator;
    words[offset + 2] = 0x295e;
    words[0] = index_word(&[accusative_offset, case_offset, offset + 2]);
    words
}

pub(crate) fn value_to_json(value: &PyacValue) -> Value {
    match value {
        PyacValue::Unsigned(value) => json!({ "type": "unsigned", "value": value }),
        PyacValue::Signed(value) => json!({ "type": "signed", "value": value }),
        PyacValue::Float32(bits) => json!({ "type": "float32", "value": f32::from_bits(*bits) }),
        PyacValue::Float64(bits) => json!({ "type": "float64", "value": f64::from_bits(*bits) }),
        PyacValue::Fixed16(numerator) => json!({
            "type": "fixed16",
            "value": f64::from(*numerator) / 46_656.0,
            "numerator": numerator,
            "denominator": 46_656
        }),
        PyacValue::Boolean(value) => json!({ "type": "boolean", "value": value }),
        PyacValue::DateEpochMs(value) => json!({ "type": "date-epoch-ms", "value": value }),
        PyacValue::Vector(values) => vector_to_json(values),
    }
}

fn vector_to_json(values: &VectorElements) -> Value {
    match values {
        VectorElements::Numbers(values) => {
            json!({ "type": "vector", "elementType": "unsigned-16", "values": values })
        }
        VectorElements::Numbers32(values) => {
            json!({ "type": "vector", "elementType": "unsigned-32", "values": values })
        }
        VectorElements::Booleans(values) => {
            json!({ "type": "vector", "elementType": "boolean", "values": values })
        }
        VectorElements::Texts(values) => {
            json!({ "type": "vector", "elementType": "text", "values": values })
        }
        VectorElements::Float32(values) => json!({
            "type": "vector",
            "elementType": "float32",
            "values": values.iter().map(|bits| f32::from_bits(*bits)).collect::<Vec<_>>()
        }),
        VectorElements::Float64(values) => json!({
            "type": "vector",
            "elementType": "float64",
            "values": values.iter().map(|bits| f64::from_bits(*bits)).collect::<Vec<_>>()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pyac::{WORDS_PER_CODELET, encode_pack};

    #[test]
    fn wasm_api_returns_typed_result_values_for_a_pack() {
        let pack = encode_pack(&[GOLDEN_NUMERIC_PLUS_CODELET]).expect("golden pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&pack)).expect("response is valid JSON");

        assert_eq!(response["ok"], true);
        assert_eq!(response["values"][0]["type"], "unsigned");
        assert_eq!(response["values"][0]["value"], 2);
    }

    #[test]
    fn wasm_api_preserves_scalar_boolean_type() {
        let truth = [
            0x0015, 0x6909, 0x245e, 0xea30, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        let pack = encode_pack(&[truth]).expect("boolean pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&pack)).expect("response is valid JSON");

        assert_eq!(
            response["values"][0],
            json!({ "type": "boolean", "value": true })
        );
    }

    #[test]
    fn wasm_cpu_api_returns_binary32_results() {
        let left = 0.1f32.to_bits();
        let right = 0.2f32.to_bits();
        let codelet = [
            0x0511,
            0xd01d,
            left as u16,
            (left >> 16) as u16,
            0x245e,
            0xd01d,
            right as u16,
            (right >> 16) as u16,
            0x243e,
            0x8a64,
            0x295e,
            0,
            0,
            0,
            0,
            0,
        ];
        let pack = encode_pack(&[codelet]).expect("f32 pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&pack)).expect("response is valid JSON");

        assert_eq!(response["ok"], true);
        assert_eq!(response["values"][0]["type"], "float32");
        assert_eq!(response["values"][0]["value"], f64::from(0.1f32 + 0.2f32));
    }

    #[test]
    fn wasm_api_serializes_typed_float_vectors() {
        let float32 = PyacValue::Vector(VectorElements::Float32(vec![
            1.25f32.to_bits(),
            (-0.5f32).to_bits(),
        ]));
        assert_eq!(
            value_to_json(&float32),
            json!({
                "type": "vector",
                "elementType": "float32",
                "values": [1.25, -0.5]
            })
        );

        let float64 = PyacValue::Vector(VectorElements::Float64(vec![
            std::f64::consts::PI.to_bits(),
            (-0.5f64).to_bits(),
        ]));
        assert_eq!(
            value_to_json(&float64),
            json!({
                "type": "vector",
                "elementType": "float64",
                "values": [std::f64::consts::PI, -0.5]
            })
        );
    }

    #[test]
    fn wasm_cpu_api_returns_fixed16_results_without_losing_the_numerator() {
        let codelet = [
            0x0149, 0xc81d, 23_328, 0x245e, 0xc81d, 11_664, 0x243e, 0x8a64, 0x295e, 0, 0, 0, 0, 0,
            0, 0,
        ];
        let pack = encode_pack(&[codelet]).expect("fixed16 pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&pack)).expect("response is valid JSON");

        assert_eq!(response["ok"], true);
        assert_eq!(response["values"][0]["type"], "fixed16");
        assert_eq!(response["values"][0]["value"], 0.75);
        assert_eq!(response["values"][0]["numerator"], 34_992);
        assert_eq!(response["values"][0]["denominator"], 46_656);
    }

    #[test]
    fn wasm_api_returns_a_stable_error_for_unsupported_codelets() {
        let pack = encode_pack(&[[0; WORDS_PER_CODELET]]).expect("pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&pack)).expect("response is valid JSON");

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "unsupported-codelet");
        assert_eq!(response["error"]["index"], 0);
    }

    #[test]
    fn wasm_demo_uses_the_core_pack_encoder_and_executor() {
        let response: Value =
            serde_json::from_str(&run_demo_pack()).expect("response is valid JSON");

        assert_eq!(response["values"][0]["value"], 2);
    }

    #[test]
    fn numeric_batch_fixture_has_known_cpu_results() {
        let response: Value = serde_json::from_str(&run_pack(&numeric_batch_demo_pack_bytes()))
            .expect("response is valid JSON");

        assert_eq!(response["backend"], "wasm-cpu");
        assert_eq!(
            response["values"],
            json!([
                { "type": "unsigned", "value": 2 },
                { "type": "unsigned", "value": 5 },
                { "type": "unsigned", "value": 4294836225u64 },
                { "type": "unsigned", "value": 4 },
                { "type": "unsigned", "value": 4 },
                { "type": "unsigned", "value": 81 },
                { "type": "unsigned", "value": 1 },
                { "type": "unsigned", "value": 65535 },
                { "type": "unsigned", "value": 0 }
            ])
        );
    }

    #[test]
    fn conditional_fixture_executes_in_pack_order_on_the_cpu_reference() {
        for (bytes, expected) in [
            (
                conditional_number_demo_pack_bytes(),
                json!([
                    { "type": "unsigned", "value": 7 },
                    { "type": "unsigned", "value": 2 }
                ]),
            ),
            (
                conditional_number_alternative_demo_pack_bytes(),
                json!([
                    { "type": "unsigned", "value": 9 },
                    { "type": "unsigned", "value": 2 }
                ]),
            ),
        ] {
            let response: Value =
                serde_json::from_str(&run_pack(&bytes)).expect("response is valid JSON");
            assert_eq!(response["ok"], true);
            assert_eq!(response["values"], expected);
        }
    }

    #[test]
    fn comparison_branch_preserves_the_encoded_boolean_type() {
        let branch = [
            [
                0xaab6, 0x881d, 3, 0x245e, 0x881d, 5, 0x313e, 0x6c0d, 0x29be, 0x6909, 0x245e,
                0x7271, 0x217e, 0x680d, 0x245e, 0x7271,
            ],
            [0x0003, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ];
        let bytes = encode_pack(&branch).expect("boolean comparison pack encodes");
        let response: Value =
            serde_json::from_str(&run_pack(&bytes)).expect("response is valid JSON");

        assert_eq!(response["ok"], true);
        assert_eq!(
            response["values"],
            json!([{ "type": "boolean", "value": true }])
        );
    }

    #[test]
    fn wasm_api_executes_numeric_vector_arithmetic_with_promoted_products() {
        let response: Value = serde_json::from_str(&run_pack(&vector_arithmetic_demo_pack_bytes()))
            .expect("response is valid JSON");

        assert_eq!(response["ok"], true);
        assert_eq!(
            response["values"],
            json!([
                { "type": "vector", "elementType": "unsigned-16", "values": [3, 4, 5, 6] },
                { "type": "vector", "elementType": "unsigned-32", "values": [4294836225u32, 196605] },
                { "type": "vector", "elementType": "unsigned-16", "values": [7, 2] },
                { "type": "vector", "elementType": "unsigned-16", "values": [4, 4] },
                { "type": "vector", "elementType": "unsigned-16", "values": [4, 10] },
                { "type": "vector", "elementType": "unsigned-16", "values": [8, 27] },
                { "type": "vector", "elementType": "unsigned-16", "values": [1, 2] },
                { "type": "vector", "elementType": "unsigned-16", "values": [0, 1, 2, 3, 4] },
                { "type": "vector", "elementType": "unsigned-16", "values": [65535, 5] },
                { "type": "vector", "elementType": "unsigned-16", "values": [6, 8, 10, 12] }
            ])
        );
    }
}
