"""Bounded CUDA evaluator for batches of named-slot Pyash VLIW functions."""

import ctypes
import json
import math
import re
from typing import Any, Dict, List, Tuple

MAX_CANDIDATES = 256
MAX_CASES = 4096
MAX_PAIRS = 262144
MAX_BATCH_BYTES = 16 * 1024 * 1024
MAX_SCRATCH_BYTES = 512 * 1024 * 1024
DEFAULT_STEP_BUDGET = 65_536
MAX_STEP_BUDGET = 10_000_000
OPCODES = {"plus": 1, "subtract": 2, "xor": 3}

_PTX = r"""
.version 7.0
.target sm_70
.address_size 64
.visible .entry evaluate_vliw_batch(
  .param .u64 candidates_ptr,
  .param .u64 cases_ptr,
  .param .u64 results_ptr,
  .param .u64 scratch_ptr,
  .param .u32 candidate_count,
  .param .u32 case_count,
  .param .u32 slot_count,
  .param .u32 candidate_stride
)
{
  .reg .pred %p<8>;
  .reg .b32 %r<24>;
  .reg .b64 %rd<16>;

  ld.param.u64 %rd0, [candidates_ptr];
  ld.param.u64 %rd1, [cases_ptr];
  ld.param.u64 %rd2, [results_ptr];
  ld.param.u64 %rd3, [scratch_ptr];
  ld.param.u32 %r0, [candidate_count];
  ld.param.u32 %r1, [case_count];
  ld.param.u32 %r2, [slot_count];
  ld.param.u32 %r3, [candidate_stride];
  mov.u32 %r4, %ctaid.x;
  mov.u32 %r5, %ntid.x;
  mov.u32 %r6, %tid.x;
  mad.lo.u32 %r7, %r4, %r5, %r6;
  mul.lo.u32 %r8, %r0, %r1;
  setp.ge.u32 %p0, %r7, %r8;
  @%p0 bra DONE;

  div.u32 %r9, %r7, %r1;
  rem.u32 %r10, %r7, %r1;
  mul.lo.u32 %r11, %r9, %r3;
  mul.wide.u32 %rd4, %r11, 4;
  add.u64 %rd5, %rd0, %rd4;
  ld.global.u32 %r12, [%rd5];
  ld.global.u32 %r13, [%rd5+4];

  add.u32 %r14, %r2, 1;
  mul.lo.u32 %r15, %r10, %r14;
  mul.wide.u32 %rd6, %r15, 4;
  add.u64 %rd7, %rd1, %rd6;
  mul.lo.u32 %r16, %r7, %r2;
  mul.wide.u32 %rd8, %r16, 4;
  add.u64 %rd9, %rd3, %rd8;
  mov.u32 %r17, 0;
LOAD_SLOT:
  setp.ge.u32 %p1, %r17, %r2;
  @%p1 bra LOAD_DONE;
  mul.wide.u32 %rd10, %r17, 4;
  add.u64 %rd11, %rd7, %rd10;
  ld.global.u32 %r18, [%rd11];
  add.u64 %rd12, %rd9, %rd10;
  st.global.u32 [%rd12], %r18;
  add.u32 %r17, %r17, 1;
  bra LOAD_SLOT;
LOAD_DONE:
  mov.u32 %r17, 0;
INSTRUCTION:
  setp.ge.u32 %p2, %r17, %r12;
  @%p2 bra RETURN_VALUE;
  mul.lo.u32 %r18, %r17, 4;
  add.u32 %r18, %r18, 2;
  mul.wide.u32 %rd10, %r18, 4;
  add.u64 %rd11, %rd5, %rd10;
  ld.global.u32 %r19, [%rd11];
  ld.global.u32 %r20, [%rd11+4];
  ld.global.u32 %r21, [%rd11+8];
  ld.global.u32 %r22, [%rd11+12];
  mul.wide.u32 %rd10, %r21, 4;
  add.u64 %rd12, %rd9, %rd10;
  ld.global.u32 %r23, [%rd12];
  mul.wide.u32 %rd10, %r22, 4;
  add.u64 %rd12, %rd9, %rd10;
  ld.global.u32 %r18, [%rd12];
  setp.eq.u32 %p3, %r19, 1;
  @%p3 bra OP_PLUS;
  setp.eq.u32 %p3, %r19, 2;
  @%p3 bra OP_SUBTRACT;
  xor.b32 %r23, %r23, %r18;
  bra STORE_RESULT;
OP_PLUS:
  add.u32 %r23, %r23, %r18;
  min.u32 %r23, %r23, 65535;
  bra STORE_RESULT;
OP_SUBTRACT:
  setp.ge.u32 %p4, %r23, %r18;
  sub.u32 %r23, %r23, %r18;
  @!%p4 mov.u32 %r23, 0;
STORE_RESULT:
  mul.wide.u32 %rd10, %r20, 4;
  add.u64 %rd12, %rd9, %rd10;
  st.global.u32 [%rd12], %r23;
  add.u32 %r17, %r17, 1;
  bra INSTRUCTION;
RETURN_VALUE:
  mul.wide.u32 %rd10, %r13, 4;
  add.u64 %rd12, %rd9, %rd10;
  ld.global.u32 %r23, [%rd12];
  mul.wide.u32 %rd10, %r7, 4;
  add.u64 %rd12, %rd2, %rd10;
  st.global.u32 [%rd12], %r23;
DONE:
  ret;
}
"""


def _require_map(value: Any, label: str) -> Dict[str, Any]:
  if not isinstance(value, dict):
    raise ValueError(f"{label} must be a map")
  return value


def _slot_index(value: Any, slots: Dict[str, int], label: str) -> int:
  name = str(value or "").strip()
  if name not in slots:
    raise ValueError(f"{label} references unknown slot: {name or '<empty>'}")
  return slots[name]


def _uint16(value: Any, label: str) -> int:
  if isinstance(value, bool):
    raise ValueError(f"{label} must be an unsigned 16-bit integer")
  try:
    number = int(value)
  except (TypeError, ValueError):
    raise ValueError(f"{label} must be an unsigned 16-bit integer")
  if number < 0 or number > 0xFFFF or str(number) != str(value).strip():
    raise ValueError(f"{label} must be an unsigned 16-bit integer")
  return number


def prepare_vliw_batch(payload: Any) -> Dict[str, Any]:
  """Validate and lower a bounded VLIW function/evidence batch to slot indices."""
  raw = _require_map(payload, "vliw batch payload")
  if raw.get("schemaVersion") != 1:
    raise ValueError("vliw batch schemaVersion must be 1")
  encoded_size = len(json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
  if encoded_size > MAX_BATCH_BYTES:
    raise ValueError(f"VLIW batch payload exceeds the {MAX_BATCH_BYTES}-byte safety limit")
  step_budget = raw.get("stepBudget", DEFAULT_STEP_BUDGET)
  if isinstance(step_budget, bool) or not isinstance(step_budget, int) or not 1 <= step_budget <= MAX_STEP_BUDGET:
    raise ValueError(f"stepBudget must be an integer from 1 through {MAX_STEP_BUDGET}")
  slot_names = raw.get("slots")
  if not isinstance(slot_names, list) or len(slot_names) < 2:
    raise ValueError("slots must contain at least two names")
  normalized_slots = [str(item).strip() for item in slot_names]
  if any(not item for item in normalized_slots) or len(set(normalized_slots)) != len(normalized_slots):
    raise ValueError("slot names must be non-empty and unique")
  slots = {name: index for index, name in enumerate(normalized_slots)}

  input_names = raw.get("inputSlots")
  if not isinstance(input_names, list) or len(input_names) != 2 or input_names[0] == input_names[1]:
    raise ValueError("inputSlots must name exactly two distinct slots")
  input_slots = [_slot_index(name, slots, "inputSlots") for name in input_names]
  output_slot = _slot_index(raw.get("outputSlot"), slots, "outputSlot")

  cases_raw = raw.get("cases")
  candidates_raw = raw.get("candidates")
  if not isinstance(cases_raw, list) or not cases_raw:
    raise ValueError("vliw batch must contain at least one case")
  if len(cases_raw) > MAX_CASES:
    raise ValueError(f"case limit is {MAX_CASES}")
  if not isinstance(candidates_raw, list) or not candidates_raw:
    raise ValueError("vliw batch must contain at least one candidate")
  if len(candidates_raw) > MAX_CANDIDATES:
    raise ValueError(f"candidate limit is {MAX_CANDIDATES}")
  if len(cases_raw) * len(candidates_raw) > MAX_PAIRS:
    raise ValueError(f"candidate/case pair limit is {MAX_PAIRS}")
  scratch_bytes = len(cases_raw) * len(candidates_raw) * len(normalized_slots) * 4
  if scratch_bytes > MAX_SCRATCH_BYTES:
    raise ValueError(f"VLIW batch scratch requirement exceeds the {MAX_SCRATCH_BYTES}-byte device safety limit")

  cases: List[Tuple[List[int], int]] = []
  for case_index, case_value in enumerate(cases_raw):
    case = _require_map(case_value, f"case {case_index + 1}")
    values = _require_map(case.get("values"), f"case {case_index + 1} values")
    row = [0] * len(normalized_slots)
    for name in input_names:
      if name not in values:
        raise ValueError(f"case {case_index + 1} is missing input slot {name}")
      row[slots[name]] = _uint16(values[name], f"case {case_index + 1} {name}")
    cases.append((row, _uint16(case.get("expected"), f"case {case_index + 1} expected")))

  candidates = []
  candidate_ids = set()
  for candidate_index, candidate_value in enumerate(candidates_raw):
    candidate = _require_map(candidate_value, f"candidate {candidate_index + 1}")
    candidate_id = str(candidate.get("id") or "").strip()
    if not candidate_id or candidate_id in candidate_ids:
      raise ValueError("candidate ids must be non-empty and unique")
    candidate_ids.add(candidate_id)
    instructions_raw = candidate.get("instructions")
    if not isinstance(instructions_raw, list) or not instructions_raw:
      raise ValueError(f"candidate {candidate_id} must contain at least one instruction")
    if len(instructions_raw) > step_budget:
      raise ValueError(f"candidate {candidate_id} requires {len(instructions_raw)} steps but stepBudget is {step_budget}")
    instructions = []
    for instruction_index, instruction_value in enumerate(instructions_raw):
      instruction = _require_map(instruction_value, f"candidate {candidate_id} instruction {instruction_index + 1}")
      opcode = OPCODES.get(str(instruction.get("op") or "").strip().lower())
      if opcode is None:
        raise ValueError(f"unsupported VLIW operation: {instruction.get('op')}")
      instructions.append((
        opcode,
        _slot_index(instruction.get("target"), slots, "target"),
        _slot_index(instruction.get("left"), slots, "left operand"),
        _slot_index(instruction.get("right"), slots, "right operand")
      ))
    candidates.append({"id": candidate_id, "instructions": instructions})

  return {
    "slotNames": normalized_slots,
    "inputSlots": input_slots,
    "outputSlot": output_slot,
    "stepBudget": step_budget,
    "cases": cases,
    "candidates": candidates
  }


def _check_cuda(result: int, operation: str) -> None:
  if result != 0:
    raise RuntimeError(f"CUDA driver {operation} failed with code {result}")


def _cuda_device_ordinal(device_id: str) -> int:
  match = re.search(r"(\d+)$", str(device_id or "gpu0"))
  return int(match.group(1)) if match else 0


def evaluate_vliw_batch_cuda(prepared: Dict[str, Any], device_id: str = "gpu0") -> List[List[int]]:
  """Evaluate the batch through CUDA Driver API; intentionally has no CPU fallback."""
  try:
    driver = ctypes.CDLL("libcuda.so.1")
  except OSError as err:
    raise RuntimeError(f"CUDA driver library unavailable: {err}") from err

  u32 = ctypes.c_uint32
  u64 = ctypes.c_uint64
  ptr = ctypes.c_void_p
  driver.cuInit.argtypes = [u32]
  driver.cuDeviceGet.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_int]
  driver.cuCtxCreate_v2.argtypes = [ctypes.POINTER(ptr), u32, ctypes.c_int]
  driver.cuCtxDestroy_v2.argtypes = [ptr]
  driver.cuModuleLoadData.argtypes = [ctypes.POINTER(ptr), ctypes.c_char_p]
  driver.cuModuleGetFunction.argtypes = [ctypes.POINTER(ptr), ptr, ctypes.c_char_p]
  driver.cuMemAlloc_v2.argtypes = [ctypes.POINTER(u64), ctypes.c_size_t]
  driver.cuMemFree_v2.argtypes = [u64]
  driver.cuMemcpyHtoD_v2.argtypes = [u64, ptr, ctypes.c_size_t]
  driver.cuMemcpyDtoH_v2.argtypes = [ptr, u64, ctypes.c_size_t]
  driver.cuLaunchKernel.argtypes = [ptr, u32, u32, u32, u32, u32, u32, u32, ptr, ptr, ptr]
  driver.cuCtxSynchronize.argtypes = []

  candidate_count = len(prepared["candidates"])
  case_count = len(prepared["cases"])
  slot_count = len(prepared["slotNames"])
  max_instructions = max(len(candidate["instructions"]) for candidate in prepared["candidates"])
  candidate_stride = 2 + max_instructions * 4
  candidate_words = [0] * (candidate_count * candidate_stride)
  for candidate_index, candidate in enumerate(prepared["candidates"]):
    base = candidate_index * candidate_stride
    candidate_words[base] = len(candidate["instructions"])
    candidate_words[base + 1] = prepared["outputSlot"]
    for instruction_index, instruction in enumerate(candidate["instructions"]):
      start = base + 2 + instruction_index * 4
      candidate_words[start:start + 4] = instruction
  case_stride = slot_count + 1
  case_words = [0] * (case_count * case_stride)
  for case_index, (values, expected) in enumerate(prepared["cases"]):
    start = case_index * case_stride
    case_words[start:start + slot_count] = values
    case_words[start + slot_count] = expected

  candidate_array = (u32 * len(candidate_words))(*candidate_words)
  case_array = (u32 * len(case_words))(*case_words)
  pair_count = candidate_count * case_count
  result_array = (u32 * pair_count)()
  context = ptr()
  module = ptr()
  device_candidates = []
  try:
    _check_cuda(driver.cuInit(0), "initialization")
    device = ctypes.c_int()
    _check_cuda(driver.cuDeviceGet(ctypes.byref(device), _cuda_device_ordinal(device_id)), "device selection")
    _check_cuda(driver.cuCtxCreate_v2(ctypes.byref(context), 0, device.value), "context creation")
    ptx = _PTX.encode("ascii") + b"\0"
    _check_cuda(driver.cuModuleLoadData(ctypes.byref(module), ptx), "PTX module load")
    function = ptr()
    _check_cuda(driver.cuModuleGetFunction(ctypes.byref(function), module, b"evaluate_vliw_batch"), "kernel lookup")

    def allocate_and_copy(array):
      address = u64()
      size = ctypes.sizeof(array)
      _check_cuda(driver.cuMemAlloc_v2(ctypes.byref(address), size), "device allocation")
      device_candidates.append(address)
      _check_cuda(driver.cuMemcpyHtoD_v2(address, ctypes.cast(array, ptr), size), "host-to-device copy")
      return address

    def allocate(size):
      address = u64()
      _check_cuda(driver.cuMemAlloc_v2(ctypes.byref(address), size), "device allocation")
      device_candidates.append(address)
      return address

    candidates_address = allocate_and_copy(candidate_array)
    cases_address = allocate_and_copy(case_array)
    results_address = allocate(ctypes.sizeof(result_array))
    scratch_address = allocate(pair_count * slot_count * ctypes.sizeof(u32))
    candidate_arg = u64(candidates_address.value)
    cases_arg = u64(cases_address.value)
    results_arg = u64(results_address.value)
    scratch_arg = u64(scratch_address.value)
    candidate_count_arg = u32(candidate_count)
    case_count_arg = u32(case_count)
    slot_count_arg = u32(slot_count)
    candidate_stride_arg = u32(candidate_stride)
    kernel_arguments = (ptr * 8)(
      ctypes.cast(ctypes.byref(candidate_arg), ptr),
      ctypes.cast(ctypes.byref(cases_arg), ptr),
      ctypes.cast(ctypes.byref(results_arg), ptr),
      ctypes.cast(ctypes.byref(scratch_arg), ptr),
      ctypes.cast(ctypes.byref(candidate_count_arg), ptr),
      ctypes.cast(ctypes.byref(case_count_arg), ptr),
      ctypes.cast(ctypes.byref(slot_count_arg), ptr),
      ctypes.cast(ctypes.byref(candidate_stride_arg), ptr)
    )
    block_size = 128
    grid_size = math.ceil(pair_count / block_size)
    _check_cuda(driver.cuLaunchKernel(
      function, grid_size, 1, 1, block_size, 1, 1, 0, None,
      ctypes.cast(kernel_arguments, ptr), None
    ), "kernel launch")
    _check_cuda(driver.cuCtxSynchronize(), "kernel synchronization")
    _check_cuda(driver.cuMemcpyDtoH_v2(ctypes.cast(result_array, ptr), results_address, ctypes.sizeof(result_array)), "device-to-host copy")
  finally:
    for address in reversed(device_candidates):
      driver.cuMemFree_v2(address)
    if module:
      driver.cuModuleUnload.argtypes = [ptr]
      driver.cuModuleUnload(module)
    if context:
      driver.cuCtxDestroy_v2(context)

  return [
    [int(result_array[candidate_index * case_count + case_index]) for case_index in range(case_count)]
    for candidate_index in range(candidate_count)
  ]


def score_vliw_batch(payload: Any, device_id: str = "gpu0") -> Dict[str, Any]:
  prepared = prepare_vliw_batch(payload)
  outputs = evaluate_vliw_batch_cuda(prepared, device_id)
  expected = [case[1] for case in prepared["cases"]]
  scores = []
  for candidate, actual_values in zip(prepared["candidates"], outputs):
    errors = [abs(actual - wanted) for actual, wanted in zip(actual_values, expected)]
    scores.append({
      "id": candidate["id"],
      "incorrectCount": sum(error != 0 for error in errors),
      "totalAbsoluteError": sum(errors),
      "instructionCount": len(candidate["instructions"]),
      "outputs": actual_values
    })
  scores.sort(key=lambda item: (
    item["incorrectCount"], item["totalAbsoluteError"], item["instructionCount"], item["id"]
  ))
  return {
    "schemaVersion": 1,
    "deviceId": str(device_id),
    "stepBudget": prepared["stepBudget"],
    "caseCount": len(prepared["cases"]),
    "candidateCount": len(prepared["candidates"]),
    "scores": scores
  }
