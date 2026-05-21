// Global bindings loaded from nano-pow dynamic module import

// Helper to wait for NanoPow to be available
async function ensureNanoPowLoaded() {
    if (globalThis.NanoPow) return;
    return new Promise(resolve => {
        document.addEventListener('nanopow-ready', () => resolve(), { once: true });
    });
}

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
        const hashBytes = '718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2';
        const h = new Uint32Array(8);
        for (let i = 0; i < 8; i++) {
            const b0 = parseInt(hashBytes.slice(i*8+0, i*8+2), 16);
            const b1 = parseInt(hashBytes.slice(i*8+2, i*8+4), 16);
            const b2 = parseInt(hashBytes.slice(i*8+4, i*8+6), 16);
            const b3 = parseInt(hashBytes.slice(i*8+6, i*8+8), 16);
            h[i] = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
        }

        const nonceLo = 0x103259c9 >>> 0;
        const nonceHi = 0xedc20712 >>> 0;
        const threshLo = 0x00000000 >>> 0;
        const threshHi = 0xffff0000 >>> 0;

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
        pass.dispatchWorkgroups(1);
        pass.end();
        enc.copyBufferToBuffer(resultBuf, 0, readBuf, 0, 12);
        device.queue.submit([enc.finish()]);

        await device.queue.onSubmittedWorkDone();
        await readBuf.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(readBuf.getMappedRange());
        const foundFlag  = data[2];
        const nonceLoOut = data[0];
        const nonceHiOut = data[1];
        readBuf.unmap();
        device.destroy();

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

// Setup Page
log('System', 'Initializing page components...');
checkWebGpuSupport().then(supported => {
    if (supported) {
        checkWebGpuComputeWorks().then(computeOk => {
            if (computeOk) {
                log('System', 'WebGPU support verified and fully functional in your browser.');
            } else {
                log('System', 'WARNING: WebGPU is available but compute readback check failed. AUTO mode will use CPU.');
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

// Active generation running status flag
let isRunning = false;

// Click Handler
elBtnRun.addEventListener('click', async () => {
    // If work is in progress, since nano-pow doesn't support cancel, we just force UI reset
    if (isRunning) {
        log('System', 'Note: Competitor nano-pow library does not natively support computation cancellation. Force-resetting UI state.');
        isRunning = false;
        elBtnRun.textContent = 'Generate Work';
        elBtnRun.classList.remove('btn-cancel');
        elStatBackend.innerText = 'CANCELLED / RESET';
        elStatBackend.className = 'stat-value';
        elStatDuration.innerText = '—';
        elResStatus.innerText = 'Cancelled';
        elResStatus.style.color = 'var(--warning-color)';
        elResNonce.innerText = '—';
        elResValidation.innerText = '—';
        return;
    }

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
    isRunning = true;
    elBtnRun.textContent = 'Reset UI State';
    elBtnRun.classList.add('btn-cancel');
    elStatBackend.innerText = 'Calculating...';
    elStatBackend.className = 'stat-value';
    elStatDuration.innerText = 'Calculating...';
    elStatDuration.className = 'stat-value warning';
    elResStatus.innerText = 'Running...';
    elResStatus.style.color = 'var(--warning-color)';
    elResNonce.innerText = '—';
    elResValidation.innerText = '—';
    
    log('System', `Starting PoW generation with competitor's nano-pow library (Mode: ${mode.toUpperCase()})...`);
    log('System', `Hash: ${hash}`);
    log('System', `Difficulty Threshold: ${threshold}`);

    try {
        log('System', 'Ensuring nano-pow ES module is dynamically imported and initialized...');
        const tInitStart = performance.now();
        await ensureNanoPowLoaded();
        const tInitEnd = performance.now();
        log('System', `Competitor library loaded successfully in ${(tInitEnd - tInitStart).toFixed(1)} ms.`);
        
        if (globalThis.localStorage) {
            log('System', "Clearing competitor's internal localStorage PoW cache to force real computation...");
            globalThis.localStorage.removeItem('NanoPowCache');
        }
        
        let apiTarget = 'cpu';
        if (mode === 'auto') {
            log('System', 'Checking WebGPU capability...');
            const webgpuOk = await checkWebGpuSupport();
            if (webgpuOk) {
                log('System', 'Running GPU compute smoke test...');
                const computeOk = await checkWebGpuComputeWorks();
                if (!computeOk) {
                    log('System', 'WARNING: WebGPU compute smoke test failed. Auto falling back to WASM/CPU...');
                    apiTarget = 'cpu';
                } else {
                    log('System', 'Auto Mode: WebGPU support verified. Using WebGPU.');
                    apiTarget = 'webgpu';
                }
            } else {
                log('System', 'Auto Mode: WebGPU not available or timed out. Using CPU.');
                apiTarget = 'cpu';
            }
        } else if (mode === 'webgpu') {
            log('WebGPU', 'Forcing WebGPU mode...');
            apiTarget = 'webgpu';
        } else {
            log('CPU', 'Forcing CPU mode...');
            apiTarget = 'cpu';
        }

        log('System', `Dispatching to nano-pow.work_generate(hash, { api: "${apiTarget}", difficulty: BigInt("0x${threshold}") })...`);
        const tGenStart = performance.now();
        
        // Call the competitor generation API
        const genResult = await globalThis.NanoPow.work_generate(hash, {
            api: apiTarget,
            difficulty: BigInt('0x' + threshold),
            effort: 4,
            debug: true
        });
        
        const tGenEnd = performance.now();
        const durationMs = tGenEnd - tGenStart;
        
        if (!isRunning) {
            log('System', 'Work was discarded due to UI reset.');
            return;
        }

        if (genResult.error) {
            throw new Error(genResult.error);
        }

        // Nonce & Details
        const nonce = genResult.work; // 'work' field contains the nonce in competitor API
        const solvedDifficulty = genResult.difficulty;
        const isGpu = apiTarget === 'webgpu';
        const backendName = isGpu ? 'WebGPU (nano-pow)' : 'CPU (nano-pow)';
        
        log('Success', `PoW exploration finished! Valid Nonce found: ${nonce}`);
        log('Success', `Backend utilized: ${backendName}`);
        log('Success', `Result Difficulty: ${solvedDifficulty}`);
        log('Success', `Generation Time: ${durationMs.toFixed(1)} ms`);
        
        // Update Diagnostics UI
        elStatBackend.innerText = isGpu ? 'WEBGPU (COMP)' : 'CPU (COMP)';
        elStatBackend.className = 'stat-value ' + (isGpu ? 'success' : 'warning');
        elStatDuration.innerText = `${durationMs.toFixed(1)} ms`;
        
        elResStatus.innerText = 'PoW Found!';
        elResStatus.style.color = 'var(--success-color)';
        elResNonce.innerText = nonce;
        
        // Local Validation check using competitor validation API
        log('System', 'Verifying nonce difficulty locally using competitor work_validate API...');
        const valResult = await globalThis.NanoPow.work_validate(nonce, hash, {
            difficulty: BigInt('0x' + threshold),
            debug: true
        });

        if (valResult.error) {
            throw new Error("Validation error: " + valResult.error);
        }
        
        const isValid = valResult.valid === '1';
        
        elResValidation.innerText = isValid ? 'VALID ✓' : 'INVALID ✗';
        elResValidation.style.color = isValid ? 'var(--success-color)' : '#ef4444';
        
        if (isValid) {
            log('Success', `Local validation passed! Nonce satisfies network threshold.`);
            log('Success', `Details: valid_all=${valResult.valid_all}, valid_receive=${valResult.valid_receive}`);
        } else {
            log('System', `ERROR: Generated nonce failed validation check.`);
        }
        
    } catch (err) {
        const msg = err.message || String(err);
        log('System', `ERROR: ${msg}`);
        elStatBackend.innerText = 'FAILED';
        elStatBackend.className = 'stat-value';
        elStatDuration.innerText = '—';
        elResStatus.innerText = 'Error';
        elResStatus.style.color = '#ef4444';
        elResNonce.innerText = '—';
        elResValidation.innerText = '—';
    } finally {
        elBtnRun.textContent = 'Generate Work';
        elBtnRun.classList.remove('btn-cancel');
        isRunning = false;
    }
});
