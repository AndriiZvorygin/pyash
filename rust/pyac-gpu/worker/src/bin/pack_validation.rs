use axum::http::StatusCode;

use super::ApiError;

pub(super) const MAX_PACK_BYTES: usize = u32::MAX as usize;

pub(super) fn validate_pack(job_id: String, pack: Vec<u8>) -> Result<(String, Vec<u8>), ApiError> {
    if job_id.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "jobId is required".to_owned(),
            timings_ms: None,
        });
    }
    if pack.len() > MAX_PACK_BYTES {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "PyAC pack exceeds the VLIW protocol's 32-bit byte-length limit".to_owned(),
            timings_ms: None,
        });
    }
    let decoded = pyac::decode_pack(&pack).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("PyAC pack is invalid: {error}"),
        timings_ms: None,
    })?;
    let mut storage_sections = [pyac_vliw_core::StorageSectionRange::default(); 64];
    pyac_vliw_core::scan_storage_sections(
        decoded.codelets.as_flattened(),
        decoded.codelets.len(),
        &mut storage_sections,
    )
    .map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("PyAC storage section is malformed (core error {error})"),
        timings_ms: None,
    })?;
    Ok((job_id, pack))
}
