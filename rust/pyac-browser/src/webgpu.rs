use std::{cell::RefCell, rc::Rc};

use futures_channel::oneshot;
use pyac::{
    NumericOperator, NumericVectorOperand, PyacValue, VectorElements, decode_numeric_arithmetic,
    decode_numeric_vector_arithmetic, decode_pack,
};
use serde_json::json;
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

use crate::value_to_json;

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
    enum OutputShape {
        Scalar,
        Vector16(usize),
        Vector32(usize),
    }
    let mut input_words = Vec::new();
    let mut output_shapes = Vec::with_capacity(pack.codelets.len());
    for (index, codelet) in pack.codelets.iter().enumerate() {
        if let Ok(instruction) = decode_numeric_vector_arithmetic(codelet) {
            if matches!(
                instruction.operator,
                NumericOperator::Divide | NumericOperator::Remains
            ) && match &instruction.operand {
                NumericVectorOperand::Scalar(value) => *value == 0,
                NumericVectorOperand::Vector(values) => values.contains(&0),
            }
            {
                return Err(js_error(format!(
                    "codelet {index}: numeric division cannot divide by zero"
                )));
            }
            for (index, element) in instruction.elements.iter().enumerate() {
                input_words.push(operator_id(instruction.operator));
                input_words.push(u32::from(*element));
                let operand = match &instruction.operand {
                    NumericVectorOperand::Scalar(value) => *value,
                    NumericVectorOperand::Vector(values) => values[index],
                };
                input_words.push(u32::from(operand));
            }
            output_shapes.push(if instruction.operator == NumericOperator::Multiply {
                OutputShape::Vector32(instruction.elements.len())
            } else {
                OutputShape::Vector16(instruction.elements.len())
            });
        } else {
            let instruction = decode_numeric_arithmetic(codelet)
                .map_err(|error| js_error(format!("codelet {index}: {error}")))?;
            if matches!(
                instruction.operator,
                NumericOperator::Divide | NumericOperator::Remains
            ) && instruction.operand == 0
            {
                return Err(js_error(format!(
                    "codelet {index}: numeric division cannot divide by zero"
                )));
            }
            input_words.push(operator_id(instruction.operator));
            input_words.push(u32::from(instruction.ob));
            input_words.push(u32::from(instruction.operand));
            output_shapes.push(OutputShape::Scalar);
        }
    }
    let work_item_count = input_words.len() / 3;
    let input_byte_len = input_words
        .len()
        .checked_mul(4)
        .ok_or_else(|| js_error("numeric pack input size overflowed"))?;
    let output_bytes = work_item_count
        .checked_mul(4)
        .ok_or_else(|| js_error("numeric pack output size overflowed"))?;
    let limits = context.device.limits();
    let max_storage_bytes = limits.max_storage_buffer_binding_size as usize;
    if input_byte_len > max_storage_bytes || output_bytes > max_storage_bytes {
        return Err(js_error(
            "numeric pack exceeds this browser GPU's storage-buffer limit",
        ));
    }
    let workgroups = work_item_count.div_ceil(64);
    if workgroups > limits.max_compute_workgroups_per_dimension as usize {
        return Err(js_error(
            "numeric pack exceeds the browser GPU dispatch limit",
        ));
    }

    let mut input_bytes = Vec::with_capacity(input_words.len() * 4);
    for word in input_words {
        input_bytes.extend_from_slice(&word.to_le_bytes());
    }

    let execution_errors = context
        .device
        .push_error_scope(wgpu::ErrorFilter::Validation);
    let input_buffer = context
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("PyAC numeric input"),
            contents: &input_bytes,
            usage: wgpu::BufferUsages::STORAGE,
        });
    let output_buffer = context.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("PyAC numeric output"),
        size: output_bytes as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback_buffer = context.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("PyAC numeric readback"),
        size: output_bytes as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind_group = context
        .device
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("PyAC numeric bindings"),
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
            label: Some("PyAC numeric batch"),
        });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("PyAC numeric batch"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&context.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(workgroups as u32, 1, 1);
    }
    encoder.copy_buffer_to_buffer(&output_buffer, 0, &readback_buffer, 0, output_bytes as u64);
    context.queue.submit([encoder.finish()]);
    if let Some(error) = execution_errors.pop().await {
        return Err(js_error(format!(
            "WebGPU dispatch validation failed: {error}"
        )));
    }

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
        .map_err(|error| js_error(format!("GPU readback mapping failed: {error}")))?;
    let work_values = mapped
        .chunks_exact(4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        .collect::<Vec<_>>();
    drop(mapped);
    readback_buffer.unmap();
    let mut cursor = 0;
    let output_values = output_shapes
        .into_iter()
        .map(|shape| match shape {
            OutputShape::Scalar => {
                let value = work_values[cursor];
                cursor += 1;
                PyacValue::Unsigned(u64::from(value))
            }
            OutputShape::Vector16(length) => {
                let values = work_values[cursor..cursor + length]
                    .iter()
                    .map(|value| *value as u16)
                    .collect();
                cursor += length;
                PyacValue::Vector(VectorElements::Numbers(values))
            }
            OutputShape::Vector32(length) => {
                let values = work_values[cursor..cursor + length].to_vec();
                cursor += length;
                PyacValue::Vector(VectorElements::Numbers32(values))
            }
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "ok": true,
        "backend": "webgpu",
        "device": context.adapter_name,
        "values": output_values.iter().map(value_to_json).collect::<Vec<_>>(),
    })
    .to_string())
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
        label: Some("PyAC numeric batch WGSL"),
        source: wgpu::ShaderSource::Wgsl(include_str!("numeric_batch.wgsl").into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("PyAC numeric batch pipeline"),
        layout: None,
        module: &shader,
        entry_point: Some("main"),
        compilation_options: Default::default(),
        cache: None,
    });
    if let Some(error) = pipeline_errors.pop().await {
        return Err(js_error(format!(
            "WebGPU pipeline validation failed: {error}"
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

fn operator_id(operator: NumericOperator) -> u32 {
    match operator {
        NumericOperator::Plus => 0,
        NumericOperator::Subtract => 1,
        NumericOperator::Multiply => 2,
        NumericOperator::Divide => 3,
        NumericOperator::Xor => 4,
        NumericOperator::Exponential => 5,
        NumericOperator::Remains => 6,
    }
}

fn js_error(message: impl AsRef<str>) -> JsValue {
    JsValue::from_str(message.as_ref())
}
