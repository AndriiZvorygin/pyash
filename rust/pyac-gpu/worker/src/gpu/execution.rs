use super::*;
impl GpuRuntime {
    pub(crate) async fn execute_pack(&self, pack_bytes: &[u8]) -> Result<Value, String> {
        let (result, timings) = self.execute_pack_with_timings(pack_bytes).await;
        result.map(|mut response| {
            response["runtimeTimingMs"] = timings.to_json();
            response
        })
    }

    pub(crate) async fn execute_pack_with_timings(
        &self,
        pack_bytes: &[u8],
    ) -> (Result<Value, String>, GpuExecutionTiming) {
        let total_started = Instant::now();
        let decode_started = Instant::now();
        let pack = decode_pack(pack_bytes);
        let mut timings = GpuExecutionTiming {
            pack_decode_ms: decode_started.elapsed().as_secs_f64() * 1000.0,
            ..Default::default()
        };
        let result = match pack {
            Ok(pack) => self.execute_codelets(&pack.codelets, &mut timings).await,
            Err(error) => Err(error.to_string()),
        };
        timings.total_ms = total_started.elapsed().as_secs_f64() * 1000.0;
        (result, timings)
    }
}
