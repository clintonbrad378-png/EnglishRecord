mod commands;
mod storage;
mod transcription;

use std::sync::Mutex;
use tauri::{Manager, webview::{PermissionKind, PermissionResponse}};

use transcription::TranscriberState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TranscriberState(Mutex::new(None)))
        .on_permission_request(|_webview, kind| match kind {
            PermissionKind::Microphone
            | PermissionKind::Camera
            | PermissionKind::DisplayCapture
            | PermissionKind::Autoplay => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<TranscriberState>();
                let model_path = {
                    let resource = handle
                        .path()
                        .resource_dir()
                        .ok()
                        .map(|p| p.join("models").join("ggml-base.en-q5_1.bin"));
                    if let Some(p) = resource.filter(|p| p.exists()) {
                        p
                    } else {
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("resources")
                            .join("models")
                            .join("ggml-base.en-q5_1.bin")
                    }
                };
                let service = transcription::TranscriptionService::new(model_path);
                if let Ok(service) = service {
                    if let Ok(mut guard) = state.0.lock() {
                        *guard = Some(service);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::recordings::list_recordings,
            commands::recordings::get_recording,
            commands::recordings::get_audio_base64,
            commands::recordings::save_recording,
            commands::recordings::save_meta,
            commands::recordings::delete_recording,
            commands::recordings::storage_info,
            commands::transcribe::init_transcriber,
            commands::transcribe::transcribe_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running English Record");
}
