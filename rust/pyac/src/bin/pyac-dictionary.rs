use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use pyac::dictionary::{
    DictionaryFileReader, DictionaryMetadata, DictionaryVolume, DictionaryVolumeEntry, LexicalForm,
    OperationArgument, OperationArgumentType, OperationResult, OperationSignature, SourceGloss,
    SourceLink, encode_dictionary,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct BuildInput {
    metadata: DictionaryMetadataInput,
    entries: Vec<DictionaryEntryInput>,
}

#[derive(Deserialize)]
struct DictionaryMetadataInput {
    kind: String,
    title: String,
    revision: u32,
    languages: Vec<String>,
    normalization_policy: String,
}

#[derive(Deserialize)]
struct DictionaryEntryInput {
    key: Vec<u16>,
    lexical_forms: Vec<LexicalFormInput>,
    source_links: Vec<SourceLinkInput>,
    #[serde(default)]
    source_glosses: Vec<SourceGlossInput>,
    #[serde(default)]
    component_keys: Vec<Vec<u16>>,
    #[serde(default)]
    task_keys: Vec<Vec<u16>>,
    #[serde(default)]
    references: Vec<Vec<u16>>,
    #[serde(default)]
    operation_signatures: Vec<OperationSignatureInput>,
    #[serde(default)]
    definition: Option<Vec<Vec<u16>>>,
}

#[derive(Deserialize)]
struct LexicalFormInput {
    language: String,
    surface: String,
    normalized: String,
}

#[derive(Deserialize)]
struct SourceLinkInput {
    dataset: String,
    release: String,
    identifier: String,
    relation: String,
}

#[derive(Deserialize)]
struct SourceGlossInput {
    language: String,
    text: String,
    dataset: String,
    release: String,
    identifier: String,
}

#[derive(Deserialize)]
struct OperationSignatureInput {
    verb: Vec<u16>,
    mood: Vec<u16>,
    arguments: Vec<OperationArgumentInput>,
    results: Vec<OperationResultInput>,
}

#[derive(Deserialize)]
struct OperationArgumentInput {
    grammatical_case: Vec<u16>,
    value_type: Vec<u16>,
    name: String,
    description: String,
}

#[derive(Deserialize)]
struct OperationResultInput {
    value_type: Vec<u16>,
    name: String,
    description: String,
}

fn usage() -> &'static str {
    "usage:\n  pyac-dictionary build <volume.pyac>  # Build JSON request is read from stdin.\n  pyac-dictionary inspect <volume.pyac>\n  pyac-dictionary surface <volume.pyac> <language> <surface>\n  pyac-dictionary surface-entries <volume.pyac> <language> <surface>\n  pyac-dictionary source <volume.pyac> <dataset> <release> <identifier>\n  pyac-dictionary source-entries <volume.pyac> <dataset> <release> <identifier>\n  pyac-dictionary key <volume.pyac> <hnuc[,hnuc...]>\n  pyac-dictionary entry <volume.pyac> <hnuc[,hnuc...]>\n  pyac-dictionary verify <volume.pyac>  # every canonical key must read back.\n  pyac-dictionary benchmark <volume.pyac> <iterations> surface <language> <surface>"
}

fn binary_bytes() -> io::Result<u64> {
    Ok(fs::metadata(env::current_exe()?)?.len())
}

fn parse_key(value: &str) -> Result<Vec<u16>, String> {
    let key = value
        .split(',')
        .map(|word| {
            let word = word.trim().trim_start_matches("0x");
            u16::from_str_radix(word, 16).map_err(|_| format!("invalid HNUC word: {word}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if key.is_empty() {
        return Err("Pyac key must contain at least one HNUC word".into());
    }
    Ok(key)
}

fn convert_input(input: BuildInput) -> Result<DictionaryVolume, String> {
    let entries = input
        .entries
        .into_iter()
        .map(|entry| {
            let definition = entry
                .definition
                .map(|codelets| {
                    codelets
                        .into_iter()
                        .map(|codelet| {
                            codelet.try_into().map_err(
                                |_| "definition codelet must contain exactly 16 uint16 words",
                            )
                        })
                        .collect::<Result<Vec<[u16; 16]>, _>>()
                })
                .transpose()?;
            Ok(DictionaryVolumeEntry {
                key: entry.key,
                lexical_forms: entry
                    .lexical_forms
                    .into_iter()
                    .map(|form| LexicalForm {
                        language: form.language,
                        surface: form.surface,
                        normalized: form.normalized,
                    })
                    .collect(),
                source_links: entry
                    .source_links
                    .into_iter()
                    .map(|link| SourceLink {
                        dataset: link.dataset,
                        release: link.release,
                        identifier: link.identifier,
                        relation: link.relation,
                    })
                    .collect(),
                source_glosses: entry
                    .source_glosses
                    .into_iter()
                    .map(|gloss| SourceGloss {
                        language: gloss.language,
                        text: gloss.text,
                        dataset: gloss.dataset,
                        release: gloss.release,
                        identifier: gloss.identifier,
                    })
                    .collect(),
                component_keys: entry.component_keys,
                task_keys: entry.task_keys,
                references: entry.references,
                operation_signatures: entry
                    .operation_signatures
                    .into_iter()
                    .map(|signature| OperationSignature {
                        verb: signature.verb,
                        mood: signature.mood,
                        arguments: signature
                            .arguments
                            .into_iter()
                            .map(|argument| OperationArgument {
                                key: OperationArgumentType {
                                    grammatical_case: argument.grammatical_case,
                                    value_type: argument.value_type,
                                },
                                name: argument.name,
                                description: argument.description,
                            })
                            .collect(),
                        results: signature
                            .results
                            .into_iter()
                            .map(|result| OperationResult {
                                value_type: result.value_type,
                                name: result.name,
                                description: result.description,
                            })
                            .collect(),
                    })
                    .collect(),
                definition,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(DictionaryVolume {
        metadata: DictionaryMetadata {
            kind: input.metadata.kind,
            title: input.metadata.title,
            revision: input.metadata.revision,
            languages: input.metadata.languages,
            normalization_policy: input.metadata.normalization_policy,
        },
        entries,
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut temporary = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("pyac");
    temporary.set_extension(format!("{extension}.tmp-{}", std::process::id()));
    let result = (|| {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// The throughput benchmark measures the direct-file indexes of a v4 volume,
/// so every older profile is refused instead of measured with compatibility
/// scans.
fn benchmark_guard_reason(profile_version: &str) -> Option<&'static str> {
    if profile_version == "pyac-vliw-dictionary/4" {
        return None;
    }
    Some("dictionary throughput benchmark requires v4 direct-file indexes; v2/v3 use compatibility scans")
}

fn open_reader(path: &Path) -> Result<DictionaryFileReader<File>, Box<dyn std::error::Error>> {
    Ok(DictionaryFileReader::open(File::open(path)?)?)
}

fn execute(args: &[String]) -> Result<Value, Box<dyn std::error::Error>> {
    let binary_size = binary_bytes()?;
    let whole_start = Instant::now();
    let command = args.first().map(String::as_str).unwrap_or("");
    let output = match command {
        "build" if args.len() == 2 => {
            let input_started = Instant::now();
            let mut input_bytes = Vec::new();
            io::stdin().read_to_end(&mut input_bytes)?;
            let input_ms = input_started.elapsed().as_secs_f64() * 1000.0;
            let request: BuildInput = serde_json::from_slice(&input_bytes)?;
            let volume = convert_input(request)?;
            let encode_started = Instant::now();
            let encoded = encode_dictionary(&volume)?;
            let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
            let write_started = Instant::now();
            atomic_write(Path::new(&args[1]), &encoded)?;
            let write_ms = write_started.elapsed().as_secs_f64() * 1000.0;
            json!({
                "command": "build", "path": args[1], "entries": volume.entries.len(),
                "volumeBytes": encoded.len(), "codeletCount": encoded.len().saturating_sub(32) / 32,
                "inputBytes": input_bytes.len(), "inputMs": input_ms,
                "encodeMs": encode_ms, "writeMs": write_ms
            })
        }
        "inspect" if args.len() == 2 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let metadata = reader.metadata();
            json!({
                "command": "inspect", "path": path, "volumeBytes": size,
                "codeletCount": reader.codelet_count(), "entryCount": reader.entry_count(),
                "metadata": {
                    "kind": metadata.kind, "title": metadata.title,
                    "revision": metadata.revision, "languages": metadata.languages,
                    "normalizationPolicy": metadata.normalization_policy
                },
                "sections": reader.sections().iter().map(|section| json!({
                    "role": section.role, "codeletStart": section.codelet_start,
                    "codeletCount": section.codelet_count
                })).collect::<Vec<_>>(),
                "openMs": open_ms
            })
        }
        "surface" if args.len() == 4 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let lookup_start = Instant::now();
            let offsets = reader.lookup_surface(&args[2], &args[3])?;
            let lookup_ns = lookup_start.elapsed().as_nanos();
            json!({
                "command": "surface", "path": path, "language": args[2], "surface": args[3],
                "matches": offsets, "volumeBytes": size, "openMs": open_ms,
                "lookupNs": lookup_ns
            })
        }
        "surface-entries" if args.len() == 4 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let lookup_start = Instant::now();
            let offsets = reader.lookup_surface(&args[2], &args[3])?;
            let matches = offsets
                .iter()
                .map(|offset| {
                    Ok(json!({
                        "offset": offset,
                        "codelets": reader.read_entry_at(*offset)?.iter().map(|codelet| codelet.to_vec()).collect::<Vec<_>>()
                    }))
                })
                .collect::<Result<Vec<_>, pyac::dictionary::DictionaryReadError>>()?;
            let lookup_ns = lookup_start.elapsed().as_nanos();
            json!({
                "command": "surface-entries", "path": path, "language": args[2], "surface": args[3],
                "matches": matches, "volumeBytes": size, "openMs": open_ms,
                "lookupNs": lookup_ns
            })
        }
        "source" if args.len() == 5 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let lookup_start = Instant::now();
            let matches = reader.lookup_source(&args[2], &args[3], &args[4])?;
            let lookup_ns = lookup_start.elapsed().as_nanos();
            let matches = matches
                .iter()
                .map(|offset| json!({"offset": offset}))
                .collect::<Vec<_>>();
            json!({
                "command": "source", "path": path, "dataset": args[2], "release": args[3],
                "identifier": args[4], "matches": matches, "volumeBytes": size,
                "openMs": open_ms, "lookupNs": lookup_ns
            })
        }
        "source-entries" if args.len() == 5 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let lookup_start = Instant::now();
            let source_matches = reader.lookup_source(&args[2], &args[3], &args[4])?;
            let matches = source_matches
                .iter()
                .map(|offset| {
                    Ok(json!({
                        "offset": offset,
                        "codelets": reader.read_entry_at(*offset)?.iter().map(|codelet| codelet.to_vec()).collect::<Vec<_>>()
                    }))
                })
                .collect::<Result<Vec<_>, pyac::dictionary::DictionaryReadError>>()?;
            let lookup_ns = lookup_start.elapsed().as_nanos();
            json!({
                "command": "source-entries", "path": path, "dataset": args[2], "release": args[3],
                "identifier": args[4], "matches": matches, "volumeBytes": size,
                "openMs": open_ms, "lookupNs": lookup_ns
            })
        }
        "key" | "entry" if args.len() == 3 => {
            let path = Path::new(&args[1]);
            let key = parse_key(&args[2]).map_err(io::Error::other)?;
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let read_start = Instant::now();
            let codelets = if command == "entry" {
                reader.read_entry(&key)?
            } else {
                reader.read_definition(&key)?
            };
            let read_ns = read_start.elapsed().as_nanos();
            json!({
                "command": command, "path": path, "key": key, "codelets": codelets,
                "hasDefinition": reader.has_definition(&key)?,
                "volumeBytes": size, "openMs": open_ms, "readNs": read_ns
            })
        }
        "verify" if args.len() == 2 => {
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            let verify_start = Instant::now();
            let keys = reader.canonical_keys()?;
            let mut failures: Vec<String> = Vec::new();
            for key in &keys {
                match reader.read_entry(key) {
                    Ok(codelets) if !codelets.is_empty() => {}
                    Ok(_) => failures.push(format!("key {key:x?}: decoded as empty")),
                    Err(error) => failures.push(format!("key {key:x?}: {error}")),
                }
            }
            let verify_ns = verify_start.elapsed().as_nanos();
            let verified = keys.len();
            json!({
                "command": "verify", "path": path,
                "entries": reader.entry_count(), "keys": verified,
                "failures": failures, "ok": failures.is_empty(),
                "volumeBytes": size, "openMs": open_ms, "verifyNs": verify_ns
            })
        }
        "benchmark" if args.len() == 6 && args[3] == "surface" => {
            let iterations = args[2].parse::<u64>()?;
            if iterations == 0 {
                return Err("benchmark iterations must be positive".into());
            }
            let path = Path::new(&args[1]);
            let size = fs::metadata(path)?.len();
            let open_start = Instant::now();
            let mut reader = open_reader(path)?;
            let open_ms = open_start.elapsed().as_secs_f64() * 1000.0;
            if let Some(reason) = benchmark_guard_reason(reader.profile_version()) {
                return Err(io::Error::other(reason).into());
            }
            for _ in 0..5 {
                std::hint::black_box(reader.lookup_surface(&args[4], &args[5])?);
            }
            let lookup_start = Instant::now();
            let mut match_count = 0usize;
            for _ in 0..iterations {
                match_count +=
                    std::hint::black_box(reader.lookup_surface(&args[4], &args[5])?).len();
            }
            let lookup_ns = lookup_start.elapsed().as_nanos();
            json!({
                "command": "benchmark", "path": path, "language": args[4], "surface": args[5],
                "iterations": iterations, "warmupIterations": 5,
                "matchesPerIteration": match_count / iterations as usize,
                "volumeBytes": size, "codeletCount": reader.codelet_count(),
                "entryCount": reader.entry_count(),
                "openMs": open_ms, "lookupTotalNs": lookup_ns,
                "lookupMeanNs": lookup_ns / u128::from(iterations),
                "lookupsPerSecond": (iterations as f64 * 1_000_000_000.0)
                    / lookup_ns.max(1) as f64
            })
        }
        _ => return Err(usage().into()),
    };
    let mut result = output;
    if let Some(object) = result.as_object_mut() {
        object.insert("executableBytes".into(), json!(binary_size));
        object.insert(
            "totalMs".into(),
            json!(whole_start.elapsed().as_secs_f64() * 1000.0),
        );
    }
    Ok(result)
}

fn main() {
    match execute(&env::args().skip(1).collect::<Vec<_>>()) {
        Ok(result) => {
            // `verify` reports its verdict in the body, so its exit status has to
            // carry the same answer for a shell or CI step to act on it.
            let failed_verify = result.get("ok").and_then(|value| value.as_bool()) == Some(false);
            println!("{result}");
            if failed_verify {
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("pyac-dictionary: {error}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::benchmark_guard_reason;

    #[test]
    fn the_benchmark_guard_refuses_every_profile_before_v4() {
        for profile in [
            "pyac-vliw-dictionary/2",
            "pyac-vliw-dictionary/3",
            "pyac-vliw-dictionary/1",
        ] {
            let reason = benchmark_guard_reason(profile).expect("legacy profiles are refused");
            assert!(reason.contains("requires v4 direct-file indexes"));
        }
        assert!(benchmark_guard_reason("pyac-vliw-dictionary/4").is_none());
    }
}
