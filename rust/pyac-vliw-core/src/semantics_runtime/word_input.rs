/// A codelet word source can keep its packed width while the interpreter
/// promotes individual words only when evaluating a semantic operation.
pub trait VliwWord: Copy {
    fn into_u32(self) -> u32;
}

impl VliwWord for u16 {
    #[inline(always)]
    fn into_u32(self) -> u32 {
        u32::from(self)
    }
}

impl VliwWord for u32 {
    #[inline(always)]
    fn into_u32(self) -> u32 {
        self
    }
}

#[cfg(target_arch = "spirv")]
#[inline(always)]
pub(super) unsafe fn input_word_unchecked<W: VliwWord>(words: &[W], index: usize) -> u32 {
    // SAFETY: callers validate the codelet range before reading its words.
    unsafe { *<[W] as spirv_std::arch::IndexUnchecked<W>>::index_unchecked(words, index) }
        .into_u32()
}

#[cfg(not(target_arch = "spirv"))]
#[inline(always)]
pub(super) unsafe fn input_word_unchecked<W: VliwWord>(words: &[W], index: usize) -> u32 {
    // SAFETY: callers validate the codelet range before reading its words.
    unsafe { words.get_unchecked(index).into_u32() }
}
