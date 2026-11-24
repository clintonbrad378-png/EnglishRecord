use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager};

use crate::storage::{self, RecordingMeta, StorageInfo};

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver el directorio de datos: {e}"))?;
    storage::ensure_dirs(&dir)
        .map_err(|e| format!("No se pudo crear el directorio de datos: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn list_recordings(app: AppHandle) -> Result<Vec<RecordingMeta>, String> {
    let dir = data_dir(&app)?;
    storage::list_recordings(&dir)
        .map_err(|e| format!("No se pudieron listar las grabaciones: {e}"))
}

#[tauri::command]
pub fn get_recording(app: AppHandle, id: String) -> Result<Option<RecordingMeta>, String> {
    let dir = data_dir(&app)?;
    storage::get_meta(&dir, &id).map_err(|e| format!("No se pudo leer la grabación: {e}"))
}

#[tauri::command]
pub fn get_audio_base64(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = data_dir(&app)?;
    let bytes =
        storage::get_audio(&dir, &id).map_err(|e| format!("No se pudo leer el audio: {e}"))?;
    Ok(bytes.map(|b| STANDARD.encode(b)))
}

#[tauri::command]
pub fn save_recording(
    app: AppHandle,
    meta: RecordingMeta,
    audio_base64: Option<String>,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let audio = match audio_base64 {
        Some(b64) if !b64.is_empty() => Some(
            STANDARD
                .decode(b64.as_bytes())
                .map_err(|e| format!("Audio base64 inválido: {e}"))?,
        ),
        _ => None,
    };
    storage::save_recording(&dir, &meta, audio.as_deref())
        .map_err(|e| format!("No se pudo guardar la grabación: {e}"))
}

#[tauri::command]
pub fn save_meta(app: AppHandle, meta: RecordingMeta) -> Result<(), String> {
    let dir = data_dir(&app)?;
    storage::save_meta(&dir, &meta).map_err(|e| format!("No se pudo guardar la grabación: {e}"))
}

#[tauri::command]
pub fn delete_recording(app: AppHandle, id: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    storage::delete_recording(&dir, &id)
        .map_err(|e| format!("No se pudo eliminar la grabación: {e}"))
}

#[tauri::command]
pub fn storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    let dir = data_dir(&app)?;
    storage::storage_usage(&dir).map_err(|e| format!("No se pudo obtener el almacenamiento: {e}"))
}
