use super::*;
use sha2::{Digest, Sha256};
use std::ffi::{CStr, c_char, c_int, c_void};
use std::ptr::{from_mut, null_mut};
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::time::Duration;

#[path = "cuda/driver.rs"]
mod driver;
use driver::{Buffer, Driver, Event, Handle, check};

pub(crate) const BACKEND: &str = "rust-cuda-cubin";
const LOAD_LIMIT: Duration = Duration::from_secs(59);
const REQUIRED_KERNELS: [&CStr; 3] = [
    c"execute_pyac_pack",
    c"execute_pyac_programlet",
    c"execute_pyac_sections",
];

fn artifact(bytes: &[u8], expected: &str) -> Result<(), String> {
    // NVIDIA emits standalone cubins as little-endian ELF64 with EM_CUDA (190).
    if bytes.len() < 64 || bytes[..6] != *b"\x7fELF\x02\x01" || bytes[18..20] != [190, 0] {
        return Err("CUDA artifact must be an ELF64 cubin, not PTX or a fatbin".to_owned());
    }
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return Err("CUDA cubin SHA-256 differs from the packaged worker".to_owned());
    }
    Ok(())
}

type Reply = (Result<Value, String>, GpuExecutionTiming);
type Work = (Vec<u8>, SyncSender<Reply>);

fn wait_for_device(
    initialized: Receiver<Result<String, String>>,
    limit: Duration,
) -> Result<String, String> {
    initialized
        .recv_timeout(limit)
        .map_err(|error| format!("CUDA initialization failed before readiness: {error}"))?
}

pub(crate) struct CudaRuntime {
    device_name: String,
    worker: SyncSender<Work>,
}

impl CudaRuntime {
    pub(crate) fn new(path: PathBuf) -> Result<Self, String> {
        let expected = option_env!("PYAC_VLIW_BUILD_CUBIN_SHA256")
            .ok_or("CUDA worker was not built with a packaged cubin hash")?;
        let (ready, initialized) = sync_channel(1);
        let (worker, jobs) = sync_channel::<Work>(1);
        std::thread::Builder::new()
            .name("pyac-vliw-cuda".to_owned())
            .spawn(move || match CudaDevice::new(&path, expected) {
                Ok(device) => {
                    if ready.send(Ok(device.name.clone())).is_ok() {
                        while let Ok((pack, reply)) = jobs.recv() {
                            let _ = reply.send(device.execute(&pack));
                        }
                    }
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                }
            })
            .map_err(|error| format!("could not start CUDA owner thread: {error}"))?;
        let device_name = wait_for_device(initialized, LOAD_LIMIT)?;
        Ok(Self {
            device_name,
            worker,
        })
    }

    pub(crate) fn device_name(&self) -> &str {
        &self.device_name
    }

    pub(crate) fn execute(&self, pack: Vec<u8>) -> Reply {
        let (reply, result) = sync_channel(1);
        if self.worker.send((pack, reply)).is_ok()
            && let Ok(response) = result.recv()
        {
            return response;
        }
        (
            Err("CUDA owner thread unavailable".to_owned()),
            GpuExecutionTiming::default(),
        )
    }
}

struct CudaDevice {
    driver: Driver,
    ordinal: c_int,
    name: String,
    module: Handle,
    kernels: [Handle; 3],
}

impl CudaDevice {
    fn new(path: &Path, expected: &str) -> Result<Self, String> {
        let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
        artifact(&bytes, expected)?;
        let driver = Driver::load()?;
        let mut ordinal = 0;
        let mut name: [c_char; 256] = [0; 256];
        let mut major = 0;
        let mut minor = 0;
        let mut context = null_mut();
        unsafe {
            check((driver.init)(0), "initialize driver")?;
            check((driver.get_device)(&mut ordinal, 0), "find visible device")?;
            check(
                (driver.get_attribute)(&mut major, 75, ordinal),
                "compute capability major",
            )?;
            check(
                (driver.get_attribute)(&mut minor, 76, ordinal),
                "compute capability minor",
            )?;
            if (major, minor) != (8, 6) {
                return Err(format!(
                    "CUDA cubin targets sm_86, device is sm_{major}{minor}"
                ));
            }
            check(
                (driver.get_name)(name.as_mut_ptr(), 255, ordinal),
                "read device name",
            )?;
            check(
                (driver.retain)(&mut context, ordinal),
                "retain device context",
            )?;
        }
        let mut device = Self {
            driver,
            ordinal,
            name: unsafe { CStr::from_ptr(name.as_ptr()) }
                .to_string_lossy()
                .into_owned(),
            module: null_mut(),
            kernels: [null_mut(); 3],
        };
        unsafe {
            check((device.driver.set_current)(context), "set current context")?;
            check(
                (device.driver.load_module)(&mut device.module, bytes.as_ptr().cast()),
                "load cubin",
            )?;
            for (name, handle) in REQUIRED_KERNELS.iter().zip(&mut device.kernels) {
                check(
                    (device.driver.get_function)(handle, device.module, name.as_ptr()),
                    &format!("resolve {}", name.to_string_lossy()),
                )?;
            }
        }
        Ok(device)
    }

    fn execute(&self, pack: &[u8]) -> Reply {
        let started = Instant::now();
        let decoded = decode_pack(pack);
        let mut timing = GpuExecutionTiming {
            pack_decode_ms: elapsed(started),
            ..Default::default()
        };
        let result = match decoded {
            Ok(pack) => self.execute_codelets(&pack.codelets, &mut timing),
            Err(error) => Err(error.to_string()),
        };
        timing.total_ms = elapsed(started);
        (result, timing)
    }

    fn execute_codelets(
        &self,
        codelets: &[[u16; pyac::WORDS_PER_CODELET]],
        timing: &mut GpuExecutionTiming,
    ) -> Result<Value, String> {
        if codelets.is_empty() {
            return Ok(json!({"ok": true, "backend": BACKEND, "device": self.name, "values": []}));
        }
        let start = Instant::now();
        let prepared = prepare_pack(codelets);
        timing.classify_ms = elapsed(start);
        let PreparedPack {
            input_words,
            section_words,
            dispatch_words,
            section_count,
            programlet,
            result_records,
        } = prepared?;

        let start = Instant::now();
        let driver = &self.driver;
        let input = Buffer::upload(driver, &input_words)?;
        let result = Buffer::new(driver, result_records)?;
        check(
            unsafe { (driver.clear)(result.address, 0, result_records) },
            "clear result",
        )?;
        let directory = Buffer::upload(driver, &dispatch_words)?;
        let sections = Buffer::upload(driver, &section_words)?;
        let completion = Buffer::upload(driver, &[0])?;
        let before = Event::new(driver)?;
        let after = Event::new(driver)?;
        timing.buffer_setup_ms = elapsed(start);

        let start = Instant::now();
        let (mut src, mut dst) = (input.address, result.address);
        let (mut directory, mut descriptors, mut ticket) =
            (directory.address, sections.address, completion.address);
        let (mut count, mut section_total) = (codelets.len() as u32, section_count as u32);
        let mut args: [*mut c_void; 7] = [
            from_mut(&mut src).cast(),
            from_mut(&mut count).cast(),
            from_mut(&mut dst).cast(),
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
        ];
        let (entry, blocks, block_size) = if section_count > 0 {
            args[3] = from_mut(&mut descriptors).cast();
            args[4] = from_mut(&mut section_total).cast();
            args[5] = from_mut(&mut ticket).cast();
            args[6] = from_mut(&mut directory).cast();
            (2, section_total, 1)
        } else if programlet {
            args[3] = from_mut(&mut directory).cast();
            (1, 1, 1)
        } else {
            (0, count.div_ceil(64), 64)
        };
        timing.command_encode_ms = elapsed(start);

        let start = Instant::now();
        let mut output = vec![0u32; result_records];
        let mut gpu_ms = 0.0;
        unsafe {
            check(
                (driver.event_record)(before.handle, null_mut()),
                "record start event",
            )?;
            check(
                (driver.launch)(
                    self.kernels[entry],
                    blocks,
                    1,
                    1,
                    block_size,
                    1,
                    1,
                    0,
                    null_mut(),
                    args.as_mut_ptr(),
                    null_mut(),
                ),
                "launch kernel",
            )?;
            check(
                (driver.event_record)(after.handle, null_mut()),
                "record finish event",
            )?;
            check((driver.event_sync)(after.handle), "wait for kernel")?;
            check(
                (driver.event_ms)(&mut gpu_ms, before.handle, after.handle),
                "read elapsed kernel time",
            )?;
            check(
                (driver.download)(
                    output.as_mut_ptr().cast(),
                    result.address,
                    result_records * 4,
                ),
                "download result",
            )?;
        }
        timing.kernel_gpu_ms = Some(f64::from(gpu_ms));
        timing.kernel_timing_source = Some("cuda-event");
        timing.submit_wait_readback_ms = elapsed(start);
        decode_pack_result(
            codelets,
            &output,
            section_count,
            programlet,
            BACKEND,
            &self.name,
            timing,
        )
    }
}

impl Drop for CudaDevice {
    fn drop(&mut self) {
        unsafe {
            if !self.module.is_null() {
                (self.driver.unload_module)(self.module);
            }
            (self.driver.set_current)(null_mut());
            (self.driver.release)(self.ordinal);
        }
    }
}

fn elapsed(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cubin_requires_native_format_and_packaged_hash() {
        let mut binary = [0u8; 64];
        binary[..6].copy_from_slice(b"\x7fELF\x02\x01");
        binary[18] = 190;
        let hash = format!("{:x}", Sha256::digest(binary));
        assert!(artifact(&binary, &hash).is_ok());
        binary[42] ^= 1;
        assert!(artifact(&binary, &hash).unwrap_err().contains("SHA-256"));
        assert!(
            artifact(b".target sm_86", &hash)
                .unwrap_err()
                .contains("not PTX")
        );
    }

    #[test]
    fn stalled_device_load_fails_without_announcing_readiness() {
        let (_owner, initialized) = sync_channel(1);
        let error = wait_for_device(initialized, Duration::from_millis(2)).unwrap_err();
        assert!(error.contains("before readiness"));
        assert!(LOAD_LIMIT < Duration::from_secs(60));
    }
}
