"""Small, least-privilege Kubernetes adapter for Housekeeper-managed runtimes."""

import json
import os
import ssl
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


SERVICE_ACCOUNT_ROOT = "/var/run/secrets/kubernetes.io/serviceaccount"
RequestJson = Callable[[Dict[str, Any], str, str, Optional[Dict[str, Any]]], Dict[str, Any]]


def _required(entry: Dict[str, Any], field: str) -> str:
  value = str(entry.get(field) or "").strip()
  if not value:
    raise RuntimeError(f"Kubernetes runtime requires {field}")
  return value


def _api_url(entry: Dict[str, Any]) -> str:
  base = str(
    entry.get("kubernetesApiUrl")
    or os.environ.get("KUBERNETES_API_URL")
    or ""
  ).strip().rstrip("/")
  if not base:
    host = os.environ.get("KUBERNETES_SERVICE_HOST", "").strip()
    port = os.environ.get("KUBERNETES_SERVICE_PORT", "443").strip() or "443"
    if host:
      base = f"https://{host}:{port}"
  if not base.startswith("https://"):
    raise RuntimeError("Kubernetes API URL must use HTTPS")
  return base


def _token(entry: Dict[str, Any]) -> str:
  path = str(
    entry.get("kubernetesTokenFile")
    or os.environ.get("KUBERNETES_TOKEN_FILE")
    or f"{SERVICE_ACCOUNT_ROOT}/token"
  ).strip()
  try:
    token = Path(path).read_text(encoding="utf-8").strip()
  except OSError as err:
    raise RuntimeError(f"could not read Kubernetes API token file: {err}") from err
  if not token:
    raise RuntimeError("Kubernetes API token file is empty")
  return token


def _ssl_context(entry: Dict[str, Any]) -> ssl.SSLContext:
  ca_file = str(
    entry.get("kubernetesCaFile")
    or os.environ.get("KUBERNETES_CA_FILE")
    or f"{SERVICE_ACCOUNT_ROOT}/ca.crt"
  ).strip()
  try:
    return ssl.create_default_context(cafile=ca_file)
  except OSError as err:
    raise RuntimeError(f"could not load Kubernetes API CA file: {err}") from err


def request_json(
  entry: Dict[str, Any],
  method: str,
  path: str,
  payload: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
  body = None if payload is None else json.dumps(payload).encode("utf-8")
  content_type = "application/merge-patch+json" if method.upper() == "PATCH" else "application/json"
  request = Request(
    f"{_api_url(entry)}{path}",
    data=body,
    method=method.upper(),
    headers={
      "Authorization": f"Bearer {_token(entry)}",
      "Accept": "application/json",
      "Content-Type": content_type
    }
  )
  try:
    with urlopen(request, timeout=10, context=_ssl_context(entry)) as response:
      raw = response.read().decode("utf-8")
  except HTTPError as err:
    detail = err.read().decode("utf-8", errors="replace")
    raise RuntimeError(f"Kubernetes API request failed ({err.code}): {detail or err.reason}") from err
  except URLError as err:
    raise RuntimeError(f"Kubernetes API request failed: {err.reason}") from err
  try:
    parsed = json.loads(raw or "{}")
  except json.JSONDecodeError as err:
    raise RuntimeError("Kubernetes API returned invalid JSON") from err
  if not isinstance(parsed, dict):
    raise RuntimeError("Kubernetes API returned a non-object response")
  return parsed


def _deployment_path(entry: Dict[str, Any]) -> str:
  namespace = quote(_required(entry, "kubernetesNamespace"), safe="")
  deployment = quote(_required(entry, "kubernetesDeployment"), safe="")
  return f"/apis/apps/v1/namespaces/{namespace}/deployments/{deployment}"


def _gpu_request(deployment: Dict[str, Any]) -> int:
  template = deployment.get("spec", {}).get("template", {})
  pod_spec = template.get("spec", {}) if isinstance(template, dict) else {}
  containers = pod_spec.get("containers", []) if isinstance(pod_spec, dict) else []
  total = 0
  for container in containers:
    if not isinstance(container, dict):
      continue
    resources = container.get("resources", {})
    limits = resources.get("limits", {}) if isinstance(resources, dict) else {}
    raw = limits.get("nvidia.com/gpu", 0) if isinstance(limits, dict) else 0
    try:
      total += int(raw)
    except (TypeError, ValueError):
      continue
  return total


def runtime_status(
  entry: Dict[str, Any],
  request: Optional[RequestJson] = None
) -> Dict[str, Any]:
  request = request or request_json
  path = _deployment_path(entry)
  deployment = request(entry, "GET", path)
  spec = deployment.get("spec") if isinstance(deployment.get("spec"), dict) else {}
  status = deployment.get("status") if isinstance(deployment.get("status"), dict) else {}
  desired = max(0, int(spec.get("replicas", 1) or 0))
  ready = max(0, int(status.get("readyReplicas", 0) or 0))
  available = max(0, int(status.get("availableReplicas", ready) or 0))
  gpu_count = _gpu_request(deployment)

  labels = spec.get("selector", {}).get("matchLabels", {})
  if not isinstance(labels, dict) or not labels:
    raise RuntimeError("Kubernetes Ollama Deployment must define selector.matchLabels")
  selector = ",".join(f"{key}={value}" for key, value in sorted(labels.items()))
  namespace = quote(_required(entry, "kubernetesNamespace"), safe="")
  query = urlencode({"labelSelector": selector})
  pods_response = request(entry, "GET", f"/api/v1/namespaces/{namespace}/pods?{query}")
  pods = pods_response.get("items") if isinstance(pods_response.get("items"), list) else []
  expected_node = str(entry.get("kubernetesNodeName") or "").strip()
  pod_node = ""
  pod_ready = False
  active_pod_count = 0
  for pod in pods:
    if not isinstance(pod, dict):
      continue
    pod_spec = pod.get("spec") if isinstance(pod.get("spec"), dict) else {}
    pod_status = pod.get("status") if isinstance(pod.get("status"), dict) else {}
    if pod_status.get("phase") not in {"Succeeded", "Failed"}:
      active_pod_count += 1
    node = str(pod_spec.get("nodeName") or "").strip()
    container_statuses = pod_status.get("containerStatuses", [])
    ready_containers = bool(container_statuses) and all(
      isinstance(item, dict) and item.get("ready") is True
      for item in container_statuses
    )
    if pod_status.get("phase") == "Running" and ready_containers:
      pod_node = node
      pod_ready = True
      break
    if not pod_node:
      pod_node = node

  if desired > 1 or (desired > 0 and gpu_count != 1):
    state = "invalid"
  elif desired == 0:
    state = "stopped" if active_pod_count == 0 else "stopping"
  elif ready == 1 and available == 1 and active_pod_count == 1 and pod_ready:
    state = "running"
  else:
    state = "starting"

  node_matches = not expected_node or pod_node == expected_node
  gpu_observed = state == "running" and gpu_count >= 1 and node_matches and pod_ready
  if desired > 1:
    message = "Kubernetes Ollama Deployment exceeds the single-replica host plugin limit"
  elif desired > 0 and gpu_count != 1:
    message = "Kubernetes Ollama Deployment must reserve exactly one nvidia.com/gpu"
  elif expected_node and pod_node and not node_matches:
    message = f"Kubernetes Ollama pod is on {pod_node}, expected {expected_node}"
  elif expected_node and not pod_node and state != "stopped":
    message = f"Kubernetes Ollama pod is not assigned to expected node {expected_node}"
  elif state == "stopping":
    message = f"Kubernetes Ollama Deployment is stopping ({active_pod_count} active pod(s) remain)"
  else:
    message = f"Kubernetes Ollama Deployment {state} ({ready}/{desired} ready)"
  return {
    "status": state,
    "gpuObserved": gpu_observed,
    "desiredReplicas": desired,
    "readyReplicas": ready,
    "availableReplicas": available,
    "activePodCount": active_pod_count,
    "gpuRequestCount": gpu_count,
    "nodeName": pod_node,
    "message": message
  }


def set_replicas(
  entry: Dict[str, Any],
  replicas: int,
  request: Optional[RequestJson] = None
) -> Dict[str, Any]:
  if replicas not in {0, 1}:
    raise ValueError("Kubernetes Ollama replicas must be 0 or 1 for the single-GPU host plugin")
  request = request or request_json
  namespace = quote(_required(entry, "kubernetesNamespace"), safe="")
  deployment = quote(_required(entry, "kubernetesDeployment"), safe="")
  request(
    entry,
    "PATCH",
    f"/apis/apps/v1/namespaces/{namespace}/deployments/{deployment}/scale",
    {"spec": {"replicas": replicas}}
  )
  return {
    "success": True,
    "status": "stopping" if replicas == 0 else "starting",
    "message": f"scaled Kubernetes Deployment {deployment} to {replicas} replica(s)"
  }


def wait_for_replicas(
  entry: Dict[str, Any],
  replicas: int,
  timeout_sec: float,
  request: Optional[RequestJson] = None
) -> bool:
  request = request or request_json
  deadline = time.monotonic() + max(0.0, timeout_sec)
  while True:
    observed = runtime_status(entry, request)
    if (
      replicas == 0
      and observed["desiredReplicas"] == 0
      and observed["readyReplicas"] == 0
      and observed["activePodCount"] == 0
    ):
      return True
    if replicas == 1 and observed["status"] == "running" and observed["gpuObserved"]:
      return True
    if time.monotonic() >= deadline:
      return False
    time.sleep(min(1.0, max(0.05, deadline - time.monotonic())))


def restart(
  entry: Dict[str, Any],
  timeout_sec: float,
  request: Optional[RequestJson] = None
) -> Dict[str, Any]:
  request = request or request_json
  set_replicas(entry, 0, request)
  if not wait_for_replicas(entry, 0, timeout_sec / 2, request):
    return {"success": False, "status": "timeout", "message": "Kubernetes Ollama pod did not stop for restart"}
  set_replicas(entry, 1, request)
  if not wait_for_replicas(entry, 1, timeout_sec / 2, request):
    return {"success": False, "status": "timeout", "message": "Kubernetes Ollama pod did not become GPU-ready after restart"}
  return {"success": True, "status": "running", "message": "Kubernetes Ollama Deployment restarted and is GPU-ready"}
