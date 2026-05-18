fn main() {
    // Add the directory containing the Python.framework to the framework search path
    println!("cargo:rustc-link-search=framework=/opt/homebrew/opt/python@3.14/Frameworks");
    // Link the Python framework
    println!("cargo:rustc-link-lib=framework=Python");
    
    // Also, we might need to link against the Python library explicitly if the framework doesn't do it?
    // But linking the framework should be enough.
    println!("cargo:warning=Linking Python framework via rustc-link-search and rustc-link-lib");
}