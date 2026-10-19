# Host disk cleanup

`run-disk-housekeeping.sh` handles reporter artifacts under `/home`. Root
filesystem pressure is usually Docker build output or old Snap revisions, so
the host cleanup command is separate:

```bash
cd /home/htaf/pyash
./run-host-disk-cleanup.sh              # read-only report
./run-host-disk-cleanup.sh --json       # machine-readable report
./run-host-disk-cleanup.sh --apply      # execute safe cleanup actions
```

`--apply` removes dangling Docker images, Docker build cache older than seven
days, disabled Snap revisions, and apt’s downloaded package cache. It does not
stop containers, remove active/tagged images, or delete reporter artifacts.

Reporter housekeeping also prunes the configured fresh-library caches after 30
days and keeps each cache below its configured size cap. The active policy
includes both the shared cache and Owen Sound’s nested cache, so a reporter
cannot silently move a large disposable cache outside the cleanup path.

Virtual-machine disks under `/opt/vm` are intentionally outside this cleanup
policy. Review and remove those only after confirming that the corresponding
VM is no longer needed.
