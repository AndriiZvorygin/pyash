use std::{cell::RefCell, rc::Rc};

use futures_channel::oneshot;
use pyac::{PyacValue, VectorElements, decode_pack};
use serde_json::json;
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

use crate::value_to_json;

const RESULT_WORDS: usize = 32;
const RESULT_STRIDE: usize = 4 + RESULT_WORDS;

thread_local! {
    static GPU_CONTEXT: RefCell<Option<Rc<GpuContext>>> = const { RefCell::new(None) };
}

struct GpuContext {
    _instance: wgpu::Instance,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    adapter_name: String,
}

#[wasm_bindgen]
pub async fn run_pack_webgpu(pack_bytes: &[u8]) -> Result<String, JsValue> {
    let pack = decode_pack(pack_bytes).map_err(|error| js_error(error.to_string()))?;
    if pack.codelets.is_empty() {
        return Ok(json!({ "ok": true, "backend": "webgpu", "values": [] }).to_string());
    }

    let context = gpu_context().await?;
    let input_words = pack
        .codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    let input_bytes_len = input_words
        .len()
        .checked_mul(4)
        .ok_or_else(|| js_error("VLIW input buffer size overflowed"))?;
    let output_words_len = pack
        .codelets
        .len()
        .checked_mul(RESULT_STRIDE)
        .ok_or_else(|| js_error("VLIW output buffer size overflowed"))?;
    let output_bytes_len = output_words_len
        .checked_mul(4)
        .ok_or_else(|| js_error("VLIW output buffer size overflowed"))?;
    let limits = context.device.limits();
    let max_storage_bytes = limits.max_storage_buffer_binding_size as usize;
    if input_bytes_len > max_storage_bytes || output_bytes_len > max_storage_bytes {
        return Err(js_error(
            "VLIW pack exceeds this browser GPU's storage-buffer limit",
        ));
    }
    let workgroups = pack.codelets.len().div_ceil(64);
    if workgroups > limits.max_compute_workgroups_per_dimension as usize {
        return Err(js_error("VLIW pack exceeds the browser GPU dispatch limit"));
    }

    let input_bytes = input_words
        .iter()
        .flat_map(|word| word.to_le_bytes())
        .collect::<Vec<_>>();
    let input_buffer = context
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Pyash VLIW codelets"),
            contents: &input_bytes,
            usage: wgpu::BufferUsages::STORAGE,
        });
    let output_buffer = context.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW results"),
        size: output_bytes_len as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback_buffer = context.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW result readback"),
        size: output_bytes_len as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind_group = context
        .device
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Pyash VLIW bindings"),
            layout: &context.pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: input_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: output_buffer.as_entire_binding(),
                },
            ],
        });
    let mut encoder = context
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Pyash VLIW pack execution"),
        });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Pyash shared VLIW interpreter"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&context.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(workgroups as u32, 1, 1);
    }
    encoder.copy_buffer_to_buffer(
        &output_buffer,
        0,
        &readback_buffer,
        0,
        output_bytes_len as u64,
    );
    context.queue.submit([encoder.finish()]);

    let output_slice = readback_buffer.slice(..);
    let (sender, receiver) = oneshot::channel();
    output_slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    receiver
        .await
        .map_err(|_| js_error("GPU readback callback was cancelled"))?
        .map_err(|error| js_error(format!("GPU readback failed: {error}")))?;
    let mapped = output_slice
        .get_mapped_range()
        .map_err(|error| js_error(format!("GPU result map failed: {error}")))?;
    let output_words = mapped
        .chunks_exact(4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect::<Vec<_>>();
    drop(mapped);
    readback_buffer.unmap();

    let values = decode_results(&pack.codelets, &output_words)?;
    Ok(json!({
        "ok": true,
        "backend": "webgpu",
        "device": context.adapter_name,
        "values": values.iter().map(value_to_json).collect::<Vec<_>>(),
    })
    .to_string())
}

fn decode_results(
    codelets: &[[u16; pyac::WORDS_PER_CODELET]],
    output: &[u32],
) -> Result<Vec<PyacValue>, JsValue> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < codelets.len() {
        if index > 0 && codelets[index - 1][0] & 1 == 0 {
            index += 1;
            continue;
        }
        let offset = index * RESULT_STRIDE;
        let result = output
            .get(offset..offset + RESULT_STRIDE)
            .ok_or_else(|| js_error(format!("codelet {index}: GPU result is truncated")))?;
        if result[1] != 0 {
            return Err(js_error(format!(
                "codelet {index}: shared VLIW core error {}",
                result[1]
            )));
        }
        let length = result[2] as usize;
        let data = &result[4..];
        let value = match result[0] {
            pyac_vliw_core::VALUE_UNSIGNED => {
                PyacValue::Unsigned(u64::from(data[0]) | (u64::from(data[1]) << 32))
            }
            pyac_vliw_core::VALUE_SIGNED => {
                PyacValue::Signed((u64::from(data[0]) | (u64::from(data[1]) << 32)) as i64)
            }
            pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(data[0] != 0),
            pyac_vliw_core::VALUE_DATE => {
                PyacValue::DateEpochMs(u64::from(data[0]) | (u64::from(data[1]) << 32))
            }
            pyac_vliw_core::VALUE_VECTOR_U16 if length <= RESULT_WORDS => PyacValue::Vector(
                VectorElements::Numbers(data[..length].iter().map(|value| *value as u16).collect()),
            ),
            pyac_vliw_core::VALUE_VECTOR_U32 if length <= RESULT_WORDS => {
                PyacValue::Vector(VectorElements::Numbers32(data[..length].to_vec()))
            }
            pyac_vliw_core::VALUE_VECTOR_BOOL if length <= RESULT_WORDS => PyacValue::Vector(
                VectorElements::Booleans(data[..length].iter().map(|value| *value != 0).collect()),
            ),
            kind => {
                return Err(js_error(format!(
                    "codelet {index}: invalid shared VLIW result kind/length ({kind}/{length})"
                )));
            }
        };
        values.push(value);
        let consumed = result[3] as usize;
        if consumed == 0 || index + consumed > codelets.len() {
            return Err(js_error(format!(
                "codelet {index}: shared VLIW core returned an invalid group length"
            )));
        }
        index += consumed;
    }
    Ok(values)
}

async fn gpu_context() -> Result<Rc<GpuContext>, JsValue> {
    if let Some(context) = GPU_CONTEXT.with(|stored| stored.borrow().clone()) {
        return Ok(context);
    }

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            ..Default::default()
        })
        .await
        .map_err(|error| js_error(format!("WebGPU adapter unavailable: {error}")))?;
    let adapter_name = match adapter.get_info().name.as_str() {
        "" => "WebGPU adapter (name withheld by browser)".to_owned(),
        name => name.to_owned(),
    };
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
        .map_err(|error| js_error(format!("WebGPU device unavailable: {error}")))?;
    let pipeline_errors = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Pyash generated shared VLIW WGSL"),
        source: wgpu::ShaderSource::Wgsl(include_str!("vliw_kernel.wgsl").into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Pyash VLIW interpreter pipeline"),
        layout: None,
        module: &shader,
        entry_point: Some("execute_pyac_pack"),
        compilation_options: Default::default(),
        cache: None,
    });
    if let Some(error) = pipeline_errors.pop().await {
        return Err(js_error(format!(
            "WebGPU VLIW pipeline validation failed: {error}"
        )));
    }
    let context = Rc::new(GpuContext {
        _instance: instance,
        device,
        queue,
        pipeline,
        adapter_name,
    });
    GPU_CONTEXT.with(|stored| *stored.borrow_mut() = Some(Rc::clone(&context)));
    Ok(context)
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    JsValue::from_str(message.as_ref())
}
