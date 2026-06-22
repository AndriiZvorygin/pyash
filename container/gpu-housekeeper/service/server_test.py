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
    server._JOBS.clear()

  def tearDown(self):
    server.parse_runtime_status = self.orig_parse_runtime_status
    server.runtime_action = self.orig_runtime_action
    server.request_ollama_json = self.orig_request_ollama_json
    server._PROFILES.clear()
    server._JOBS.clear()

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

  def test_registered_job_executes_without_housekeeper_backlog(self):
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": True,
      "message": "running"
    }
    server.request_ollama_json = lambda pathname, payload=None, timeout_sec=600: (
      {"models": []} if pathname == "/api/ps" else {"response": "ok"}
    )

    submitted = server.submit_job({
      "handleId": "handle-direct",
      "runtimeName": "ollama",
      "profileName": "qwen-test",
      "jobSpec": {"kind": "ollama-generate", "payload": {"model": "qwen-test", "prompt": "hi"}}
    })

    self.assertTrue(submitted["accepted"])
    self.assertEqual(server.queue_depth(), 0)
    server.execute_registered_job(submitted["remoteJobId"], {"ollama": {"runtimeName": "ollama", "gpuExpected": True}})

    status = server.job_status(submitted["remoteJobId"])
    self.assertEqual(status["status"], "success")
    self.assertEqual(status["result"], {"response": "ok"})
    self.assertEqual(server.queue_depth(), 0)


class HousekeeperComfyuiTests(unittest.TestCase):
  def setUp(self):
    self.orig_parse_runtime_status = server.parse_runtime_status
    self.orig_runtime_action = server.runtime_action
    self.orig_request_comfyui_json = server.request_comfyui_json
    server._PROFILES.clear()
    server._JOBS.clear()

  def tearDown(self):
    server.parse_runtime_status = self.orig_parse_runtime_status
    server.runtime_action = self.orig_runtime_action
    server.request_comfyui_json = self.orig_request_comfyui_json
    server._PROFILES.clear()
    server._JOBS.clear()

  def test_submit_accepts_comfyui_teaching_stage_jobs(self):
    prompt = {"1": {"inputs": {}}}
    for kind in ["comfyui-draw", "comfyui-say", "comfyui-hear", "comfyui-prompt"]:
      result = server.submit_job({
        "handleId": f"handle-{kind}",
        "runtimeName": "comfyui",
        "profileName": kind,
        "jobSpec": {"kind": kind, "prompt": prompt}
      })
      self.assertTrue(result["accepted"], kind)

    bad = server.submit_job({
      "handleId": "bad",
      "runtimeName": "comfyui",
      "profileName": "draw",
      "jobSpec": {"kind": "comfyui-draw"}
    })
    self.assertFalse(bad["accepted"])

  def test_comfyui_execution_posts_prompt_and_returns_history(self):
    calls = []
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": True,
      "message": "running"
    }

    def fake_request(pathname, payload=None, timeout_sec=600):
      calls.append((pathname, payload))
      if pathname == "/prompt":
        self.assertEqual(payload["prompt"], {"1": {"inputs": {"text": "hello"}}})
        return {"prompt_id": "prompt-1"}
      if pathname == "/history/prompt-1":
        return {
          "prompt-1": {
            "status": {"completed": True, "status_str": "success"},
            "outputs": {"9": {"audio": [{"filename": "voice.wav"}]}}
          }
        }
      raise AssertionError(pathname)

    server.request_comfyui_json = fake_request
    result = server.execute_comfyui_job({
      "runtimeName": "comfyui",
      "profileName": "qwen-say",
      "jobSpec": {
        "kind": "comfyui-say",
        "prompt": {"1": {"inputs": {"text": "hello"}}}
      }
    }, {"comfyui": {"runtimeName": "comfyui", "gpuExpected": True}})

    self.assertEqual(calls[0][0], "/prompt")
    self.assertEqual(calls[1][0], "/history/prompt-1")
    self.assertEqual(result["promptId"], "prompt-1")
    self.assertEqual(result["kind"], "comfyui-say")
    self.assertIn("history", result)
    self.assertTrue(server._PROFILES["qwen-say"]["loaded"])

  def test_comfyui_stopped_runtime_triggers_begin(self):
    actions = []
    statuses = iter([
      {"status": "exited", "gpuExpected": True, "gpuObserved": True},
      {"status": "running", "gpuExpected": True, "gpuObserved": True}
    ])
    server.parse_runtime_status = lambda _entry: next(statuses)
    server.runtime_action = lambda _registry, runtime_name, action_key: actions.append((runtime_name, action_key)) or {
      "success": True,
      "status": "running",
      "message": "started"
    }
    server.request_comfyui_json = lambda pathname, payload=None, timeout_sec=600: (
      {"prompt_id": "prompt-1"} if pathname == "/prompt" else {"prompt-1": {"outputs": {"1": {}}}}
    )

    server.execute_comfyui_job({
      "runtimeName": "comfyui",
      "profileName": "draw",
      "jobSpec": {"kind": "comfyui-draw", "prompt": {"1": {"inputs": {}}}}
    }, {"comfyui": {"runtimeName": "comfyui", "gpuExpected": True}})

    self.assertEqual(actions, [("comfyui", "beginAction")])


class HousekeeperKatagoTests(unittest.TestCase):
  def setUp(self):
    self.orig_parse_runtime_status = server.parse_runtime_status
    self.orig_runtime_action = server.runtime_action
    self.orig_docker_exec_json_line = server.docker_exec_json_line
    server._PROFILES.clear()
    server._JOBS.clear()

  def tearDown(self):
    server.parse_runtime_status = self.orig_parse_runtime_status
    server.runtime_action = self.orig_runtime_action
    server.docker_exec_json_line = self.orig_docker_exec_json_line
    server._PROFILES.clear()
    server._JOBS.clear()

  def test_submit_accepts_katago_analysis_and_lifecycle_jobs(self):
    query = {"id": "q", "moves": [["B", "pd"]], "rules": "tromp-taylor"}
    analyze = server.submit_job({
      "handleId": "katago-one",
      "runtimeName": "katago",
      "profileName": "default",
      "jobSpec": {"kind": "katago-analyze", "query": query}
    })
    begin = server.submit_job({
      "handleId": "katago-two",
      "runtimeName": "katago",
      "profileName": "default",
      "jobSpec": {"kind": "katago-begin"}
    })
    bad = server.submit_job({
      "handleId": "katago-three",
      "runtimeName": "katago",
      "profileName": "default",
      "jobSpec": {"kind": "katago-analyze"}
    })

    self.assertTrue(analyze["accepted"])
    self.assertTrue(begin["accepted"])
    self.assertFalse(bad["accepted"])

  def test_katago_analysis_executes_inside_runtime_container(self):
    calls = []
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": True,
      "message": "running"
    }

    def fake_exec(container_name, args, payload, timeout_sec):
      calls.append((container_name, args, payload, timeout_sec))
      return {"id": payload["id"], "moveInfos": [{"move": "Q16", "visits": 8, "winrate": 0.6}]}

    server.docker_exec_json_line = fake_exec
    result = server.execute_katago_job({
      "runtimeName": "katago",
      "profileName": "default",
      "jobSpec": {
        "kind": "katago-analyze",
        "query": {"id": "q", "moves": [["B", "pd"]]},
        "timeoutSec": 33
      }
    }, {"katago": {"runtimeName": "katago", "containerName": "katago", "gpuExpected": True}})

    self.assertEqual(result["moveInfos"][0]["move"], "Q16")
    self.assertEqual(calls[0][0], "katago")
    self.assertIn("analysis", calls[0][1])
    self.assertEqual(calls[0][2]["id"], "q")
    self.assertEqual(calls[0][3], 33)
    self.assertTrue(server._PROFILES["default"]["loaded"])

  def test_katago_lifecycle_uses_runtime_actions(self):
    actions = []
    server.parse_runtime_status = lambda _entry: {
      "status": "running",
      "gpuExpected": True,
      "gpuObserved": True,
      "message": "running"
    }
    server.runtime_action = lambda _registry, runtime_name, action_key: actions.append((runtime_name, action_key)) or {
      "success": True,
      "status": "running",
      "message": action_key
    }

    registry = {"katago": {"runtimeName": "katago", "containerName": "katago", "gpuExpected": True}}
    begin = server.execute_katago_job({"runtimeName": "katago", "profileName": "default", "jobSpec": {"kind": "katago-begin"}}, registry)
    discharge = server.execute_katago_job({"runtimeName": "katago", "profileName": "default", "jobSpec": {"kind": "katago-discharge"}}, registry)
    restart = server.execute_katago_job({"runtimeName": "katago", "profileName": "default", "jobSpec": {"kind": "katago-restart"}}, registry)

    self.assertEqual(begin["message"], "katago begun")
    self.assertEqual(discharge["message"], "katago discharged")
    self.assertEqual(restart["message"], "katago restarted")
    self.assertEqual(actions, [("katago", "stopAction"), ("katago", "restartAction")])


if __name__ == "__main__":
  unittest.main()
