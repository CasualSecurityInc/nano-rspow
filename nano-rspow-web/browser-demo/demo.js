// Global bindings loaded from wasm-bindgen

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
    { value: 'ffff000000000000', label: 'Dev / Smoketest Threshold (0xffff000000000000)' },
    { value: 'fffffe0000000000', label: 'Receive / State-block Threshold (0xfffffe0000000000)' },
    { value: 'ffffffc000000000', label: 'Send / Epoch-block Threshold (0xffffffc000000000)' }
];

let currentDiffIndex = 0; // Default: Dev / Smoketest

function setDifficultyIndex(index) {
    if (index < 0 || index >= difficultyLevels.length) return;
    currentDiffIndex = index;
    
    const level = difficultyLevels[index];
    if (elDifficulty) elDifficulty.value = level.value;
    if (elDiffLabel) elDiffLabel.textContent = level.label;
    
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

// Web Worker template and variables
let activeWorker = null;

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
            
            activeWorker.onmessage = function(e) {
                const { type, result, error } = e.data;
                activeWorker.terminate();
                activeWorker = null;
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
                URL.revokeObjectURL(workerUrl);
                reject(new Error("Web Worker error: " + e.message));
            };
            
            activeWorker.postMessage({ hash, threshold });
        } catch (err) {
            reject(err);
        }
    });
}

// Timeout-protected WebGPU runner
async function generateWorkGpuWithTimeout(hash, threshold, timeoutMs = 5000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error("WebGPU execution timed out (Safari GPU process hung)"));
        }, timeoutMs);
    });
    
    try {
        const result = await Promise.race([
            globalThis.generate_work_gpu(hash, threshold),
            timeoutPromise
        ]);
        clearTimeout(timeoutId);
        return result;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// Setup Page
log('System', 'Initializing page components...');
checkWebGpuSupport().then(supported => {
    if (supported) {
        log('System', 'WebGPU support verified and fully functional in your browser.');
    } else {
        log('System', 'WARNING: WebGPU is NOT supported, not enabled, or timed out. WebGPU mode will fail, but CPU mode will function.');
    }
});

// Click Handler
elBtnRun.addEventListener('click', async () => {
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
    elBtnRun.disabled = true;
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
                log('System', 'Auto Mode: Attempting WebGPU primary...');
                try {
                    // Attempt WebGPU with a 5-second timeout
                    result = await generateWorkGpuWithTimeout(hash, threshold, 5000);
                } catch (err) {
                    log('System', `WARNING: WebGPU attempt failed or timed out: ${err.message}. Falling back directly to background CPU Worker...`);
                    result = await generateWorkCpuWorker(hash, threshold);
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
            log('WebGPU', 'Forcing WebGPU. Instantiating GPU pipeline...');
            result = await generateWorkGpuWithTimeout(hash, threshold, 5000);
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
        const backendName = isGpu ? 'WebGPU' : 'WASM CPU Fallback';
        
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
        log('System', `ERROR: ${err.message || err}`);
        elStatBackend.innerText = 'FAILED';
        elStatBackend.className = 'stat-value';
        elStatDuration.innerText = '—';
        elResStatus.innerText = 'Error';
        elResStatus.style.color = '#ef4444';
        elResNonce.innerText = '—';
        elResValidation.innerText = '—';
    } finally {
        elBtnRun.disabled = false;
        if (activeWorker) {
            activeWorker.terminate();
            activeWorker = null;
        }
    }
});
