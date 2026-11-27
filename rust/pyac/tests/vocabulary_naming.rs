//! Guards that the Rust identifiers say what the vocabulary says, in English.
//!
//! The defect these cover is not a runtime bug: it is a name that points at a
//! different word than the value it holds. `SU` held `na` (the nominative case),
//! and `MAXIMUM_VERB_FIRST` held the atom for "magnitude". Both read fine and
//! were wrong, and both cost real debugging time to notice.
//!
//! The rule is that an identifier is English, because it is code meant to be read
//! in English, and the Pya spelling belongs in the doc comment. Transliterating
//! the spelling into the identifier (`GJAT_MAGNITUDE`, `HGIP_CABBAGE`) does not
//! help: it hides the meaning behind a word nobody reads.
//!
//! These are source-text checks, not behaviour checks.

use std::fs;
use std::path::Path;

fn read(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("cannot read {} for the naming guard: {error}", path.display())
    })
}

/// The case and mood words are named for what they mean, not for the English
/// role word that happens to translate them.
#[test]
fn dictionary_words_are_named_for_their_meaning() {
    let source = read("src/dictionary/words.rs");
    let expected = [
        ("0x225e", "NAME_MARKER"),
        ("0x24de", "NOMINATIVE"),
        ("0x245e", "ACCUSATIVE"),
        ("0x414f", "ESSIVE"),
        ("0x313e", "SOURCE"),
        ("0x243e", "DESTINATION"),
        ("0x287e", "INSTRUMENTAL"),
        ("0x490f", "COMITATIVE"),
        ("0x615f", "LOCATIVE"),
        ("0x217e", "REALIS"),
    ];
    for (value, name) in expected {
        let line = format!("const {name}: u16 = {value};");
        assert!(
            source.contains(&line),
            "words.rs should define `{line}`; name the case or mood for its meaning"
        );
    }
}

/// The old names must not come back. They were the English role word for a Pya
/// case word, which is what made `SU` look like the word `su`.
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
        for banned in [
            "const SU:", "const OB:", "const FROM:", "const TO:", "const AS:", "const BY:",
            "const WITH:", "const AT:",
        ] {
            assert!(
                !source.contains(banned),
                "{file} still defines `{banned}`; name the case for its meaning"
            );
        }
    }
}

/// Identifiers are English. A Pya spelling in the identifier hides the meaning
/// behind a word the reader has to look up.
///
/// The one exception is a genuine ambiguity: two English senses of the same word
/// that need different atoms. Then the Pya spelling may appear to say which.
/// No identifier needs that today, so the list below is exhaustive — if one is
/// added deliberately, it belongs here with a comment saying which senses it
/// separates.
#[test]
fn identifiers_are_english_not_pya_spellings() {
    for file in [
        "src/dictionary/words.rs",
        "src/iwsp.rs",
        "../pyac-vliw-core/src/semantics_runtime/iwsp_vector_ops.rs",
        "../pyac-vliw-core/src/semantics_runtime/programlet_vector_actions.rs",
        "../pyac-vliw-core/src/semantics_runtime/pluk_tlas.rs",
    ] {
        let source = read(file);
        for banned in [
            "GJAT_", "BWIT_", "HGUT_", "HGIP_", "DLEK_", "GI_NAME", "NA_NOMINATIVE",
            "KA_ACCUSATIVE", "SWIH_ESSIVE", "SO_SOURCE", "MA_DESTINATION", "YU_INSTRUMENTAL",
            "MWAH_COMITATIVE", "LWOH_LOCATIVE", "LI_REALIS", "PLUK", "TLAS",
        ] {
            assert!(
                !source.contains(banned),
                "{file} names something with the Pya spelling `{banned}`; use the English term and note the spelling in a comment"
            );
        }
    }
}

/// The dispatch discriminator is the noun class, and the case field is
/// `grammatical_case`. Both files must say so, because the note on this module
/// existed precisely because the two encodings were indistinguishable by name.
#[test]
fn both_encodings_state_the_same_dispatch_identity() {
    for file in [
        "src/dictionary/operation.rs",
        "../pyac-vliw-core/src/semantics_runtime/canonical_signature.rs",
    ] {
        let source = read(file);
        assert!(
            source.contains("dispatch identity = verb + mood + sorted[(grammatical_case, noun_class)]"),
            "{file} should state the dispatch identity verbatim, so the two encodings cannot drift apart"
        );
    }
}

/// Inputs and outputs are different axes, and a reader must not have to infer
/// that from the mood. The dictionary side says it in words.
#[test]
fn the_argument_result_split_is_stated() {
    let source = read("src/dictionary/operation.rs");
    assert!(
        source.contains("case-keyed")
            && source.contains("keyed by noun class only"),
        "operation.rs should say arguments are case-keyed inputs and results are noun-class-keyed outputs"
    );
    assert!(
        source.contains("not the mood"),
        "operation.rs should say input versus output is the case axis, not the mood"
    );
}

/// The four grounded .rs concepts must cite a real sense and a real volume key,
/// and that key must be the one that resolves to it. A doc comment naming a
/// sense the volume does not carry is worse than no comment: it reads as
/// authoritative and is wrong.
#[test]
fn documented_senses_are_the_ones_in_the_reference_volume() {
    let source = read("src/dictionary/operation.rs");
    // (sense id, pya key, where it should be cited)
    let expected = [
        ("n:06367706-n", "tlas hrut", "OperationArgument"),
        ("n:07217239-n", "tyec dlut", "label"),
        ("n:06737512-n", "drut pfif", "description"),
        ("n:06321935-n", "gvak", "grammatical_case"),
    ];
    for (sense, key, what) in expected {
        assert!(
            source.contains(sense),
            "operation.rs should cite WordNet sense {sense} for `{what}`"
        );
        assert!(
            source.contains(key),
            "operation.rs should cite the reference key `{key}` for `{what}`, so the sense is reachable with `pyash dict`"
        );
    }
}

/// Documentation fields are named for their compound, never `name`. `name` is
/// the name noun class (`gi`), and a field called `name` invites a reader to put
/// the noun class into a documentation slot.
#[test]
fn documentation_fields_are_named_for_their_compound() {
    let source = read("src/dictionary/operation.rs");
    assert!(
        !source.contains("pub name: String"),
        "operation.rs has a documentation field called `name`; that is the name noun class, use `tag_label`"
    );
    assert!(
        source.contains("pub tag_label: String"),
        "operation.rs should carry a tag label as `tag_label`; Pyac key `tyec dlut`"
    );
    assert!(
        source.contains("pub descriptive_specification: String"),
        "operation.rs should carry a description as `descriptive_specification`; Pyac key `drut pfif`"
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
