#!/usr/bin/env python3
import os
import sys
import base64
import subprocess
import webbrowser

def main():
    # 1. Paths Setup
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.abspath(os.path.join(script_dir, "..", ".."))
    pkg_dir = os.path.join(script_dir, "pkg")
    index_html_path = os.path.join(script_dir, "index.html")
    
    print("=== Nano PoW Web Benchmark Builder ===")
    
    # 2. Build the Rust WASM crate
    print("\n1. Compiling nano-rspow-web to wasm32 target in release mode...")
    build_cmd = [
        "cargo", "build", 
        "-p", "nano-rspow-web", 
        "--target", "wasm32-unknown-unknown", 
        "--release"
    ]
    try:
        subprocess.run(build_cmd, cwd=workspace_dir, check=True)
        print("✓ Compilation successful!")
    except subprocess.CalledProcessError as e:
        print(f"✗ Cargo compilation failed: {e}")
        sys.exit(1)
        
    # 3. Run wasm-bindgen
    print("\n2. Generating JS bindings via wasm-bindgen...")
    wasm_file = os.path.join(workspace_dir, "target", "wasm32-unknown-unknown", "release", "nano_rspow_web.wasm")
    bindgen_cmd = [
        "wasm-bindgen",
        "--target", "web",
        "--out-dir", pkg_dir,
        wasm_file
    ]
    try:
        subprocess.run(bindgen_cmd, cwd=workspace_dir, check=True)
        print("✓ JS bindings generated successfully!")
    except subprocess.CalledProcessError as e:
        print(f"✗ wasm-bindgen failed: {e}")
        sys.exit(1)
        
    # 4. Inline the WASM file as Base64 into the JS loader
    print("\n3. Converting and inlining WASM binary as Base64...")
    wasm_bg_file = os.path.join(pkg_dir, "nano_rspow_web_bg.wasm")
    js_loader_file = os.path.join(pkg_dir, "nano_rspow_web.js")
    
    if not os.path.exists(wasm_bg_file) or not os.path.exists(js_loader_file):
        print("✗ Error: Generated binding files not found.")
        sys.exit(1)
        
    with open(wasm_bg_file, "rb") as f:
        wasm_data = f.read()
    
    wasm_base64 = base64.b64encode(wasm_data).decode("utf-8")
    
    with open(js_loader_file, "r") as f:
        js_content = f.read()
        
    # Inject base64 at the very top
    js_inlined = f"const wasmBase64 = \"{wasm_base64}\";\n\n" + js_content
    
    # Replace the fetch URL with inlined Uint8Array decoding
    target_pattern = """    if (module_or_path === undefined) {
        module_or_path = new URL('nano_rspow_web_bg.wasm', import.meta.url);
    }"""
    
    replacement_pattern = """    if (module_or_path === undefined) {
        const base64 = wasmBase64;
        const raw = globalThis.atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        module_or_path = bytes;
    }"""
    
    if target_pattern in js_inlined:
        js_inlined = js_inlined.replace(target_pattern, replacement_pattern)
        print("✓ Inlined WASM binary directly into JavaScript loader!")
    else:
        # Fallback if wasm-bindgen output slightly differs
        print("⚠ Warning: Standard fetch pattern not matched exactly. Attempting fallback replace...")
        fallback_target = "module_or_path = new URL('nano_rspow_web_bg.wasm', import.meta.url);"
        if fallback_target in js_inlined:
            fallback_replacement = """const base64 = wasmBase64;
        const raw = globalThis.atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        module_or_path = bytes;"""
            js_inlined = js_inlined.replace(fallback_target, fallback_replacement)
            print("✓ Inlined WASM binary using fallback match!")
        else:
            print("✗ Error: Could not locate WASM loader injection point in the generated JS file.")
            sys.exit(1)
            
    # 4b. Strip ES export syntax to make it compatible with regular non-module <script> tags over file://
    print("\n3b. Adapting exports for non-module script tag (file:// compatibility)...")
    js_inlined = js_inlined.replace("export class GenerateResult ", "class GenerateResult ")
    js_inlined = js_inlined.replace("export function generate_work(", "function generate_work(")
    js_inlined = js_inlined.replace("export function generate_work_cpu(", "function generate_work_cpu(")
    js_inlined = js_inlined.replace("export function generate_work_gpu(", "function generate_work_gpu(")
    js_inlined = js_inlined.replace("export function validate_work(", "function validate_work(")
    
    # Replace the final export statement
    final_export_pattern = "export { initSync, __wbg_init as default };"
    global_bindings = """
// Binds to globalThis for worker & window context support
globalThis.GenerateResult = GenerateResult;
globalThis.generate_work = generate_work;
globalThis.generate_work_cpu = generate_work_cpu;
globalThis.generate_work_gpu = generate_work_gpu;
globalThis.validate_work = validate_work;
globalThis.init = __wbg_init;
globalThis.initSync = initSync;
"""
    if final_export_pattern in js_inlined:
        js_inlined = js_inlined.replace(final_export_pattern, global_bindings)
        print("✓ Successfully adapted ES exports to global window bindings!")
    else:
        print("⚠ Warning: Could not locate final export block. Trying fallback replace...")
        js_inlined = js_inlined.replace("export {", "// export {")
        js_inlined += global_bindings
            
    # 5. Inline all scripts into index.template.html to generate a single self-contained index.html file
    print("\n4. Inlining JS and WebAssembly directly into HTML...")
    index_template_path = os.path.join(script_dir, "index.template.html")
    demo_js_path = os.path.join(script_dir, "demo.js")
    
    if not os.path.exists(index_template_path):
        print(f"✗ Error: Template file {index_template_path} not found.")
        sys.exit(1)
        
    if not os.path.exists(demo_js_path):
        print(f"✗ Error: UI script {demo_js_path} not found.")
        sys.exit(1)
        
    with open(index_template_path, "r") as f:
        template_content = f.read()
        
    with open(demo_js_path, "r") as f:
        demo_content = f.read()
        
    # Perform substitutions
    html_content = template_content.replace("// WASM_GLUE_CODE", js_inlined)
    html_content = html_content.replace("// DEMO_CODE", demo_content)
    
    with open(index_html_path, "w") as f:
        f.write(html_content)
    print("✓ Successfully generated single-file self-contained dashboard!")
    
    # Clean up temporary build artifacts
    import shutil
    if os.path.exists(pkg_dir):
        shutil.rmtree(pkg_dir)
    print("✓ Cleaned up external pkg directory. Crate benchmark is now fully self-contained.")
    
    # 6. Open index.html in the browser
    file_url = "file://" + index_html_path
    print(f"\n5. Launching the Benchmarking Dashboard in your default browser:")
    print(f"   URL: {file_url}")
    
    webbrowser.open(file_url)
    print("\n✓ Launch complete. Enjoy the dashboard!")

if __name__ == "__main__":
    main()
