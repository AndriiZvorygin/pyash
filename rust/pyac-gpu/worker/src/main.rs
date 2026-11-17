use std::borrow::Cow;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::PathBuf;

use pyac::{PyacValue, VectorElements, decode_pack};
use pyac_vliw_core::{
    ERROR_FUNCTION_DIVISION_BY_ZERO, ERROR_FUNCTION_OPCODE, ERROR_FUNCTION_OPERAND,
};
use serde_json::{Map, Value, json};
use wgpu::util::DeviceExt;

const RESULT_WORDS: usize = 32;
const RESULT_STRIDE: usize = 4 + RESULT_WORDS;
const MAX_BATCH_BYTES: usize = 16 * 1024 * 1024;
const MAX_CANDIDATES: usize = 256;
const MAX_CASES: usize = 4096;
const MAX_PAIRS: usize = 262_144;
const MAX_SCRATCH_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_STEP_BUDGET: usize = 65_536;
const MAX_STEP_BUDGET: usize = 10_000_000;

#[derive(Debug)]
struct PreparedBatch {
    ids: Vec<String>,
    instruction_counts: Vec<usize>,
    expected: Vec<u32>,
    candidate_words: Vec<u32>,
    case_words: Vec<u32>,
    metadata: [u32; 6],
}

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
    let response = if input.first() == Some(&b'{') {
        let payload: Value = serde_json::from_slice(&input)
            .map_err(|error| format!("invalid VLIW batch JSON: {error}"))?;
        let batch = prepare_batch(&payload)?;
        pollster::block_on(run_batch(&batch))?
    } else {
        let pack = decode_pack(&input).map_err(|error| error.to_string())?;
        pollster::block_on(run_pack(&pack.codelets))?
    };
    std::io::stdout()
        .write_all(response.to_string().as_bytes())
        .map_err(|error| format!("could not write JSON result: {error}"))?;
    Ok(())
}

fn require_map<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{label} must be a map"))
}

fn required_string(map: &Map<String, Value>, key: &str, label: &str) -> Result<String, String> {
    let value = map
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} must be non-empty text"))?;
    Ok(value.to_owned())
}

fn required_u32(value: Option<&Value>, label: &str, max: u32) -> Result<u32, String> {
    let number = value
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("{label} must be an unsigned integer"))?;
    if number > u64::from(max) {
        return Err(format!("{label} must be at most {max}"));
    }
    Ok(number as u32)
}

fn slot_index(
    value: Option<&Value>,
    slots: &BTreeMap<String, usize>,
    label: &str,
) -> Result<usize, String> {
    let name = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} must name a slot"))?;
    slots
        .get(name)
        .copied()
        .ok_or_else(|| format!("{label} references unknown slot: {name}"))
}

fn prepare_batch(payload: &Value) -> Result<PreparedBatch, String> {
    let raw = require_map(payload, "VLIW batch payload")?;
    if raw.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("vliw batch schemaVersion must be 1".to_owned());
    }
    if serde_json::to_vec(payload)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_BATCH_BYTES
    {
        return Err(format!(
            "VLIW batch payload exceeds the {MAX_BATCH_BYTES}-byte limit"
        ));
    }
    let step_budget = raw
        .get("stepBudget")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_STEP_BUDGET);
    if !(1..=MAX_STEP_BUDGET).contains(&step_budget) {
        return Err(format!(
            "stepBudget must be from 1 through {MAX_STEP_BUDGET}"
        ));
    }

    let slot_names = raw
        .get("slots")
        .and_then(Value::as_array)
        .ok_or_else(|| "slots must be an array".to_owned())?;
    if slot_names.len() < 2 {
        return Err("slots must contain at least two names".to_owned());
    }
    let mut slots = BTreeMap::new();
    for (index, name) in slot_names.iter().enumerate() {
        let name = name
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "slot names must be non-empty text".to_owned())?;
        if slots.insert(name.to_owned(), index).is_some() {
            return Err("slot names must be unique".to_owned());
        }
    }
    let input_slots = raw
        .get("inputSlots")
        .and_then(Value::as_array)
        .ok_or_else(|| "inputSlots must be an array".to_owned())?;
    if input_slots.len() != 2 {
        return Err("inputSlots must name exactly two distinct slots".to_owned());
    }
    let input_indices = [
        slot_index(input_slots.first(), &slots, "inputSlots")?,
        slot_index(input_slots.get(1), &slots, "inputSlots")?,
    ];
    if input_indices[0] == input_indices[1] {
        return Err("inputSlots must name exactly two distinct slots".to_owned());
    }
    let output_slot = slot_index(raw.get("outputSlot"), &slots, "outputSlot")?;

    let cases = raw
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| "cases must be an array".to_owned())?;
    let candidates = raw
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or_else(|| "candidates must be an array".to_owned())?;
    if cases.is_empty() || cases.len() > MAX_CASES {
        return Err(format!("case count must be 1 through {MAX_CASES}"));
    }
    if candidates.is_empty() || candidates.len() > MAX_CANDIDATES {
        return Err(format!(
            "candidate count must be 1 through {MAX_CANDIDATES}"
        ));
    }
    let pair_count = cases.len() * candidates.len();
    if pair_count > MAX_PAIRS {
        return Err(format!("candidate/case pair limit is {MAX_PAIRS}"));
    }
    let scratch_bytes = pair_count
        .checked_mul(slot_names.len())
        .and_then(|words| words.checked_mul(4))
        .ok_or_else(|| "VLIW batch scratch size overflow".to_owned())?;
    if scratch_bytes > MAX_SCRATCH_BYTES {
        return Err(format!(
            "VLIW batch scratch exceeds {MAX_SCRATCH_BYTES} bytes"
        ));
    }

    let mut case_words = Vec::with_capacity(cases.len() * (slot_names.len() + 1));
    let mut expected = Vec::with_capacity(cases.len());
    for (index, case_value) in cases.iter().enumerate() {
        let case = require_map(case_value, &format!("case {}", index + 1))?;
        let values = require_map(
            case.get("values")
                .ok_or_else(|| format!("case {} values are required", index + 1))?,
            &format!("case {} values", index + 1),
        )?;
        let mut row = vec![0u32; slot_names.len()];
        for (name, slot) in raw["inputSlots"]
            .as_array()
            .unwrap()
            .iter()
            .zip(input_indices)
        {
            let name = name.as_str().unwrap();
            row[slot] = required_u32(
                values.get(name),
                &format!("case {} {name}", index + 1),
                65_535,
            )?;
        }
        let expected_value = required_u32(
            case.get("expected"),
            &format!("case {} expected", index + 1),
            u32::MAX,
        )?;
        case_words.extend(row);
        case_words.push(expected_value);
        expected.push(expected_value);
    }

    let opcodes = [
        ("plus", 1),
        ("subtract", 2),
        ("xor", 3),
        ("multiply", 4),
        ("divide", 5),
        ("remains", 6),
        ("exponential", 7),
        ("equally", 8),
        ("tiny", 9),
        ("giant", 10),
    ];
    let mut ids = Vec::with_capacity(candidates.len());
    let mut seen_ids = std::collections::BTreeSet::new();
    let mut instruction_counts = Vec::with_capacity(candidates.len());
    let mut lowered = Vec::with_capacity(candidates.len());
    let mut max_instructions = 0;
    for (index, candidate_value) in candidates.iter().enumerate() {
        let candidate = require_map(candidate_value, &format!("candidate {}", index + 1))?;
        let id = required_string(candidate, "id", "candidate id")?;
        if !seen_ids.insert(id.clone()) {
            return Err("candidate ids must be unique".to_owned());
        }
        let instructions = candidate
            .get("instructions")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("candidate {id} instructions must be an array"))?;
        if instructions.is_empty() || instructions.len() > step_budget {
            return Err(format!(
                "candidate {id} instruction count exceeds its step budget"
            ));
        }
        let mut instructions_flat = Vec::with_capacity(instructions.len() * 4);
        for instruction_value in instructions {
            let instruction = require_map(instruction_value, "candidate instruction")?;
            let op = required_string(instruction, "op", "instruction op")?.to_lowercase();
            let opcode = opcodes
                .iter()
                .find_map(|(name, code)| (*name == op).then_some(*code))
                .ok_or_else(|| format!("unsupported VLIW operation: {op}"))?;
            instructions_flat.extend([
                opcode,
                slot_index(instruction.get("target"), &slots, "target")? as u32,
                slot_index(instruction.get("left"), &slots, "left operand")? as u32,
                slot_index(instruction.get("right"), &slots, "right operand")? as u32,
            ]);
        }
        max_instructions = max_instructions.max(instructions.len());
        instruction_counts.push(instructions.len());
        ids.push(id);
        lowered.push(instructions_flat);
    }

    let candidate_stride = 2 + max_instructions * 4;
    let candidate_buffer_bytes = candidates.len() * candidate_stride * 4;
    if candidate_buffer_bytes > MAX_SCRATCH_BYTES {
        return Err(format!(
            "VLIW candidate buffer exceeds {MAX_SCRATCH_BYTES} bytes"
        ));
    }
    let mut candidate_words = vec![0u32; candidates.len() * candidate_stride];
    for (index, instructions) in lowered.iter().enumerate() {
        let start = index * candidate_stride;
        candidate_words[start] = instruction_counts[index] as u32;
        candidate_words[start + 1] = output_slot as u32;
        candidate_words[start + 2..start + 2 + instructions.len()].copy_from_slice(instructions);
    }

    Ok(PreparedBatch {
        ids,
        instruction_counts,
        expected,
        candidate_words,
        case_words,
        metadata: [
            candidates.len() as u32,
            cases.len() as u32,
            slot_names.len() as u32,
            candidate_stride as u32,
            (slot_names.len() + 1) as u32,
            step_budget as u32,
        ],
    })
}

async fn run_pack(codelets: &[[u16; pyac::WORDS_PER_CODELET]]) -> Result<Value, String> {
    if codelets.is_empty() {
        return Ok(json!({"ok": true, "backend": "rust-gpu-vulkan", "values": []}));
    }

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
        entry_point: Some("execute_pyac_pack"),
        compilation_options: Default::default(),
        cache: None,
    });

    let input_words = codelets
        .iter()
        .flat_map(|codelet| codelet.iter().map(|word| u32::from(*word)))
        .collect::<Vec<_>>();
    let output_words = codelets.len() * RESULT_STRIDE;
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
        pass.dispatch_workgroups(codelets.len().div_ceil(64) as u32, 1, 1);
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
    let values = decode_results(codelets, output)?;
    drop(mapped);
    readback.unmap();

    Ok(json!({
        "ok": true,
        "backend": "rust-gpu-vulkan",
        "device": adapter_info.name,
        "values": values.iter().map(value_json).collect::<Vec<_>>(),
    }))
}

async fn run_batch(batch: &PreparedBatch) -> Result<Value, String> {
    let candidate_count = batch.metadata[0] as usize;
    let case_count = batch.metadata[1] as usize;
    let slot_count = batch.metadata[2] as usize;
    let pair_count = candidate_count * case_count;
    let output_words = pair_count * 2;
    let scratch_words = pair_count * slot_count;

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
        label: Some("Pyash shared VLIW candidate evaluator SPIR-V"),
        source: wgpu::ShaderSource::SpirV(Cow::Owned(shader_words.to_vec())),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("Pyash VLIW candidate batch evaluator"),
        layout: None,
        module: &shader,
        entry_point: Some("evaluate_vliw_batch"),
        compilation_options: Default::default(),
        cache: None,
    });
    let candidates_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Pyash VLIW candidate instructions"),
        contents: bytemuck::cast_slice(&batch.candidate_words),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let cases_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Pyash VLIW candidate test cases"),
        contents: bytemuck::cast_slice(&batch.case_words),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let metadata_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Pyash VLIW batch dimensions"),
        contents: bytemuck::cast_slice(&batch.metadata),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW batch results"),
        size: (output_words * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let scratch_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW candidate slots"),
        size: (scratch_words * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Pyash VLIW batch readback"),
        size: (output_words * 4) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Pyash VLIW batch bindings"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: candidates_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: cases_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: metadata_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: output_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: scratch_buffer.as_entire_binding(),
            },
        ],
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Pyash VLIW batch dispatch"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Pyash shared candidate evaluator"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(pair_count.div_ceil(64) as u32, 1, 1);
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
    let words = bytemuck::try_cast_slice::<u8, u32>(&mapped)
        .map_err(|error| format!("Vulkan result buffer was not u32 aligned: {error}"))?;
    let mut actual = vec![vec![0u32; case_count]; candidate_count];
    for pair in 0..pair_count {
        let result = FunctionResultView {
            value: words[pair * 2],
            error: words[pair * 2 + 1],
        };
        if result.error != 0 {
            let detail = match result.error {
                ERROR_FUNCTION_OPERAND => "operand outside unsigned 16-bit range",
                ERROR_FUNCTION_DIVISION_BY_ZERO => "division by zero",
                ERROR_FUNCTION_OPCODE => "unsupported operation",
                _ => "malformed candidate or slot reference",
            };
            return Err(format!("candidate/case pair {}: {detail}", pair + 1));
        }
        actual[pair / case_count][pair % case_count] = result.value;
    }
    drop(mapped);
    readback.unmap();

    let mut scores = Vec::with_capacity(candidate_count);
    for candidate in 0..candidate_count {
        let outputs = &actual[candidate];
        let mut incorrect_count = 0usize;
        let mut total_absolute_error = 0u64;
        for (actual_value, expected_value) in outputs.iter().zip(&batch.expected) {
            let error = u64::from(actual_value.abs_diff(*expected_value));
            incorrect_count += usize::from(error != 0);
            total_absolute_error += error;
        }
        scores.push(json!({
            "id": batch.ids[candidate],
            "incorrectCount": incorrect_count,
            "totalAbsoluteError": total_absolute_error,
            "instructionCount": batch.instruction_counts[candidate],
            "outputs": outputs,
        }));
    }
    scores.sort_by(|left, right| {
        let metric = |score: &Value, key: &str| score.get(key).and_then(Value::as_u64).unwrap_or(0);
        metric(left, "incorrectCount")
            .cmp(&metric(right, "incorrectCount"))
            .then_with(|| {
                metric(left, "totalAbsoluteError").cmp(&metric(right, "totalAbsoluteError"))
            })
            .then_with(|| metric(left, "instructionCount").cmp(&metric(right, "instructionCount")))
            .then_with(|| left["id"].as_str().cmp(&right["id"].as_str()))
    });

    Ok(json!({
        "schemaVersion": 1,
        "backend": "rust-gpu-vulkan",
        "device": adapter_info.name,
        "stepBudget": batch.metadata[5],
        "caseCount": case_count,
        "candidateCount": candidate_count,
        "scores": scores,
    }))
}

struct FunctionResultView {
    value: u32,
    error: u32,
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
    fn lowers_named_slot_batch_to_shared_core_buffers() {
        let payload = json!({
            "schemaVersion": 1,
            "slots": ["left", "right", "product"],
            "inputSlots": ["left", "right"],
            "outputSlot": "product",
            "cases": [{"values": {"left": 7, "right": 6}, "expected": 42}],
            "candidates": [{
                "id": "multiply",
                "instructions": [{"op": "multiply", "target": "product", "left": "left", "right": "right"}]
            }]
        });
        let batch = prepare_batch(&payload).expect("valid batch lowers");
        assert_eq!(batch.metadata, [1, 1, 3, 6, 4, DEFAULT_STEP_BUDGET as u32]);
        assert_eq!(batch.candidate_words, [1, 2, 4, 2, 0, 1]);
        assert_eq!(batch.case_words, [7, 6, 0, 42]);
        assert_eq!(batch.ids, vec!["multiply".to_owned()]);
    }

    #[test]
    fn rejects_unknown_candidate_operations_before_gpu_dispatch() {
        let payload = json!({
            "schemaVersion": 1,
            "slots": ["left", "right", "value"],
            "inputSlots": ["left", "right"],
            "outputSlot": "value",
            "cases": [{"values": {"left": 1, "right": 2}, "expected": 3}],
            "candidates": [{
                "id": "unknown",
                "instructions": [{"op": "invented", "target": "value", "left": "left", "right": "right"}]
            }]
        });
        assert!(
            prepare_batch(&payload)
                .unwrap_err()
                .contains("unsupported VLIW operation")
        );
    }
}
