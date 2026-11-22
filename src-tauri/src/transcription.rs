use std::{
    path::PathBuf,
    sync::Mutex,
};

#[cfg(not(target_os = "android"))]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct TranscriberState(pub Mutex<Option<TranscriptionService>>);

#[cfg(not(target_os = "android"))]
pub struct TranscriptionService {
    tx: std::sync::mpsc::Sender<JobRequest>,
}

#[cfg(not(target_os = "android"))]
pub struct JobRequest {
    pub audio: Vec<f32>,
    pub prompt: Option<String>,
    pub resp: std::sync::mpsc::Sender<Result<String, String>>,
}

#[cfg(target_os = "android")]
pub struct TranscriptionService;

#[cfg(not(target_os = "android"))]
impl TranscriptionService {
    pub fn new(model_path: PathBuf) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::channel::<JobRequest>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        std::thread::Builder::new()
            .name("whisper-transcriber".into())
            .spawn(move || {
                let ctx = match WhisperContext::new_with_params(
                    model_path.to_string_lossy().as_ref(),
                    WhisperContextParameters::default(),
                ) {
                    Ok(ctx) => {
                        let _ = ready_tx.send(Ok(()));
                        ctx
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("No se pudo cargar el modelo Whisper: {e}")));
                        return;
                    }
                };

                while let Ok(job) = rx.recv() {
                    let result = transcribe_with_ctx(&ctx, &job.audio, job.prompt.as_deref());
                    let _ = job.resp.send(result);
                }
            })
            .map_err(|e| format!("No se pudo iniciar el hilo de transcripción: {e}"))?;

        ready_rx
            .recv()
            .map_err(|_| "El transcriptor no respondió al iniciar".to_string())??;

        Ok(Self { tx })
    }

    pub fn sender(&self) -> std::sync::mpsc::Sender<JobRequest> {
        self.tx.clone()
    }
}

#[cfg(not(target_os = "android"))]
fn transcribe_with_ctx(ctx: &WhisperContext, audio: &[f32], prompt: Option<&str>) -> Result<String, String> {
    if audio.len() < 1600 {
        return Ok(String::new());
    }

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(false);
    params.set_temperature(0.0);
    params.set_max_len(80);
    params.set_n_threads(available_threads());
    if let Some(p) = prompt.filter(|p| !p.trim().is_empty()) {
        params.set_initial_prompt(p);
    }

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("No se pudo crear el estado de Whisper: {e}"))?;
    state
        .full(params, audio)
        .map_err(|e| format!("No se pudo transcribir el audio: {e}"))?;

    let n_segments = state.full_n_segments();
    let mut out = String::new();
    for i in 0..n_segments {
        let segment = state
            .get_segment(i)
            .ok_or_else(|| "No se pudo leer un segmento".to_string())?;
        let text = segment
            .to_str_lossy()
            .map_err(|e| format!("No se pudo leer un segmento: {e}"))?;
        out.push_str(&text);
        out.push(' ');
    }

    Ok(sanitize(&out, audio.len() as f64 / 16000.0))
}

#[cfg(not(target_os = "android"))]
fn available_threads() -> i32 {
    let n = std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(2);
    (n - 1).clamp(1, 4)
}

#[cfg(not(target_os = "android"))]
fn sanitize(text: &str, duration: f64) -> String {
    let cleaned = text
        .replace("[BLANK_AUDIO]", " ")
        .replace("[blank_audio]", " ")
        .replace("[silence]", " ")
        .replace("[inaudible]", " ")
        .replace("[music]", " ")
        .replace("[applause]", " ")
        .replace("[noise]", " ")
        .replace("(silence)", " ")
        .replace("(inaudible)", " ")
        .replace("(music)", " ")
        .replace("(applause)", " ")
        .replace("(noise)", " ");

    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let bare: String = collapsed
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    if bare.is_empty() {
        return String::new();
    }

    if duration < 2.2 {
        let hallucinations = [
            "thankyou",
            "thanksforwatching",
            "pleasesubscribe",
            "subscribe",
            "you",
            "bye",
            "okay",
            "mmhmm",
            "uhhuh",
        ];
        if hallucinations.contains(&bare.as_str()) {
            return String::new();
        }
    }

    let lower = collapsed.to_lowercase();
    if (lower.starts_with("please subscribe") || lower.starts_with("subscribe")) && duration < 4.0 {
        return String::new();
    }
    collapsed
}

#[cfg(target_os = "android")]
impl TranscriptionService {
    pub fn new(_model_path: PathBuf) -> Result<Self, String> {
        Ok(Self)
    }
}
