//! PyAC word codec: the glyph spelling of one HNUC word.
//!
//! A PyAC word is a 16-bit identity packed from its glyphs: a sort, a first
//! consonant, an optional second, a vowel, a tone, and a final consonant. The
//! packing is positional and fixed, so spelling and identity are one function
//! and its inverse — nothing is looked up.
//!
//! Ported from `program/library/vliw/word_code.mjs`; the two must agree, and a
//! differential test pins that.

/// Which structural class a spelling belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WordClass {
    /// Four or five glyphs starting with `h`.
    LongRoot,
    /// Four glyphs, not starting with `h`.
    ShortRoot,
    /// Four glyphs ending in `h`.
    LongGrammar,
    /// Two or three glyphs.
    ShortGrammar,
}

/// Why a spelling or identity was rejected.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WordError {
    /// Not one of the four glyph shapes.
    UnsupportedShape,
    /// A glyph is not in the table for its position.
    UnsupportedGlyph,
    /// The packed value belongs to no word class.
    UnsupportedIdentity,
    /// A spelling must be 2 to 5 ASCII glyphs.
    UnsupportedLength,
}

const CONSONANT_ONE: [(u8, u8); 23] = [
    (b'm', 1), (b'k', 2), (b'y', 3), (b'p', 4), (b'w', 5), (b'n', 6),
    (b's', 9), (b't', 10), (b'l', 11), (b'f', 12), (b'c', 13), (b'r', 14),
    (b'b', 17), (b'g', 18), (b'd', 19), (b'z', 20), (b'j', 21), (b'v', 22),
    (b'q', 25), (b'x', 26), (b'4', 27), (b'8', 28), (b'Q', 29),
];

const VOWEL: [(u8, u8); 8] = [
    (b'i', 0), (b'a', 1), (b'u', 2), (b'e', 3), (b'o', 4), (b'6', 5), (b'1', 6), (b'3', 7),
];

const TONE: [(u8, u8); 4] = [(b'E', 0), (b'M', 1), (b'7', 2), (b'2', 3)];

const CONSONANT_THREE: [(u8, u8); 14] = [
    (b'm', 0), (b'k', 1), (b'p', 2), (b'n', 3), (b's', 4), (b't', 5), (b'f', 6), (b'c', 7),
    (b'z', 4), (b'g', 1), (b'v', 6), (b'b', 2), (b'd', 5), (b'j', 7),
];

const CONSONANT_THREE_CANONICAL: [u8; 8] = [b'm', b'k', b'p', b'n', b's', b't', b'f', b'c'];

const CONSONANT_TWO_VOCAL: [u8; 8] = [b'y', b'w', b'z', b'l', b'v', b'j', b'r', b'x'];
const CONSONANT_TWO_ASPIRATE: [u8; 8] = [b'y', b'w', b's', b'l', b'f', b'c', b'r', b'x'];

fn table_lookup(table: &[(u8, u8)], glyph: u8) -> Option<u8> {
    table.iter().find(|(key, _)| *key == glyph).map(|(_, value)| *value)
}

fn table_inverse(table: &[(u8, u8)], code: u8) -> Option<u8> {
    table.iter().find(|(_, value)| *value == code).map(|(key, _)| *key)
}

/// Classify a spelling by its glyph shape.
///
/// Order matters and mirrors the C (`code_ACC_type`): a 4-glyph word ending in
/// `h` is long grammar, one *starting* with `h` is a short root, and any other
/// 4-glyph word is a long root. A 5-glyph word starting with `h` is a short
/// root; ending in `h` is long grammar; otherwise long root.
pub fn classify(word: &[u8]) -> Result<WordClass, WordError> {
    match word {
        [_, _] | [_, _, _] => Ok(WordClass::ShortGrammar),
        [_, _, _, b'h'] => Ok(WordClass::LongGrammar),
        [b'h', _, _, _] => Ok(WordClass::ShortRoot),
        [_, _, _, _] => Ok(WordClass::LongRoot),
        [b'h', _, _, _, _] => Ok(WordClass::ShortRoot),
        [_, _, _, _, b'h'] => Ok(WordClass::LongGrammar),
        [_, _, _, _, _] => Ok(WordClass::LongRoot),
        _ => Err(WordError::UnsupportedShape),
    }
}

fn is_vocal(first: u8) -> bool {
    matches!(first, b'b' | b'g' | b'd')
}

/// Pack a spelling into its 16-bit identity.
pub fn encode(word: &str) -> Result<u16, WordError> {
    let bytes = word.as_bytes();
    if !(2..=5).contains(&bytes.len()) || !bytes.is_ascii() {
        return Err(WordError::UnsupportedLength);
    }
    let class = classify(bytes)?;
    let mut value: u32 = match class {
        WordClass::ShortGrammar => 0x1e,
        WordClass::LongGrammar => 0x7,
        _ => 0,
    };

    let first = bytes[0];
    let (vowel, tone, second, third): (u8, u8, Option<u8>, Option<u8>) = match (bytes.len(), class) {
        (2, _) => (bytes[1], b'M', None, None),
        (3, _) => (bytes[1], bytes[2], None, None),
        (5, WordClass::ShortRoot) => (bytes[2], bytes[3], Some(bytes[1]), Some(bytes[4])),
        (5, _) => (bytes[2], bytes[3], Some(bytes[1]), Some(bytes[4])),
        (4, WordClass::ShortRoot) => (bytes[2], b'M', Some(bytes[1]), Some(bytes[3])),
        (4, _) => (bytes[2], b'M', Some(bytes[1]), Some(bytes[3])),
        _ => return Err(WordError::UnsupportedShape),
    };

    // First consonant: shifted by class.
    if first != b'\0' && class != WordClass::ShortRoot {
        let code = u32::from(table_lookup(&CONSONANT_ONE, first).ok_or(WordError::UnsupportedGlyph)?);
        value |= match class {
            WordClass::LongRoot => code,
            WordClass::LongGrammar => code << 3,
            _ => code << 5,
        };
    }
    // Second consonant.
    if let Some(glyph) = second {
        if class == WordClass::ShortRoot {
            let code = u32::from(table_lookup(&CONSONANT_ONE, glyph).ok_or(WordError::UnsupportedGlyph)?);
            value |= code << 3;
        } else if class != WordClass::ShortGrammar {
            let code = if is_vocal(first) {
                CONSONANT_TWO_VOCAL
                    .iter()
                    .position(|candidate| *candidate == glyph)
            } else {
                CONSONANT_TWO_ASPIRATE
                    .iter()
                    .position(|candidate| *candidate == glyph)
            }
            .ok_or(WordError::UnsupportedGlyph)? as u32;
            value |= match class {
                WordClass::LongRoot => code << 5,
                _ => code << 8,
            };
        }
    }
    // Vowel.
    let vowel_code = u32::from(table_lookup(&VOWEL, vowel).ok_or(WordError::UnsupportedGlyph)?);
    value |= match class {
        WordClass::LongRoot | WordClass::ShortRoot => vowel_code << 8,
        WordClass::LongGrammar => vowel_code << 11,
        WordClass::ShortGrammar => vowel_code << 10,
    };
    // Tone.
    let tone_code = u32::from(table_lookup(&TONE, tone).ok_or(WordError::UnsupportedGlyph)?);
    value |= match class {
        WordClass::LongRoot | WordClass::ShortRoot => tone_code << 11,
        WordClass::LongGrammar => tone_code << 14,
        WordClass::ShortGrammar => tone_code << 13,
    };
    // Final consonant.
    if let Some(glyph) = third {
        if class != WordClass::LongGrammar && class != WordClass::ShortGrammar {
            let code = u32::from(table_lookup(&CONSONANT_THREE, glyph).ok_or(WordError::UnsupportedGlyph)?);
            value |= code << 13;
        }
    }
    Ok(value as u16)
}

/// Spell a 16-bit identity back into its glyphs.
///
/// This is the same bit layout read backwards, not a table: the class bits
/// select the shape, then each field is shifted out and mapped through the same
/// glyph tables `encode` uses.
pub fn decode(value: u16, out: &mut [u8]) -> Result<usize, WordError> {
    if out.len() < 5 {
        return Err(WordError::UnsupportedLength);
    }
    if value == 0 {
        return Ok(0);
    }
    let mut len = 0usize;

    let short_sort = value & 0x7;
    let long_sort = value & 0x1f;

    if short_sort == 0 {
        // long root: h C V T c
        let first = table_inverse(&CONSONANT_ONE, ((value >> 3) & 0x1f) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let vowel = table_inverse(&VOWEL, ((value >> 8) & 0x7) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let tone = ((value >> 11) & 0x3) as u8;
        let third = *CONSONANT_THREE_CANONICAL
            .get(((value >> 13) & 0x7) as usize)
            .ok_or(WordError::UnsupportedIdentity)?;
        out[len] = b'h'; len += 1;
        out[len] = first; len += 1;
        out[len] = vowel; len += 1;
        len = push_tone(out, len, tone);
        out[len] = third; len += 1;
        return Ok(len);
    }
    if short_sort == 7 {
        // long grammar: C C V T h
        let first = table_inverse(&CONSONANT_ONE, ((value >> 3) & 0x1f) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let second_table = if is_vocal(first) {
            &CONSONANT_TWO_VOCAL
        } else {
            &CONSONANT_TWO_ASPIRATE
        };
        let second = *second_table
            .get(((value >> 8) & 0x7) as usize)
            .ok_or(WordError::UnsupportedIdentity)?;
        let vowel = table_inverse(&VOWEL, ((value >> 11) & 0x7) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        out[len] = first; len += 1;
        out[len] = second; len += 1;
        out[len] = vowel; len += 1;
        len = push_tone(out, len, ((value >> 14) & 0x3) as u8);
        out[len] = b'h'; len += 1;
        return Ok(len);
    }
    if long_sort == 0x1e {
        // short grammar: C V T
        let first = table_inverse(&CONSONANT_ONE, ((value >> 5) & 0x1f) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let vowel = table_inverse(&VOWEL, ((value >> 10) & 0x7) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        out[len] = first; len += 1;
        out[len] = vowel; len += 1;
        len = push_tone(out, len, ((value >> 13) & 0x3) as u8);
        return Ok(len);
    }
    if value > 0x800 {
        // short root: C C V T c
        let first = table_inverse(&CONSONANT_ONE, (value & 0x1f) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let second_table = if is_vocal(first) {
            &CONSONANT_TWO_VOCAL
        } else {
            &CONSONANT_TWO_ASPIRATE
        };
        let second = *second_table
            .get(((value >> 5) & 0x7) as usize)
            .ok_or(WordError::UnsupportedIdentity)?;
        let vowel = table_inverse(&VOWEL, ((value >> 8) & 0x7) as u8)
            .ok_or(WordError::UnsupportedIdentity)?;
        let third = *CONSONANT_THREE_CANONICAL
            .get(((value >> 13) & 0x7) as usize)
            .ok_or(WordError::UnsupportedIdentity)?;
        out[len] = first; len += 1;
        out[len] = second; len += 1;
        out[len] = vowel; len += 1;
        len = push_tone(out, len, ((value >> 11) & 0x3) as u8);
        out[len] = third; len += 1;
        return Ok(len);
    }
    Err(WordError::UnsupportedIdentity)
}

/// Append a tone glyph, omitting the unmarked tone.
fn push_tone(out: &mut [u8], len: usize, code: u8) -> usize {
    match table_inverse(&TONE, code) {
        Some(glyph) if glyph != b'M' => {
            out[len] = glyph;
            len + 1
        }
        _ => len,
    }
}
