import importlib.util
import pathlib
import unittest


SERVER_PATH = pathlib.Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("criterion_huggingface_server", SERVER_PATH)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class FakeWorker:
  def __init__(self):
    self.loads = []
    self.generations = []

  def load_state(self, request):
    self.loads.append(request)
    return {"metadata": {"modelId": request["model"]}, "model": request["model"]}

  def generate(self, state, request):
    self.generations.append((state, request))
    return {"text": f"summary for {state['model']}", "metadataRecord": state["metadata"]}


class CriterionHuggingFaceServerTests(unittest.TestCase):
  def setUp(self):
    self.original_worker = server.WORKER
    self.original_state = server._STATE
    self.original_model = server._MODEL
    server.WORKER = FakeWorker()
    server._STATE = None
    server._MODEL = ""

  def tearDown(self):
    server.WORKER = self.original_worker
    server._STATE = self.original_state
    server._MODEL = self.original_model

  def test_model_stays_loaded_between_requests_and_switches_explicitly(self):
    first = server.generate({"model": "model-one", "input": "first"})
    second = server.generate({"model": "model-one", "input": "second"})
    third = server.generate({"model": "model-two", "input": "third"})

    self.assertEqual(first["text"], "summary for model-one")
    self.assertEqual(second["text"], "summary for model-one")
    self.assertEqual(third["text"], "summary for model-two")
    self.assertEqual([item["model"] for item in server.WORKER.loads], ["model-one", "model-two"])
    self.assertEqual(len(server.WORKER.generations), 3)
