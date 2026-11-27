use super::*;
pub(super) async fn create_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    cache: &wgpu::PipelineCache,
    device_loss: &Arc<Mutex<Option<String>>>,
    entry_point: &str,
    label: &str,
) -> Result<wgpu::ComputePipeline, String> {
    let internal_scope = device.push_error_scope(wgpu::ErrorFilter::Internal);
    let oom_scope = device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
    let validation_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        module: shader,
        entry_point: Some(entry_point),
        compilation_options: Default::default(),
        cache: Some(cache),
    });
    let validation_error = validation_scope.pop().await;
    let oom_error = oom_scope.pop().await;
    let internal_error = internal_scope.pop().await;
    if let Some(error) = validation_error.or(oom_error).or(internal_error) {
        return Err(format!(
            "Vulkan VLIW {entry_point} pipeline creation failed: {error}"
        ));
    }
    if let Some(loss) = device_loss
        .lock()
        .map_err(|_| "Vulkan device-loss state lock poisoned".to_owned())?
        .as_ref()
    {
        return Err(format!(
            "Vulkan device lost during {entry_point} pipeline creation: {loss}"
        ));
    }
    Ok(pipeline)
}

pub(super) fn read_pipeline_cache(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "compiled GPU pipeline artifact is required at {}: {error}",
            path.display()
        )
    })?;
    if bytes.is_empty() {
        return Err(format!(
            "compiled GPU pipeline artifact is empty: {}",
            path.display()
        ));
    }
    Ok(bytes)
}

pub(super) fn write_pipeline_cache(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    if let Some(parent) = parent {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "could not create pipeline artifact directory {}: {error}",
                parent.display()
            )
        })?;
    }
    let mut temporary = PathBuf::from(path);
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("bin");
    temporary.set_extension(format!("{extension}.{}.tmp", std::process::id()));
    fs::write(&temporary, data).map_err(|error| {
        format!(
            "could not write compiled pipeline artifact {}: {error}",
            temporary.display()
        )
    })?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "could not atomically install compiled pipeline artifact {}: {error}",
            path.display()
        ));
    }
    Ok(())
}
