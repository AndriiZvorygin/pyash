use std::borrow::Cow;
use std::io::{Read, Write};
use std::path::PathBuf;

use pyac::{PyacValue, VectorElements, decode_pack};
use serde_json::{Value, json};
use wgpu::util::DeviceExt;

const RESULT_WORDS: usize = 32;
const RESULT_STRIDE: usize = 4 + RESULT_WORDS;
fn main() {
    if let Err(error) = run() {
        eprintln!("pyac-vliw-gpu-worker: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut input = Vec::new();
    std::io::stdin()
        .read_to_end(&mut input)
        .map_err(|error| format!("could not read VLIW input from stdin: {error}"))?;
    let pack = decode_pack(&input).map_err(|error| error.to_string())?;
    let response = pollster::block_on(run_pack(&pack.codelets))?;
    std::io::stdout()
        .write_all(response.to_string().as_bytes())
        .map_err(|error| format!("could not write JSON result: {error}"))?;
    Ok(())
}

async fn run_pack(codelets: &[[u16; pyac::WORDS_PER_CODELET]]) -> Result<Value, String> {
    if codelets.is_empty() {
        return Ok(json!({"ok": true, "backend": "rust-gpu-vulkan", "values": []}));
    }

    let input_words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    let programlet = pyac_vliw_core::is_numeric_programlet(&input_words, codelets.len());
    let result_records = if programlet { 1 } else { codelets.len() };
    let entry_point = if programlet {
        "execute_pyac_programlet"
    } else {
        "execute_pyac_pack"
    };

    let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    instance_descriptor.backends = wgpu::Backends::VULKAN;
    let instance = wgpu::Instance::new(instance_descriptor);
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            ..Default::default()
        })
        .await
        .map_err(|error| format!("Vulkan adapter unavailable: {error}"))?;
    let adapter_info = adapter.get_info();
    if adapter_info.device_type != wgpu::DeviceType::DiscreteGpu {
        return Err(format!(
            "refusing non-discrete adapter: {} ({:?})",
            adapter_info.name, adapter_info.device_type
        ));
    }

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await
        .map_err(|error| format!("Vulkan device unavailable: {error}"))?;

    let shader_path = std::env::var_os("PYAC_VLIW_SPIRV_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from("rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv")
        });
    let shader_bytes = std::fs::read(&shader_path)
        .map_err(|error| format!("could not read {}: {error}", shader_path.display()))?;
    let shader_words = bytemuck::try_cast_slice::<u8, u32>(&shader_bytes)
        .map_err(|error| format!("SPIR-V file is not aligned u32 data: {error}"))?;
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Pyash shared VLIW interpreter SPIR-V"),
        source: wgpu::ShaderSource::SpirV(Cow::Owned(shader_words.to_vec())),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Pyash VLIW pack interpreter"),
        layout: None,
        module: &shader,
        entry_point: Some(entry_point),
        compilation_options: Default::default(),
        cache: None,
    });

    let output_words = result_records * RESULT_STRIDE;
    let input_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Pyash VLIW codelets"),
        contents: bytemuck::cast_slice(&input_words),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW results"),
        size: (output_words * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW result readback"),
        size: (output_words * 4) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Pyash VLIW pack bindings"),
        layout: &pipeline.get_bind_group_layout(0),
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
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Pyash VLIW pack dispatch"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Pyash shared interpreter"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        let workgroups = if programlet {
            1
        } else {
            codelets.len().div_ceil(64) as u32
        };
        pass.dispatch_workgroups(workgroups, 1, 1);
    }
    encoder.copy_buffer_to_buffer(&output_buffer, 0, &readback, 0, (output_words * 4) as u64);
    queue.submit([encoder.finish()]);

    let slice = readback.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|error| format!("Vulkan device poll failed: {error}"))?;
    receiver
        .recv()
        .map_err(|error| format!("Vulkan readback callback failed: {error}"))?
        .map_err(|error| format!("Vulkan readback mapping failed: {error}"))?;
    let mapped = slice
        .get_mapped_range()
        .map_err(|error| format!("Vulkan result map failed: {error}"))?;
    let output = bytemuck::try_cast_slice::<u8, u32>(&mapped)
        .map_err(|error| format!("GPU result buffer was not u32 aligned: {error}"))?;
    let values = if programlet {
        decode_programlet_result(codelets.len(), output)?
    } else {
        decode_results(codelets, output)?
    };
    drop(mapped);
    readback.unmap();

    Ok(json!({
        "ok": true,
        "backend": "rust-gpu-vulkan",
        "device": adapter_info.name,
        "values": values.iter().map(value_json).collect::<Vec<_>>(),
    }))
}

fn decode_programlet_result(
    codelet_count: usize,
    output: &[u32],
) -> Result<Vec<PyacValue>, String> {
    if output.len() < RESULT_STRIDE {
        return Err("programlet: GPU result is truncated".to_owned());
    }
    if output[1] != 0 {
        return Err(format!(
            "programlet: shared VLIW runtime error {}",
            output[1]
        ));
    }
    if output[2] != 1 || output[3] as usize != codelet_count {
        return Err(format!(
            "programlet: invalid GPU result record (kind={}, length={}, consumed={}, expected={codelet_count})",
            output[0], output[2], output[3]
        ));
    }
    let value = match output[0] {
        pyac_vliw_core::VALUE_UNSIGNED => PyacValue::Unsigned(u64::from(output[4])),
        pyac_vliw_core::VALUE_SIGNED => PyacValue::Signed(i64::from(output[4] as i32)),
        pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(output[4] != 0),
        kind => return Err(format!("programlet: unsupported GPU result kind {kind}")),
    };
    Ok(vec![value])
}

fn decode_results(
    codelets: &[[u16; pyac::WORDS_PER_CODELET]],
    output: &[u32],
) -> Result<Vec<PyacValue>, String> {
    let mut values = Vec::new();
    let mut index = 0;
    while index < codelets.len() {
        if index > 0 && codelets[index - 1][0] & 1 == 0 {
            index += 1;
            continue;
        }
        let offset = index * RESULT_STRIDE;
        let result = &output[offset..offset + RESULT_STRIDE];
        if result[1] != 0 {
            return Err(format!(
                "codelet {index}: shared VLIW core error {}",
                result[1]
            ));
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
            pyac_vliw_core::VALUE_VECTOR_U16 => PyacValue::Vector(VectorElements::Numbers(
                data[..length].iter().map(|value| *value as u16).collect(),
            )),
            pyac_vliw_core::VALUE_VECTOR_U32 => {
                PyacValue::Vector(VectorElements::Numbers32(data[..length].to_vec()))
            }
            pyac_vliw_core::VALUE_VECTOR_BOOL => PyacValue::Vector(VectorElements::Booleans(
                data[..length].iter().map(|value| *value != 0).collect(),
            )),
            kind => {
                return Err(format!(
                    "codelet {index}: unsupported GPU result kind {kind}"
                ));
            }
        };
        values.push(value);
        let consumed = result[3] as usize;
        if consumed == 0 {
            return Err(format!(
                "codelet {index}: shared VLIW core returned no group length"
            ));
        }
        index += consumed;
    }
    Ok(values)
}

fn value_json(value: &PyacValue) -> Value {
    match value {
        PyacValue::Unsigned(value) => json!({"type": "unsigned", "value": value}),
        PyacValue::Signed(value) => json!({"type": "signed", "value": value}),
        PyacValue::Boolean(value) => json!({"type": "boolean", "value": value}),
        PyacValue::DateEpochMs(value) => json!({"type": "date-epoch-ms", "value": value}),
        PyacValue::Vector(VectorElements::Numbers(values)) => {
            json!({"type": "vector", "elementType": "unsigned-16", "values": values})
        }
        PyacValue::Vector(VectorElements::Numbers32(values)) => {
            json!({"type": "vector", "elementType": "unsigned-32", "values": values})
        }
        PyacValue::Vector(VectorElements::Booleans(values)) => {
            json!({"type": "vector", "elementType": "boolean", "values": values})
        }
        PyacValue::Vector(VectorElements::Texts(values)) => {
            json!({"type": "vector", "elementType": "text", "values": values})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result_record(kind: u32, value: u32) -> [u32; RESULT_STRIDE] {
        let mut output = [0; RESULT_STRIDE];
        output[0] = kind;
        output[2] = 1;
        output[3] = 6;
        output[4] = value;
        output
    }

    #[test]
    fn decodes_supported_typed_programlet_results() {
        assert_eq!(
            decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_UNSIGNED, 17))
                .unwrap(),
            vec![PyacValue::Unsigned(17)]
        );
        assert_eq!(
            decode_programlet_result(
                6,
                &result_record(pyac_vliw_core::VALUE_SIGNED, (-5i32) as u32)
            )
            .unwrap(),
            vec![PyacValue::Signed(-5)]
        );
        assert_eq!(
            decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_BOOLEAN, 1)).unwrap(),
            vec![PyacValue::Boolean(true)]
        );
    }

    #[test]
    fn rejects_invalid_programlet_result_metadata_and_types() {
        let mut output = result_record(pyac_vliw_core::VALUE_UNSIGNED, 17);
        output[2] = 2;
        assert!(decode_programlet_result(6, &output).is_err());

        let output = result_record(pyac_vliw_core::VALUE_DATE, 17);
        assert!(decode_programlet_result(6, &output).is_err());
    }
}
