//! A width word bounds the value it introduces.
//!
//! `po` is one byte, `do` two, `pu` four, `tl6h` eight. A value that does not fit
//! its width word is malformed, not silently truncated — otherwise the width word
//! would be decoration and `po 3940` would read as the uint8 0x64.
//!
//! The programlet is the canonical local-variable flow (declare from a literal,
//! write, return), copied from the pack fixture. The only thing varied here is
//! the declaration's initialising literal.

use pyac_vliw_core::{
    CODELET_WORDS, DEFAULT_PROGRAMLET_STEP_BUDGET, ERROR_MALFORMED, MAX_PROGRAMLET_SYMBOL_WORDS,
    ProgramletStack, execute_numeric_programlet,
};

const WORDS: usize = CODELET_WORDS;

type Flow = [[u16; WORDS]; 6];

/// The canonical flow, with the declaration's literal replaced.
///
/// The declaration is `gi hgut na | <width> <value> ka | gi prif swih | hnuc li`.
/// In the reference fixture that literal is `Qyis 0`; here it becomes a
/// width-tagged `<width> <value>`, which occupies the same two words so every
/// codelet header is unchanged.
fn flow(width_word: u16, value: u16) -> Flow {
    [
        // gi hgut hyas na | do gi 4930 ma | Qyis 0 fromindex | ceremony def
        [
            0x2911, 0x225e, 0xaa90, 0x8918, 0x24de, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0x0000,
            0x6357, 0xe8c9, 0x5217, 0, 0,
        ],
        // gi hgut na | <width> <value> ka | gi prif swih | hnuc li
        [
            0x0a49, 0x225e, 0xaa90, 0x24de, width_word, value, 0x245e, 0x225e, 0xc8c4, 0x414f,
            0xea30, 0x217e, 0, 0, 0, 0,
        ],
        // Qyis 1 ka | do gi 4930 ma | plus tu
        [
            0x0289, 0x881d, 0x0001, 0x245e, 0x327e, 0x225e, 0x4930, 0x243e, 0x8a64, 0x295e, 0, 0,
            0, 0, 0, 0,
        ],
        // gi hgut na | ret
        [
            0x0019, 0x225e, 0xaa90, 0x24de, 0xa828, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        // gi hgut hyas na | ceremony prah
        [
            0x0051, 0x225e, 0xaa90, 0x8918, 0x24de, 0xe8c9, 0x4e27, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        // do gi 4930 ma | hgut hyas tu
        [
            0x0091, 0x327e, 0x225e, 0x4930, 0x243e, 0xaa90, 0x8918, 0x295e, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    ]
}

fn run(codelets: &Flow) -> pyac_vliw_core::CoreResult {
    let words: Vec<u32> = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect();
    let mut symbols = [0; MAX_PROGRAMLET_SYMBOL_WORDS];
    let mut frames = ProgramletStack::EMPTY;
    execute_numeric_programlet(
        &words,
        codelets.len(),
        DEFAULT_PROGRAMLET_STEP_BUDGET,
        &mut symbols,
        &mut frames,
    )
}

#[test]
fn the_canonical_flow_itself_runs() {
    // Harness guard: if this fails the width assertions below prove nothing.
    let result = run(&flow(0x327e, 0));
    assert_eq!(result.error, 0, "baseline must execute: {result:?}");
}

#[test]
fn a_u8_width_accepts_255() {
    let result = run(&flow(0x309e, 255));
    assert_eq!(result.error, 0, "{result:?}");
}

#[test]
fn a_u8_width_rejects_256() {
    let result = run(&flow(0x309e, 256));
    assert_eq!(result.error, ERROR_MALFORMED, "{result:?}");
}

#[test]
fn a_u8_width_rejects_3940() {
    // The defect this guards: 3940 is not a uint8, so it must not be accepted
    // and silently read as 0x64.
    let result = run(&flow(0x309e, 3940));
    assert_eq!(result.error, ERROR_MALFORMED, "{result:?}");
}

#[test]
fn a_u16_width_accepts_65535() {
    let result = run(&flow(0x327e, 65535));
    assert_eq!(result.error, 0, "{result:?}");
}

#[test]
fn a_u32_width_accepts_a_word_sized_value() {
    // `pu` holds four bytes, so any single-word value fits.
    let result = run(&flow(0x289e, 65535));
    assert_eq!(result.error, 0, "{result:?}");
}

#[test]
fn the_reference_fixture_runs_unchanged() {
    // Exactly the pack fixture's declaration (literal `Qyis 0`), used to prove
    // the harness is sound before the width variations above mean anything.
    let mut codelets: Flow = flow(0x327e, 0);
    codelets[1] = [
        0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 0x0000, 0x245e, 0x225e, 0xc8c4, 0x414f, 0xea30,
        0x217e, 0, 0, 0, 0,
    ];
    let flat: Vec<u32> = codelets
        .iter()
        .flat_map(|c| c.iter().map(|w| u32::from(*w)))
        .collect();
    let expect: Vec<u32> = vec![
        0x2911, 0x225e, 0xaa90, 0x8918, 0x24de, 0x327e, 0x225e, 0x4930, 0x243e, 0x881d, 0x0000,
        0x6357, 0xe8c9, 0x5217, 0, 0, 0x0a49, 0x225e, 0xaa90, 0x24de, 0x881d, 0x0000, 0x245e,
        0x225e, 0xc8c4, 0x414f, 0xea30, 0x217e, 0, 0, 0, 0,
    ];
    assert_eq!(
        &flat[..32],
        &expect[..],
        "codelets 0 and 1 must match the reference"
    );
    let result = run(&codelets);
    assert_eq!(
        result.error, 0,
        "reference declaration must execute: {result:?}"
    );
}
