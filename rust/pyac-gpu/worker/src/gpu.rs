use std::borrow::Cow;
use std::path::Path;

use pyac::{PyacValue, VectorElements, decode_pack};
use serde_json::{Value, json};

const RESULT_WORDS: usize = 32;
const RESULT_STRIDE: usize = 4 + RESULT_WORDS;

pub(crate) struct GpuRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter_name: String,
    bind_group_layout: wgpu::BindGroupLayout,
    pack_pipeline: wgpu::ComputePipeline,
    programlet_pipeline: wgpu::ComputePipeline,
}

impl GpuRuntime {
    pub(crate) async fn new(shader_path: &Path) -> Result<Self, String> {
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

        let required_features = wgpu::Features::PASSTHROUGH_SHADERS;
        if !adapter.features().contains(required_features) {
            return Err("Vulkan adapter lacks SPIR-V passthrough support".to_owned());
        }
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_features,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("Vulkan device unavailable: {error}"))?;

        let shader_bytes = std::fs::read(shader_path)
            .map_err(|error| format!("could not read {}: {error}", shader_path.display()))?;
        let shader_words = bytemuck::try_cast_slice::<u8, u32>(&shader_bytes)
            .map_err(|error| format!("SPIR-V file is not aligned u32 data: {error}"))?;
        let shader_internal_scope = device.push_error_scope(wgpu::ErrorFilter::Internal);
        let shader_oom_scope = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let shader_validation_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        // SAFETY: the image build generates this module from our shader crate and validates it
        // for Vulkan 1.2; the entry points and workgroup sizes are fixed by that crate.
        let shader = unsafe {
            device.create_shader_module_passthrough(wgpu::ShaderModuleDescriptorPassthrough {
                label: Some("Pyash shared VLIW interpreter SPIR-V"),
                entry_points: Cow::Owned(vec![
                    wgpu::PassthroughShaderEntryPoint {
                        name: Cow::Borrowed("execute_pyac_pack"),
                        workgroup_size: (64, 1, 1),
                    },
                    wgpu::PassthroughShaderEntryPoint {
                        name: Cow::Borrowed("execute_pyac_programlet"),
                        workgroup_size: (64, 1, 1),
                    },
                ]),
                spirv: Some(Cow::Owned(shader_words.to_vec())),
                ..Default::default()
            })
        };
        let shader_validation_error = shader_validation_scope.pop().await;
        let shader_oom_error = shader_oom_scope.pop().await;
        let shader_internal_error = shader_internal_scope.pop().await;
        if let Some(error) = shader_validation_error
            .or(shader_oom_error)
            .or(shader_internal_error)
        {
            return Err(format!(
                "Vulkan VLIW shader module creation failed: {error}"
            ));
        }

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Pyash VLIW storage bindings"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Pyash VLIW pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pack_pipeline = create_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            "execute_pyac_pack",
            "Pyash VLIW pack interpreter",
        )
        .await?;
        let programlet_pipeline = create_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            "execute_pyac_programlet",
            "Pyash VLIW programlet interpreter",
        )
        .await?;

        Ok(Self {
            device,
            queue,
            adapter_name: adapter_info.name,
            bind_group_layout,
            pack_pipeline,
            programlet_pipeline,
        })
    }

    #[allow(dead_code)]
    pub(crate) fn device_name(&self) -> &str {
        &self.adapter_name
    }

    pub(crate) async fn execute_pack(&self, pack_bytes: &[u8]) -> Result<Value, String> {
        let pack = decode_pack(pack_bytes).map_err(|error| error.to_string())?;
        self.execute_codelets(&pack.codelets).await
    }

    async fn execute_codelets(
        &self,
        codelets: &[[u16; pyac::WORDS_PER_CODELET]],
    ) -> Result<Value, String> {
        if codelets.is_empty() {
            return Ok(json!({
                "ok": true,
                "backend": "rust-gpu-vulkan",
                "device": self.adapter_name,
                "values": []
            }));
        }

        let input_words = codelets
            .iter()
            .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
            .collect::<Vec<_>>();
        let programlet = pyac_vliw_core::is_numeric_programlet(&input_words, codelets.len());
        let result_records = if programlet { 1 } else { codelets.len() };
        let pipeline = if programlet {
            &self.programlet_pipeline
        } else {
            &self.pack_pipeline
        };

        let input_buffer_internal_scope = self.device.push_error_scope(wgpu::ErrorFilter::Internal);
        let input_buffer_oom_scope = self.device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let input_buffer_validation_scope =
            self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let input_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW codelets"),
            size: std::mem::size_of_val(input_words.as_slice()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let input_buffer_validation_error = input_buffer_validation_scope.pop().await;
        let input_buffer_oom_error = input_buffer_oom_scope.pop().await;
        let input_buffer_internal_error = input_buffer_internal_scope.pop().await;
        if let Some(error) = input_buffer_validation_error
            .or(input_buffer_oom_error)
            .or(input_buffer_internal_error)
        {
            return Err(format!("Vulkan VLIW input buffer creation failed: {error}"));
        }
        self.queue
            .write_buffer(&input_buffer, 0, bytemuck::cast_slice(&input_words));

        let output_words = result_records * RESULT_STRIDE;
        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW results"),
            size: (output_words * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW result readback"),
            size: (output_words * 4) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Pyash VLIW pack bindings"),
            layout: &self.bind_group_layout,
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
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Pyash VLIW pack dispatch"),
            });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Pyash shared interpreter"),
                timestamp_writes: None,
            });
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            let workgroups = if programlet {
                1
            } else {
                codelets.len().div_ceil(64) as u32
            };
            pass.dispatch_workgroups(workgroups, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&output_buffer, 0, &readback, 0, (output_words * 4) as u64);
        self.queue.submit([encoder.finish()]);

        let slice = readback.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        self.device
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
            "device": self.adapter_name,
            "values": values.iter().map(value_json).collect::<Vec<_>>(),
        }))
    }
}

async fn create_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    entry_point: &str,
    label: &str,
) -> Result<wgpu::ComputePipeline, String> {
    let internal_scope = device.push_error_scope(wgpu::ErrorFilter::Internal);
    let oom_scope = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
    let validation_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        module: shader,
        entry_point: Some(entry_point),
        compilation_options: Default::default(),
        cache: None,
    });
    let validation_error = validation_scope.pop().await;
    let oom_error = oom_scope.pop().await;
    let internal_error = internal_scope.pop().await;
    if let Some(error) = validation_error.or(oom_error).or(internal_error) {
        return Err(format!("Vulkan VLIW pipeline creation failed: {error}"));
    }
    Ok(pipeline)
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
