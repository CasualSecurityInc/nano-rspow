//! A small Nano work-peer compatible HTTP server.
//!
//! The server deliberately keeps one `WorkGenerator` behind a bounded FIFO
//! queue.  This preserves the generator's hardware state (especially wgpu's
//! device and tuning cache) while keeping status, validation, and cancellation
//! requests responsive in their own HTTP handler threads.

use std::collections::VecDeque;
use std::io::Write;
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver, Sender},
};
use std::thread;
use std::time::{Duration, Instant};

use nano_rspow::{CancelToken, WorkGenerator, WorkResult, difficulty, thresholds};
use serde_json::{Value, json};
use tiny_http::{Header, Request, Response, Server, StatusCode};

const DEFAULT_LISTEN: &str = "127.0.0.1:7076";
const DEFAULT_QUEUE_SIZE: usize = 32;
const DEFAULT_BENCHMARK_COUNT: usize = 10;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub listen: String,
    pub backend: String,
    pub retune: bool,
    pub queue_size: usize,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen: DEFAULT_LISTEN.to_owned(),
            backend: "auto".to_owned(),
            retune: false,
            queue_size: DEFAULT_QUEUE_SIZE,
        }
    }
}

struct Job {
    hash: Option<[u8; 32]>,
    cancel: CancelToken,
    operation: Operation,
    reply: Sender<Result<JobOutput, String>>,
}

enum Operation {
    Generate { threshold: u64 },
    Benchmark { threshold: u64, count: usize },
}

enum JobOutput {
    Generate {
        result: WorkResult,
        generation_ms: f64,
    },
    Benchmark(BenchmarkResult),
}

#[derive(Debug, Clone)]
struct BenchmarkResult {
    average_ms: u64,
    duration_ms: u64,
    count: usize,
}

struct ActiveJob {
    hash: Option<[u8; 32]>,
    cancel: CancelToken,
}

struct QueueState {
    queue: VecDeque<Job>,
    active: Option<ActiveJob>,
}

struct SharedState {
    queue: Mutex<QueueState>,
    wake: Condvar,
    shutdown: AtomicBool,
    capacity: usize,
}

/// The state shared by HTTP handlers and the single generation worker.
#[derive(Clone)]
pub struct WorkServer {
    generator: Arc<WorkGenerator>,
    shared: Arc<SharedState>,
}

impl WorkServer {
    pub fn new(generator: WorkGenerator, capacity: usize) -> Self {
        let server = Self {
            generator: Arc::new(generator),
            shared: Arc::new(SharedState {
                queue: Mutex::new(QueueState {
                    queue: VecDeque::new(),
                    active: None,
                }),
                wake: Condvar::new(),
                shutdown: AtomicBool::new(false),
                capacity: capacity.max(1),
            }),
        };
        server.start_worker();
        server
    }

    fn start_worker(&self) {
        let generator = Arc::clone(&self.generator);
        let shared = Arc::clone(&self.shared);
        thread::Builder::new()
            .name("nano-rspow-work-peer".to_owned())
            .spawn(move || worker_loop(generator, shared))
            .expect("failed to start work-peer worker");
    }

    fn enqueue(
        &self,
        hash: Option<[u8; 32]>,
        operation: Operation,
    ) -> Result<Receiver<Result<JobOutput, String>>, String> {
        let (reply, result) = mpsc::channel();
        let mut state = self
            .shared
            .queue
            .lock()
            .map_err(|_| "queue lock poisoned")?;
        if self.shared.shutdown.load(Ordering::Acquire) {
            return Err("server is shutting down".to_owned());
        }
        if state.queue.len() >= self.shared.capacity {
            return Err("work queue is full".to_owned());
        }
        state.queue.push_back(Job {
            hash,
            cancel: CancelToken::new(),
            operation,
            reply,
        });
        self.shared.wake.notify_one();
        Ok(result)
    }

    fn cancel_hash(&self, hash: [u8; 32]) {
        let mut state = match self.shared.queue.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if let Some(active) = &state.active
            && active.hash == Some(hash)
        {
            active.cancel.cancel();
        }

        let mut retained = VecDeque::with_capacity(state.queue.len());
        while let Some(job) = state.queue.pop_front() {
            if job.hash == Some(hash) {
                job.cancel.cancel();
                let _ = job
                    .reply
                    .send(Err("Work generation was cancelled".to_owned()));
            } else {
                retained.push_back(job);
            }
        }
        state.queue = retained;
    }

    pub fn status(&self) -> (bool, usize) {
        let Ok(state) = self.shared.queue.lock() else {
            return (false, 0);
        };
        (state.active.is_some(), state.queue.len())
    }

    pub fn backend_name(&self) -> &'static str {
        self.generator.backend_name()
    }

    pub fn shutdown(&self) {
        if self.shared.shutdown.swap(true, Ordering::AcqRel) {
            return;
        }
        let Ok(mut state) = self.shared.queue.lock() else {
            self.shared.wake.notify_all();
            return;
        };
        if let Some(active) = &state.active {
            active.cancel.cancel();
        }
        while let Some(job) = state.queue.pop_front() {
            job.cancel.cancel();
            let _ = job.reply.send(Err("server is shutting down".to_owned()));
        }
        self.shared.wake.notify_all();
    }
}

fn worker_loop(generator: Arc<WorkGenerator>, shared: Arc<SharedState>) {
    loop {
        let job = {
            let mut state = match shared.queue.lock() {
                Ok(state) => state,
                Err(_) => return,
            };
            loop {
                if shared.shutdown.load(Ordering::Acquire) && state.queue.is_empty() {
                    return;
                }
                if let Some(job) = state.queue.pop_front() {
                    state.active = Some(ActiveJob {
                        hash: job.hash,
                        cancel: job.cancel.clone(),
                    });
                    break job;
                }
                state = match shared.wake.wait(state) {
                    Ok(state) => state,
                    Err(_) => return,
                };
            }
        };

        let result = match job.operation {
            Operation::Generate { threshold } => {
                let started = Instant::now();
                generator
                    .generate_with_cancel(
                        &job.hash.expect("generate jobs have a hash"),
                        threshold,
                        &job.cancel,
                    )
                    .map(|result| JobOutput::Generate {
                        result,
                        generation_ms: started.elapsed().as_secs_f64() * 1000.0,
                    })
                    .ok_or_else(|| "Work generation was cancelled".to_owned())
            }
            Operation::Benchmark { threshold, count } => {
                run_benchmark(&generator, threshold, count, &job.cancel)
                    .map(JobOutput::Benchmark)
                    .ok_or_else(|| "Benchmark was cancelled".to_owned())
            }
        };

        if let Ok(mut state) = shared.queue.lock() {
            state.active = None;
        }
        let _ = job.reply.send(result);
    }
}

fn run_benchmark(
    generator: &WorkGenerator,
    threshold: u64,
    count: usize,
    cancel: &CancelToken,
) -> Option<BenchmarkResult> {
    let hash = [0u8; 32];
    let start = Instant::now();
    let mut completed = 0usize;
    for _ in 0..count {
        if cancel.is_cancelled() {
            break;
        }
        generator.generate_with_cancel(&hash, threshold, cancel)?;
        completed += 1;
    }
    let duration_ms = start.elapsed().as_millis() as u64;
    Some(BenchmarkResult {
        average_ms: if completed == 0 {
            0
        } else {
            duration_ms / completed as u64
        },
        duration_ms,
        count: completed,
    })
}

/// Run the work peer until the listener fails or the process is shut down.
pub fn run(config: ServerConfig) -> Result<(), String> {
    if config.queue_size == 0 {
        return Err("queue size must be greater than zero".to_owned());
    }
    let generator = make_generator(&config.backend, config.retune)?;
    let server = WorkServer::new(generator, config.queue_size);
    let http = Server::http(&config.listen)
        .map_err(|e| format!("failed to listen on {}: {e}", config.listen))?;
    eprintln!(
        "nano-rspow work peer listening on {} (backend: {})",
        config.listen,
        server.backend_name()
    );

    loop {
        match http.recv_timeout(Duration::from_millis(100)) {
            Ok(Some(request)) => {
                let state = server.clone();
                thread::Builder::new()
                    .name("nano-rspow-http".to_owned())
                    .spawn(move || handle_http_request(request, state))
                    .map_err(|e| format!("failed to spawn HTTP handler: {e}"))?;
            }
            Ok(None) => {
                if server.shared.shutdown.load(Ordering::Acquire) {
                    break;
                }
            }
            Err(e) => {
                server.shutdown();
                return Err(format!("HTTP listener failed: {e}"));
            }
        }
    }
    server.shutdown();
    Ok(())
}

fn make_generator(backend: &str, retune: bool) -> Result<WorkGenerator, String> {
    match backend {
        "auto" => Ok(WorkGenerator::auto()),
        "cpu" => Ok(WorkGenerator::cpu()),
        "gpu" => {
            #[cfg(feature = "wgpu-backend")]
            {
                WorkGenerator::gpu_with_config(nano_rspow::WgpuConfig {
                    retune,
                    ..Default::default()
                })
                .map_err(|e| format!("GPU backend unavailable: {e}"))
            }
            #[cfg(not(feature = "wgpu-backend"))]
            {
                let _ = retune;
                Err("GPU backend was not compiled".to_owned())
            }
        }
        _ => Err(format!(
            "unknown backend '{backend}'; use auto, cpu, or gpu"
        )),
    }
}

fn handle_http_request(mut request: Request, server: WorkServer) {
    let mut body = String::new();
    let read_result = request.as_reader().read_to_string(&mut body);
    let (status, response_body) = match read_result {
        Ok(_) => process_rpc(&body, &server),
        Err(e) => (
            400,
            json!({ "error": format!("failed to read request body: {e}") }).to_string(),
        ),
    };
    let mut response = Response::from_string(response_body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes(b"Content-Type", b"application/json") {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn process_rpc(body: &str, server: &WorkServer) -> (u16, String) {
    let request: Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(e) => return rpc_error(400, format!("invalid JSON: {e}")),
    };
    let Some(action) = request.get("action").and_then(Value::as_str) else {
        return rpc_error(400, "missing action".to_owned());
    };

    match action {
        "work_generate" => rpc_generate(&request, server),
        "work_validate" => rpc_validate(&request),
        "work_cancel" => rpc_cancel(&request, server),
        "status" => {
            let (generating, queue_size) = server.status();
            (
                200,
                json!({
                    "generating": if generating { "1" } else { "0" },
                    "queue_size": queue_size.to_string(),
                })
                .to_string(),
            )
        }
        "benchmark" => rpc_benchmark(&request, server),
        _ => rpc_error(400, format!("unknown action '{action}'")),
    }
}

fn rpc_generate(request: &Value, server: &WorkServer) -> (u16, String) {
    let hash = match request
        .get("hash")
        .and_then(Value::as_str)
        .and_then(parse_hash)
    {
        Some(hash) => hash,
        None => return rpc_error(400, "hash must be 64 hexadecimal characters".to_owned()),
    };
    let threshold = match parse_requested_threshold(request) {
        Ok(threshold) => threshold,
        Err(error) => return rpc_error(400, error),
    };
    let receiver = match server.enqueue(Some(hash), Operation::Generate { threshold }) {
        Ok(receiver) => receiver,
        Err(error) => return rpc_error(503, error),
    };
    log_event(format!("Queued work for hash {}", hex::encode(hash)));
    match receiver.recv() {
        Ok(Ok(JobOutput::Generate {
            result,
            generation_ms,
        })) => {
            log_event(format!(
                "Generated work for hash {} in {generation_ms:.3} ms",
                hex::encode(hash)
            ));
            (
                200,
                json!({
                    "work": result.nonce_hex(),
                    "difficulty": result.difficulty_hex(),
                    "multiplier": format_multiplier(thresholds::to_multiplier(result.difficulty, thresholds::current::SEND)),
                    "hash": hex::encode(hash),
                })
                .to_string(),
            )
        }
        Ok(Ok(_)) => rpc_error(500, "invalid worker response".to_owned()),
        Ok(Err(error)) => rpc_error(409, error),
        Err(_) => rpc_error(500, "worker disconnected".to_owned()),
    }
}

fn log_event(message: String) {
    println!("{message}");
    let _ = std::io::stdout().flush();
}

fn rpc_validate(request: &Value) -> (u16, String) {
    if let Some(version) = request.get("version").and_then(Value::as_str) {
        if version != "work_1" {
            return rpc_error(400, "version must be work_1".to_owned());
        }
    } else if request.get("version").is_some() {
        return rpc_error(400, "version must be work_1".to_owned());
    }

    let Some(hash) = request.get("hash").and_then(parse_validate_hash) else {
        return rpc_error(400, "hash must be 64 hexadecimal characters".to_owned());
    };
    let Some(work) = request.get("work").and_then(parse_validate_work) else {
        return rpc_error(400, "work must be 16 hexadecimal characters".to_owned());
    };
    let threshold = match parse_validate_threshold(request) {
        Ok(threshold) => threshold,
        Err(error) => return rpc_error(400, error),
    };
    let result = difficulty::compute(&hash, work);
    let has_explicit_threshold =
        request.get("difficulty").is_some() || request.get("multiplier").is_some();
    let mut response = json!({
        "valid_all": if result >= thresholds::current::SEND { "1" } else { "0" },
        "valid_receive": if result >= thresholds::current::RECEIVE { "1" } else { "0" },
        "difficulty": format!("{result:016x}"),
        "multiplier": format_multiplier(thresholds::to_multiplier(result, thresholds::current::SEND)),
    });
    if has_explicit_threshold {
        response["valid"] = json!(if result >= threshold { "1" } else { "0" });
    }
    (200, response.to_string())
}

fn rpc_cancel(request: &Value, server: &WorkServer) -> (u16, String) {
    let Some(hash) = request
        .get("hash")
        .and_then(Value::as_str)
        .and_then(parse_hash)
    else {
        return rpc_error(400, "hash must be 64 hexadecimal characters".to_owned());
    };
    server.cancel_hash(hash);
    (200, json!({ "success": "" }).to_string())
}

fn rpc_benchmark(request: &Value, server: &WorkServer) -> (u16, String) {
    let count = match request.get("count") {
        None => DEFAULT_BENCHMARK_COUNT,
        Some(value) => match parse_decimal_usize(value) {
            Some(count) if (1..=10_000).contains(&count) => count,
            _ => return rpc_error(400, "count must be between 1 and 10000".to_owned()),
        },
    };
    let threshold = match parse_requested_threshold(request) {
        Ok(threshold) => threshold,
        Err(error) => return rpc_error(400, error),
    };
    let receiver = match server.enqueue(None, Operation::Benchmark { threshold, count }) {
        Ok(receiver) => receiver,
        Err(error) => return rpc_error(503, error),
    };
    match receiver.recv() {
        Ok(Ok(JobOutput::Benchmark(result))) => (
            200,
            json!({
                "average": result.average_ms.to_string(),
                "count": result.count.to_string(),
                "difficulty": format!("{threshold:016x}"),
                "duration": result.duration_ms.to_string(),
                "hint": "Times in milliseconds",
                "multiplier": format_multiplier(thresholds::to_multiplier(threshold, thresholds::current::SEND)),
            })
            .to_string(),
        ),
        Ok(Ok(_)) => rpc_error(500, "invalid worker response".to_owned()),
        Ok(Err(error)) => rpc_error(409, error),
        Err(_) => rpc_error(500, "worker disconnected".to_owned()),
    }
}

fn parse_requested_threshold(request: &Value) -> Result<u64, String> {
    if let Some(multiplier) = request.get("multiplier") {
        let multiplier =
            parse_f64(multiplier).ok_or_else(|| "multiplier must be a number".to_owned())?;
        if !multiplier.is_finite() || multiplier <= 0.0 {
            return Err("multiplier must be finite and greater than zero".to_owned());
        }
        Ok(threshold_from_multiplier(multiplier))
    } else if let Some(difficulty) = request.get("difficulty") {
        parse_hex_value(difficulty)
            .ok_or_else(|| "difficulty must be a 64-bit hexadecimal value".to_owned())
    } else {
        Ok(thresholds::current::SEND)
    }
}

fn parse_validate_threshold(request: &Value) -> Result<u64, String> {
    if request.get("multiplier").is_some() {
        parse_requested_threshold(request)
    } else if let Some(difficulty) = request.get("difficulty") {
        parse_fixed_hex_u64(difficulty)
            .ok_or_else(|| "difficulty must be 16 hexadecimal characters".to_owned())
    } else {
        Ok(thresholds::current::SEND)
    }
}

fn threshold_from_multiplier(multiplier: f64) -> u64 {
    let max = u64::MAX as f64;
    let threshold = max - ((max - thresholds::current::SEND as f64) / multiplier);
    threshold.clamp(0.0, max) as u64
}

fn parse_hash(value: &str) -> Option<[u8; 32]> {
    let bytes = hex::decode(value.trim().trim_start_matches("0x")).ok()?;
    bytes.try_into().ok()
}

fn parse_validate_hash(value: &Value) -> Option<[u8; 32]> {
    let value = value.as_str()?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    hex::decode(value).ok()?.try_into().ok()
}

fn parse_validate_work(value: &Value) -> Option<u64> {
    parse_fixed_hex_u64(value)
}

fn parse_fixed_hex_u64(value: &Value) -> Option<u64> {
    let value = value.as_str()?;
    if value.len() != 16 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    u64::from_str_radix(value, 16).ok()
}

fn parse_hex_u64(value: &str) -> Option<u64> {
    u64::from_str_radix(value.trim().trim_start_matches("0x"), 16).ok()
}

fn parse_hex_value(value: &Value) -> Option<u64> {
    value
        .as_str()
        .and_then(parse_hex_u64)
        .or_else(|| value.as_u64())
}

fn parse_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn parse_decimal_usize(value: &Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn format_multiplier(value: f64) -> String {
    format!("{value:.15}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

fn rpc_error(status: u16, error: String) -> (u16, String) {
    (status, json!({ "error": error }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    const HASH: &str = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";

    fn test_server(capacity: usize) -> WorkServer {
        WorkServer::new(WorkGenerator::cpu(), capacity)
    }

    #[test]
    fn generate_matches_nano_work_server_response_shape() {
        let server = test_server(2);
        let (status, body) = process_rpc(
            &json!({ "action": "work_generate", "hash": HASH, "difficulty": "fe00000000000000" })
                .to_string(),
            &server,
        );
        assert_eq!(status, 200);
        let response: Value = serde_json::from_str(&body).unwrap();
        assert!(response["work"].as_str().unwrap().len() == 16);
        assert!(response["difficulty"].as_str().unwrap().len() == 16);
        assert_eq!(response["hash"], HASH.to_ascii_lowercase());
        server.shutdown();
    }

    #[test]
    fn validate_reports_current_all_and_receive_thresholds() {
        let server = test_server(1);
        let (status, body) = process_rpc(
            &json!({ "action": "work_validate", "version": "work_1", "hash": HASH, "work": "2bf29ef00786a6bc" }).to_string(),
            &server,
        );
        assert_eq!(status, 200);
        let response: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(response["valid_all"], "0");
        assert_eq!(response["valid_receive"], "1");
        server.shutdown();
    }

    #[test]
    fn validate_rejects_unsupported_work_version() {
        let server = test_server(1);
        let (status, body) = process_rpc(
            &json!({ "action": "work_validate", "version": "work_2", "hash": HASH, "work": "2bf29ef00786a6bc" }).to_string(),
            &server,
        );
        assert_eq!(status, 400);
        assert!(body.contains("version must be work_1"));
        server.shutdown();
    }

    #[test]
    fn validate_reports_requested_difficulty_result() {
        let server = test_server(1);
        let (status, body) = process_rpc(
            &json!({ "action": "work_validate", "hash": HASH, "work": "2bf29ef00786a6bc", "difficulty": "ffffffffffffffff" }).to_string(),
            &server,
        );
        assert_eq!(status, 200);
        let response: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(response["valid"], "0");
        server.shutdown();
    }

    #[test]
    fn validate_rejects_noncanonical_work_encoding() {
        let server = test_server(1);
        let (status, body) = process_rpc(
            &json!({ "action": "work_validate", "hash": HASH, "work": "1" }).to_string(),
            &server,
        );
        assert_eq!(status, 400);
        assert!(body.contains("work must be 16 hexadecimal characters"));
        server.shutdown();
    }

    #[test]
    fn validate_rejects_nonstring_difficulty() {
        let server = test_server(1);
        let (status, body) = process_rpc(
            &json!({ "action": "work_validate", "hash": HASH, "work": "2bf29ef00786a6bc", "difficulty": 1 }).to_string(),
            &server,
        );
        assert_eq!(status, 400);
        assert!(body.contains("difficulty must be 16 hexadecimal characters"));
        server.shutdown();
    }

    #[test]
    fn invalid_input_is_a_json_rpc_error() {
        let server = test_server(1);
        let (status, body) =
            process_rpc("{\"action\":\"work_generate\",\"hash\":\"bad\"}", &server);
        assert_eq!(status, 400);
        assert!(body.contains("64 hexadecimal"));
        server.shutdown();
    }

    #[test]
    fn cancellation_stops_active_generation() {
        let server = test_server(1);
        let server_for_request = server.clone();
        let request = thread::spawn(move || {
            process_rpc(
                &json!({ "action": "work_generate", "hash": HASH, "difficulty": "ffffffffffffffff" }).to_string(),
                &server_for_request,
            )
        });
        for _ in 0..100 {
            if server.status().0 {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        let _ = process_rpc(
            &json!({ "action": "work_cancel", "hash": HASH }).to_string(),
            &server,
        );
        let (status, body) = request.join().unwrap();
        assert_eq!(status, 409);
        assert!(body.contains("cancelled"));
        server.shutdown();
    }

    #[test]
    fn queue_capacity_and_shutdown_are_bounded() {
        let server = test_server(1);
        let (reply, result) = mpsc::channel();
        let mut state = server.shared.queue.lock().unwrap();
        state.queue.push_back(Job {
            hash: Some(parse_hash(HASH).unwrap()),
            cancel: CancelToken::new(),
            operation: Operation::Generate {
                threshold: u64::MAX,
            },
            reply,
        });
        drop(state);
        assert!(
            server
                .enqueue(
                    Some(parse_hash(HASH).unwrap()),
                    Operation::Generate {
                        threshold: u64::MAX
                    }
                )
                .is_err()
        );
        server.shutdown();
        assert!(result.recv().unwrap().is_err());
    }

    #[test]
    fn http_post_contract_returns_json() {
        let http = Server::http("127.0.0.1:0").unwrap();
        let address = http.server_addr().to_string();
        let server = test_server(1);
        let worker_server = server.clone();
        let thread = thread::spawn(move || {
            let request = http.recv().unwrap();
            handle_http_request(request, worker_server);
        });
        let mut stream = TcpStream::connect(address).unwrap();
        let body = json!({ "action": "status" }).to_string();
        write!(stream, "POST / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        thread.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.contains("\"queue_size\""));
        server.shutdown();
    }
}
