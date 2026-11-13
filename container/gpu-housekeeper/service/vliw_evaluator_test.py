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

  def test_batch_rejects_missing_cases_and_oversized_programs(self):
    no_cases = self.valid_payload()
    no_cases["cases"] = []
    with self.assertRaisesRegex(ValueError, "at least one case"):
      vliw.prepare_vliw_batch(no_cases)

    too_many = self.valid_payload()
    too_many["candidates"][0]["instructions"] = [
      {"op": "plus", "target": "sum", "left": "left", "right": "right"}
    ] * (vliw.MAX_INSTRUCTIONS + 1)
    with self.assertRaisesRegex(ValueError, "instruction limit"):
      vliw.prepare_vliw_batch(too_many)

  def test_batch_rejects_unknown_slots_and_operators(self):
    unknown_slot = self.valid_payload()
    unknown_slot["candidates"][0]["instructions"][0]["right"] = "missing"
    with self.assertRaisesRegex(ValueError, "unknown slot"):
      vliw.prepare_vliw_batch(unknown_slot)

    unknown_op = self.valid_payload()
    unknown_op["candidates"][0]["instructions"][0]["op"] = "multiply"
    with self.assertRaisesRegex(ValueError, "unsupported VLIW operation"):
      vliw.prepare_vliw_batch(unknown_op)


if __name__ == "__main__":
  unittest.main()
