use libloading::Library;
use std::ffi::{c_char, c_int, c_uint, c_void};

pub(super) type Handle = *mut c_void;
type Status = c_int;
type Device = c_int;

macro_rules! driver_api {
    ($($field:ident : $symbol:literal ($($arg:ty),*) );* $(;)?) => {
        pub(super) struct Driver {
            $(
                pub(super) $field: unsafe extern "C" fn($($arg),*) -> Status,
            )*
            _library: Library,
        }

        impl Driver {
            pub(super) fn load() -> Result<Self, String> {
                let library = unsafe { Library::new("libcuda.so.1") }
                    .map_err(|error| format!("CUDA driver unavailable: {error}"))?;
                unsafe {
                    Ok(Self {
                        $(
                            $field: *library.get(concat!($symbol, "\0").as_bytes())
                                .map_err(|error| format!("CUDA {}: {error}", $symbol))?,
                        )*
                        _library: library,
                    })
                }
            }
        }
    };
}

driver_api! {
    init: "cuInit"(c_uint);
    get_device: "cuDeviceGet"(*mut Device, c_int);
    get_name: "cuDeviceGetName"(*mut c_char, c_int, Device);
    get_attribute: "cuDeviceGetAttribute"(*mut c_int, c_int, Device);
    retain: "cuDevicePrimaryCtxRetain"(*mut Handle, Device);
    release: "cuDevicePrimaryCtxRelease_v2"(Device);
    set_current: "cuCtxSetCurrent"(Handle);
    load_module: "cuModuleLoadData"(*mut Handle, *const c_void);
    unload_module: "cuModuleUnload"(Handle);
    get_function: "cuModuleGetFunction"(*mut Handle, Handle, *const c_char);
    allocate: "cuMemAlloc_v2"(*mut u64, usize);
    free: "cuMemFree_v2"(u64);
    upload: "cuMemcpyHtoD_v2"(u64, *const c_void, usize);
    download: "cuMemcpyDtoH_v2"(*mut c_void, u64, usize);
    clear: "cuMemsetD32_v2"(u64, c_uint, usize);
    event_create: "cuEventCreate"(*mut Handle, c_uint);
    event_record: "cuEventRecord"(Handle, Handle);
    event_sync: "cuEventSynchronize"(Handle);
    event_ms: "cuEventElapsedTime"(*mut f32, Handle, Handle);
    event_destroy: "cuEventDestroy_v2"(Handle);
    launch: "cuLaunchKernel"(Handle, c_uint, c_uint, c_uint, c_uint, c_uint, c_uint,
        c_uint, Handle, *mut *mut c_void, *mut *mut c_void);
}

pub(super) fn check(status: Status, operation: &str) -> Result<(), String> {
    if status == 0 {
        Ok(())
    } else {
        Err(format!("CUDA {operation} failed (CUresult {status})"))
    }
}

pub(super) struct Buffer<'a> {
    driver: &'a Driver,
    pub(super) address: u64,
}

impl<'a> Buffer<'a> {
    pub(super) fn new(driver: &'a Driver, words: usize) -> Result<Self, String> {
        let bytes = words
            .checked_mul(4)
            .ok_or("CUDA allocation size overflow")?;
        Self::new_bytes(driver, bytes)
    }

    fn new_bytes(driver: &'a Driver, bytes: usize) -> Result<Self, String> {
        let mut address = 0;
        check(
            unsafe { (driver.allocate)(&mut address, bytes) },
            "allocate",
        )?;
        Ok(Self { driver, address })
    }

    pub(super) fn upload<T>(driver: &'a Driver, words: &[T]) -> Result<Self, String> {
        let bytes = std::mem::size_of_val(words);
        let buffer = Self::new_bytes(driver, bytes)?;
        check(
            unsafe { (driver.upload)(buffer.address, words.as_ptr().cast(), bytes) },
            "upload",
        )?;
        Ok(buffer)
    }

    pub(super) fn upload_bytes(driver: &'a Driver, bytes: &[u8]) -> Result<Self, String> {
        let buffer = Self::new_bytes(driver, bytes.len())?;
        check(
            unsafe { (driver.upload)(buffer.address, bytes.as_ptr().cast(), bytes.len()) },
            "upload",
        )?;
        Ok(buffer)
    }
}

impl Drop for Buffer<'_> {
    fn drop(&mut self) {
        unsafe { (self.driver.free)(self.address) };
    }
}

pub(super) struct Event<'a> {
    driver: &'a Driver,
    pub(super) handle: Handle,
}

impl<'a> Event<'a> {
    pub(super) fn new(driver: &'a Driver) -> Result<Self, String> {
        let mut handle = std::ptr::null_mut();
        check(
            unsafe { (driver.event_create)(&mut handle, 0) },
            "create event",
        )?;
        Ok(Self { driver, handle })
    }
}

impl Drop for Event<'_> {
    fn drop(&mut self) {
        unsafe { (self.driver.event_destroy)(self.handle) };
    }
}
