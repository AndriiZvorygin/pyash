//! Guards that the Rust identifiers keep saying what the vocabulary says.
//!
//! The defect these cover is not a runtime bug: it is a name that points at a
//! different word than the value it holds. `SU` held `na` (nominative), and
//! `MAXIMUM_VERB_FIRST` held `gjat` ("magnitude"). Both read fine and were
//! wrong, and both cost real debugging time to notice.
//!
//! These are source-text checks, not behaviour checks — they read the files and
//! assert the naming rule holds. A rename that reintroduces a misleading name
//! fails here before it can mislead anyone again.

use std::fs;
use std::path::Path;

fn read(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("cannot read {} for the naming guard: {error}", path.display())
    })
}

/// Every vocabulary constant is `<pya>_<english>` or an alias that names the
/// atom it equals. A bare English role word (`SU`, `OB`) is what went wrong.
#[test]
fn dictionary_words_are_named_for_their_atoms() {
    let source = read("src/dictionary/words.rs");
    // Each of these must appear as a constant, and must carry the pya spelling
    // for the case it encodes.
    let expected = [
        ("0x225e", "GI_NAME"),
        ("0x24de", "NA_NOMINATIVE"),
        ("0x245e", "KA_ACCUSATIVE"),
        ("0x414f", "SWIH_ESSIVE"),
        ("0x313e", "SO_SOURCE"),
        ("0x243e", "MA_DESTINATION"),
        ("0x287e", "YU_INSTRUMENTAL"),
        ("0x490f", "MWAH_COMITATIVE"),
        ("0x615f", "LWOH_LOCATIVE"),
        ("0x217e", "LI_REALIS"),
    ];
    for (value, name) in expected {
        let line = format!("const {name}: u16 = {value};");
        assert!(
            source.contains(&line),
            "words.rs should define `{line}`; an atom must be named for its pya spelling and its gloss"
        );
    }
}

/// The old names must not come back. They are the English role for a pya case
/// word, which is what made `SU` look like the word `su` (`0x293e`, "except_").
#[test]
fn the_english_role_names_are_gone() {
    for file in [
        "src/dictionary/words.rs",
        "src/dictionary/wire.rs",
        "src/dictionary/reader.rs",
        "src/dictionary/reader_codec.rs",
        "src/dictionary/reader_index.rs",
        "src/dictionary/volume_records.rs",
    ] {
        let source = read(file);
        for banned in ["const SU:", "const OB:", "const FROM:", "const TO:", "const AS:", "const BY:", "const WITH:", "const AT:"] {
            assert!(
                !source.contains(banned),
                "{file} still defines `{banned}`; name the atom, e.g. NA_NOMINATIVE for na"
            );
        }
    }
}

/// `slot` is already a vocabulary word (0xac69, "shoot"). Using it as an
/// identifier name would recreate the very defect this guards.
#[test]
fn no_identifier_is_named_slot() {
    for file in [
        "src/dictionary/operation.rs",
        "src/dictionary/wire.rs",
        "src/dictionary/volume.rs",
    ] {
        let source = read(file);
        assert!(
            !source.contains("pub slot:"),
            "{file} names a field `slot`, but `slot` is 0xac69 (\"shoot\"); use `case_type`"
        );
    }
}

/// Documentation fields are `label`, never `name`. `name` is the name_ noun
/// class (`gi`), and a field called `name` invites a reader to put the noun
/// class into a documentation slot.
#[test]
fn documentation_fields_are_labelled_not_named() {
    let source = read("src/dictionary/operation.rs");
    assert!(
        !source.contains("pub name: String"),
        "operation.rs has a documentation field called `name`; `name` is the name_ noun class, use `label`"
    );
    assert!(
        source.contains("pub label: String"),
        "operation.rs should carry documentation as `label`"
    );
}

/// The noun class is the dispatch discriminator, so its name must say so. A
/// field called `value_type` reads as a coarse scalar type and hides that.
#[test]
fn the_dispatch_discriminator_is_called_noun_class() {
    let source = read("src/dictionary/operation.rs");
    assert!(
        !source.contains("pub value_type:"),
        "operation.rs says `value_type`; the field is a noun class and the dispatch discriminator"
    );
    assert!(
        source.contains("pub noun_class:"),
        "operation.rs should name the discriminator `noun_class`"
    );
}
