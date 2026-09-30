use nano_rspow::CancelToken;
use nano_rspow::wgpu_types::{SHADER, Uniforms, WORKGROUP_SIZE};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::Mutex;
use std::task::{Context, Poll, Waker};

macro_rules! console_log {
    ($($t:tt)*) => (
        web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&format!($($t)*)))
    )
}

// ---------------------------------------------------------------------------
// Shared generator
// ---------------------------------------------------------------------------
//
// A `WgpuWebGenerator` holds only reusable GPU resources: building one
// requests an instance, adapter, device and queue, compiles the WGSL shader,
// creates the compute pipeline and allocates the double-buffered slots.
// Rebuilding that per call charged the whole bring-up to the caller once per
// block, so exactly one generator is cached for the life of the module and
// reused.
//
// Reuse is only sound because generation is serialised. The ping-pong slots
// are shared resources: `generate` keeps its `slot` index in a local, but two
// overlapping calls would write the same slot and then read back each other's
// results, returning a nonce computed against the wrong hash and threshold.
// The gate below prevents that.

static GATE: Gate = Gate::new();

// The cached generator, rebuilt whenever the device is lost.
//
// Cache and bookkeeping are thread-local rather than `static` because wgpu's web
// backend handles are neither `Send` nor `Sync`. `wasm32-unknown-unknown` is
// single-threaded, so a thread-local cache is also exactly the right
// granularity: one generator per realm, whether that realm is a window or a
// worker. Keeping the epoch thread-local matters too — a shared counter would
// let one realm's rebuild mask another realm's device loss.
thread_local! {
    static CACHE: RefCell<Option<Rc<WgpuWebGenerator>>> = const { RefCell::new(None) };
    /// Set by the device-loss callback, cleared when a fresh generator is
    /// installed.
    static DEVICE_LOST: Cell<bool> = const { Cell::new(false) };
    /// Incremented per build so a late loss notification from an already
    /// replaced generator is ignored.
    static EPOCH: Cell<u64> = const { Cell::new(0) };
}

/// A minimal FIFO async mutex.
///
/// Generation is the only async operation that needs mutual exclusion, so this
/// is deliberately a ticket queue of wakers rather than a dependency. It is
/// built on `std::task::Waker` so the host test suite can drive it without a
/// JavaScript event loop.
///
/// Each caller draws a ticket on its first poll and may enter only when that
/// ticket is the one being served. Releasing advances the served ticket and
/// wakes whoever is now next in line, so a newcomer cannot overtake a waiter
/// that has already been released.
struct Gate {
    state: Mutex<GateState>,
}

struct GateState {
    /// Whether the served ticket is inside the critical section. Guards against
    /// re-polling a future that has already completed.
    held: bool,
    /// Ticket handed to the next caller to arrive.
    next_ticket: u64,
    /// The ticket permitted to enter, advanced when the holder leaves or when
    /// its caller gives up while queued.
    serving: u64,
    /// Callers that arrived while the gate was held, in arrival order.
    waiters: VecDeque<(u64, Waker)>,
}

impl GateState {
    /// The ticket to serve once the current holder leaves or gives up: the oldest
    /// live waiter, or `after` when nobody is waiting.
    ///
    /// Not simply `current + 1`, because a caller that abandoned its ticket
    /// leaves a gap that has to be stepped over.
    fn next_serving(&self, after: u64) -> u64 {
        self.waiters.front().map(|(ticket, _)| *ticket).unwrap_or(after)
    }
}

struct GateGuard<'a> {
    gate: &'a Gate,
    ticket: u64,
}

impl Gate {
    const fn new() -> Self {
        Self {
            state: Mutex::new(GateState {
                held: false,
                next_ticket: 0,
                serving: 0,
                waiters: VecDeque::new(),
            }),
        }
    }

    async fn lock(&self) -> GateGuard<'_> {
        Acquire {
            gate: self,
            ticket: None,
        }
        .await
    }

    fn state(&self) -> std::sync::MutexGuard<'_, GateState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

struct Acquire<'a> {
    gate: &'a Gate,
    ticket: Option<u64>,
}

impl<'a> Future for Acquire<'a> {
    type Output = GateGuard<'a>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.gate.state();

        let ticket = match self.ticket {
            Some(ticket) => ticket,
            None => {
                let ticket = state.next_ticket;
                state.next_ticket += 1;
                self.ticket = Some(ticket);
                ticket
            }
        };

        if state.held || ticket != state.serving {
            // Keep one queue entry per caller: a pending future is re-polled, and
            // re-polling must not enqueue it a second time.
            match state
                .waiters
                .iter_mut()
                .find(|(waiting, _)| *waiting == ticket)
            {
                Some((_, woken)) => *woken = cx.waker().clone(),
                None => state.waiters.push_back((ticket, cx.waker().clone())),
            }
            return Poll::Pending;
        }

        state.held = true;
        if let Some(position) = state.waiters.iter().position(|(waiting, _)| *waiting == ticket)
        {
            state.waiters.remove(position);
        }
        Poll::Ready(GateGuard {
            gate: self.gate,
            ticket,
        })
    }
}

impl Drop for Acquire<'_> {
    fn drop(&mut self) {
        // A caller that gives up while queued must not stall the tickets behind
        // it. A caller that already acquired has left the queue, and its guard
        // owns the release.
        let Some(ticket) = self.ticket else {
            return;
        };
        let mut state = self.gate.state();
        let Some(position) = state.waiters.iter().position(|(waiting, _)| *waiting == ticket) else {
            return;
        };
        state.waiters.remove(position);

        if ticket == state.serving {
            let next = state.next_serving(ticket + 1);
            state.serving = next;
            let woken = state.waiters.front().map(|(_, waker)| waker.clone());
            drop(state);
            if let Some(woken) = woken {
                woken.wake();
            }
        }
    }
}

impl Drop for GateGuard<'_> {
    fn drop(&mut self) {
        let mut state = self.gate.state();
        state.held = false;
        let next = state.next_serving(self.ticket + 1);
        state.serving = next;

        let woken = state.waiters.front().map(|(_, waker)| waker.clone());
        drop(state);
        if let Some(woken) = woken {
            woken.wake();
        }
    }
}

/// The cached generator, unless the device backing it has been lost.
fn cached_generator() -> Option<Rc<WgpuWebGenerator>> {
    if DEVICE_LOST.with(Cell::get) {
        return None;
    }
    CACHE.with(|cache| cache.borrow().clone())
}

/// Return the cached generator, building it on first use.
///
/// Held under the gate, so only one caller can be here at a time and no
/// separate in-flight-initialisation bookkeeping is needed. A failed build is
/// deliberately not cached: callers such as `generate_work` fall back to the
/// CPU, and the next call should get a fresh attempt at the GPU.
async fn ensure_generator() -> Result<Rc<WgpuWebGenerator>, String> {
    if let Some(generator) = cached_generator() {
        return Ok(generator);
    }

    DEVICE_LOST.with(|lost| lost.set(false));
    let epoch = EPOCH.with(|epoch| {
        let next = epoch.get() + 1;
        epoch.set(next);
        next
    });
    CACHE.with(|cache| *cache.borrow_mut() = None);

    let generator = Rc::new(WgpuWebGenerator::new().await?);
    watch_device_lost(&generator, epoch);
    CACHE.with(|cache| *cache.borrow_mut() = Some(Rc::clone(&generator)));
    Ok(generator)
}

/// Record a device-loss notification, ignoring one from a generator that has
/// already been replaced. Returns whether the notification was accepted.
///
/// Kept free of logging so it stays unit-testable off the web.
fn note_device_lost(epoch: u64) -> bool {
    if EPOCH.with(Cell::get) != epoch {
        return false;
    }
    DEVICE_LOST.with(|lost| lost.set(true));
    true
}

/// Discard the cached generator once the current device is lost.
///
/// Per-call construction used to paper over device loss by accident. With a
/// cached generator the recovery has to be explicit, otherwise every later call
/// would keep dispatching through a dead device. The callback fires on the
/// browser's event loop, and the epoch check ignores a late notification from a
/// generator that has already been replaced.
fn watch_device_lost(generator: &WgpuWebGenerator, epoch: u64) {
    generator
        .device
        .set_device_lost_callback(move |reason, message| {
            if note_device_lost(epoch) {
                console_log!(
                    "[WebGPU] Device lost ({:?}): {}. Cached generator discarded.",
                    reason,
                    message
                );
            }
        });
}

/// Generate proof of work through the process-wide generator, building it on
/// first use.
///
/// `Ok(None)` means the search was exhausted or cancelled; `Err` means the GPU
/// stack was unavailable, which is the same condition a caller saw when
/// `WgpuWebGenerator::new` failed.
pub async fn generate_shared(
    hash: &[u8; 32],
    threshold: u64,
    cancel: &CancelToken,
) -> Result<Option<u64>, String> {
    let _guard = GATE.lock().await;
    let generator = ensure_generator().await?;
    console_log!("[WebGPU] Generating with cached device and pipeline.");
    Ok(generator.generate(hash, threshold, cancel).await)
}

/// Build the shared generator ahead of time so the first `generate_shared`
/// call does not pay for it.
///
/// This is what `probe_local_pow` uses: it already needed to know whether a
/// full generator was constructible, and now the answer is also reusable.
pub async fn warm_up() -> Result<(), String> {
    let _guard = GATE.lock().await;
    ensure_generator().await.map(|_| ())
}

// Double-buffered WebGPU generator.
// Two slots (ping/pong) let us submit batch N while reading back batch N-1,
// guaranteeing the mapped buffer is always already retired — fixing Safari's
// mapAsync bug where mapping an in-flight buffer returns only zeros.
//
// Instances are not built directly by callers: use `generate_shared`, which
// caches one generator for the life of the module and serialises access to the
// slots.
struct WgpuWebGenerator {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    uniform_bufs: [wgpu::Buffer; 2],
    result_bufs: [wgpu::Buffer; 2],
    readback_bufs: [wgpu::Buffer; 2],
    bind_groups: [wgpu::BindGroup; 2],
}

/// Map a GPU readback buffer asynchronously.
/// The double-buffer ping-pong guarantees the buffer being mapped was submitted
/// one full batch ago, so it is already retired — no explicit sync needed.
async fn map_readback_async(buf: &wgpu::Buffer, cancel: &CancelToken) -> bool {
    use js_sys::Function;
    use wasm_bindgen::JsValue;

    if cancel.is_cancelled() {
        return false;
    }

    // Build a JS Promise whose resolve we hand to map_async.
    let mut resolve_holder: Option<Function> = None;
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        resolve_holder = Some(resolve);
    });
    let resolve_fn = resolve_holder.expect("Promise constructor called synchronously");

    buf.slice(..).map_async(wgpu::MapMode::Read, move |_res| {
        let _ = resolve_fn.call0(&JsValue::UNDEFINED);
    });

    // Await the map completion promise.
    wasm_bindgen_futures::JsFuture::from(promise).await.is_ok()
}

impl WgpuWebGenerator {
    pub async fn new() -> Result<Self, String> {
        let started_at = js_sys::Date::now();
        console_log!("[WebGPU] Instantiating wgpu::Instance...");
        let instance = wgpu::Instance::default();

        console_log!("[WebGPU] Requesting adapter...");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU adapter: {:?}", e))?;

        console_log!("[WebGPU] Adapter acquired. Requesting device...");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("nano-rspow-web"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: Default::default(),
                experimental_features: Default::default(),
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU device: {}", e))?;

        console_log!("[WebGPU] Device and Queue acquired. Compiling WGSL shader...");
        let shader_src = SHADER.replace("WGS_PLACEHOLDER", &WORKGROUP_SIZE.to_string());
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nano-rspow-pow"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("nano-rspow-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nano-rspow-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nano-rspow-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        console_log!("[WebGPU] Pipeline compiled. Allocating double-buffered slots...");

        let uniform_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("uniforms-{i}")),
                size: std::mem::size_of::<Uniforms>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let result_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("result-{i}")),
                size: 12,
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let readback_bufs = std::array::from_fn(|i| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("readback-{i}")),
                size: 12,
                usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        });
        let bind_groups = std::array::from_fn(|i| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(&format!("nano-rspow-bg-{i}")),
                layout: &bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_bufs[i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: result_bufs[i].as_entire_binding(),
                    },
                ],
            })
        });

        console_log!(
            "[WebGPU] Initialization complete in {} ms (double-buffered)!",
            js_sys::Date::now() - started_at
        );
        Ok(Self {
            device,
            queue,
            pipeline,
            uniform_bufs,
            result_bufs,
            readback_bufs,
            bind_groups,
        })
    }

    pub async fn generate(
        &self,
        hash: &[u8; 32],
        threshold: u64,
        cancel: &CancelToken,
    ) -> Option<u64> {
        console_log!(
            "[WebGPU] Starting generation (double-buffered). threshold: {:016x}",
            threshold
        );
        let mut hash0 = [0u32; 4];
        let mut hash1 = [0u32; 4];
        for (output, chunk) in hash0.iter_mut().zip(hash[..16].as_chunks::<4>().0) {
            *output = u32::from_le_bytes(*chunk);
        }
        for (output, chunk) in hash1.iter_mut().zip(hash[16..].as_chunks::<4>().0) {
            *output = u32::from_le_bytes(*chunk);
        }

        let threshold_lo = threshold as u32;
        let threshold_hi = (threshold >> 32) as u32;
        // 65535 × 64 workgroup threads = ~4.19M nonces per batch.
        const DISPATCH_X: u32 = 65535;
        let nonces_per_batch = (WORKGROUP_SIZE * DISPATCH_X) as u64;

        let mut base_nonce: u64 = rand::random();
        let mut batch_count = 0u64;

        // Submit one compute batch into `slot`.
        let submit = |slot: usize, nonce: u64| {
            let uniforms = Uniforms {
                hash0,
                hash1,
                base_nonce_lo: nonce as u32,
                base_nonce_hi: (nonce >> 32) as u32,
                threshold_lo,
                threshold_hi,
            };
            self.queue
                .write_buffer(&self.uniform_bufs[slot], 0, bytemuck::bytes_of(&uniforms));
            let mut enc = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("nano-rspow-enc"),
                });
            enc.clear_buffer(&self.result_bufs[slot], 0, None);
            {
                let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pow"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind_groups[slot], &[]);
                pass.dispatch_workgroups(DISPATCH_X, 1, 1);
            }
            enc.copy_buffer_to_buffer(&self.result_bufs[slot], 0, &self.readback_bufs[slot], 0, 12);
            self.queue.submit(std::iter::once(enc.finish()));
        };

        // Warm-up: submit slot 0 so there is always a prior batch to read back.
        submit(0, base_nonce);
        base_nonce = base_nonce.wrapping_add(nonces_per_batch);
        let mut slot: usize = 1;

        loop {
            batch_count += 1;

            if cancel.is_cancelled() {
                console_log!("[WebGPU] Cancelled after {} batch(es).", batch_count - 1);
                return None;
            }

            // Submit current slot.
            submit(slot, base_nonce);
            base_nonce = base_nonce.wrapping_add(nonces_per_batch);

            // Read back the PREVIOUS slot — guaranteed retired by GPU ordering.
            let prev = slot ^ 1;
            let ok = map_readback_async(&self.readback_bufs[prev], cancel).await;
            if !ok {
                if cancel.is_cancelled() {
                    console_log!("[WebGPU] Cancelled after {} batch(es).", batch_count);
                }
                return None;
            }

            let data: Vec<u32> = {
                let mapped = self.readback_bufs[prev].slice(..).get_mapped_range();
                bytemuck::cast_slice(&mapped).to_vec()
            };
            self.readback_bufs[prev].unmap();

            if batch_count <= 3 {
                console_log!(
                    "[WebGPU] batch={} slot={} prev={} data=[{:#010x}, {:#010x}, {}]",
                    batch_count,
                    slot,
                    prev,
                    data[0],
                    data[1],
                    data[2]
                );
            }

            if data[2] != 0 {
                let found_nonce = data[0] as u64 | ((data[1] as u64) << 32);
                console_log!(
                    "[WebGPU] Found nonce after {} batch(es): {:016x}",
                    batch_count,
                    found_nonce
                );
                return Some(found_nonce);
            }

            slot ^= 1;
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc as ThreadSafeArc;
    use std::task::Wake;
    use std::time::{Duration, Instant};

    // The WebGPU paths need a real adapter, so they cannot run on the host. The
    // gate is what makes a shared generator safe, and it is pure `std`, so it is
    // tested here.
    //
    // `block_on` and `join2` stand in for the browser event loop. `join2`
    // matters most: it drives two futures on one thread, which is exactly how two
    // unawaited `generate_work` promises interleave in a browser.

    struct ThreadWaker(std::thread::Thread);

    impl Wake for ThreadWaker {
        fn wake(self: ThreadSafeArc<Self>) {
            self.0.unpark();
        }
    }

    /// A waker that unparks the calling thread. `park` keeps a permit, so a wake
    /// arriving between a poll and the park is not lost.
    fn thread_waker() -> Waker {
        Waker::from(ThreadSafeArc::new(ThreadWaker(std::thread::current())))
    }

    /// Give up rather than hang if a future stops making progress. A wedged gate
    /// should read as a failed test, not a stuck CI job.
    const STALL_LIMIT: Duration = Duration::from_secs(10);

    fn wait_for_progress(stalled: &mut u32, started_at: Instant) {
        *stalled += 1;
        assert!(
            started_at.elapsed() < STALL_LIMIT,
            "no progress for {STALL_LIMIT:?}: the gate never released"
        );
        std::thread::park_timeout(Duration::from_millis(20));
    }

    /// Poll once, requiring the gate to be free.
    fn acquire_now<F: Future>(future: &mut Pin<Box<F>>, cx: &mut Context<'_>) -> F::Output {
        match future.as_mut().poll(cx) {
            Poll::Ready(value) => value,
            Poll::Pending => panic!("expected a free gate, but the acquire stayed pending"),
        }
    }

    fn block_on<F: Future>(future: F) -> F::Output {
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);
        let mut future = Box::pin(future);
        let (started_at, mut stalled) = (Instant::now(), 0);

        loop {
            if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
                return value;
            }
            wait_for_progress(&mut stalled, started_at);
        }
    }

    /// Poll two futures on one thread until both complete.
    fn join2<A: Future, B: Future>(first: A, second: B) -> (A::Output, B::Output) {
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);
        let mut first = Box::pin(first);
        let mut second = Box::pin(second);
        let (started_at, mut stalled) = (Instant::now(), 0);
        let (mut a, mut b) = (None, None);

        while a.is_none() || b.is_none() {
            // The `is_none` guards are load-bearing: a completed future must not
            // be polled again, so the poll cannot be hoisted into the pattern.
            #[allow(clippy::collapsible_if)]
            if a.is_none() {
                if let Poll::Ready(value) = first.as_mut().poll(&mut cx) {
                    a = Some(value);
                }
            }
            #[allow(clippy::collapsible_if)]
            if b.is_none() {
                if let Poll::Ready(value) = second.as_mut().poll(&mut cx) {
                    b = Some(value);
                }
            }
            if a.is_some() && b.is_some() {
                break;
            }
            wait_for_progress(&mut stalled, started_at);
        }

        (a.unwrap(), b.unwrap())
    }

    /// Yields once, so a critical section containing it is a real await point
    /// the other future can run into.
    struct YieldOnce(bool);

    impl Future for YieldOnce {
        type Output = ();

        fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
            if self.0 {
                return Poll::Ready(());
            }
            self.0 = true;
            cx.waker().wake_by_ref();
            Poll::Pending
        }
    }

    /// Overlapping calls must never share the critical section, because that
    /// section is all that stands between two `generate` calls and the shared
    /// ping-pong buffers. Without the gate both enter before either yields, and
    /// each reads back the other's nonce. This is the host-runnable equivalent
    /// of firing concurrent `generate_work` calls and validating each result
    /// against its own hash.
    #[test]
    fn gate_keeps_overlapping_calls_out_of_the_same_critical_section() {
        let gate = Gate::new();
        let trace: RefCell<Vec<&'static str>> = RefCell::new(Vec::new());

        let first = async {
            let _guard = gate.lock().await;
            trace.borrow_mut().push("first-in");
            YieldOnce(false).await;
            trace.borrow_mut().push("first-out");
        };
        let second = async {
            let _guard = gate.lock().await;
            trace.borrow_mut().push("second-in");
            YieldOnce(false).await;
            trace.borrow_mut().push("second-out");
        };

        join2(first, second);

        assert_eq!(
            *trace.borrow(),
            vec!["first-in", "first-out", "second-in", "second-out"],
            "critical sections interleaved: overlapping calls would alias the ping-pong buffers"
        );
    }

    #[test]
    fn gate_admits_a_waiter_only_after_the_holder_releases() {
        let gate = Gate::new();
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);

        let mut held = Box::pin(gate.lock());
        let held_guard = acquire_now(&mut held, &mut cx);

        let mut waited = Box::pin(gate.lock());
        assert!(
            waited.as_mut().poll(&mut cx).is_pending(),
            "a second caller entered the critical section while it was held"
        );

        // Releasing hands ownership straight to the queued waiter.
        drop(held_guard);
        let waited_guard = acquire_now(&mut waited, &mut cx);
        drop(waited_guard);
    }

    #[test]
    fn gate_admits_waiters_in_arrival_order() {
        let gate = Gate::new();
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);

        let mut held = Box::pin(gate.lock());
        let held_guard = acquire_now(&mut held, &mut cx);

        let mut first = Box::pin(gate.lock());
        let mut second = Box::pin(gate.lock());
        assert!(first.as_mut().poll(&mut cx).is_pending());
        assert!(second.as_mut().poll(&mut cx).is_pending());

        drop(held_guard);
        let first_guard = acquire_now(&mut first, &mut cx);
        assert!(
            second.as_mut().poll(&mut cx).is_pending(),
            "a later waiter jumped the queue"
        );

        drop(first_guard);
        let second_guard = acquire_now(&mut second, &mut cx);
        drop(second_guard);
    }

    #[test]
    fn gate_queues_a_repolled_waiter_only_once() {
        let gate = Gate::new();
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);

        let mut held = Box::pin(gate.lock());
        let held_guard = acquire_now(&mut held, &mut cx);

        // A pending future is normally re-polled by its executor.
        let mut waited = Box::pin(gate.lock());
        for _ in 0..3 {
            assert!(waited.as_mut().poll(&mut cx).is_pending());
        }

        let waiters = gate
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .waiters
            .len();
        assert_eq!(waiters, 1, "re-polls enqueued duplicate waiters");

        drop(held_guard);
    }

    #[test]
    fn gate_is_reusable_across_sequential_callers() {
        let gate = Gate::new();

        block_on(async {
            for _ in 0..3 {
                let guard = gate.lock().await;
                drop(guard);
            }
        });

        // The gate must not be left permanently held by a departed caller.
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);
        let mut acquire = Box::pin(gate.lock());
        let guard = acquire_now(&mut acquire, &mut cx);
        drop(guard);
    }

    /// A caller that gives up while queued must not strand the ticket behind it.
    #[test]
    fn gate_skips_a_waiter_that_gives_up() {
        let gate = Gate::new();
        let waker = thread_waker();
        let mut cx = Context::from_waker(&waker);

        let mut held = Box::pin(gate.lock());
        let held_guard = acquire_now(&mut held, &mut cx);

        let mut abandoned = Box::pin(gate.lock());
        assert!(abandoned.as_mut().poll(&mut cx).is_pending());

        let mut waiting = Box::pin(gate.lock());
        assert!(waiting.as_mut().poll(&mut cx).is_pending());

        drop(abandoned);
        drop(held_guard);

        let waiting_guard = acquire_now(&mut waiting, &mut cx);
        drop(waiting_guard);
    }

    #[test]
    fn a_loss_notification_from_a_replaced_generator_is_ignored() {
        // Thread-locals are per-thread, so the harness gives this test its own
        // copy and it cannot disturb the others.
        assert!(!DEVICE_LOST.with(Cell::get), "test began already lost");

        let current = EPOCH.with(Cell::get);

        assert!(
            !note_device_lost(current + 1),
            "a notification from a replaced generator was accepted"
        );
        assert!(!DEVICE_LOST.with(Cell::get));

        assert!(note_device_lost(current));
        assert!(
            DEVICE_LOST.with(Cell::get),
            "a loss on the current generator did not invalidate the cache"
        );
    }
}
