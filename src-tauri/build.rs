#[path = "src/publisher_config.rs"]
mod publisher_config;
fn main() {
    // Public tracking links only. Publisher configuration is fixed in the distributed build.
    println!("cargo:rerun-if-env-changed=SOFA_PUBLISHER_CONFIG");
    println!("cargo:rerun-if-changed=src/publisher_config.rs");
    println!("cargo:rerun-if-changed=publisher.local.json");
    println!("cargo:rerun-if-changed=publisher.example.json");
    let source = std::path::Path::new("publisher.local.json");
    let config = std::env::var("SOFA_PUBLISHER_CONFIG")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            std::fs::read_to_string(if source.exists() {
                source
            } else {
                std::path::Path::new("publisher.example.json")
            })
            .expect("read publisher configuration")
        });
    let parsed: publisher_config::PublisherConfig = serde_json::from_str(&config)
        .expect("invalid publisher configuration: supply public IDs and approved links only");
    let config = serde_json::to_string(&parsed).expect("serialize publisher configuration");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    std::fs::write(output.join("publisher.json"), config).expect("write publisher configuration");
    tauri_build::build()
}
