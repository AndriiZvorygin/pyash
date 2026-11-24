use serde_json::{Value, json};

#[derive(Default)]
pub(crate) struct GpuExecutionTiming {
    pub(crate) pack_decode_ms: f64,
    pub(crate) classify_ms: f64,
    pub(crate) buffer_setup_ms: f64,
    pub(crate) command_encode_ms: f64,
    pub(crate) submit_wait_readback_ms: f64,
    pub(crate) kernel_gpu_ms: Option<f64>,
    pub(crate) kernel_timing_source: Option<&'static str>,
    pub(crate) result_decode_ms: f64,
    pub(crate) total_ms: f64,
}

impl GpuExecutionTiming {
    pub(crate) fn to_json(&self) -> Value {
        json!({
            "packDecodeMs": self.pack_decode_ms,
            "classifyMs": self.classify_ms,
            "bufferSetupMs": self.buffer_setup_ms,
            "commandEncodeMs": self.command_encode_ms,
            "submitWaitReadbackMs": self.submit_wait_readback_ms,
            "kernelGpuMs": self.kernel_gpu_ms,
            "kernelTimingSource": if self.kernel_gpu_ms.is_some() {
                self.kernel_timing_source.unwrap_or("vulkan-timestamp-query")
            } else {
                "unavailable"
            },
            "resultDecodeMs": self.result_decode_ms,
            "totalMs": self.total_ms,
        })
    }
}
