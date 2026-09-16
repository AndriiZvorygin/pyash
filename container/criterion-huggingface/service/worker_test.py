import importlib.util
import pathlib
import unittest


WORKER_PATH = pathlib.Path(__file__).resolve().parents[3] / "program/runtime/criterion/huggingface_worker.py"
spec = importlib.util.spec_from_file_location("criterion_huggingface_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CriterionHuggingFaceWorkerTests(unittest.TestCase):
  def test_target_defaults_use_declared_limits_and_deterministic_generation(self):
    dialog_led = worker.MODEL_DEFAULTS["MingZhong/DialogLED-large-5120"]
    meeting_script = worker.MODEL_DEFAULTS["Shaelois/MeetingScript"]
    self.assertEqual(dialog_led["maxInputTokens"], 5120)
    self.assertEqual(meeting_script["maxInputTokens"], 4096)
    self.assertEqual(dialog_led["numBeams"], 4)
    self.assertFalse(dialog_led["doSample"])
    self.assertEqual(worker.MODEL_DEFAULTS["SUSTech-NLP/UniRRM-8B"]["operation"], "judge")

  def test_judge_auto_dtype_uses_bfloat16_on_cuda(self):
    class Torch:
      float16 = "float16"
      bfloat16 = "bfloat16"

    self.assertEqual(worker.resolve_dtype("auto", "judge", "cuda", Torch), "bfloat16")
    self.assertIsNone(worker.resolve_dtype("auto", "generate", "cuda", Torch))

  def test_long_inputs_are_covered_by_deterministic_overlapping_windows(self):
    ranges = worker.chunk_ranges(9000, 4096, 128)
    self.assertGreater(len(ranges), 1)
    self.assertEqual(ranges[0], (0, 4096))
    self.assertEqual(ranges[-1][1], 9000)
    self.assertEqual(ranges[1][0], 3968)
    self.assertEqual(sum(end - start for start, end in ranges), 9256)

  def test_short_inputs_use_one_window(self):
    self.assertEqual(worker.chunk_ranges(512, 4096, 128), [(0, 512)])

  def test_model_revision_prefers_resolved_model_commit(self):
    class Tokenizer:
      _commit_hash = "tokenizer-commit"

    class Config:
      _commit_hash = "model-commit"

    class Model:
      config = Config()

    self.assertEqual(worker.resolved_revision(Tokenizer(), Model(), "requested"), "model-commit")


if __name__ == "__main__":
  unittest.main()
