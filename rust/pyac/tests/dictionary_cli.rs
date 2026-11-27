use std::fs;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use pyac::dictionary::{DictionaryField, DictionaryValue, encode_text_sentence};
use serde_json::Value;

fn temporary_directory() -> std::path::PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "pyac-dictionary-cli-{}-{timestamp}",
        std::process::id()
    ))
}

fn request() -> Value {
    let key = [0xa96a, 0x6c22];
    let definition = encode_text_sentence(
        &key,
        &[DictionaryField {
            grammatical_case: 0x245e,
            value: DictionaryValue::Text("A dictionary entry used by the CLI test."),
        }],
    )
    .expect("encode definition");
    let codelets = definition
        .iter()
        .map(|codelet| codelet.to_vec())
        .collect::<Vec<_>>();
    serde_json::json!({
        "metadata": {
            "kind": "English Pyash dictionary", "title": "CLI test volume",
            "revision": 1, "languages": ["en"], "normalization_policy": "NFC"
        },
        "entries": [{
            "key": key,
            "lexical_forms": [{
                "language": "en", "surface": "dictionary", "normalized": "dictionary"
            }],
            "source_links": [{
                "dataset": "wordnet", "release": "OEWN 2025",
                "identifier": "n:06311813-n", "relation": "exact-sense"
            }],
            "source_glosses": [{
                "language": "en", "dataset": "wordnet", "release": "OEWN 2025",
                "identifier": "n:06311813-n", "text": "A dictionary entry used by the CLI test."
            }],
            "definition": codelets
        }]
    })
}

fn run(args: &[&str], input: Option<&[u8]>) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_pyac-dictionary"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start dictionary executable");
    if let Some(input) = input {
        child
            .stdin
            .take()
            .expect("child stdin")
            .write_all(input)
            .expect("write request");
    }
    let output = child
        .wait_with_output()
        .expect("wait for dictionary executable");
    assert!(
        output.status.success(),
        "command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("JSON command result")
}

#[test]
fn compiled_cli_builds_inspects_looks_up_and_benchmarks_a_volume() {
    let directory = temporary_directory();
    fs::create_dir_all(&directory).expect("create temp directory");
    let volume = directory.join("dictionary.pyac");
    let volume_arg = volume.to_str().expect("UTF-8 temp path");
    let input = request().to_string();

    let built = run(&["build", volume_arg], Some(input.as_bytes()));
    assert_eq!(built["command"], "build");
    assert_eq!(built["entries"], 1);
    assert!(built["executableBytes"].as_u64().unwrap() > 0);
    assert!(built["encodeMs"].as_f64().is_some());
    assert!(volume.exists());

    let inspected = run(&["inspect", volume_arg], None);
    assert_eq!(inspected["metadata"]["title"], "CLI test volume");
    assert_eq!(inspected["codeletCount"], built["codeletCount"]);
    assert_eq!(inspected["entryCount"], 1);
    assert!(inspected["openMs"].as_f64().is_some());

    let surface = run(&["surface", volume_arg, "en", "dictionary"], None);
    let surface_entries = run(&["surface-entries", volume_arg, "en", "dictionary"], None);
    let offset = surface_entries["matches"][0]["offset"].clone();
    assert_eq!(surface["matches"], serde_json::json!([offset]));
    assert!(
        !surface_entries["matches"][0]["codelets"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(surface["lookupNs"].as_u64().is_some());

    let source = run(
        &[
            "source-entries",
            volume_arg,
            "wordnet",
            "OEWN 2025",
            "n:06311813-n",
        ],
        None,
    );
    assert_eq!(source["matches"].as_array().unwrap().len(), 1);
    assert!(
        !source["matches"][0]["codelets"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let entry = run(&["key", volume_arg, "a96a,6c22"], None);
    assert_eq!(entry["key"], serde_json::json!([0xa96a, 0x6c22]));
    assert!(!entry["codelets"].as_array().unwrap().is_empty());

    let full_entry = run(&["entry", volume_arg, "a96a,6c22"], None);
    assert_eq!(full_entry["hasDefinition"], true);
    assert!(
        full_entry["codelets"].as_array().unwrap().len()
            > entry["codelets"].as_array().unwrap().len()
    );

    let benchmark = run(
        &[
            "benchmark",
            volume_arg,
            "1000",
            "surface",
            "en",
            "dictionary",
        ],
        None,
    );
    assert_eq!(benchmark["iterations"], 1000);
    assert_eq!(benchmark["warmupIterations"], 5);
    assert_eq!(benchmark["entryCount"], 1);
    assert_eq!(benchmark["matchesPerIteration"], 1);
    assert!(benchmark["lookupMeanNs"].as_u64().is_some());
    assert!(benchmark["lookupsPerSecond"].as_f64().unwrap() > 0.0);
    fs::remove_dir_all(directory).expect("remove temp directory");
}
