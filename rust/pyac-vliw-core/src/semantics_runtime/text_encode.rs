//! Text to codelets: the front half of the PyAC pipeline.
//!
//! Ported from `~/pyac/lwonprom`:
//!
//! - `program/parser.c`   `first_word_derive`   — word boundary by glyph shape
//! - `program/analyst.c`  `derive_first_word`   — the same, copying the word out
//! - `program/encoding.c` `process_full_word`   — classify a derived word
//! - `program/encoding.c` `neo_phrase_encode`   — place it in the phrase
//! - `program/encoding.c` `neo_independentClause_encoding` — the clause loop
//! - `program/sort.c`     `tablet_word_write` / `tablet_grammar_write`
//!
//! The shape of the thing: scan glyphs into a word, derive that word's length
//! from its glyph pattern, encode it to an HNUC, then append it to the codelet
//! being built. A case word or a mood sets the boundary bit for its slot; every
//! other word leaves it clear. Which appender is used decides that, so the
//! classification ladder is the heart of it.
//!
//! Codelet layout mirrors the C: slot 0 is the summary word carrying the
//! boundary bitmap and the completion bit, slots 1..=15 are payload.
//!
//! The crate is `no_std` with no allocator, so this writes into a caller-supplied
//! codelet buffer and returns how many codelets it filled — the same discipline
//! as `decode_sentence`.

use super::word_code;

/// Payload slots per codelet; slot 0 is the summary word.
pub const CODELET_PAYLOAD: usize = 15;
/// A full codelet, summary word included.
pub const CODELET_WIDTH: usize = CODELET_PAYLOAD + 1;

/// Glyphs that start or continue a consonant, exactly as `consonant_group` in
/// `program/parser.c` lists them. The C's `consonant_group_magnitude` says 23 but
/// 24 glyphs are listed, so the list is taken as written.
const CONSONANT_GLYPHS: &[u8] = b"ptkfscxbdgvzjnmqrlyw18h.";
/// Vowels, in the C's order.
const VOWEL_GLYPHS: &[u8] = b"iaueo6";
/// Tone marks. `M` is the unmarked tone for the codec but a real glyph here.
const TONE_GLYPHS: &[u8] = b"M72";

/// The quote header the C writes for a numeric literal.
const NUMBER_QUOTE: u32 = 0x881d;
const NUMBER_WORD: u32 = 0x327e;
const REFERENTIAL_WORD: u32 = 0xc8c4;

/// Why a sentence could not be encoded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    /// A glyph that begins no word.
    BadGlyph,
    /// A word-shaped run the codec could not encode.
    Unencodable,
    /// The caller's codelet buffer filled up.
    CodeletCapacity,
    /// Nothing to parse.
    Empty,
}

fn is_consonant(glyph: u8) -> bool {
    CONSONANT_GLYPHS.contains(&glyph)
}

fn is_vowel(glyph: u8) -> bool {
    VOWEL_GLYPHS.contains(&glyph)
}

fn is_tone(glyph: u8) -> bool {
    TONE_GLYPHS.contains(&glyph)
}

/// A glyph that belongs to a word; anything else separates words.
pub fn is_letter(glyph: u8) -> bool {
    is_consonant(glyph) || is_vowel(glyph) || is_tone(glyph)
}

/// Derive the first word's length from its glyph pattern.
///
/// Mirrors `first_word_derive`: a leading consonant is `CV`, `CVT`, `CCVC` or
/// `CCVT`; a leading vowel is a glottal-stopped word, which the C skips into (see
/// [`encode_sentence`]). Returns `None` when no word starts at `text[0]`.
pub fn first_word_length(text: &[u8]) -> Option<usize> {
    if text.len() < 2 {
        return None;
    }
    let first = text[0];
    if is_vowel(first) {
        // Vowel-initial: the next two glyphs must be consonants, and the C then
        // advances into the word rather than returning a length.
        if text.len() < 3 || !is_consonant(text[1]) || !is_consonant(text[2]) {
            return None;
        }
        return Some(0);
    }
    if !is_consonant(first) {
        return None;
    }
    if is_consonant(text[1]) {
        // CCV(T)C or CCVT
        if text.len() < 3 || !is_vowel(text[2]) {
            return None;
        }
        if text.len() >= 4 && is_tone(text[3]) {
            if text.len() < 5 || !is_consonant(text[4]) {
                return None;
            }
            return Some(5);
        }
        if text.len() >= 4 && is_consonant(text[3]) {
            return Some(4);
        }
        return None;
    }
    if is_vowel(text[1]) {
        // CV or CVT
        if text.len() >= 3 && is_tone(text[2]) {
            return Some(3);
        }
        return Some(2);
    }
    None
}

/// The classification a derived word falls into, which picks the appender.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WordClass {
    /// A numeric literal terminator (`do`), which collects the digit run before it.
    Number,
    /// A number-word digit, buffered until a terminator arrives.
    Digit,
    /// A hash name, appended like a lexical value.
    Referential,
    /// A grammatical case word, appended as grammar (sets a boundary).
    Case,
    /// A mood, appended as grammar (sets a boundary).
    Perspective,
    /// Any other word, appended as a lexical value.
    Lexical,
}

/// Grammatical case words, by HNUC, from `grammaticalCase_word_sequence`.
const CASE_WORDS: &[u32] = &[
    0x24de, // nominative
    0x245e, // accusative
    0x255e, // topic
    0x28be, // vocative
    0x215e, // genitive
    0x243e, // destination
    0x207e, // dative
    0x287e, // instrumental
    0x490f, // comitative
    0x4927, // benefactive
    0x414f, // essive
    0x267e, // adpositional
    0x2d5e, // location
    0x265e, // way
    0x313e, // source
    0x4127, // ablative
    0x4957, // elative
    0x4157, // illative
];

/// Mood words, by HNUC, from `perspective_word_sequence`.
const PERSPECTIVE_WORDS: &[u32] = &[
    0x217e, // realis
    0x295e, // deontic
    0x29be, // conditional
    0x213e, // epistemic
    0x21de, // interrogative
    0x227e, // directive
    0x5217, // declarative
    0x4e27, // paragraph
];

/// Number-word digits, `pyash_number_dictionary` in the C. The word's index is
/// its value, so a run of them reads as base-16 digits.
const NUMBER_DIGITS: &[(u32, u32)] = &[
    (0x6cd4, 0),  // zron
    (0x2818, 1),  // hyik
    (0xaa0a, 2),  // tyut
    (0x680a, 3),  // tyin
    (0x8942, 4),  // ksas
    (0x2960, 5),  // hfak
    (0x8858, 6),  // hlis
    (0x4848, 7),  // hsip
    (0x4928, 8),  // hwap
    (0x6a2a, 9),  // twun
    (0x4850, 10), // htip
    (0x6b69, 11), // slen
    (0xa98a, 12), // tfat
    (0x8b4a, 13), // tses
    (0x8b48, 14), // hses
    (0xab20, 15), // hpet
];

fn number_digit(honuc: u32) -> Option<u32> {
    NUMBER_DIGITS
        .iter()
        .find(|(word, _)| *word == honuc)
        .map(|(_, digit)| *digit)
}

fn classify(honuc: u32) -> WordClass {
    if honuc == NUMBER_WORD {
        WordClass::Number
    } else if honuc == REFERENTIAL_WORD {
        WordClass::Referential
    } else if number_digit(honuc).is_some() {
        // A digit is a lexical word until the `do` terminator collects it.
        WordClass::Digit
    } else if CASE_WORDS.contains(&honuc) {
        WordClass::Case
    } else if PERSPECTIVE_WORDS.contains(&honuc) {
        WordClass::Perspective
    } else {
        WordClass::Lexical
    }
}

/// A codelet under construction, writing straight into the caller's buffer.
struct Builder<'a> {
    codelets: &'a mut [[u32; CODELET_WIDTH]],
    count: usize,
    summary: u32,
    used: usize,
}

impl<'a> Builder<'a> {
    fn new(codelets: &'a mut [[u32; CODELET_WIDTH]]) -> Self {
        Self {
            codelets,
            count: 1,
            summary: 0,
            used: 0,
        }
    }

    fn current(&mut self) -> &mut [u32; CODELET_WIDTH] {
        &mut self.codelets[self.count - 1]
    }

    /// Append a payload word, optionally marking it a boundary.
    fn push(&mut self, word: u32, boundary: bool) -> Result<(), ParseError> {
        if self.used == CODELET_PAYLOAD {
            if self.count == self.codelets.len() {
                return Err(ParseError::CodeletCapacity);
            }
            self.seal();
            self.count += 1;
            self.summary = 0;
            self.used = 0;
        }
        let slot = self.used + 1;
        if boundary {
            self.summary |= 1 << slot;
        }
        self.current()[slot] = word;
        self.used += 1;
        Ok(())
    }

    /// Write the summary word for the codelet being filled.
    fn seal(&mut self) {
        let summary = self.summary;
        self.current()[0] = summary;
    }

    /// Seal the last codelet, marking it complete.
    fn finish(mut self) -> usize {
        let summary = self.summary | 1;
        self.current()[0] = summary;
        self.count
    }
}

/// Encode one PyAC sentence into `codelets`, returning how many were filled.
///
/// A case word closes the field before it and a mood closes the sentence; both
/// set their slot's boundary bit, which is why the classification decides the
/// bitmap rather than any separate pass.
pub fn encode_sentence(
    text: &str,
    codelets: &mut [[u32; CODELET_WIDTH]],
) -> Result<usize, ParseError> {
    let letters = text.as_bytes();
    if letters.is_empty() {
        return Err(ParseError::Empty);
    }
    if codelets.is_empty() {
        return Err(ParseError::CodeletCapacity);
    }
    let mut builder = Builder::new(codelets);
    let mut index = 0usize;
    // A run of number-word digits, held until a terminator (`do`) collects them
    // or another word proves the run was ordinary vocabulary.
    let mut pending = [0u32; 8];
    let mut pending_used = 0usize;

    while index < letters.len() {
        while index < letters.len() && !is_letter(letters[index]) {
            index += 1;
        }
        if index >= letters.len() {
            break;
        }
        let rest = &letters[index..];
        let Some(length) = first_word_length(rest) else {
            return Err(ParseError::BadGlyph);
        };
        if length == 0 {
            // Vowel-initial: the C steps past the leading vowel and re-derives.
            index += 1;
            continue;
        }
        let word = core::str::from_utf8(&rest[..length]).map_err(|_| ParseError::BadGlyph)?;
        let honuc = u32::from(word_code::encode(word).map_err(|_| ParseError::Unencodable)?);
        index += length;

        let is_digit = number_digit(honuc).is_some();
        if is_digit {
            if pending_used == pending.len() {
                return Err(ParseError::CodeletCapacity);
            }
            pending[pending_used] = honuc;
            pending_used += 1;
            continue;
        }

        // A `do` settles the pending digit run into one numeric quote and is fully
        // consumed by that; every other word class is appended normally.
        if honuc == NUMBER_WORD {
            let mut value = 0u32;
            for position in 0..pending_used {
                let digit = number_digit(pending[position]).unwrap_or(0);
                value = value.wrapping_add(digit << (4 * position as u32));
            }
            pending_used = 0;
            builder.push(NUMBER_QUOTE, false)?;
            builder.push(value, false)?;
            continue;
        }

        // Anything else flushes a pending run as the plain words it was.
        for slot in 0..pending_used {
            builder.push(pending[slot], false)?;
        }
        pending_used = 0;

        match classify(honuc) {
            WordClass::Case | WordClass::Perspective => builder.push(honuc, true)?,
            _ => builder.push(honuc, false)?,
        }
    }

    // Trailing digits with no terminator are ordinary words.
    for slot in 0..pending_used {
        builder.push(pending[slot], false)?;
    }

    Ok(builder.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cv_word_is_two_glyphs() {
        assert_eq!(first_word_length(b"doka"), Some(2));
    }

    #[test]
    fn a_cvt_word_is_three_glyphs() {
        assert_eq!(first_word_length(b"no7ka"), Some(3));
    }

    #[test]
    fn a_ccvc_word_is_four_glyphs() {
        assert_eq!(first_word_length(b"plustu"), Some(4));
    }

    #[test]
    fn a_ccvt_word_is_five_glyphs() {
        assert_eq!(first_word_length(b"kse7m"), Some(5));
    }

    #[test]
    fn a_vowel_initial_word_asks_the_caller_to_advance() {
        assert_eq!(first_word_length(b"ipla"), Some(0));
    }

    #[test]
    fn separators_are_not_letters() {
        assert!(!is_letter(b' '));
        assert!(is_letter(b'k'));
        assert!(is_letter(b'a'));
        assert!(is_letter(b'7'));
    }
}
