mod gpu;

use std::io::{Read, Write};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("pyac-vliw-gpu-worker: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut input = Vec::new();
    std::io::stdin()
        .read_to_end(&mut input)
        .map_err(|error| format!("could not read VLIW input from stdin: {error}"))?;
    let shader_path = std::env::var_os("PYAC_VLIW_SPIRV_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from("rust/pyac-gpu/target/generated/vulkan/pyac_vliw_gpu_kernel.spv")
        });
    let cache_path = std::env::var_os("PYAC_VLIW_PIPELINE_CACHE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from("rust/pyac-gpu/target/generated/vulkan/pyac_vliw_pipeline_cache.bin")
        });
    let runtime = pollster::block_on(gpu::GpuRuntime::new(&shader_path, &cache_path))?;
    let response = pollster::block_on(runtime.execute_pack(&input))?;
    std::io::stdout()
        .write_all(response.to_string().as_bytes())
        .map_err(|error| format!("could not write JSON result: {error}"))?;
    Ok(())
}
