use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use pyac::{PyacValue, VectorElements, decode_pack};
use serde_json::{Value, json};

const RESULT_WORDS: usize = 32;
const RESULT_STRIDE: usize = 4 + RESULT_WORDS;
const MAX_SECTION_NAME_WORDS: usize = pyac_vliw_core::MAX_PROGRAMLET_SECTION_NAME_WORDS;
const SECTION_DESCRIPTOR_STRIDE: usize = 3 + MAX_SECTION_NAME_WORDS;
const SECTION_RESULT_STRIDE: usize = 4 + MAX_SECTION_NAME_WORDS + RESULT_STRIDE;

#[derive(Debug)]
struct DecodedSectionResult {
    section_index: usize,
    name_words: Vec<u32>,
    completion_order: usize,
    value: PyacValue,
}

pub(crate) struct GpuRuntime {
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter_name: String,
    bind_group_layout: wgpu::BindGroupLayout,
    pipeline_cache: wgpu::PipelineCache,
    pack_pipeline: wgpu::ComputePipeline,
    programlet_pipeline: wgpu::ComputePipeline,
    sections_pipeline: wgpu::ComputePipeline,
}

impl GpuRuntime {
    pub(crate) async fn new(shader_path: &Path, cache_path: &Path) -> Result<Self, String> {
        let cache_data = read_pipeline_cache(cache_path)?;
        Self::initialize(shader_path, Some(&cache_data)).await
    }

    pub(crate) async fn compile_pipeline_cache(
        shader_path: &Path,
        cache_path: &Path,
    ) -> Result<(), String> {
        let runtime = Self::initialize(shader_path, None).await?;
        let cache_data = runtime
            .pipeline_cache
            .get_data()
            .ok_or_else(|| "Vulkan driver did not return pipeline executable data".to_owned())?;
        if cache_data.is_empty() {
            return Err("Vulkan driver returned an empty pipeline artifact".to_owned());
        }
        write_pipeline_cache(cache_path, &cache_data)?;
        eprintln!(
            "[pyac-vliw] wrote compiled GPU pipeline artifact: {} ({} bytes)",
            cache_path.display(),
            cache_data.len()
        );
        Ok(())
    }

    async fn initialize(shader_path: &Path, cache_data: Option<&[u8]>) -> Result<Self, String> {
        let init_started = Instant::now();
        let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        instance_descriptor.backends = wgpu::Backends::VULKAN;
        let instance = wgpu::Instance::new(instance_descriptor);
        eprintln!("[pyac-vliw] requesting Vulkan adapter");
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
        eprintln!(
            "[pyac-vliw] adapter ready in {:.2}s: {} ({:?})",
            init_started.elapsed().as_secs_f64(),
            adapter_info.name,
            adapter_info.device_type
        );
        if adapter_info.device_type != wgpu::DeviceType::DiscreteGpu {
            return Err(format!(
                "refusing non-discrete adapter: {} ({:?})",
                adapter_info.name, adapter_info.device_type
            ));
        }

        let required_features =
            wgpu::Features::PASSTHROUGH_SHADERS | wgpu::Features::PIPELINE_CACHE;
        if !adapter.features().contains(required_features) {
            return Err(
                "Vulkan adapter lacks SPIR-V passthrough or pipeline-cache support".to_owned(),
            );
        }
        let device_started = Instant::now();
        eprintln!("[pyac-vliw] requesting Vulkan device");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_features,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("Vulkan device unavailable: {error}"))?;
        eprintln!(
            "[pyac-vliw] device ready in {:.2}s",
            device_started.elapsed().as_secs_f64()
        );

        let cache_internal_scope = device.push_error_scope(wgpu::ErrorFilter::Internal);
        let cache_oom_scope = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let cache_validation_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        // The compile command passes no data to create a new artifact. The service
        // passes only bytes previously returned by PipelineCache::get_data.
        let pipeline_cache = unsafe {
            device.create_pipeline_cache(&wgpu::PipelineCacheDescriptor {
                label: Some("Pyash VLIW compiled pipeline artifact"),
                data: cache_data,
                fallback: false,
            })
        };
        let cache_validation_error = cache_validation_scope.pop().await;
        let cache_oom_error = cache_oom_scope.pop().await;
        let cache_internal_error = cache_internal_scope.pop().await;
        if let Some(error) = cache_validation_error
            .or(cache_oom_error)
            .or(cache_internal_error)
        {
            return Err(format!("Vulkan VLIW pipeline artifact rejected: {error}"));
        }

        let shader_bytes = std::fs::read(shader_path)
            .map_err(|error| format!("could not read {}: {error}", shader_path.display()))?;
        let shader_words = bytemuck::try_cast_slice::<u8, u32>(&shader_bytes)
            .map_err(|error| format!("SPIR-V file is not aligned u32 data: {error}"))?;
        let shader_internal_scope = device.push_error_scope(wgpu::ErrorFilter::Internal);
        let shader_oom_scope = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let shader_validation_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader_started = Instant::now();
        eprintln!(
            "[pyac-vliw] creating SPIR-V module ({} bytes)",
            shader_bytes.len()
        );
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
                    wgpu::PassthroughShaderEntryPoint {
                        name: Cow::Borrowed("execute_pyac_sections"),
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
        eprintln!(
            "[pyac-vliw] SPIR-V module ready in {:.2}s",
            shader_started.elapsed().as_secs_f64()
        );

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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
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
        let pipeline_started = Instant::now();
        eprintln!("[pyac-vliw] creating pack pipeline");
        let pack_pipeline = create_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            &pipeline_cache,
            "execute_pyac_pack",
            "Pyash VLIW pack interpreter",
        )
        .await?;
        eprintln!(
            "[pyac-vliw] pack pipeline ready in {:.2}s",
            pipeline_started.elapsed().as_secs_f64()
        );
        let pipeline_started = Instant::now();
        eprintln!("[pyac-vliw] creating programlet pipeline");
        let programlet_pipeline = create_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            &pipeline_cache,
            "execute_pyac_programlet",
            "Pyash VLIW programlet interpreter",
        )
        .await?;
        eprintln!(
            "[pyac-vliw] programlet pipeline ready in {:.2}s",
            pipeline_started.elapsed().as_secs_f64()
        );
        let pipeline_started = Instant::now();
        eprintln!("[pyac-vliw] creating sections pipeline");
        let sections_pipeline = create_pipeline(
            &device,
            &pipeline_layout,
            &shader,
            &pipeline_cache,
            "execute_pyac_sections",
            "Pyash independent section interpreter",
        )
        .await?;
        eprintln!(
            "[pyac-vliw] sections pipeline ready in {:.2}s; full initialization {:.2}s",
            pipeline_started.elapsed().as_secs_f64(),
            init_started.elapsed().as_secs_f64()
        );

        Ok(Self {
            device,
            queue,
            adapter_name: adapter_info.name,
            bind_group_layout,
            pipeline_cache,
            pack_pipeline,
            programlet_pipeline,
            sections_pipeline,
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
        let sectioned = pyac_vliw_core::has_programlet_section_header(&input_words, codelets.len());
        let mut section_descriptors =
            [pyac_vliw_core::ProgramletSection::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_SECTIONS];
        let section_count = if sectioned {
            pyac_vliw_core::scan_numeric_programlet_sections(
                &input_words,
                codelets.len(),
                &mut section_descriptors,
            )
            .map_err(|error| format!("malformed VLIW section packet (core error {error})"))?
        } else {
            0
        };
        let programlet =
            !sectioned && pyac_vliw_core::is_numeric_programlet(&input_words, codelets.len());
        let result_records = if sectioned {
            section_count * SECTION_RESULT_STRIDE
        } else if programlet {
            RESULT_STRIDE
        } else {
            codelets.len() * RESULT_STRIDE
        };
        let pipeline = if sectioned {
            &self.sections_pipeline
        } else if programlet {
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

        let mut section_words =
            Vec::with_capacity(section_count.max(1) * SECTION_DESCRIPTOR_STRIDE);
        for section in &section_descriptors[..section_count] {
            section_words.push(section.codelet_start);
            section_words.push(section.codelet_count);
            section_words.push(section.name_length);
            section_words.extend_from_slice(&section.name_words);
        }
        if section_words.is_empty() {
            section_words.push(0);
        }
        let section_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW section descriptors"),
            size: std::mem::size_of_val(section_words.as_slice()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue
            .write_buffer(&section_buffer, 0, bytemuck::cast_slice(&section_words));
        let completion_counter = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW section completion counter"),
            size: 4,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue
            .write_buffer(&completion_counter, 0, bytemuck::cast_slice(&[0u32]));

        let output_words = result_records;
        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW results"),
            size: (output_words * 4) as u64,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_SRC
                | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(
            &output_buffer,
            0,
            bytemuck::cast_slice(&vec![0u32; output_words]),
        );
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
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: section_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: completion_counter.as_entire_binding(),
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
            let workgroups = if sectioned {
                section_count as u32
            } else if programlet {
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
        let section_records = if sectioned {
            Some(decode_section_records(section_count, output)?)
        } else {
            None
        };
        let values = if let Some(records) = &section_records {
            records.iter().map(|record| record.value.clone()).collect()
        } else if programlet {
            decode_programlet_result(codelets.len(), output)?
        } else {
            decode_results(codelets, output)?
        };
        let section_json = section_records.as_ref().map(|records| {
            records
                .iter()
                .map(|record| {
                    json!({
                        "sectionIndex": record.section_index,
                        "nameWords": record.name_words,
                        "completionOrder": record.completion_order,
                        "value": value_json(&record.value),
                    })
                })
                .collect::<Vec<_>>()
        });
        drop(mapped);
        readback.unmap();

        let mut response = json!({
            "ok": true,
            "backend": "rust-gpu-vulkan",
            "device": self.adapter_name,
            "values": values.iter().map(value_json).collect::<Vec<_>>(),
        });
        if let Some(section_json) = section_json {
            response["sections"] = Value::Array(section_json);
            response["completionOrder"] = Value::Array(
                section_records
                    .as_ref()
                    .expect("section records exist for section packets")
                    .iter()
                    .map(|record| Value::from(record.section_index as u64))
                    .collect(),
            );
        }
        Ok(response)
    }
}

async fn create_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    cache: &wgpu::PipelineCache,
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
        cache: Some(cache),
    });
    let validation_error = validation_scope.pop().await;
    let oom_error = oom_scope.pop().await;
    let internal_error = internal_scope.pop().await;
    if let Some(error) = validation_error.or(oom_error).or(internal_error) {
        return Err(format!("Vulkan VLIW pipeline creation failed: {error}"));
    }
    Ok(pipeline)
}

fn read_pipeline_cache(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "compiled GPU pipeline artifact is required at {}: {error}",
            path.display()
        )
    })?;
    if bytes.is_empty() {
        return Err(format!(
            "compiled GPU pipeline artifact is empty: {}",
            path.display()
        ));
    }
    Ok(bytes)
}

fn write_pipeline_cache(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "could not create pipeline artifact directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let mut temporary = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("bin");
    temporary.set_extension(format!("{extension}.{}.tmp", std::process::id()));
    fs::write(&temporary, data).map_err(|error| {
        format!(
            "could not write compiled pipeline artifact {}: {error}",
            temporary.display()
        )
    })?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "could not atomically install compiled pipeline artifact {}: {error}",
            path.display()
        ));
    }
    Ok(())
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
        pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(output[4]),
        pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(output[4] as u16),
        pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(output[4] != 0),
        kind => return Err(format!("programlet: unsupported GPU result kind {kind}")),
    };
    Ok(vec![value])
}

fn decode_section_records(
    section_count: usize,
    output: &[u32],
) -> Result<Vec<DecodedSectionResult>, String> {
    if output.len() < section_count * SECTION_RESULT_STRIDE {
        return Err("sectioned programlet: GPU result buffer is truncated".to_owned());
    }

    let mut records = Vec::with_capacity(section_count);
    for completion_order in 0..section_count {
        let record_start = completion_order * SECTION_RESULT_STRIDE;
        let section_index = output[record_start] as usize;
        let name_length = output[record_start + 1] as usize;
        let codelet_count = output[record_start + 3] as usize;
        if section_index >= section_count
            || name_length == 0
            || name_length > MAX_SECTION_NAME_WORDS
            || codelet_count == 0
        {
            return Err(format!(
                "sectioned programlet: invalid result metadata at completion slot {completion_order}"
            ));
        }
        let name_words = output[record_start + 4..record_start + 4 + name_length].to_vec();
        let result_start = record_start + 4 + MAX_SECTION_NAME_WORDS;
        let result = &output[result_start..result_start + RESULT_STRIDE];
        if result[1] != 0 {
            return Err(format!(
                "sectioned programlet {section_index} ({name_words:04x?}): shared VLIW runtime error {}",
                result[1]
            ));
        }
        if result[2] != 1 || result[3] as usize != codelet_count {
            return Err(format!(
                "sectioned programlet {section_index}: invalid result record (kind={}, length={}, consumed={}, expected={codelet_count})",
                result[0], result[2], result[3]
            ));
        }
        let value = match result[0] {
            pyac_vliw_core::VALUE_UNSIGNED => PyacValue::Unsigned(u64::from(result[4])),
            pyac_vliw_core::VALUE_SIGNED => PyacValue::Signed(i64::from(result[4] as i32)),
            pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(result[4]),
            pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(result[4] as u16),
            pyac_vliw_core::VALUE_BOOLEAN => PyacValue::Boolean(result[4] != 0),
            kind => {
                return Err(format!(
                    "sectioned programlet {section_index}: unsupported GPU result kind {kind}"
                ));
            }
        };
        records.push(DecodedSectionResult {
            section_index,
            name_words,
            completion_order,
            value,
        });
    }
    Ok(records)
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
            pyac_vliw_core::VALUE_FLOAT32 => PyacValue::Float32(data[0]),
            pyac_vliw_core::VALUE_FIXED16 => PyacValue::Fixed16(data[0] as u16),
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
        PyacValue::Float32(bits) => json!({"type": "float32", "value": f32::from_bits(*bits)}),
        PyacValue::Fixed16(numerator) => json!({
            "type": "fixed16",
            "value": f64::from(*numerator) / 46_656.0,
            "numerator": numerator,
            "denominator": 46_656
        }),
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

    #[test]
    fn pipeline_artifact_is_written_atomically_and_required_when_loading() {
        let path = std::env::temp_dir().join(format!(
            "pyac-vliw-pipeline-cache-{}-{}.bin",
            std::process::id(),
            Instant::now().elapsed().as_nanos()
        ));
        let artifact = [0x50, 0x59, 0x41, 0x43, 1, 2, 3];

        write_pipeline_cache(&path, &artifact).unwrap();
        assert_eq!(read_pipeline_cache(&path).unwrap(), artifact);
        fs::remove_file(&path).unwrap();
        assert!(read_pipeline_cache(&path).unwrap_err().contains("required"));
    }

    #[test]
    fn empty_pipeline_artifacts_are_rejected() {
        let path = std::env::temp_dir().join(format!(
            "pyac-vliw-empty-pipeline-cache-{}.bin",
            std::process::id()
        ));
        fs::write(&path, []).unwrap();
        assert!(read_pipeline_cache(&path).unwrap_err().contains("empty"));
        fs::remove_file(path).unwrap();
    }

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
        assert_eq!(
            decode_programlet_result(
                6,
                &result_record(pyac_vliw_core::VALUE_FLOAT32, 1.25f32.to_bits())
            )
            .unwrap(),
            vec![PyacValue::Float32(1.25f32.to_bits())]
        );
        assert_eq!(
            decode_programlet_result(6, &result_record(pyac_vliw_core::VALUE_FIXED16, 23_328))
                .unwrap(),
            vec![PyacValue::Fixed16(23_328)]
        );
    }

    #[test]
    fn decodes_float32_codelet_results_and_json_values() {
        let mut codelet = [0; pyac::WORDS_PER_CODELET];
        codelet[0] = 1;
        let bits = 0.3f32.to_bits();
        let mut output = vec![0; RESULT_STRIDE];
        output[0] = pyac_vliw_core::VALUE_FLOAT32;
        output[2] = 1;
        output[3] = 1;
        output[4] = bits;

        assert_eq!(
            decode_results(&[codelet], &output).unwrap(),
            vec![PyacValue::Float32(bits)]
        );
        assert_eq!(
            value_json(&PyacValue::Float32(bits)),
            json!({ "type": "float32", "value": f32::from_bits(bits) })
        );
    }

    #[test]
    fn decodes_fixed16_codelet_results_and_json_values() {
        let mut codelet = [0; pyac::WORDS_PER_CODELET];
        codelet[0] = 1;
        let mut output = vec![0; RESULT_STRIDE];
        output[0] = pyac_vliw_core::VALUE_FIXED16;
        output[2] = 1;
        output[3] = 1;
        output[4] = 23_328;

        assert_eq!(
            decode_results(&[codelet], &output).unwrap(),
            vec![PyacValue::Fixed16(23_328)]
        );
        assert_eq!(
            value_json(&PyacValue::Fixed16(23_328)),
            json!({
                "type": "fixed16",
                "value": 0.5,
                "numerator": 23_328,
                "denominator": 46_656
            })
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

    #[test]
    fn decodes_section_results_in_gpu_completion_order_with_hnuc_names() {
        let mut output = vec![0; 2 * SECTION_RESULT_STRIDE];
        for (ticket, section_index, name, value) in [(0, 1, 0x2222, 22), (1, 0, 0x1111, 11)] {
            let start = ticket * SECTION_RESULT_STRIDE;
            output[start] = section_index;
            output[start + 1] = 1;
            output[start + 2] = section_index * 2;
            output[start + 3] = 3;
            output[start + 4] = name;
            let result = start + 4 + MAX_SECTION_NAME_WORDS;
            output[result] = pyac_vliw_core::VALUE_UNSIGNED;
            output[result + 2] = 1;
            output[result + 3] = 3;
            output[result + 4] = value;
        }

        let records = decode_section_records(2, &output).unwrap();
        assert_eq!(records[0].completion_order, 0);
        assert_eq!(records[0].section_index, 1);
        assert_eq!(records[0].name_words, vec![0x2222]);
        assert_eq!(records[0].value, PyacValue::Unsigned(22));
        assert_eq!(records[1].completion_order, 1);
        assert_eq!(records[1].section_index, 0);
        assert_eq!(records[1].name_words, vec![0x1111]);
        assert_eq!(records[1].value, PyacValue::Unsigned(11));
    }
}
