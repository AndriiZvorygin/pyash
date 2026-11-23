#[path = "../gpu.rs"]
mod gpu_worker;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::Semaphore;
use tokio::time::timeout;

const MAX_PACK_BYTES: usize = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 23 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 1800;

enum RuntimeBackend {
    Vulkan(gpu_worker::GpuRuntime),
    #[cfg(feature = "cuda")]
    Cuda(gpu_worker::cuda::CudaRuntime),
}

impl RuntimeBackend {
    fn name(&self) -> &'static str {
        match self {
            Self::Vulkan(_) => "rust-gpu-vulkan",
            #[cfg(feature = "cuda")]
            Self::Cuda(_) => gpu_worker::cuda::BACKEND,
        }
    }

    fn device_name(&self) -> &str {
        match self {
            Self::Vulkan(gpu) => gpu.device_name(),
            #[cfg(feature = "cuda")]
            Self::Cuda(gpu) => gpu.device_name(),
        }
    }

    fn execute(&self, pack: Vec<u8>) -> (Result<Value, String>, gpu_worker::GpuExecutionTiming) {
        match self {
            Self::Vulkan(gpu) => pollster::block_on(gpu.execute_pack_with_timings(&pack)),
            #[cfg(feature = "cuda")]
            Self::Cuda(gpu) => gpu.execute(pack),
        }
    }
}

#[derive(Clone)]
struct RuntimeState {
    gpu: Arc<RuntimeBackend>,
    worker_timeout: Duration,
    workers: Arc<Semaphore>,
    gpu_execution: Arc<std::sync::Mutex<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteRequest {
    protocol_version: u32,
    job_id: String,
    job_spec: JobSpec,
}

#[derive(Debug, Deserialize)]
struct JobSpec {
    kind: String,
    payload: Payload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    pack_base64: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
    timings_ms: Option<Value>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.message });
        if let Some(timings) = self.timings_ms {
            body["runtimeTimingMs"] = timings;
        }
        (self.status, Json(body)).into_response()
    }
}

fn decode_request(request: ExecuteRequest) -> Result<(String, Vec<u8>), ApiError> {
    if request.protocol_version != 1 {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "protocolVersion must be 1".to_owned(),
            timings_ms: None,
        });
    }
    if request.job_id.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "jobId is required".to_owned(),
            timings_ms: None,
        });
    }
    if request.job_spec.kind != "pyac-pack-execute" {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "jobSpec.kind must be pyac-pack-execute".to_owned(),
            timings_ms: None,
        });
    }
    let pack = STANDARD
        .decode(request.job_spec.payload.pack_base64.as_bytes())
        .map_err(|error| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("packBase64 is invalid: {error}"),
            timings_ms: None,
        })?;
    if pack.len() > MAX_PACK_BYTES {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "PyAC pack exceeds the 16 MiB runtime limit".to_owned(),
            timings_ms: None,
        });
    }
    pyac::decode_pack(&pack).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("PyAC pack is invalid: {error}"),
        timings_ms: None,
    })?;
    Ok((request.job_id, pack))
}

async fn health(State(state): State<RuntimeState>) -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "ready": true,
            "protocolVersion": 1,
            "workerReady": true,
            "shaderReady": true,
            "gpuReady": true,
            "backend": state.gpu.name(),
            "device": state.gpu.device_name(),
            "availableWorkers": state.workers.available_permits(),
            "executionMode": "resident"
        })),
    )
}

async fn execute(
    State(state): State<RuntimeState>,
    Json(request): Json<ExecuteRequest>,
) -> Result<Json<Value>, ApiError> {
    let request_decode_started = Instant::now();
    let (job_id, pack) = decode_request(request)?;
    let request_decode_ms = request_decode_started.elapsed().as_secs_f64() * 1000.0;
    let worker_slot_started = Instant::now();
    let _permit = state.workers.acquire().await.map_err(|_| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "VLIW runtime is shutting down".to_owned(),
        timings_ms: None,
    })?;
    let worker_slot_wait_ms = worker_slot_started.elapsed().as_secs_f64() * 1000.0;

    // WGPU error-scope guards are not Send. Keep the GPU future on one blocking
    // thread, and serialize device-global error scopes while Housekeeper queues work.
    let gpu = Arc::clone(&state.gpu);
    let gpu_execution = Arc::clone(&state.gpu_execution);
    let execution = tokio::task::spawn_blocking(move || {
        let lock_started = Instant::now();
        let _gpu_execution = gpu_execution
            .lock()
            .map_err(|_| "VLIW GPU execution lock was poisoned".to_owned())?;
        let gpu_lock_wait_ms = lock_started.elapsed().as_secs_f64() * 1000.0;
        let (result, timings) = gpu.execute(pack);
        Ok::<_, String>((result, timings, gpu_lock_wait_ms))
    });
    let execution_result = timeout(state.worker_timeout, execution)
        .await
        .map_err(|_| ApiError {
            status: StatusCode::GATEWAY_TIMEOUT,
            message: format!("VLIW GPU job {job_id} exceeded its runtime limit"),
            timings_ms: None,
        })?
        .map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("VLIW GPU execution task failed: {error}"),
            timings_ms: None,
        })?
        .map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error,
            timings_ms: None,
        })?;
    let (result, timings, gpu_lock_wait_ms) = execution_result;
    let mut timings_ms = timings.to_json();
    if let Some(values) = timings_ms.as_object_mut() {
        values.insert("requestDecodeMs".to_owned(), json!(request_decode_ms));
        values.insert("workerSlotWaitMs".to_owned(), json!(worker_slot_wait_ms));
        values.insert("gpuLockWaitMs".to_owned(), json!(gpu_lock_wait_ms));
        values.insert(
            "serviceTotalMs".to_owned(),
            json!(request_decode_started.elapsed().as_secs_f64() * 1000.0),
        );
    }
    match result {
        Ok(mut response) => {
            response["runtimeTimingMs"] = timings_ms;
            Ok(Json(response))
        }
        Err(message) => Err(ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message,
            timings_ms: Some(timings_ms),
        }),
    }
}

fn env_u16(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let runtime_started = Instant::now();
    let host = std::env::var("PYAC_VLIW_RUNTIME_HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
    let port = env_u16("PYAC_VLIW_RUNTIME_PORT", 18887);
    let workers = env_u16("PYAC_VLIW_RUNTIME_CONCURRENCY", 1) as usize;
    let shader_path = std::env::var_os("PYAC_VLIW_SPIRV_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/service/pyac_vliw_gpu_kernel.spv"));
    let cache_path = std::env::var_os("PYAC_VLIW_PIPELINE_CACHE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/service/pyac_vliw_pipeline_cache.bin"));
    let backend = std::env::var("PYAC_VLIW_BACKEND").unwrap_or_else(|_| "vulkan".to_owned());
    let gpu = Arc::new(match backend.as_str() {
        "vulkan" => {
            eprintln!(
                "[pyac-vliw] loading shader {} and compiled GPU artifact {}",
                shader_path.display(),
                cache_path.display()
            );
            RuntimeBackend::Vulkan(
                gpu_worker::GpuRuntime::new(&shader_path, &cache_path)
                    .await
                    .map_err(std::io::Error::other)?,
            )
        }
        #[cfg(feature = "cuda")]
        "cuda" => {
            let cubin = std::env::var_os("PYAC_VLIW_CUBIN_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/service/pyac_vliw_gpu_kernel.cubin"));
            eprintln!(
                "[pyac-vliw] loading compiled CUDA artifact {}",
                cubin.display()
            );
            RuntimeBackend::Cuda(
                gpu_worker::cuda::CudaRuntime::new(cubin).map_err(std::io::Error::other)?,
            )
        }
        #[cfg(not(feature = "cuda"))]
        "cuda" => return Err("this VLIW runtime was built without CUDA support".into()),
        _ => return Err(format!("unsupported VLIW backend: {backend}").into()),
    });
    eprintln!(
        "[pyac-vliw] runtime initialized on {} in {:.2}s",
        gpu.device_name(),
        runtime_started.elapsed().as_secs_f64()
    );
    let state = RuntimeState {
        gpu,
        worker_timeout: Duration::from_secs(env_u64(
            "PYAC_VLIW_RUNTIME_TIMEOUT_SEC",
            DEFAULT_TIMEOUT_SECONDS,
        )),
        workers: Arc::new(Semaphore::new(workers)),
        gpu_execution: Arc::new(std::sync::Mutex::new(())),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/execute", post(execute))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state);
    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    eprintln!("[pyac-vliw] listening on {address}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn valid_pack() -> Vec<u8> {
        let mut pack = b"PYACVLIW".to_vec();
        pack.extend_from_slice(&1u16.to_le_bytes());
        pack.extend_from_slice(&16u16.to_le_bytes());
        pack.extend_from_slice(&16u16.to_le_bytes());
        pack.extend_from_slice(&32u16.to_le_bytes());
        pack.extend_from_slice(&1u32.to_le_bytes());
        pack.extend_from_slice(&32u32.to_le_bytes());
        pack.extend_from_slice(&64u32.to_le_bytes());
        pack.extend_from_slice(&0u32.to_le_bytes());
        pack.extend_from_slice(&[0; 32]);
        pack
    }

    fn request(pack: &[u8]) -> ExecuteRequest {
        ExecuteRequest {
            protocol_version: 1,
            job_id: "test-job".to_owned(),
            job_spec: JobSpec {
                kind: "pyac-pack-execute".to_owned(),
                payload: Payload {
                    pack_base64: STANDARD.encode(pack),
                },
            },
        }
    }

    #[test]
    fn runtime_contract_accepts_a_valid_pyac_pack() {
        let (job_id, decoded) = decode_request(request(&valid_pack())).unwrap();
        assert_eq!(job_id, "test-job");
        assert_eq!(decoded, valid_pack());
    }

    #[test]
    fn runtime_contract_rejects_unsupported_versions_and_job_kinds() {
        let mut bad_version = request(&valid_pack());
        bad_version.protocol_version = 2;
        assert_eq!(
            decode_request(bad_version).unwrap_err().status,
            StatusCode::BAD_REQUEST
        );

        let mut bad_kind = request(&valid_pack());
        bad_kind.job_spec.kind = "arbitrary-kernel".to_owned();
        assert_eq!(
            decode_request(bad_kind).unwrap_err().status,
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn runtime_contract_rejects_invalid_pyac_pack_headers() {
        let error = decode_request(request(b"not a pack")).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert!(error.message.contains("invalid"));
    }
}
