use std::path::PathBuf;
use std::process::Command;

/// Entry point behind `cargo benchmark-web`, which is what the root README
/// tells people to run for the browser-only dashboard.
///
/// It resolves the builder script from the crate location rather than the
/// working directory, so it works from anywhere in the workspace. Resolving it
/// relative to the cwd meant running it from a subdirectory failed with a bare
/// Python "can't open file" error, which is a confusing way to learn you were
/// in the wrong place.
fn main() {
    let script = builder_script().unwrap_or_else(|message| {
        eprintln!("error: {message}");
        eprintln!("hint: run this from a nano-rspow checkout, or use `make web-demo`.");
        std::process::exit(1);
    });

    println!("Building the browser-only dashboard via {}", script.display());

    let status = Command::new("python3")
        .arg(&script)
        .status()
        .unwrap_or_else(|error| {
            eprintln!("error: could not run python3: {error}");
            eprintln!("hint: python3 is required; `make web-prereqs` checks for it.");
            std::process::exit(1);
        });

    if !status.success() {
        eprintln!(
            "error: {} exited with {}",
            script.display(),
            status.code().unwrap_or(-1)
        );
        eprintln!("hint: if the build complained about a missing wasm32 target or the");
        eprintln!("      wasm-bindgen CLI, run `make web-prereqs` from the repository root.");
        std::process::exit(status.code().unwrap_or(1));
    }
}

/// Locate `browser-demo/build-demo.py` by walking up from this crate.
fn builder_script() -> Result<PathBuf, String> {
    let mut directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    loop {
        let candidate = directory.join("browser-demo").join("build-demo.py");
        if candidate.is_file() {
            return Ok(candidate);
        }
        if !directory.pop() {
            return Err("could not find browser-demo/build-demo.py above this crate".to_owned());
        }
    }
}
