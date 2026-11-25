pub const STORAGE_BINDING_WORDS: usize = 16;
const STORAGE_SHAPE_OFFSET: usize = 8;

#[derive(Clone, Copy)]
pub struct StorageView<'a> {
    descriptors: &'a [u32],
    names: &'a [u32],
    payload: &'a [u32],
}

impl<'a> StorageView<'a> {
    pub const EMPTY: Self = Self {
        descriptors: &[0],
        names: &[0],
        payload: &[0],
    };

    pub const fn new(descriptors: &'a [u32], names: &'a [u32], payload: &'a [u32]) -> Self {
        Self {
            descriptors,
            names,
            payload,
        }
    }

    pub fn section_count(&self) -> usize {
        self.descriptors
            .first()
            .copied()
            .unwrap_or(0)
            .min(((self.descriptors.len().saturating_sub(1)) / STORAGE_BINDING_WORDS) as u32)
            as usize
    }

    pub fn descriptor(&self, section: usize, field: usize) -> Option<u32> {
        if section >= self.section_count() || field >= STORAGE_BINDING_WORDS {
            return None;
        }
        self.descriptors
            .get(1 + section * STORAGE_BINDING_WORDS + field)
            .copied()
    }

    pub fn shape(&self, section: usize, dimension: usize) -> Option<u32> {
        if dimension >= STORAGE_BINDING_WORDS - STORAGE_SHAPE_OFFSET {
            return None;
        }
        self.descriptor(section, STORAGE_SHAPE_OFFSET + dimension)
            .filter(|extent| *extent != 0)
    }

    pub fn name_word(&self, index: usize) -> Option<u32> {
        self.names.get(index).copied()
    }

    pub fn payload_word(&self, index: usize) -> Option<u32> {
        self.payload.get(index).copied()
    }

    pub fn read_payload_u32(&self, byte_offset: usize) -> Option<u32> {
        let mut value = 0u32;
        let mut byte = 0;
        while byte < 4 {
            let absolute = byte_offset.checked_add(byte)?;
            let packed = self.payload_word(absolute / 4)?;
            value |= ((packed >> ((absolute % 4) * 8)) & 0xff) << (byte * 8);
            byte += 1;
        }
        Some(value)
    }

    pub fn read_payload_u64(&self, byte_offset: usize) -> Option<u64> {
        let low = self.read_payload_u32(byte_offset)? as u64;
        let high_offset = byte_offset.checked_add(4)?;
        let high = self.read_payload_u32(high_offset)? as u64;
        Some(low | (high << 32))
    }
}
