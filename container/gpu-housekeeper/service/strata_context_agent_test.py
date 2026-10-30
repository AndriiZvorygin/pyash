import importlib.util
import io
import pathlib
import tempfile
import threading
import sys
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

SERVICE_DIR = pathlib.Path(__file__).parent
sys.path.insert(0, str(SERVICE_DIR))
HELPER_PATH = SERVICE_DIR / "strata_context_helper.py"
helper_spec = importlib.util.spec_from_file_location("strata_context_helper", HELPER_PATH)
helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helper)

AGENT_PATH = SERVICE_DIR / "strata_context_agent.py"
agent_spec = importlib.util.spec_from_file_location("strata_context_agent", AGENT_PATH)
agent = importlib.util.module_from_spec(agent_spec)
agent_spec.loader.exec_module(agent)
CLIENT_PATH = SERVICE_DIR / "strata_context_client.py"
client_spec = importlib.util.spec_from_file_location("strata_context_client", CLIENT_PATH)
client = importlib.util.module_from_spec(client_spec)
client_spec.loader.exec_module(client)


class StrataContextAgentTests(unittest.TestCase):
  def settings(self):
    return {
      "config": "/tmp/strata-profile.json",
      "unit": "strata.service",
      "options": [8192, 32768, 65536],
      "health_url": "http://127.0.0.1:8081/health",
      "timeout": 180
    }

  def test_context_agent_only_restarts_allowlisted_sizes(self):
    settings = self.settings()
    with patch.object(agent.strata_context_helper, "reconfigure", return_value={"success": True, "contextLength": 65536}) as restart:
      self.assertEqual(agent.change_context(65536, settings)["contextLength"], 65536)
      restart.assert_called_once_with(settings["config"], 65536, settings["unit"], settings["health_url"], 180)
      with self.assertRaisesRegex(ValueError, "unsupported context length"):
        agent.change_context(16384, settings)
      with self.assertRaisesRegex(ValueError, "must be an integer"):
        agent.change_context(True, settings)
      self.assertEqual(restart.call_count, 1)

  def test_agent_options_are_bounded_and_deduplicated(self):
    with patch.dict(agent.os.environ, {"GPU_HOUSEKEEPER_STRATA_CONTEXT_OPTIONS": "8192,32768,32768,999999,nope"}):
      self.assertEqual(agent.configured_options(), [8192, 32768])

  def test_unix_socket_client_reaches_agent_and_restarts_configured_context(self):
    with tempfile.TemporaryDirectory() as directory:
      socket_path = str(pathlib.Path(directory) / "agent.sock")
      settings = self.settings()
      agent.ContextHandler.settings = settings
      httpd = agent.UnixHTTPServer(socket_path, agent.ContextHandler)
      thread = threading.Thread(target=httpd.serve_forever, daemon=True)
      thread.start()
      try:
        output = io.StringIO()
        with patch.object(agent.strata_context_helper, "reconfigure", return_value={"success": True, "contextLength": 65536}) as restart, \
             patch.object(sys, "argv", ["strata_context_client.py", "--socket", socket_path, "--context", "65536"]), \
             redirect_stdout(output):
          self.assertEqual(client.main(), 0)
        self.assertEqual(restart.call_count, 1)
        self.assertIn('"contextLength": 65536', output.getvalue())
      finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
  unittest.main()
