// Prevents an extra console window from opening on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    agent_observability_lib::run();
}
