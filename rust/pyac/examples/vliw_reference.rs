use std::io::{self, Read, Write};

use pyac::{PyacPack, PyacValue, VectorElements, decode_pack, execute_pack};
use serde_json::{Value, json};

fn value_json(value: PyacValue) -> Value {
    match value {
        PyacValue::Unsigned(value) => json!({"type": "unsigned", "value": value}),
        PyacValue::Signed(value) => json!({"type": "signed", "value": value}),
        PyacValue::Float32(bits) => json!({"type": "float32", "value": f32::from_bits(bits)}),
        PyacValue::Float64(bits) => json!({"type": "float64", "value": f64::from_bits(bits)}),
        PyacValue::Fixed16(numerator) => json!({
            "type": "fixed16",
            "value": f64::from(numerator) / 46_656.0,
            "numerator": numerator,
            "denominator": 46_656
        }),
        PyacValue::Boolean(value) => json!({"type": "boolean", "value": value}),
        PyacValue::DateEpochMs(value) => json!({"type": "date", "value": value}),
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

fn programlet_diagnostic(pack: &PyacPack) -> Option<String> {
    let prepared = pyac::prepare_storage_sections(&pack.codelets).ok()?;
    let codelet_count = prepared.executable_codelet_count;
    let words = pack
        .codelets
        .get(..codelet_count)?
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    if !pyac_vliw_core::is_numeric_programlet(&words, codelet_count) {
        return None;
    }
    let mut directory_words = [0; pyac_vliw_core::PROGRAMLET_ROUTINE_DIRECTORY_WORDS];
    pyac_vliw_core::build_programlet_routine_directory_words(
        &words,
        0,
        codelet_count,
        &mut directory_words,
    )
    .ok()?;
    let storage =
        pyac_vliw_core::StorageView::new(&prepared.descriptors, &prepared.names, &prepared.payload);
    let mut symbol_words = [0; pyac_vliw_core::MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = pyac_vliw_core::ProgramletStack::EMPTY;
    let result = pyac_vliw_core::execute_numeric_programlet_at_with_directory_words_and_storage(
        &words,
        0,
        codelet_count,
        pyac_vliw_core::DEFAULT_PROGRAMLET_STEP_BUDGET,
        &directory_words,
        0,
        &storage,
        &mut symbol_words,
        &mut frames,
    );
    Some(format!(
        " [programlet error={}, consumed={}]",
        result.error, result.consumed_codelets
    ))
}

fn run() -> Result<(), String> {
    let mut input = Vec::new();
    io::stdin()
        .read_to_end(&mut input)
        .map_err(|error| format!("could not read framed PyAC input: {error}"))?;

    let mut cursor = 0;
    let mut output = io::BufWriter::new(io::stdout().lock());
    while cursor < input.len() {
        if input.len() - cursor < 4 {
            return Err("truncated PyAC frame length".into());
        }
        let length = u32::from_le_bytes(input[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        let end = cursor
            .checked_add(length)
            .filter(|end| *end <= input.len())
            .ok_or("truncated PyAC frame payload")?;
        let pack = decode_pack(&input[cursor..end]).map_err(|error| error.to_string())?;
        let values = execute_pack(&pack).map_err(|error| {
            let diagnostic = programlet_diagnostic(&pack).unwrap_or_default();
            format!("{error}{diagnostic}")
        })?;
        let response = json!({"values": values.into_iter().map(value_json).collect::<Vec<_>>()});
        writeln!(output, "{response}")
            .map_err(|error| format!("could not write result: {error}"))?;
        cursor = end;
    }
    output
        .flush()
        .map_err(|error| format!("could not flush result: {error}"))
}

fn main() {
    if let Err(error) = run() {
        eprintln!("pyac-vliw-reference: {error}");
        std::process::exit(1);
    }
}
