import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const pkgDir = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow-web/browser-demo/pkg';
const templatePath = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow-web/browser-demo/index.template.html';
const demoPath = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow-web/browser-demo/demo.js';
const wgslPath = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow/src/wgpu_backend/pow.wgsl';
const outputPath = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow-web/browser-demo/index.html';
const pkgJsonPath = '/Users/conny/Developer/CasualSecurityInc/nano-rspow/nano-rspow-web/package.json';

console.log('Building self-contained benchmark dashboard...');

// 1. Read WASM and convert to base64
const wasmData = readFileSync(join(pkgDir, 'nano_rspow_web_bg.wasm'));
const wasmBase64 = wasmData.toString('base64');
console.log(`✓ WASM size: ${wasmData.length} bytes, base64: ${wasmBase64.length} chars`);

// 2. Read JS loader
let jsContent = readFileSync(join(pkgDir, 'nano_rspow_web.js'), 'utf-8');

// 3. Inline base64 at the top
jsContent = `const wasmBase64 = "${wasmBase64}";\n\n` + jsContent;

// 4. Replace the fetch URL with inlined Uint8Array decoding
const targetPattern = `    if (module_or_path === undefined) {
        module_or_path = new URL('nano_rspow_web_bg.wasm', import.meta.url);
    }`;

const replacementPattern = `    if (module_or_path === undefined) {
        const base64 = wasmBase64;
        const raw = globalThis.atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        module_or_path = bytes;
    }`;

if (jsContent.includes(targetPattern)) {
    jsContent = jsContent.replace(targetPattern, replacementPattern);
    console.log('✓ Inlined WASM binary into JavaScript loader');
} else {
    // Fallback
    const fallbackTarget = "module_or_path = new URL('nano_rspow_web_bg.wasm', import.meta.url);";
    if (jsContent.includes(fallbackTarget)) {
        const fallbackReplacement = `const base64 = wasmBase64;
        const raw = globalThis.atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        module_or_path = bytes;`;
        jsContent = jsContent.replace(fallbackTarget, fallbackReplacement);
        console.log('✓ Inlined WASM using fallback');
    } else {
        console.error('✗ Could not find WASM loader injection point');
        process.exit(1);
    }
}

// 5. Strip ES export syntax
jsContent = jsContent.replace(/\bexport (class|function) /g, '$1 ');
console.log('✓ Stripped ES export syntax');

// 6. Replace final export with global bindings
const finalExportPattern = "export { initSync, __wbg_init as default };";
const globalBindings = `
// Binds to globalThis for worker & window context support
globalThis.GenerateResult = GenerateResult;
globalThis.WasmCancelToken = WasmCancelToken;
globalThis.generate_work = generate_work;
globalThis.generate_work_cpu = generate_work_cpu;
globalThis.generate_work_cpu_batch = generate_work_cpu_batch;
globalThis.generate_work_gpu = generate_work_gpu;
globalThis.validate_work = validate_work;
globalThis.init = __wbg_init;
globalThis.initSync = initSync;
`;

if (jsContent.includes(finalExportPattern)) {
    jsContent = jsContent.replace(finalExportPattern, globalBindings);
    console.log('✓ Adapted ES exports to global bindings');
} else {
    console.log('⚠ Could not locate final export block, appending globals');
    jsContent = jsContent.replace("export {", "// export {");
    jsContent += globalBindings;
}

// 7. Read template and other files
const templateContent = readFileSync(templatePath, 'utf-8');
const demoContent = readFileSync(demoPath, 'utf-8');
const wgslContent = readFileSync(wgslPath, 'utf-8');
const pkgData = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
const crateVersion = pkgData.version;

// 8. Perform substitutions
let htmlContent = templateContent
    .replace('// WASM_GLUE_CODE', jsContent)
    .replace('// DEMO_CODE', demoContent)
    .replace('// POW_WGSL_SOURCE', wgslContent)
    .replace('// CRATE_VERSION', `v${crateVersion}`);

// 9. Write output
writeFileSync(outputPath, htmlContent);
console.log(`✓ Generated self-contained dashboard: ${outputPath}`);
console.log('✓ Build complete!');