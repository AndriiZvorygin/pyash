use super::*;
impl GpuRuntime {
    pub(super) async fn execute_codelets(
        &self,
        codelets: &[[u16; pyac::WORDS_PER_CODELET]],
        timings: &mut GpuExecutionTiming,
    ) -> Result<Value, String> {
        if codelets.is_empty() {
            return Ok(json!({
                "ok": true,
                "backend": "rust-gpu-vulkan",
                "device": self.adapter_name,
                "values": []
            }));
        }

        let classify_started = Instant::now();
        let input_words = codelets
            .iter()
            .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
            .collect::<Vec<_>>();
        let sectioned = pyac_vliw_core::has_programlet_section_header(&input_words, codelets.len());
        let mut section_descriptors =
            [pyac_vliw_core::ProgramletSection::EMPTY; pyac_vliw_core::MAX_PROGRAMLET_SECTIONS];
        let section_count = if sectioned {
            match pyac_vliw_core::scan_numeric_programlet_sections(
                &input_words,
                codelets.len(),
                &mut section_descriptors,
            ) {
                Ok(count) => count,
                Err(error) => {
                    timings.classify_ms = classify_started.elapsed().as_secs_f64() * 1000.0;
                    return Err(format!(
                        "malformed VLIW section packet (core error {error})"
                    ));
                }
            }
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
        let dispatch_words = prepare_dispatch_words(
            &input_words,
            programlet,
            &section_descriptors[..section_count],
        )?;
        timings.classify_ms = classify_started.elapsed().as_secs_f64() * 1000.0;

        let buffer_setup_started = Instant::now();
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
        let dispatch_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Pyash VLIW canonical programlet signatures"),
            size: std::mem::size_of_val(dispatch_words.as_slice()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue
            .write_buffer(&dispatch_buffer, 0, bytemuck::cast_slice(&dispatch_words));
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
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: dispatch_buffer.as_entire_binding(),
                },
            ],
        });
        let timestamp_query_set = self.timestamp_period_ns.map(|_| {
            self.device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("Pyash VLIW compute timestamp queries"),
                count: 2,
                ty: wgpu::QueryType::Timestamp,
            })
        });
        let timestamp_resolve = timestamp_query_set.as_ref().map(|_| {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Pyash VLIW timestamp resolve"),
                size: 256,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            })
        });
        let timestamp_readback = timestamp_query_set.as_ref().map(|_| {
            self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Pyash VLIW timestamp readback"),
                size: 16,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            })
        });
        timings.buffer_setup_ms = buffer_setup_started.elapsed().as_secs_f64() * 1000.0;

        let command_encode_started = Instant::now();
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Pyash VLIW pack dispatch"),
            });
        {
            let timestamp_writes =
                timestamp_query_set
                    .as_ref()
                    .map(|query_set| wgpu::ComputePassTimestampWrites {
                        query_set,
                        beginning_of_pass_write_index: Some(0),
                        end_of_pass_write_index: Some(1),
                    });
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Pyash shared interpreter"),
                timestamp_writes,
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
        if let (Some(query_set), Some(resolve), Some(timestamp_readback)) = (
            timestamp_query_set.as_ref(),
            timestamp_resolve.as_ref(),
            timestamp_readback.as_ref(),
        ) {
            encoder.resolve_query_set(query_set, 0..2, resolve, 0);
            encoder.copy_buffer_to_buffer(resolve, 0, timestamp_readback, 0, 16);
        }
        let command_buffer = encoder.finish();
        timings.command_encode_ms = command_encode_started.elapsed().as_secs_f64() * 1000.0;

        let submit_wait_started = Instant::now();
        self.queue.submit([command_buffer]);
        let slice = readback.slice(..);
        let (sender, receiver) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        let timestamp_slice = timestamp_readback.as_ref().map(|buffer| buffer.slice(..));
        let (timestamp_sender, timestamp_receiver) = std::sync::mpsc::channel();
        if let Some(timestamp_slice) = timestamp_slice.as_ref() {
            timestamp_slice.map_async(wgpu::MapMode::Read, move |result| {
                let _ = timestamp_sender.send(result);
            });
        }
        let poll_result = self.device.poll(wgpu::PollType::wait_indefinitely());
        let result_map_result = receiver
            .recv()
            .map_err(|error| format!("Vulkan readback callback failed: {error}"))
            .and_then(|result| {
                result.map_err(|error| format!("Vulkan readback mapping failed: {error}"))
            });
        let timestamp_map_result = if timestamp_slice.is_some() {
            timestamp_receiver
                .recv()
                .map_err(|error| format!("Vulkan timestamp callback failed: {error}"))
                .and_then(|result| {
                    result.map_err(|error| format!("Vulkan timestamp mapping failed: {error}"))
                })
        } else {
            Ok(())
        };
        timings.submit_wait_readback_ms = submit_wait_started.elapsed().as_secs_f64() * 1000.0;
        poll_result.map_err(|error| format!("Vulkan device poll failed: {error}"))?;
        result_map_result?;
        timestamp_map_result?;

        if let (Some(timestamp_slice), Some(period_ns)) =
            (timestamp_slice.as_ref(), self.timestamp_period_ns)
        {
            let timestamp_bytes = timestamp_slice
                .get_mapped_range()
                .map_err(|error| format!("Vulkan timestamp read failed: {error}"))?;
            let timestamps = bytemuck::try_cast_slice::<u8, u64>(&timestamp_bytes)
                .map_err(|error| format!("Vulkan timestamp data was not u64 aligned: {error}"))?;
            if timestamps.len() >= 2 {
                timings.kernel_gpu_ms = Some(
                    timestamps[1].wrapping_sub(timestamps[0]) as f64 * f64::from(period_ns)
                        / 1_000_000.0,
                );
            }
            drop(timestamp_bytes);
            if let Some(buffer) = timestamp_readback.as_ref() {
                buffer.unmap();
            }
        }

        let mapped = slice
            .get_mapped_range()
            .map_err(|error| format!("Vulkan result map failed: {error}"))?;
        let output = bytemuck::try_cast_slice::<u8, u32>(&mapped)
            .map_err(|error| format!("GPU result buffer was not u32 aligned: {error}"))?;
        let result_decode_started = Instant::now();
        let decode_result = (|| {
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
            Ok::<_, String>((section_records, values))
        })();
        timings.result_decode_ms = result_decode_started.elapsed().as_secs_f64() * 1000.0;
        let (section_records, values) = decode_result?;
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
