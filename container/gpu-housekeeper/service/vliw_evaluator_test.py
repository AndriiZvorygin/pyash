import importlib.util
import pathlib
import unittest

EVALUATOR_PATH = pathlib.Path(__file__).with_name("vliw_evaluator.py")
spec = importlib.util.spec_from_file_location("vliw_evaluator", EVALUATOR_PATH)
vliw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vliw)


class VliwBatchValidationTests(unittest.TestCase):
  def valid_payload(self):
    return {
      "schemaVersion": 1,
      "slots": ["left", "right", "sum"],
      "inputSlots": ["left", "right"],
      "outputSlot": "sum",
      "cases": [
        {"values": {"left": 2, "right": 3}, "expected": 5},
        {"values": {"left": 65535, "right": 1}, "expected": 65535}
      ],
      "candidates": [{
        "id": "add",
        "instructions": [{
          "op": "plus", "target": "sum", "left": "left", "right": "right"
        }]
      }]
    }

  def test_batch_is_lowered_to_fixed_width_named_slot_rows(self):
    prepared = vliw.prepare_vliw_batch(self.valid_payload())

    self.assertEqual(prepared["slotNames"], ["left", "right", "sum"])
    self.assertEqual(prepared["inputSlots"], [0, 1])
    self.assertEqual(prepared["outputSlot"], 2)
    self.assertEqual(prepared["candidates"][0]["instructions"], [(1, 2, 0, 1)])
    self.assertEqual(prepared["cases"], [([2, 3, 0], 5), ([65535, 1, 0], 65535)])

  def test_batch_rejects_missing_cases_and_respects_configured_step_budget(self):
    no_cases = self.valid_payload()
    no_cases["cases"] = []
    with self.assertRaisesRegex(ValueError, "at least one case"):
      vliw.prepare_vliw_batch(no_cases)

    large = self.valid_payload()
    large["slots"].extend(f"scratch-{index}" for index in range(17))
    large["candidates"][0]["instructions"] = [
      {"op": "plus", "target": "sum", "left": "left", "right": "right"}
    ] * 40
    self.assertEqual(len(vliw.prepare_vliw_batch(large)["candidates"][0]["instructions"]), 40)

    too_many = {**large, "stepBudget": 32}
    with self.assertRaisesRegex(ValueError, "requires 40 steps but stepBudget is 32"):
      vliw.prepare_vliw_batch(too_many)

  def test_batch_rejects_invalid_step_budgets_and_oversized_payloads(self):
    invalid_budget = self.valid_payload()
    invalid_budget["stepBudget"] = 0
    with self.assertRaisesRegex(ValueError, "stepBudget must be an integer"):
      vliw.prepare_vliw_batch(invalid_budget)

    oversized = self.valid_payload()
    oversized["padding"] = "x" * vliw.MAX_BATCH_BYTES
    with self.assertRaisesRegex(ValueError, "payload exceeds"):
      vliw.prepare_vliw_batch(oversized)

  def test_batch_rejects_unknown_slots_and_operators(self):
    unknown_slot = self.valid_payload()
    unknown_slot["candidates"][0]["instructions"][0]["right"] = "missing"
    with self.assertRaisesRegex(ValueError, "unknown slot"):
      vliw.prepare_vliw_batch(unknown_slot)

    unknown_op = self.valid_payload()
    unknown_op["candidates"][0]["instructions"][0]["op"] = "multiply"
    self.assertEqual(
      vliw.prepare_vliw_batch(unknown_op)["candidates"][0]["instructions"],
      [(4, 2, 0, 1)]
    )

  def test_batch_lowers_the_pyac_scalar_operation_subset(self):
    operations = [
      "plus", "subtract", "xor", "multiply", "divide", "remains",
      "exponential", "equally", "tiny", "giant"
    ]
    for opcode, operation in enumerate(operations, start=1):
      with self.subTest(operation=operation):
        payload = self.valid_payload()
        payload["candidates"][0]["instructions"][0]["op"] = operation
        self.assertEqual(
          vliw.prepare_vliw_batch(payload)["candidates"][0]["instructions"][0][0],
          opcode
        )

  def test_batch_accepts_u32_expected_values_for_multiply_results(self):
    payload = self.valid_payload()
    payload["cases"][0]["expected"] = 4_294_836_225
    self.assertEqual(vliw.prepare_vliw_batch(payload)["cases"][0][1], 4_294_836_225)

    payload["cases"][0]["expected"] = 4_294_967_296
    with self.assertRaisesRegex(ValueError, "unsigned 32-bit integer"):
      vliw.prepare_vliw_batch(payload)


if __name__ == "__main__":
  unittest.main()
