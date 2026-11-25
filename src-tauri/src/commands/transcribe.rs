use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, Manager, State};

use crate::transcription::{ModelSource, TranscriberInfo, TranscriberState};

fn resolve_model_source(app: &AppHandle) -> Result<ModelSource, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Ok(ModelSource::AndroidAsset(
            "resources/models/ggml-base.en-q5_1.bin",
        ));
    }

    #[cfg(not(target_os = "android"))]
    {
        let resource = app
            .path()
            .resource_dir()
            .map_err(|e| format!("No se pudo resolver el directorio de recursos: {e}"))?
            .join("models")
            .join("ggml-base.en-q5_1.bin");
        if resource.exists() {
            return Ok(ModelSource::Path(resource));
        }

        let dev_fallback = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models")
            .join("ggml-base.en-q5_1.bin");
        if dev_fallback.exists() {
            return Ok(ModelSource::Path(dev_fallback));
        }

        Err("No se encontró el modelo ggml-base.en-q5_1.bin".to_string())
    }
}

#[tauri::command]
pub async fn init_transcriber(
    app: AppHandle,
    state: State<'_, TranscriberState>,
) -> Result<TranscriberInfo, String> {
    {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Estado del transcriptor inválido".to_string())?;
        if let Some(service) = guard.as_ref() {
            if let Some(info) = service.info() {
                return Ok(info);
            }
        }
    }

    let source = resolve_model_source(&app)?;
    let service_info = tauri::async_runtime::spawn_blocking(move || {
        let mut service = crate::transcription::TranscriptionService::new();
        let info = service.init(source)?;
        Ok::<_, String>((service, info))
    })
    .await
    .map_err(|e| format!("No se pudo inicializar el transcriptor: {e}"))??;

    let (service, info) = service_info;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Estado del transcriptor inválido".to_string())?;
    if guard.as_ref().and_then(|s| s.info()).is_none() {
        *guard = Some(service);
    }
    Ok(info)
}

#[tauri::command]
pub async fn transcribe_audio(
    audio_base64: String,
    prompt: Option<String>,
    quality: Option<bool>,
    state: State<'_, TranscriberState>,
) -> Result<String, String> {
    let bytes = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|e| format!("Audio inválido: {e}"))?;
    if bytes.len() % 4 != 0 {
        return Err("Audio inválido".to_string());
    }
    let mut audio = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        audio.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }

    let tx = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Estado del transcriptor inválido".to_string())?;
        let service = guard
            .as_ref()
            .ok_or_else(|| "El transcriptor no está inicializado".to_string())?;
        service.sender()?
    };

    tauri::async_runtime::spawn_blocking(move || {
        let (resp_tx, resp_rx) = std::sync::mpsc::channel();
        tx.send(crate::transcription::JobRequest {
            audio,
            prompt,
            quality: quality.unwrap_or(false),
            resp: resp_tx,
        })
        .map_err(|_| "El transcriptor no está disponible".to_string())?;
        resp_rx
            .recv_timeout(std::time::Duration::from_secs(600))
            .map_err(|_| "La transcripción tardó demasiado".to_string())?
    })
    .await
    .map_err(|e| format!("Error de transcripción: {e}"))?
}
