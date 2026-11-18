use std::net::SocketAddr;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::time::timeout;

const MAX_PACK_BYTES: usize = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 23 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS: u64 = 1800;

#[derive(Clone)]
struct RuntimeState {
    worker_path: Arc<String>,
    shader_path: Arc<String>,
    worker_timeout: Duration,
    workers: Arc<Semaphore>,
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
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

fn decode_request(request: ExecuteRequest) -> Result<(String, Vec<u8>), ApiError> {
    if request.protocol_version != 1 {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "protocolVersion must be 1".to_owned(),
        });
    }
    if request.job_id.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "jobId is required".to_owned(),
        });
    }
    if request.job_spec.kind != "pyac-pack-execute" {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "jobSpec.kind must be pyac-pack-execute".to_owned(),
        });
    }
    let pack = STANDARD
        .decode(request.job_spec.payload.pack_base64.as_bytes())
        .map_err(|error| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("packBase64 is invalid: {error}"),
        })?;
    if pack.len() > MAX_PACK_BYTES {
        return Err(ApiError {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            message: "PyAC pack exceeds the 16 MiB runtime limit".to_owned(),
        });
    }
    pyac::decode_pack(&pack).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("PyAC pack is invalid: {error}"),
    })?;
    Ok((request.job_id, pack))
}

async fn health(State(state): State<RuntimeState>) -> impl IntoResponse {
    let worker_ready = std::path::Path::new(state.worker_path.as_str()).is_file();
    let shader_ready = std::path::Path::new(state.shader_path.as_str()).is_file();
    let ready = worker_ready && shader_ready;
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({
            "status": if ready { "ok" } else { "starting" },
            "ready": ready,
            "protocolVersion": 1,
            "workerReady": worker_ready,
            "shaderReady": shader_ready,
            "availableWorkers": state.workers.available_permits()
        })),
    )
}

async fn execute(
    State(state): State<RuntimeState>,
    Json(request): Json<ExecuteRequest>,
) -> Result<Json<Value>, ApiError> {
    let (job_id, pack) = decode_request(request)?;
    let _permit = state.workers.acquire().await.map_err(|_| ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "VLIW runtime is shutting down".to_owned(),
    })?;

    let mut child = Command::new(state.worker_path.as_str())
        .env("PYAC_VLIW_SPIRV_PATH", state.shader_path.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| ApiError {
            status: StatusCode::SERVICE_UNAVAILABLE,
            message: format!("could not start the Rust VLIW GPU worker: {error}"),
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&pack).await.map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("could not send PyAC pack to the GPU worker: {error}"),
        })?;
    }
    let output = timeout(state.worker_timeout, child.wait_with_output())
        .await
        .map_err(|_| ApiError {
            status: StatusCode::GATEWAY_TIMEOUT,
            message: format!("VLIW GPU job {job_id} exceeded its runtime limit"),
        })?
        .map_err(|error| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: format!("could not collect VLIW worker output: {error}"),
        })?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: if detail.is_empty() {
                format!("Rust VLIW GPU worker exited {}", output.status)
            } else {
                detail
            },
        });
    }
    let result: Value = serde_json::from_slice(&output.stdout).map_err(|error| ApiError {
        status: StatusCode::BAD_GATEWAY,
        message: format!("Rust VLIW GPU worker returned invalid JSON: {error}"),
    })?;
    if result.get("ok") != Some(&Value::Bool(true))
        || !result.get("values").is_some_and(Value::is_array)
    {
        return Err(ApiError {
            status: StatusCode::BAD_GATEWAY,
            message: "Rust VLIW GPU worker returned an invalid result".to_owned(),
        });
    }
    Ok(Json(result))
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
    let host = std::env::var("PYAC_VLIW_RUNTIME_HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
    let port = env_u16("PYAC_VLIW_RUNTIME_PORT", 18887);
    let workers = env_u16("PYAC_VLIW_RUNTIME_CONCURRENCY", 1) as usize;
    let state = RuntimeState {
        worker_path: Arc::new(
            std::env::var("PYAC_VLIW_WORKER_PATH")
                .unwrap_or_else(|_| "/service/pyac-vliw-gpu-worker".to_owned()),
        ),
        shader_path: Arc::new(
            std::env::var("PYAC_VLIW_SPIRV_PATH")
                .unwrap_or_else(|_| "/service/pyac_vliw_gpu_kernel.spv".to_owned()),
        ),
        worker_timeout: Duration::from_secs(env_u64(
            "PYAC_VLIW_RUNTIME_TIMEOUT_SEC",
            DEFAULT_TIMEOUT_SECONDS,
        )),
        workers: Arc::new(Semaphore::new(workers)),
    };
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/execute", post(execute))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state);
    let address: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
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
