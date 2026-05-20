// Global bindings loaded from wasm-bindgen

// Active cancel token for GPU work (null when idle)
let activeGpuCancelToken = null;

// Get DOM Elements
const elBlockHash = document.getElementById('block-hash');
const elDifficulty = document.getElementById('difficulty');
const elBtnRun = document.getElementById('btn-run');
const elStatBackend = document.getElementById('stat-backend');
const elStatDuration = document.getElementById('stat-duration');
const elResStatus = document.getElementById('res-status');
const elResNonce = document.getElementById('res-nonce');
const elResValidation = document.getElementById('res-validation');
const elConsoleLog = document.getElementById('console-log');

// Difficulty Selector bindings & logic
const elDiffControl = document.getElementById('difficulty-control');
const elDiffPrev = document.getElementById('diff-prev');
const elDiffNext = document.getElementById('diff-next');
const elDiffLabel = document.getElementById('diff-active-label');
const elBars = document.querySelectorAll('.difficulty-bars .bar');

const difficultyLevels = [
    { value: 'ffff000000000000', label: 'Dev / Smoketest Threshold<br>(0xffff000000000000)' },
    { value: 'fffffe0000000000', label: 'Receive / State-block Threshold<br>(0xfffffe0000000000)' },
    { value: 'ffffffc000000000', label: 'Send / Epoch-block Threshold<br>(0xffffffc000000000)' }
];

let currentDiffIndex = 0; // Default: Dev / Smoketest

function setDifficultyIndex(index) {
    if (index < 0 || index >= difficultyLevels.length) return;
    currentDiffIndex = index;
    
    const level = difficultyLevels[index];
    if (elDifficulty) elDifficulty.value = level.value;
    if (elDiffLabel) elDiffLabel.innerHTML = level.label;
    
    // Update data-level attribute on control for CSS styling
    if (elDiffControl) elDiffControl.setAttribute('data-level', index.toString());
    
    // Enable/disable navigation buttons
    if (elDiffPrev) elDiffPrev.disabled = (index === 0);
    if (elDiffNext) elDiffNext.disabled = (index === difficultyLevels.length - 1);
}

// Bind click events once elements are loaded
if (elDiffPrev) {
    elDiffPrev.addEventListener('click', () => setDifficultyIndex(currentDiffIndex - 1));
}
if (elDiffNext) {
    elDiffNext.addEventListener('click', () => setDifficultyIndex(currentDiffIndex + 1));
}
elBars.forEach(bar => {
    bar.addEventListener('click', () => {
        const index = parseInt(bar.getAttribute('data-index'), 10);
        setDifficultyIndex(index);
    });
});

// Initialize with index 0 (Dev Threshold)
setDifficultyIndex(0);

// Log Helper
function log(tag, message) {
    const time = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = 'console-line';
    
    let tagClass = 'tag-system';
    if (tag.toLowerCase() === 'webgpu') tagClass = 'tag-gpu';
    if (tag.toLowerCase() === 'cpu') tagClass = 'tag-cpu';
    if (tag.toLowerCase() === 'success') tagClass = 'tag-success';
    
    line.innerHTML = `<span class="timestamp">[${time}]</span><span class="${tagClass}">[${tag}]</span> ${message}`;
    elConsoleLog.appendChild(line);
    elConsoleLog.scrollTop = elConsoleLog.scrollHeight;
}

// Check WebGPU Support (async pre-flight with 1.5s timeout to prevent hangs)
async function checkWebGpuSupport() {
    if (!navigator.gpu) return false;
    try {
        const adapterPromise = navigator.gpu.requestAdapter();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 1500)
        );
        const adapter = await Promise.race([adapterPromise, timeoutPromise]);
        return !!adapter;
    } catch (e) {
        return false;
    }
}

// GPU compute smoke test — runs one real Blake2b PoW batch against a
// known-answer test vector (nonce edc20712103259c9 solves hash
// 718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2
// at threshold ffff000000000000). Base nonce is set to the answer so
// thread 0 of workgroup 0 finds it immediately.
// If result[2] != 1 after the batch, the browser's WebGPU compute
// pipeline is broken for this shader. Result is cached for the session.
let gpuSmokeTestResult = null; // null = untested, true = ok, false = broken

async function checkWebGpuComputeWorks() {
    if (gpuSmokeTestResult !== null) return gpuSmokeTestResult;
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) { gpuSmokeTestResult = false; return false; }
        const device = await adapter.requestDevice();

        // Full Blake2b PoW shader — identical to the real shader used during generation.
        const powShaderEl = document.getElementById('pow-wgsl-source');
        if (!powShaderEl) throw new Error('pow-wgsl-source element not found');
        const wgsl = powShaderEl.textContent;

        const module = device.createShaderModule({ code: wgsl });
        const pipeline = await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint: 'main' }
        });

        // Uniforms: hash 718CC2...D79E2, base_nonce = edc20712103259c9, threshold = ffff000000000000
        // Hash as 8 x u32 LE (bytes packed into u32 little-endian):
        //   718CC212 1C3E6410 59BC1C2C FC45666C 99E8AE92 2F7A807B 7D07B62C 995D79E2
        // Each group of 4 hex chars = 1 u32, stored as the integer value of those bytes LE.
        // Byte 0=0x71,1=0x8C,2=0xC2,3=0x12 → u32 LE = 0x12C28C71
        const hashBytes = '718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2';
        const h = new Uint32Array(8);
        for (let i = 0; i < 8; i++) {
            const b0 = parseInt(hashBytes.slice(i*8+0, i*8+2), 16);
            const b1 = parseInt(hashBytes.slice(i*8+2, i*8+4), 16);
            const b2 = parseInt(hashBytes.slice(i*8+4, i*8+6), 16);
            const b3 = parseInt(hashBytes.slice(i*8+6, i*8+8), 16);
            h[i] = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
        }

        // base_nonce = edc20712103259c9 → lo=0x103259c9, hi=0xedc20712
        const nonceLo = 0x103259c9 >>> 0;
        const nonceHi = 0xedc20712 >>> 0;
        // threshold = ffff000000000000 → lo=0x00000000, hi=0xffff0000
        const threshLo = 0x00000000 >>> 0;
        const threshHi = 0xffff0000 >>> 0;

        // Uniform buffer layout (matches struct Uniforms in pow.wgsl, 16-byte aligned):
        // hash0: vec4<u32> = h[0..3]  (16 bytes)
        // hash1: vec4<u32> = h[4..7]  (16 bytes)
        // base_nonce_lo, base_nonce_hi, threshold_lo, threshold_hi (16 bytes)
        const uniformData = new Uint32Array([
            h[0], h[1], h[2], h[3],
            h[4], h[5], h[6], h[7],
            nonceLo, nonceHi, threshLo, threshHi,
        ]);
        const uniformBuf = device.createBuffer({
            size: uniformData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(uniformBuf, 0, uniformData);

        const resultBuf = device.createBuffer({
            size: 12,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        const readBuf = device.createBuffer({
            size: 12,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const bg = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuf } },
                { binding: 1, resource: { buffer: resultBuf } },
            ],
        });

        const enc = device.createCommandEncoder();
        enc.clearBuffer(resultBuf);
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(1); // one workgroup of 64 threads; thread 0 holds the answer
        pass.end();
        enc.copyBufferToBuffer(resultBuf, 0, readBuf, 0, 12);
        device.queue.submit([enc.finish()]);

        await readBuf.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(readBuf.getMappedRange());
        const foundFlag  = data[2];
        const nonceLoOut = data[0];
        const nonceHiOut = data[1];
        readBuf.unmap();
        device.destroy();

        // Thread 0 must have found the nonce: flag=1, lo=0x103259c9, hi=0xedc20712
        const ok = (foundFlag === 1 && nonceLoOut === nonceLo && nonceHiOut === nonceHi);
        console.log(`[SmokeTest] flag=${foundFlag} nonce=${nonceHiOut.toString(16).padStart(8,'0')}${nonceLoOut.toString(16).padStart(8,'0')} expected=edc20712103259c9 ok=${ok}`);

        gpuSmokeTestResult = ok;
        return gpuSmokeTestResult;
    } catch (e) {
        console.log('[SmokeTest] exception:', e);
        gpuSmokeTestResult = false;
        return false;
    }
}

// Web Worker template and variables
let activeWorker = null;
let activeWorkerReject = null;

// Worker creation helper
function getWorkerCode() {
    const scriptEl = document.getElementById('wasm-glue-script');
    if (!scriptEl) {
        throw new Error("WASM glue script tag (#wasm-glue-script) not found in page.");
    }
    const glueCode = scriptEl.textContent;
    
    return glueCode + `
        self.onmessage = async function(e) {
            const { hash, threshold } = e.data;
            try {
                // Initialize WASM module inside worker
                await globalThis.init();
                
                // Call synchronous CPU generator
                const result = globalThis.generate_work_cpu(hash, threshold);
                
                // Post result back
                self.postMessage({
                    type: 'success',
                    result: {
                        nonce: result.nonce,
                        is_gpu: result.is_gpu
                    }
                });
            } catch (err) {
                self.postMessage({
                    type: 'error',
                    error: err.toString()
                });
            }
        };
    `;
}

// Background Worker CPU Runner
function generateWorkCpuWorker(hash, threshold) {
    return new Promise((resolve, reject) => {
        try {
            const code = getWorkerCode();
            const blob = new Blob([code], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            
            activeWorker = new Worker(workerUrl);
            activeWorkerReject = reject;
            
            activeWorker.onmessage = function(e) {
                const { type, result, error } = e.data;
                activeWorker.terminate();
                activeWorker = null;
                activeWorkerReject = null;
                URL.revokeObjectURL(workerUrl);
                
                if (type === 'success') {
                    resolve(result);
                } else {
                    reject(new Error(error));
                }
            };
            
            activeWorker.onerror = function(e) {
                if (activeWorker) {
                    activeWorker.terminate();
                    activeWorker = null;
                }
                activeWorkerReject = null;
                URL.revokeObjectURL(workerUrl);
                reject(new Error("Web Worker error: " + e.message));
            };
            
            activeWorker.postMessage({ hash, threshold });
        } catch (err) {
            activeWorkerReject = null;
            reject(err);
        }
    });
}

// Timeout-protected WebGPU runner
async function generateWorkGpuWithTimeout(hash, threshold, timeoutMs = 5000) {
    activeGpuCancelToken = new globalThis.WasmCancelToken();
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            if (activeGpuCancelToken) activeGpuCancelToken.cancel();
            const err = new Error("WebGPU execution timed out (Safari GPU process hung)");
            err.isGpuTimeout = true;
            reject(err);
        }, timeoutMs);
    });
    
    try {
        const result = await Promise.race([
            globalThis.generate_work_gpu(hash, threshold, activeGpuCancelToken),
            timeoutPromise
        ]);
        clearTimeout(timeoutId);
        return result;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    } finally {
        activeGpuCancelToken = null;
    }
}

// Setup Page
log('System', 'Initializing page components...');
checkWebGpuSupport().then(supported => {
    if (supported) {
        // Eagerly run the smoke test so the result is cached before the user clicks Generate.
        checkWebGpuComputeWorks().then(computeOk => {
            if (computeOk) {
                log('System', 'WebGPU support verified and fully functional in your browser.');
            } else {
                log('System', 'WARNING: WebGPU is available but compute readback is broken (known Safari/iOS defect). AUTO mode will use CPU Worker.');
            }
        });
    } else {
        log('System', 'WARNING: WebGPU is NOT supported, not enabled, or timed out. WebGPU mode will fail, but CPU mode will function.');
    }
});

// Copy-to-clipboard button
const elBtnCopy = document.getElementById('btn-copy-console');
if (elBtnCopy) {
    elBtnCopy.addEventListener('click', () => {
        const lines = elConsoleLog.querySelectorAll('.console-line');
        const text = Array.from(lines).map(l => l.textContent).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            elBtnCopy.textContent = '✓ Copied!';
            elBtnCopy.classList.add('copied');
            setTimeout(() => {
                elBtnCopy.textContent = '⎘ Copy';
                elBtnCopy.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            elBtnCopy.textContent = '✗ Failed';
            setTimeout(() => { elBtnCopy.textContent = '⎘ Copy'; }, 2000);
        });
    });
}

// Click Handler
elBtnRun.addEventListener('click', async () => {
    // If work is in progress, cancel it
    if (activeGpuCancelToken || activeWorker) {
        log('System', 'Cancellation requested by user.');
        if (activeGpuCancelToken) activeGpuCancelToken.cancel();
        if (activeWorker) {
            activeWorker.terminate();
            activeWorker = null;
            if (activeWorkerReject) {
                const rej = activeWorkerReject;
                activeWorkerReject = null;
                const err = new Error('Work generation cancelled');
                err.isCancelled = true;
                rej(err);
            }
        }
        return;
    }

    // Scroll viewport to the button to bring diagnostics and console into focus
    elBtnRun.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const hash = elBlockHash.value.trim();
    const threshold = elDifficulty.value;
    const modeElements = document.getElementsByName('exec-mode');
    let mode = 'auto';
    
    for (const el of modeElements) {
        if (el.checked) {
            mode = el.value;
            break;
        }
    }
    
    if (hash.length !== 64) {
        log('System', 'ERROR: Block hash must be exactly 64 characters (32 hexadecimal bytes).');
        return;
    }
    
    // Reset Stats
    elBtnRun.textContent = 'Cancel Work';
    elBtnRun.classList.add('btn-cancel');
    elStatBackend.innerText = 'Calculating...';
    elStatBackend.className = 'stat-value';
    elStatDuration.innerText = 'Calculating...';
    elStatDuration.className = 'stat-value warning';
    elResStatus.innerText = 'Running...';
    elResStatus.style.color = 'var(--warning-color)';
    elResNonce.innerText = '—';
    elResValidation.innerText = '—';
    
    log('System', `Starting PoW generation (Mode: ${mode.toUpperCase()})...`);
    log('System', `Hash: ${hash}`);
    log('System', `Difficulty Threshold: ${threshold}`);

    let wasCancelled = false;
    try {
        log('System', 'Loading and instantiating self-contained WebAssembly module...');
        const tInitStart = performance.now();
        await globalThis.init();
        const tInitEnd = performance.now();
        log('System', `Module loaded successfully in ${(tInitEnd - tInitStart).toFixed(1)} ms.`);
        
        let result;
        const tGenStart = performance.now();
        
        if (mode === 'auto') {
            log('System', 'Checking WebGPU capability...');
            const webgpuOk = await checkWebGpuSupport();
            if (webgpuOk) {
                log('System', 'Running GPU compute smoke test...');
                const computeOk = await checkWebGpuComputeWorks();
                if (!computeOk) {
                    log('System', 'WARNING: WebGPU compute readback returned incorrect results (known Safari/iOS defect). Skipping GPU, using CPU Worker...');
                    result = await generateWorkCpuWorker(hash, threshold);
                } else {
                    log('System', 'Auto Mode: Attempting WebGPU primary...');
                    try {
                        // 5s watchdog — guards against a true GPU process hang.
                        // Cancel button handles user abort.
                        result = await generateWorkGpuWithTimeout(hash, threshold, 5000);
                    } catch (err) {
                        if (err.isGpuTimeout) {
                            log('System', `WARNING: WebGPU watchdog fired after 5s (GPU process may be hung). Falling back to background CPU Worker...`);
                            result = await generateWorkCpuWorker(hash, threshold);
                        } else {
                            // User-initiated cancel or real error — do not fall through
                            wasCancelled = true;
                            throw err;
                        }
                    }
                }
            } else {
                log('System', 'Auto Mode: WebGPU not available or timed out. Falling back directly to background CPU Worker...');
                result = await generateWorkCpuWorker(hash, threshold);
            }
        } else if (mode === 'webgpu') {
            log('WebGPU', 'Checking WebGPU pipeline compatibility...');
            const webgpuOk = await checkWebGpuSupport();
            if (!webgpuOk) {
                throw new Error("WebGPU is not functional or timed out in this browser context.");
            }
            log('WebGPU', 'Running GPU compute smoke test...');
            const computeOk = await checkWebGpuComputeWorks();
            if (!computeOk) {
                log('WebGPU', 'WARNING: Smoke test failed (known Safari/iOS defect) — proceeding anyway as WebGPU is forced.');
            }
            log('WebGPU', 'Forcing WebGPU. Instantiating GPU pipeline...');
            // No timeout — user explicitly wants GPU; cancel button is the only abort.
            activeGpuCancelToken = new globalThis.WasmCancelToken();
            try {
                result = await globalThis.generate_work_gpu(hash, threshold, activeGpuCancelToken);
            } finally {
                activeGpuCancelToken = null;
            }
        } else {
            log('CPU', 'Forcing WASM CPU. Spawning background Web Worker...');
            result = await generateWorkCpuWorker(hash, threshold);
        }
        
        const tGenEnd = performance.now();
        const durationMs = tGenEnd - tGenStart;
        const totalDurationMs = tGenEnd - tInitStart;
        
        // Nonce & Details
        const nonce = result.nonce;
        const isGpu = result.is_gpu;
        const backendName = isGpu ? 'WebGPU' : 'WASM CPU';
        
        log('Success', `PoW exploration finished! Valid Nonce found: ${nonce}`);
        log('Success', `Backend utilized: ${backendName}`);
        log('Success', `Generation Time: ${durationMs.toFixed(1)} ms (Total with init: ${totalDurationMs.toFixed(1)} ms)`);
        
        // Update Diagnostics UI
        elStatBackend.innerText = isGpu ? 'WEBGPU' : 'CPU FALLBACK';
        elStatBackend.className = 'stat-value ' + (isGpu ? 'success' : 'warning');
        
        elStatDuration.innerText = `${durationMs.toFixed(1)} ms`;
        
        elResStatus.innerText = 'PoW Found!';
        elResStatus.style.color = 'var(--success-color)';
        elResNonce.innerText = nonce;
        
        // Local Validation check
        log('System', 'Verifying nonce difficulty locally using WASM validator...');
        const isValid = globalThis.validate_work(hash, nonce, threshold);
        
        elResValidation.innerText = isValid ? 'VALID ✓' : 'INVALID ✗';
        elResValidation.style.color = isValid ? 'var(--success-color)' : '#ef4444';
        
        if (isValid) {
            log('Success', 'Local validation passed! Nonce satisfies network threshold.');
        } else {
            log('System', 'ERROR: Generated nonce failed local validation.');
        }
        
    } catch (err) {
        // Detect cancellation from WASM error message or our flag
        const msg = err.message || String(err);
        if (wasCancelled || msg.toLowerCase().includes('cancel')) {
            log('System', 'Work generation cancelled.');
            elStatBackend.innerText = 'CANCELLED';
            elStatBackend.className = 'stat-value';
            elStatDuration.innerText = '—';
            elResStatus.innerText = 'Cancelled';
            elResStatus.style.color = 'var(--warning-color)';
            elResNonce.innerText = '—';
            elResValidation.innerText = '—';
        } else {
            log('System', `ERROR: ${msg}`);
            elStatBackend.innerText = 'FAILED';
            elStatBackend.className = 'stat-value';
            elStatDuration.innerText = '—';
            elResStatus.innerText = 'Error';
            elResStatus.style.color = '#ef4444';
            elResNonce.innerText = '—';
            elResValidation.innerText = '—';
        }
    } finally {
        elBtnRun.textContent = 'Generate Work';
        elBtnRun.classList.remove('btn-cancel');
        activeGpuCancelToken = null;
        if (activeWorker) {
            activeWorker.terminate();
            activeWorker = null;
        }
    }
});
