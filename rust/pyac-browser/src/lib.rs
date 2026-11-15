use pyac::{
    GOLDEN_NUMERIC_PLUS_CODELET, PyacValue, VectorElements, decode_pack, encode_pack, execute_pack,
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

pub(crate) fn value_to_json(value: &PyacValue) -> Value {
    match value {
        PyacValue::Unsigned(value) => json!({ "type": "unsigned", "value": value }),
        PyacValue::Signed(value) => json!({ "type": "signed", "value": value }),
        PyacValue::DateEpochMs(value) => json!({ "type": "date-epoch-ms", "value": value }),
        PyacValue::Vector(values) => vector_to_json(values),
    }
}

fn vector_to_json(values: &VectorElements) -> Value {
    match values {
        VectorElements::Numbers(values) => {
            json!({ "type": "vector", "elementType": "unsigned-16", "values": values })
        }
        VectorElements::Booleans(values) => {
            json!({ "type": "vector", "elementType": "boolean", "values": values })
        }
        VectorElements::Texts(values) => {
            json!({ "type": "vector", "elementType": "text", "values": values })
        }
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
}
