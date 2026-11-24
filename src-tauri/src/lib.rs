#[cfg(target_os = "android")]
mod android_assets;
mod commands;
mod storage;
mod transcription;

use std::sync::Mutex;
use tauri::webview::{PermissionKind, PermissionResponse};

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
