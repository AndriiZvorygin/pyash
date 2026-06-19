# KataGo Remote Runtime

This container is meant for a remote GPU host such as `mriczo` or `swac`. Local Pyash does not need KataGo installed; it enqueues durable GPU work and a `gpu_worker` submits jobs to the remote `gpu-housekeeper`.

## Files

- `Dockerfile` - installs a pinned KataGo binary (`v1.16.5` by default).
- `service/compose.yaml` - long-running container used by `gpu-housekeeper` through `docker exec`.
- `service/compose.gpu.yaml` - GPU override.
- `command/begin.sh` / `command/stop.sh` - start and stop the remote runtime.

## Remote Setup

1. Put KataGo neural net files on the remote host, for example `container/katago/models/default.bin.gz`.
2. Put an analysis config at `container/katago/configure/analysis.cfg`, or set `KATAGO_CONFIG_PATH` for `gpu-housekeeper`.
3. Start the runtime on the remote host:

```sh
./container/katago/command/begin.sh
```

4. Start or restart `gpu-housekeeper` on the same host with Docker socket access. The default registry includes a `katago` runtime named `katago`.
5. On the Pyash side, point the worker at that host:

```sh
PYA_GPU_HOUSEKEEPER_URL=http://mriczo:8090 node command/gpu_worker.mjs --world world
```

Use `http://swac:8090` instead when the runtime lives on `swac`.

## Housekeeper Defaults

`katago-analyze` runs:

```sh
docker exec -i katago katago analysis -model /models/<profile>.bin.gz -config /katago/analysis.cfg
```

Override model/config per job with `modelPath` and `configPath`, or globally for the remote housekeeper with `KATAGO_MODEL_PATH` and `KATAGO_CONFIG_PATH`.
