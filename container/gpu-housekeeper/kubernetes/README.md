# Kubernetes GPU Housekeeper Pilot

This pilot keeps Mriczo Housekeeper as the placement authority. SWAC remains a
Housekeeper peer, but its Ollama process is managed by a K3s Deployment and
requests the NVIDIA GPU through Kubernetes. Mac Studio remains an external
native Housekeeper peer. The coordinator's selection policy and peer HTTP
contract do not change.

## Host layout

- Mriczo: K3s server/control plane and existing Housekeeper coordinator. Keep
  the Mriczo GPU outside this first Kubernetes migration.
- SWAC: K3s agent and the first GPU workload node. The pilot reserves its GPU
  for the Kubernetes-managed Ollama Deployment; route other GPU runtimes to
  Mriczo or Mac Studio while this pilot is active.
- Mac Studio: unchanged external Housekeeper peer.

## GPU prerequisites

K3s uses containerd. On SWAC, ensure the existing NVIDIA driver and
`nvidia-container-runtime` are available to K3s before installing the NVIDIA
device plugin. K3s detects installed alternate runtimes and provides the
`nvidia` RuntimeClass; with the default containerd runtime, the Ollama Pod
requests `runtimeClassName: nvidia`. The device plugin then advertises
`nvidia.com/gpu` for pod scheduling. This is based on the [K3s NVIDIA runtime
instructions](https://docs.k3s.io/advanced#nvidia-container-runtime) and the
[NVIDIA Kubernetes device plugin](https://github.com/NVIDIA/k8s-device-plugin).

Do not install another GPU driver over the existing host driver. The SWAC
prerequisite audit found `/usr/bin/nvidia-container-runtime` and
`/usr/bin/nvidia-ctk`; K3s must discover that runtime when its agent starts.
If K3s does not advertise a GPU after setup, stop here and repair
containerd/runtime discovery before starting the Ollama Pod.

## Cluster setup

Pin both K3s hosts to the same stable release. Mriczo is the server; keep it
out of workload placement so its current Housekeeper-managed GPU is unaffected.
Configure the server certificate with the name SWAC will use for the API:

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.37.2+k3s1' \
  sh -s - server --tls-san mriczo \
  --node-ip 192.168.133.71 --advertise-address 192.168.133.71 \
  --node-taint node-role.kubernetes.io/control-plane=true:NoSchedule
```

Join SWAC as an agent using the server's `/var/lib/rancher/k3s/server/node-token`
and a trusted Mriczo address reachable from SWAC:

```sh
sudo install -d -o root -g root -m 0755 /home/htaf/hven/hmas/k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.37.2+k3s1' \
  K3S_URL='https://mriczo:6443' K3S_TOKEN='SET_OUTSIDE_THE_REPOSITORY' \
  sh -s - agent --data-dir /home/htaf/hven/hmas/k3s \
  --kube-proxy-arg=nodeport-addresses=172.17.0.1/32
```

SWAC currently has about 16 GB free on `/` and 312 GB free on `/home`; the
agent's `--data-dir` keeps K3s/containerd image layers on the larger volume.
The temporary image archive is also placed under `/home`, not `/tmp` on the
smaller root filesystem.

The addresses above match the current host inventory: `mriczo` resolves from
SWAC to `192.168.133.71`, SWAC's Docker `host-gateway` is `172.17.0.1`, and
SWAC is pinned as `192.168.133.245`. Re-check these values before install.
The agent's kube-proxy restriction makes NodePort `31143` reachable only via
the Docker host-gateway address; the Ollama Service also uses
`externalTrafficPolicy: Local`. Do not broaden that address range to the
physical LAN interfaces.

Before install, restrict Mriczo TCP `6443` to SWAC (`192.168.133.245`) and
allow K3s Flannel VXLAN UDP `8472` only between the two node addresses
(`192.168.133.71` and `192.168.133.245`). The current host audit found
`INPUT ACCEPT` and no UFW on either machine, so allow rules alone would not
protect these ports; install and validate a restrictive host/network firewall
policy before bringing up the API server. Never expose UDP `8472` publicly.
Verify `kubectl get nodes -o wide` shows Mriczo and SWAC Ready before
continuing. Labeling is unnecessary for the initial manifest, which pins to
the observed SWAC hostname.

Install the NVIDIA device plugin at a pinned release rather than applying a
floating `latest` manifest, then verify that the SWAC node advertises one GPU:

```sh
kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.20.1/deployments/static/nvidia-device-plugin.yml
kubectl -n kube-system rollout status daemonset/nvidia-device-plugin-daemonset --timeout=3m
kubectl get nodes -o custom-columns=NAME:.metadata.name,GPU:.status.allocatable.nvidia\\.com/gpu
```

## Preserve the existing model store

The SWAC Ollama container currently stores its model files at
`/home/htaf/hven/hmas/ollama_data`. The Deployment mounts that same directory,
so model weights are reused rather than copied or pulled again. It also keeps
the existing `/home/htaf/liberit/hmas/models` mount at `/models`. If either
host directory moves, update the corresponding `hostPath` in
`swac-ollama.yaml` before applying it.

K3s has its own containerd image store. Import the exact currently deployed
Ollama image once, without starting a second GPU instance:

```sh
docker save liberit/ollama:0.34.1-cuda12.2-sm86-clean -o /home/htaf/hven/hmas/pyash-ollama.tar
sudo k3s ctr images import /home/htaf/hven/hmas/pyash-ollama.tar
rm -f /home/htaf/hven/hmas/pyash-ollama.tar
```

Apply the namespace/RBAC and Deployment manifests only after confirming no
SWAC Ollama inference is running. During cutover, stop the Compose Ollama
container first, verify its model store remains mounted, then apply the
Kubernetes Deployment:

```sh
kubectl apply -f container/gpu-housekeeper/kubernetes/housekeeper-rbac.yaml
kubectl apply -f container/gpu-housekeeper/kubernetes/swac-ollama.yaml
kubectl -n pyash-inference rollout status deployment/ollama --timeout=5m
kubectl -n pyash-inference get pods -o wide
```

Restrict NodePort `31143` to the SWAC host's trusted Housekeeper/container
network. Do not expose the unauthenticated Ollama API to the public network.

## Configure SWAC Housekeeper

Copy the service-account token and CA from the `housekeeper-scheduler-token`
Secret to `/etc/pyash/gpu-housekeeper/kubernetes/token` and
`/etc/pyash/gpu-housekeeper/kubernetes/ca.crt` on SWAC, where Compose mounts
them into the Housekeeper container. These credentials are deliberately
absent from Git. They grant only deployment/pod observation and scale control
for the `ollama` Deployment in `pyash-inference`. Run these commands on
Mriczo; they stream credentials directly to SWAC without printing them or
putting them in shell history:

```sh
set -eu
umask 077
local_tmp=$(mktemp -d)
remote_tmp=$(ssh swac 'mktemp -d')
cleanup() {
  rm -f "$local_tmp/token" "$local_tmp/ca.crt"
  rmdir "$local_tmp"
  ssh swac "rm -f '$remote_tmp/token' '$remote_tmp/ca.crt'; rmdir '$remote_tmp'" || true
}
trap cleanup EXIT
kubectl -n pyash-inference get secret housekeeper-scheduler-token \
  -o jsonpath='{.data.token}' | base64 -d > "$local_tmp/token"
kubectl -n pyash-inference get secret housekeeper-scheduler-token \
  -o jsonpath='{.data.ca\.crt}' | base64 -d > "$local_tmp/ca.crt"
scp "$local_tmp/token" "$local_tmp/ca.crt" "swac:$remote_tmp/"
ssh -t swac "sudo install -d -m 0700 /etc/pyash/gpu-housekeeper/kubernetes && sudo install -m 0600 '$remote_tmp/token' /etc/pyash/gpu-housekeeper/kubernetes/token && sudo install -m 0644 '$remote_tmp/ca.crt' /etc/pyash/gpu-housekeeper/kubernetes/ca.crt"
```

Rotate the service-account token using the cluster's documented token
rotation procedure. Do not copy it into this repository or a shared artifact.

Set SWAC's existing Housekeeper runtime registry entry to:

```json
{
  "runtimeName": "ollama",
  "runtimeMode": "kubernetes-ollama",
  "actionDriver": "kubernetes",
  "kubernetesApiUrl": "https://mriczo:6443",
  "kubernetesTokenFile": "/run/kubernetes/token",
  "kubernetesCaFile": "/run/kubernetes/ca.crt",
  "kubernetesNamespace": "pyash-inference",
  "kubernetesDeployment": "ollama",
  "kubernetesNodeName": "swac",
  "exclusiveHostGpu": true,
  "gpuExpected": true,
  "dischargeKind": "ollama"
}
```

Set `OLLAMA_RUNTIME_URL=http://host.docker.internal:31143` for the SWAC
Housekeeper service. The `exclusiveHostGpu` setting tells local and federated
Housekeepers to keep other SWAC GPU runtimes off the single device while this
Deployment is scheduled or its pod is still terminating. Its existing
`/snapshot`, `/capacity/preview`, `/submit`, and `/job/{id}` endpoints remain
the peer interface used by Mriczo. Set the following in SWAC's untracked
Housekeeper environment file before recreating that service:

```sh
GPU_HOUSEKEEPER_KUBERNETES_CREDENTIALS_DIR=/etc/pyash/gpu-housekeeper/kubernetes
OLLAMA_RUNTIME_URL=http://host.docker.internal:31143
```

On hosts without a Kubernetes runtime this credential mount defaults to the
Housekeeper's local `service/state/kubernetes` directory and contains no
credentials.

## Verification and rollback

Verify these before routing production requests:

1. `kubectl get node swac -o jsonpath='{.status.allocatable.nvidia\.com/gpu}'`
   reports one GPU, and the Ollama pod is Ready on SWAC.
2. SWAC Housekeeper `/snapshot` reports Ollama running, GPU observed, and the
   configured node name. `/runtime/ollama/models` still lists the existing
   model tags.
3. Mriczo `/snapshot` sees SWAC and Mac Studio; a real `qwen3.5:9b` request
   routed to SWAC completes and records the same source, timing, and throughput
   observations as other Housekeeper peers.
4. A deliberately unavailable Ollama pod makes SWAC ineligible, and a request
   falls back to another eligible host. Restore the pod after this test.
5. A SWAC runtime other than Ollama is ineligible while the exclusive GPU
   reservation is active; after the Deployment is fully stopped, it can be
   considered normally.

Rollback: stop the Kubernetes Ollama Deployment, restore the saved SWAC
Housekeeper runtime registry and `OLLAMA_RUNTIME_URL`, then start the original
Compose `ollama` service. Both runtimes use the same model directory; never
run both simultaneously on SWAC's GPU.
