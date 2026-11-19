#[path = "../gpu.rs"]
mod gpu_worker;

use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("pyac-vliw-pipeline-compiler: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let shader = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "usage: pyac-vliw-pipeline-compiler <shader.spv> <output.bin>".to_owned())?;
    let output = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "usage: pyac-vliw-pipeline-compiler <shader.spv> <output.bin>".to_owned())?;
    if args.next().is_some() {
        return Err("usage: pyac-vliw-pipeline-compiler <shader.spv> <output.bin>".to_owned());
    }
    pollster::block_on(gpu_worker::GpuRuntime::compile_pipeline_cache(
        &shader, &output,
    ))
}
