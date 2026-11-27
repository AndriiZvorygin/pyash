use super::*;
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
        let cache_data = match runtime.pipeline_cache.get_data() {
            Some(data) => data,
            None => {
                return Err(
                    "Vulkan pipeline cache data unavailable; check the preceding device-loss diagnostic"
                        .to_owned(),
                );
            }
        };
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

        let timestamp_features =
            wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::TIMESTAMP_QUERY_INSIDE_PASSES;
        let timestamp_queries = adapter.features().contains(timestamp_features);
        let mut required_features = wgpu::Features::PASSTHROUGH_SHADERS
            | wgpu::Features::PIPELINE_CACHE
            | wgpu::Features::SHADER_F64;
        if timestamp_queries {
            required_features |= timestamp_features;
        }
        if !adapter.features().contains(required_features) {
            return Err(
                "Vulkan adapter lacks a required VLIW feature (SPIR-V passthrough, pipeline cache, or shader-f64)".to_owned(),
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
        let device_loss = Arc::new(Mutex::new(None::<String>));
        let callback_device_loss = Arc::clone(&device_loss);
        device.set_device_lost_callback(move |reason, message| {
            if let Ok(mut loss) = callback_device_loss.lock() {
                *loss = Some(format!("{reason:?}: {message}"));
            }
            eprintln!("[pyac-vliw] Vulkan device lost ({reason:?}): {message}");
        });
        let timestamp_period_ns = timestamp_queries.then(|| queue.get_timestamp_period());
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
                        workgroup_size: (1, 1, 1),
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
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 5,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 6,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 7,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
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
            &device_loss,
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
            &device_loss,
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
            &device_loss,
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
            timestamp_period_ns,
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
}
