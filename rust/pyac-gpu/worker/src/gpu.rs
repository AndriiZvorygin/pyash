use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use pyac::{PyacValue, decode_pack};
use serde_json::{Value, json};

#[path = "gpu/result.rs"]
mod result;
use result::{RESULT_STRIDE, decode_results, value_json};
#[path = "gpu/result_decode.rs"]
mod result_decode;
use result_decode::{decode_programlet_result, decode_section_records};
#[path = "gpu/pipeline.rs"]
mod pipeline;
use pipeline::{create_pipeline, read_pipeline_cache, write_pipeline_cache};
#[path = "gpu/timing.rs"]
mod timing;
pub(crate) use timing::GpuExecutionTiming;
#[path = "gpu/programlet_dispatch.rs"]
mod programlet_dispatch;
use programlet_dispatch::prepare_dispatch_words;
#[path = "gpu/pack_io.rs"]
mod pack_io;
use pack_io::{PreparedPack, decode_pack_result, prepare_pack};
#[cfg(feature = "cuda")]
#[path = "gpu/cuda.rs"]
pub(crate) mod cuda;
#[path = "gpu/execution.rs"]
mod execution;
#[path = "gpu/runtime.rs"]
mod runtime;

const MAX_SECTION_NAME_WORDS: usize = pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS;
const SECTION_DESCRIPTOR_STRIDE: usize = 3 + MAX_SECTION_NAME_WORDS;
const SECTION_RESULT_STRIDE: usize = 4 + MAX_SECTION_NAME_WORDS + RESULT_STRIDE;

pub(crate) struct GpuRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter_name: String,
    timestamp_period_ns: Option<f32>,
    bind_group_layout: wgpu::BindGroupLayout,
    pipeline_cache: wgpu::PipelineCache,
    pack_pipeline: wgpu::ComputePipeline,
    programlet_pipeline: wgpu::ComputePipeline,
    sections_pipeline: wgpu::ComputePipeline,
}

#[path = "gpu/dispatch_execution.rs"]
mod dispatch_execution;
#[cfg(test)]
#[path = "gpu/tests.rs"]
mod tests;
