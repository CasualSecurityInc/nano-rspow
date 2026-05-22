#!/usr/bin/env python3
import os
import re
import sys
import webbrowser
import shutil

def main():
    # 1. Paths Setup
    script_dir = os.path.dirname(os.path.abspath(__file__))
    workspace_dir = os.path.abspath(os.path.join(script_dir, "..", ".."))
    index_html_path = os.path.join(script_dir, "index.html")
    index_template_path = os.path.join(script_dir, "index.template.html")
    nano_pow_bundle_path = os.path.join(script_dir, "nano-pow-bundle.js")
    # Path of the freshly-built bundle from the worktree clone.
    competitor_dist_path = os.path.join(
        workspace_dir,
        "worktrees", "nano-pow-competitor", "vendor", "nano-pow",
        "dist", "main.min.js",
    )
    demo_js_path = os.path.join(script_dir, "demo.js")

    print("=== Competitor Nano PoW Dashboard Builder ===")

    # 2. Verify files and auto-sync bundle
    if not os.path.exists(index_template_path):
        print(f"✗ Error: Template file {index_template_path} not found.")
        sys.exit(1)

    if os.path.exists(competitor_dist_path):
        wt_mtime = os.path.getmtime(competitor_dist_path)
        local_mtime = os.path.getmtime(nano_pow_bundle_path) if os.path.exists(nano_pow_bundle_path) else 0
        if wt_mtime > local_mtime:
            shutil.copy2(competitor_dist_path, nano_pow_bundle_path)
            import datetime
            ts = datetime.datetime.fromtimestamp(wt_mtime).strftime("%Y-%m-%d %H:%M:%S")
            print(f"-> Auto-synced fresh bundle from worktree (built {ts})")
        else:
            print("-> Worktree bundle is not newer; using existing nano-pow-bundle.js")
    elif not os.path.exists(nano_pow_bundle_path):
        print(f"✗ Error: Competitor bundle {nano_pow_bundle_path} not found.")
        print("Please build the worktree first:")
        print("  cd worktrees/nano-pow-competitor/vendor/nano-pow && npm run build")
        sys.exit(1)
    else:
        print("-> Worktree not found; using existing nano-pow-bundle.js")
        
    if not os.path.exists(demo_js_path):
        print(f"✗ Error: UI script {demo_js_path} not found.")
        sys.exit(1)
        
    # Read the WGSL shader for the independent smoke test
    wgsl_path = os.path.join(workspace_dir, "nano-rspow", "src", "wgpu_backend", "pow.wgsl")
    if not os.path.exists(wgsl_path):
        print(f"✗ Error: WGSL shader not found at {wgsl_path}")
        sys.exit(1)
        
    print("\n1. Reading input files...")
    with open(index_template_path, "r") as f:
        template_content = f.read()
        
    with open(nano_pow_bundle_path, "r") as f:
        pow_bundle_content = f.read()
        
    with open(demo_js_path, "r") as f:
        demo_content = f.read()
        
    with open(wgsl_path, "r") as f:
        wgsl_content = f.read()
        
    print("2. Performing HTML template substitutions...")
    # Inject contents
    html_content = template_content.replace("// NANO_POW_BUNDLE", pow_bundle_content)
    html_content = html_content.replace("// DEMO_CODE", demo_content)
    html_content = html_content.replace("// POW_WGSL_SOURCE", wgsl_content)
    
    print("3. Writing single-file dashboard...")
    with open(index_html_path, "w") as f:
        f.write(html_content)
        
    print("✓ Successfully generated single-file competitor playground index.html!")
    
    # 4. Open index.html in the default browser (Safari, etc.)
    file_url = "file://" + index_html_path
    print(f"\n4. Launching the Competitor Dashboard in your default browser:")
    print(f"   URL: {file_url}")
    
    webbrowser.open(file_url)
    print("\n✓ Launch complete. You can now test it in Safari!")

if __name__ == "__main__":
    main()
