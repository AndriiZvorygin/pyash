use super::*;

#[test]
fn pipeline_artifact_is_written_atomically_and_required_when_loading() {
    let path = std::env::temp_dir().join(format!(
        "pyac-vliw-pipeline-cache-{}-{}.bin",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    ));
    let artifact = [0x50, 0x59, 0x41, 0x43, 1, 2, 3];

    write_pipeline_cache(&path, &artifact).unwrap();
    assert_eq!(read_pipeline_cache(&path).unwrap(), artifact);
    fs::remove_file(&path).unwrap();
    assert!(read_pipeline_cache(&path).unwrap_err().contains("required"));
}

#[test]
fn empty_pipeline_artifacts_are_rejected() {
    let path = std::env::temp_dir().join(format!(
        "pyac-vliw-empty-pipeline-cache-{}.bin",
        std::process::id()
    ));
    fs::write(&path, []).unwrap();
    assert!(read_pipeline_cache(&path).unwrap_err().contains("empty"));
    fs::remove_file(path).unwrap();
}

fn result_record(kind: u32, value: u32) -> [u32; RESULT_STRIDE] {
    let mut output = [0; RESULT_STRIDE];
    output[0] = kind;
    output[2] = 1;
    output[3] = 6;
    output[4] = value;
    output
}

#[test]
fn decodes_supported_typed_programlet_results() {
    assert_eq!(
        decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_UNSIGNED, 17)).unwrap(),
        vec![PyacValue::Unsigned(17)]
    );
    assert_eq!(
        decode_programlet_result(
            6,
            &result_record(pyac_vliw_core::VALUE_SIGNED, (-5i32) as u32)
        )
        .unwrap(),
        vec![PyacValue::Signed(-5)]
    );
    assert_eq!(
        decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_BOOLEAN, 1)).unwrap(),
        vec![PyacValue::Boolean(true)]
    );
    assert_eq!(
        decode_programlet_result(
            6,
            &result_record(pyac_vliw_core::VALUE_FLOAT32, 1.25f32.to_bits())
        )
        .unwrap(),
        vec![PyacValue::Float32(1.25f32.to_bits())]
    );
    assert_eq!(
        decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_FIXED16, 23_328)).unwrap(),
        vec![PyacValue::Fixed16(23_328)]
    );
}

#[test]
fn decodes_float32_codelet_results_and_json_values() {
    let mut codelet = [0; pyac::WORDS_PER_CODELET];
    codelet[0] = 1;
    let bits = 0.3f32.to_bits();
    let mut output = vec![0; RESULT_STRIDE];
    output[0] = pyac_vliw_core::VALUE_FLOAT32;
    output[2] = 1;
    output[3] = 1;
    output[4] = bits;

    assert_eq!(
        decode_results(&[codelet], &output).unwrap(),
        vec![PyacValue::Float32(bits)]
    );
    assert_eq!(
        value_json(&PyacValue::Float32(bits)),
        json!({ "type": "float32", "value": f32::from_bits(bits) })
    );
}

#[test]
fn decodes_fixed16_codelet_results_and_json_values() {
    let mut codelet = [0; pyac::WORDS_PER_CODELET];
    codelet[0] = 1;
    let mut output = vec![0; RESULT_STRIDE];
    output[0] = pyac_vliw_core::VALUE_FIXED16;
    output[2] = 1;
    output[3] = 1;
    output[4] = 23_328;

    assert_eq!(
        decode_results(&[codelet], &output).unwrap(),
        vec![PyacValue::Fixed16(23_328)]
    );
    assert_eq!(
        value_json(&PyacValue::Fixed16(23_328)),
        json!({
            "type": "fixed16",
            "value": 0.5,
            "numerator": 23_328,
            "denominator": 46_656
        })
    );
}

#[test]
fn rejects_invalid_programlet_result_metadata_and_types() {
    let mut output = result_record(pyac_vliw_core::VALUE_UNSIGNED, 17);
    output[2] = 2;
    assert!(decode_programlet_result(6, &output).is_err());

    let output = result_record(pyac_vliw_core::VALUE_DATE, 17);
    assert!(decode_programlet_result(6, &output).is_err());
}

#[test]
fn decodes_section_results_in_gpu_completion_order_with_hnuc_names() {
    let mut output = vec![0; 2 * SECTION_RESULT_STRIDE];
    for (ticket, section_index, name, value) in [(0, 1, 0x2222, 22), (1, 0, 0x1111, 11)] {
        let start = ticket * SECTION_RESULT_STRIDE;
        output[start] = section_index;
        output[start + 1] = 1;
        output[start + 2] = section_index * 2;
        output[start + 3] = 3;
        output[start + 4] = name;
        let result = start + 4 + MAX_SECTION_NAME_WORDS;
        output[result] = pyac_vliw_core::VALUE_UNSIGNED;
        output[result + 2] = 1;
        output[result + 3] = 3;
        output[result + 4] = value;
    }

    let records = decode_section_records(2, &output).unwrap();
    assert_eq!(records[0].completion_order, 0);
    assert_eq!(records[0].section_index, 1);
    assert_eq!(records[0].name_words, vec![0x2222]);
    assert_eq!(records[0].value, PyacValue::Unsigned(22));
    assert_eq!(records[1].completion_order, 1);
    assert_eq!(records[1].section_index, 0);
    assert_eq!(records[1].name_words, vec![0x1111]);
    assert_eq!(records[1].value, PyacValue::Unsigned(11));
}
