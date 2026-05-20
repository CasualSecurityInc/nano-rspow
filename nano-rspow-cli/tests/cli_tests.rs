use std::io::Write;
use std::process::{Command, Stdio};

fn get_bin_path() -> String {
    env!("CARGO_BIN_EXE_nano-rspow").to_string()
}

#[test]
fn test_cli_oneshot_generate() {
    let output = Command::new(get_bin_path())
        .arg("generate")
        .arg("718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2")
        .arg("--threshold")
        .arg("fe00000000000000") // Use truly low dev threshold for fast tests
        .arg("--backend")
        .arg("cpu") // Force CPU backend to avoid GPU initialization overhead in CI
        .output()
        .expect("Failed to execute command");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("Work      : "));
}

#[test]
fn test_cli_stream_mode() {
    let mut child = Command::new(get_bin_path())
        .arg("generate")
        .arg("--stream")
        .arg("--threshold")
        .arg("fe00000000000000") // Use truly low dev threshold for fast tests
        .arg("--backend")
        .arg("cpu")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("Failed to spawn command");

    let mut stdin = child.stdin.take().expect("Failed to open stdin");

    // We write two hashes, both with a custom low threshold starting with 0x
    let hash1 = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    let hash1_in = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2:0xfe00000000000000";
    let hash2_in = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2:0xff00000000000000";

    writeln!(stdin, "{}", hash1_in).unwrap();
    writeln!(stdin, "{}", hash2_in).unwrap();
    
    // Close stdin to signal EOF and allow the stream loop to exit
    drop(stdin); 

    let output = child.wait_with_output().expect("Failed to read stdout");
    assert!(output.status.success());

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.trim().lines().collect();

    assert_eq!(lines.len(), 2, "Should output exactly 2 lines");
    assert!(lines[0].starts_with(&format!("{}:0xfe00000000000000:", hash1)));
    assert!(lines[1].starts_with(&format!("{}:0xff00000000000000:", hash1)));
}

#[test]
fn test_cli_diag_json_parseable() {
    let output = Command::new(get_bin_path())
        .arg("diag")
        .arg("--backend")
        .arg("cpu")
        .arg("--format")
        .arg("json")
        .output()
        .expect("Failed to execute command");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("\"backend\":\"cpu\""));
    assert!(stdout.contains("\"gpu\":null"));
}

#[test]
fn test_cli_benchmark_warm_retune_count1() {
    let output = Command::new(get_bin_path())
        .arg("benchmark")
        .arg("--mode")
        .arg("warm")
        .arg("--retune")
        .arg("--count")
        .arg("1")
        .arg("--tier")
        .arg("dev") // Limit to dev tier to make the test pass instantly
        .output()
        .expect("Failed to execute command");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("nano-rspow benchmark"));
}

#[test]
fn test_cli_benchmark_json_parseable() {
    let output = Command::new(get_bin_path())
        .arg("benchmark")
        .arg("--format")
        .arg("json")
        .arg("--count")
        .arg("1")
        .arg("--mode")
        .arg("warm")
        .arg("--backend")
        .arg("cpu")
        .arg("--tier")
        .arg("dev")
        .output()
        .expect("Failed to execute command");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout).expect("benchmark output should be valid JSON");
    assert_eq!(json["backend"], "cpu");
    assert_eq!(json["tier"], "dev");
    assert!(json["rows"].as_array().unwrap().len() == 1);
    assert!(json["backends"].as_array().unwrap().len() == 1);
    assert!(json["backends"][0]["timings"]["warmup_ms"].is_number());
}
