import importlib.util
import pathlib
import unittest

SERVER_PATH = pathlib.Path(__file__).with_name("server.py")
spec = importlib.util.spec_from_file_location("gpu_housekeeper_server", SERVER_PATH)
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class HousekeeperOllamaTests(unittest.TestCase):
  def setUp(self):
    self.orig_parse_runtime_status = server.parse_runtime_status
    self.orig_runtime_action = server.runtime_action
    self.orig_request_ollama_json = server.request_ollama_json
    server._PROFILES.clear()

  def tearDown(self):
    server.parse_runtime_status = self.orig_parse_runtime_status
    server.runtime_action = self.orig_runtime_action
    server.request_ollama_json = self.orig_request_ollama_json
    server._PROFILES.clear()

  def test_submit_accepts_ollama_generate_and_chat_jobs(self):
    generate = server.submit_job({
      "handleId": "handle-one",
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-generate", "payload": {"model": "qwen-test", "prompt": "hi"}}
    })
    chat = server.submit_job({
      "handleId": "handle-two",
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-chat", "payload": {"model": "qwen-test", "messages": []}}
    })
    bad = server.submit_job({
      "handleId": "handle-three",
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "sleep"}
    })

    self.assertTrue(generate["accepted"])
    self.assertTrue(chat["accepted"])
    self.assertFalse(bad["accepted"])

  def test_ollama_execution_discharges_non_target_warm_models_then_runs_target(self):
    calls = []
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": True,
      "message": "running"
    }

    def fake_request(pathname, payload=None, timeout_sec=600):
      calls.append((pathname, payload))
      if pathname == "/api/ps":
        return {"models": [{"name": "old-model"}, {"name": "qwen-test"}]}
      if pathname == "/api/generate" and payload.get("model") == "old-model":
        self.assertEqual(payload.get("keep_alive"), 0)
        return {"done": True}
      if pathname == "/api/generate":
        self.assertEqual(payload.get("model"), "qwen-test")
        self.assertEqual(payload.get("keep_alive"), 300)
        return {"response": "ok"}
      raise AssertionError(pathname)

    server.request_ollama_json = fake_request
    result = server.execute_ollama_job({
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-generate", "payload": {"model": "qwen-test", "prompt": "hi"}}
    }, {"ollama": {"runtimeName": "ollama", "gpuExpected": True}})

    self.assertEqual(result, {"response": "ok"})
    self.assertEqual(calls[0][0], "/api/ps")
    self.assertEqual(calls[1][1]["model"], "old-model")
    self.assertEqual(calls[2][1]["model"], "qwen-test")

  def test_stopped_runtime_triggers_begin_before_ollama_job(self):
    actions = []
    statuses = iter([
      {"status": "exited", "gpuExpected": True, "gpuObserved": True},
      {"status": "running", "gpuExpected": True, "gpuObserved": True}
    ])
    server.parse_runtime_status = lambda _entry: next(statuses)

    def fake_action(_registry, runtime_name, action_key):
      actions.append((runtime_name, action_key))
      return {"success": True, "status": "running", "message": "started"}

    server.runtime_action = fake_action
    server.request_ollama_json = lambda pathname, payload=None, timeout_sec=600: (
      {"models": []} if pathname == "/api/ps" else {"response": "ok"}
    )

    server.execute_ollama_job({
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-generate", "payload": {"model": "qwen-test", "prompt": "hi"}}
    }, {"ollama": {"runtimeName": "ollama", "gpuExpected": True}})

    self.assertEqual(actions, [("ollama", "beginAction")])

  def test_gpu_not_observed_triggers_restart_before_ollama_job(self):
    actions = []
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": False
    }
    server.runtime_action = lambda _registry, runtime_name, action_key: actions.append((runtime_name, action_key)) or {
      "success": True,
      "status": "running",
      "message": "restarted"
    }
    server.request_ollama_json = lambda pathname, payload=None, timeout_sec=600: (
      {"models": []} if pathname == "/api/ps" else {"response": "ok"}
    )

    server.execute_ollama_job({
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-generate", "payload": {"model": "qwen-test", "prompt": "hi"}}
    }, {"ollama": {"runtimeName": "ollama", "gpuExpected": True}})

    self.assertEqual(actions, [("ollama", "restartAction")])

  def test_job_status_returns_result_and_error_shapes(self):
    server._JOBS["ok"] = {
      "status": "success",
      "message": "completed",
      "result": {"response": "ok"},
      "error": None,
      "startedAt": "start",
      "finishedAt": "finish"
    }
    server._JOBS["fail"] = {
      "status": "fail",
      "message": "boom",
      "result": None,
      "error": {"message": "boom"},
      "startedAt": "start",
      "finishedAt": "finish"
    }

    self.assertEqual(server.job_status("ok")["result"], {"response": "ok"})
    self.assertEqual(server.job_status("fail")["error"], {"message": "boom"})


if __name__ == "__main__":
  unittest.main()
