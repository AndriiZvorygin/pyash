import unittest
from unittest.mock import patch

import kubernetes_runtime


class FakeKubernetesApi:
  def __init__(self, ready_replicas=1, desired_replicas=1, node_name="swac", gpu_limit="1", pod_phase="Running"):
    self.ready_replicas = ready_replicas
    self.desired_replicas = desired_replicas
    self.node_name = node_name
    self.gpu_limit = gpu_limit
    self.pod_phase = pod_phase
    self.calls = []

  def request(self, entry, method, path, payload=None):
    self.calls.append((method, path, payload))
    if path.endswith("/deployments/ollama"):
      return {
        "spec": {
          "replicas": self.desired_replicas,
          "selector": {"matchLabels": {"app": "ollama"}},
          "template": {"spec": {"containers": [{
            "name": "ollama",
            "resources": {"limits": {"nvidia.com/gpu": self.gpu_limit}}
          }]}}
        },
        "status": {
          "readyReplicas": self.ready_replicas,
          "availableReplicas": self.ready_replicas
        }
      }
    if path.startswith("/api/v1/namespaces/inference/pods?"):
      return {"items": [{
        "metadata": {"labels": {"app": "ollama"}},
        "spec": {"nodeName": self.node_name},
        "status": {
          "phase": self.pod_phase,
          "containerStatuses": [{"name": "ollama", "ready": self.ready_replicas > 0}]
        }
      }]}
    if path.endswith("/deployments/ollama/scale"):
      self.desired_replicas = payload["spec"]["replicas"]
      self.ready_replicas = 0
      return {"spec": {"replicas": self.desired_replicas}}
    raise AssertionError((method, path, payload))


class KubernetesRuntimeTests(unittest.TestCase):
  def setUp(self):
    self.entry = {
      "runtimeName": "ollama",
      "kubernetesApiUrl": "https://kubernetes.example:6443",
      "kubernetesNamespace": "inference",
      "kubernetesDeployment": "ollama",
      "kubernetesNodeName": "swac"
    }

  def test_status_requires_ready_gpu_pod_on_expected_node(self):
    api = FakeKubernetesApi()
    status = kubernetes_runtime.runtime_status(self.entry, api.request)
    self.assertEqual(status["status"], "running")
    self.assertTrue(status["gpuObserved"])
    self.assertEqual(status["readyReplicas"], 1)
    self.assertEqual(status["nodeName"], "swac")

  def test_status_marks_unready_or_wrong_node_as_unavailable(self):
    pending = kubernetes_runtime.runtime_status(
      self.entry, FakeKubernetesApi(ready_replicas=0).request
    )
    wrong_node = kubernetes_runtime.runtime_status(
      self.entry, FakeKubernetesApi(node_name="mriczo").request
    )
    self.assertEqual(pending["status"], "starting")
    self.assertFalse(wrong_node["gpuObserved"])
    self.assertIn("swac", wrong_node["message"])

  def test_status_rejects_deployment_without_gpu_resource_request(self):
    status = kubernetes_runtime.runtime_status(
      self.entry, FakeKubernetesApi(gpu_limit="0").request
    )
    self.assertFalse(status["gpuObserved"])
    self.assertIn("nvidia.com/gpu", status["message"])

  def test_status_rejects_more_than_one_replica_for_single_gpu_plugin(self):
    status = kubernetes_runtime.runtime_status(
      self.entry, FakeKubernetesApi(ready_replicas=2, desired_replicas=2).request
    )
    self.assertEqual(status["status"], "invalid")
    self.assertFalse(status["gpuObserved"])
    self.assertIn("single-replica", status["message"])

  def test_scale_down_waits_until_terminating_pod_is_gone(self):
    api = FakeKubernetesApi(ready_replicas=0, desired_replicas=0)
    status = kubernetes_runtime.runtime_status(self.entry, api.request)
    self.assertEqual(status["status"], "stopping")
    self.assertEqual(status["activePodCount"], 1)
    self.assertFalse(kubernetes_runtime.wait_for_replicas(
      self.entry, 0, 0, api.request
    ))

    api.pod_phase = "Failed"
    status = kubernetes_runtime.runtime_status(self.entry, api.request)
    self.assertEqual(status["status"], "stopped")
    self.assertEqual(status["activePodCount"], 0)
    self.assertTrue(kubernetes_runtime.wait_for_replicas(
      self.entry, 0, 0, api.request
    ))

  def test_scale_changes_only_the_configured_deployment(self):
    api = FakeKubernetesApi()
    result = kubernetes_runtime.set_replicas(self.entry, 1, api.request)
    self.assertTrue(result["success"])
    self.assertEqual(api.calls[-1], (
      "PATCH",
      "/apis/apps/v1/namespaces/inference/deployments/ollama/scale",
      {"spec": {"replicas": 1}}
    ))

  def test_scale_rejects_invalid_replica_count(self):
    with self.assertRaisesRegex(ValueError, "replicas"):
      kubernetes_runtime.set_replicas(self.entry, -1, lambda *_args: {})

  def test_api_request_uses_bearer_token_and_cluster_ca(self):
    class Response:
      status = 200

      def __enter__(self):
        return self

      def __exit__(self, *_args):
        return False

      def read(self):
        return b'{"ok":true}'

    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as directory:
      token_path = Path(directory) / "token"
      ca_path = Path(directory) / "ca.crt"
      token_path.write_text("unit-test-token", encoding="utf-8")
      ca_path.write_text("unused-test-ca", encoding="utf-8")
      entry = {
        **self.entry,
        "kubernetesTokenFile": str(token_path),
        "kubernetesCaFile": str(ca_path)
      }
      captured = {}

      def fake_urlopen(request, timeout, context):
        captured["request"] = request
        captured["context"] = context
        return Response()

      with patch.object(kubernetes_runtime, "_ssl_context", return_value=object()), \
           patch.object(kubernetes_runtime, "urlopen", side_effect=fake_urlopen):
        result = kubernetes_runtime.request_json(entry, "GET", "/api/v1/nodes/swac")

    self.assertEqual(result, {"ok": True})
    self.assertEqual(captured["request"].get_header("Authorization"), "Bearer unit-test-token")
    self.assertIsNotNone(captured["context"])


if __name__ == "__main__":
  unittest.main()
