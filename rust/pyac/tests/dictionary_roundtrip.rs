//! The gate on the volume writer: decode then encode must reproduce the bytes.
//!
//! A lossy decode would corrupt every entry an edit command touched, and it
//! would do so silently — the volume would still verify, because the decoder
//! and the verifier share the same reading of the format. Only a byte-for-byte
//! comparison against the original catches that, so this test compares bytes.

use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;

use pyac::dictionary::{decode_dictionary, encode_dictionary};

fn reference_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../program/library/dictionary/reference.pyac")
}

#[test]
fn decoding_the_published_volume_reproduces_it_byte_for_byte() {
    let path = reference_path();
    let original = std::fs::read(&path).expect("the tracked reference volume is readable");

    let volume = decode_dictionary(File::open(&path).expect("open the reference volume"))
        .expect("the published volume decodes");
    let reencoded = encode_dictionary(&volume).expect("the decoded model re-encodes");

    assert_eq!(
        volume.entries.len(),
        volume.entries.len(),
        "sanity: entry list is non-empty"
    );
    assert!(
        volume.entries.len() > 64_000,
        "expected the whole vocabulary, decoded {} entries",
        volume.entries.len()
    );

    if reencoded != original {
        // Report the first difference so a failure is diagnosable rather than
        // just "not equal".
        let first = original
            .iter()
            .zip(reencoded.iter())
            .position(|(left, right)| left != right);
        panic!(
            "decode->encode is not the identity: original {} bytes, re-encoded {} bytes, first difference at {:?}",
            original.len(),
            reencoded.len(),
            first
        );
    }
}
