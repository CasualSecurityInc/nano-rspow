use std::process::Command;
use std::env;

fn main() {
    println!("=== Launching Nano PoW Web Benchmarking Target ===");
    
    // Find the workspace root or locate the script relative to the current file
    let current_dir = env::current_dir().expect("Failed to get current directory");
    println!("Current working directory: {:?}", current_dir);

    // Run the Python builder script
    let mut cmd = Command::new("python3");
    cmd.arg("nano-rspow-web/browser-demo/build-demo.py");

    let status = cmd.status().expect("Failed to execute python3 build-demo.py script");
    if !status.success() {
        eprintln!("Error: build-demo.py script returned non-zero exit code.");
        std::process::exit(status.code().unwrap_or(1));
    }
}
