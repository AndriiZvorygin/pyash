use pyac_vliw_core::{MAX_PROGRAMLET_SECTIONS, StorageSectionRange, scan_storage_sections};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageSectionError {
    pub codelet_index: usize,
    pub reason: &'static str,
}

impl std::fmt::Display for StorageSectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} at codelet {}",
            self.reason, self.codelet_index
        )
    }
}

impl std::error::Error for StorageSectionError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PyacStorageSections {
    pub executable_codelet_count: usize,
    pub descriptors: Vec<u32>,
    pub names: Vec<u32>,
    pub payload: Vec<u32>,
}

pub fn prepare_storage_sections(
    codelets: &[[u16; pyac_vliw_core::CODELET_WORDS]],
) -> Result<PyacStorageSections, StorageSectionError> {
    let words = codelets.as_flattened();
    let mut ranges = [StorageSectionRange::default(); MAX_PROGRAMLET_SECTIONS];
    let count = scan_storage_sections(words, codelets.len(), &mut ranges).map_err(|_| {
        StorageSectionError {
            codelet_index: 0,
            reason: "malformed VLIW storage packet",
        }
    })?;
    if count == 0 {
        return Ok(PyacStorageSections {
            executable_codelet_count: codelets.len(),
            descriptors: vec![0],
            names: vec![0],
            payload: vec![0],
        });
    }

    let executable_codelet_count = ranges[0].metadata_start;
    if executable_codelet_count == 0 {
        return Err(StorageSectionError {
            codelet_index: 0,
            reason: "storage payload packet has no executable VLIW code",
        });
    }
    let mut expected_start = executable_codelet_count;
    for section in &ranges[..count] {
        if section.metadata_start != expected_start {
            return Err(StorageSectionError {
                codelet_index: expected_start,
                reason: "storage descriptors and payloads are not contiguous",
            });
        }
        expected_start = section.payload_start + section.payload_codelets;
    }
    if expected_start != codelets.len() {
        return Err(StorageSectionError {
            codelet_index: expected_start,
            reason: "codelets follow the final storage payload",
        });
    }

    let mut descriptors = Vec::with_capacity(1 + count * pyac_vliw_core::STORAGE_BINDING_WORDS);
    let mut names = Vec::new();
    let mut payload = Vec::new();
    let mut payload_bytes = 0usize;
    descriptors.push(count as u32);
    for section in &ranges[..count] {
        let name_offset = names.len();
        names.extend(
            (0..section.name_length).map(|index| u32::from(words[section.name_word_index + index])),
        );
        let payload_offset = payload_bytes;
        let payload_start_word = section.payload_start * pyac_vliw_core::CODELET_WORDS;
        for byte_index in 0..section.byte_length as usize {
            let word = words[payload_start_word + byte_index / 2];
            let byte = if byte_index % 2 == 0 {
                (word & 0xff) as u8
            } else {
                (word >> 8) as u8
            };
            let payload_word_index = payload_bytes / 4;
            if payload_word_index == payload.len() {
                payload.push(0);
            }
            payload[payload_word_index] |= u32::from(byte) << ((payload_bytes % 4) * 8);
            payload_bytes += 1;
        }
        descriptors.extend([
            name_offset as u32,
            section.name_length as u32,
            payload_offset as u32,
            section.byte_length,
            section.element_width,
            section.element_count,
            section.element_type,
            section.rank,
        ]);
        descriptors.extend_from_slice(&section.shape);
    }
    if names.is_empty() {
        names.push(0);
    }
    if payload.is_empty() {
        payload.push(0);
    }
    Ok(PyacStorageSections {
        executable_codelet_count,
        descriptors,
        names,
        payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_metadata_and_payload_are_prepared_once_for_cpu_and_gpu_callers() {
        let codelets = [
            [0u16; pyac_vliw_core::CODELET_WORDS],
            [
                0xbbb6, 0x225e, 0x6844, 0x24de, 0x225e, 0x309e, 0x414f, 0x891d, 4, 0, 0x287e,
                0x8e1d, 1, 4, 0x490f, 0x6a84,
            ],
            [5, 0xec01, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0x0201, 0x0403, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ];
        let prepared = prepare_storage_sections(&codelets).expect("storage packet is valid");
        assert_eq!(prepared.executable_codelet_count, 1);
        assert_eq!(
            prepared.descriptors,
            [1, 0, 1, 0, 4, 1, 4, 0x309e, 1, 4, 0, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(prepared.names, [0x6844]);
        assert_eq!(prepared.payload, [0x0403_0201]);
    }

    #[test]
    fn rejects_codelets_after_a_storage_payload() {
        let mut codelets = vec![
            [0u16; pyac_vliw_core::CODELET_WORDS],
            [
                0xbbb6, 0x225e, 0x6844, 0x24de, 0x225e, 0x309e, 0x414f, 0x891d, 4, 0, 0x287e,
                0x8e1d, 1, 4, 0x490f, 0x6a84,
            ],
            [5, 0xec01, 0x217e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0x0201, 0x0403, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        ];
        codelets.push([0; pyac_vliw_core::CODELET_WORDS]);
        let error = prepare_storage_sections(&codelets).expect_err("trailing codelet is invalid");
        assert_eq!(error.codelet_index, 4);
        assert_eq!(error.reason, "codelets follow the final storage payload");
    }
}
