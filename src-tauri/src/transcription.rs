use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use whisper_rs::{
    FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState,
};

#[cfg(target_os = "android")]
use crate::android_assets::read_android_asset;

pub struct TranscriberState(pub Mutex<Option<TranscriptionService>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriberInfo {
    pub engine: String,
    pub threads: i32,
    pub model: String,
    pub model_load_ms: u64,
}

#[derive(Clone, Debug)]
pub enum ModelSource {
    Path(PathBuf),
    AndroidAsset(&'static str),
}

pub(crate) struct JobRequest {
    pub audio: Vec<f32>,
    pub prompt: Option<String>,
    pub quality: bool,
    pub resp: mpsc::Sender<Result<String, String>>,
}

pub struct TranscriptionService {
    tx: Option<mpsc::Sender<JobRequest>>,
    ready: Arc<AtomicBool>,
    info: Option<TranscriberInfo>,
}

impl TranscriptionService {
    pub fn new() -> Self {
        Self {
            tx: None,
            ready: Arc::new(AtomicBool::new(false)),
            info: None,
        }
    }

    pub fn init(&mut self, source: ModelSource) -> Result<TranscriberInfo, String> {
        if let Some(info) = &self.info {
            if self.tx.is_some() && self.ready.load(Ordering::SeqCst) {
                return Ok(info.clone());
            }
        }

        let (tx, rx) = mpsc::channel::<JobRequest>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<TranscriberInfo, String>>(1);
        let ready = Arc::new(AtomicBool::new(false));
        let ready_flag = ready.clone();

        thread::Builder::new()
            .name("whisper-transcriber".into())
            .spawn(move || {
                let started = std::time::Instant::now();
                let threads = available_threads();
                let model_name = match &source {
                    ModelSource::Path(p) => p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("ggml-base.en-q5_1.bin")
                        .to_string(),
                    ModelSource::AndroidAsset(_) => "ggml-base.en-q5_1.bin".to_string(),
                };

                let load_result: Result<(WhisperContext, WhisperState), String> = (|| {
                    let ctx = load_context(&source)?;
                    let state = ctx
                        .create_state()
                        .map_err(|e| format!("No se pudo crear el estado de Whisper: {e}"))?;
                    Ok((ctx, state))
                })(
                );

                let (ctx, mut state) = match load_result {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };

                let info = TranscriberInfo {
                    engine: "native".to_string(),
                    threads,
                    model: model_name,
                    model_load_ms: started.elapsed().as_millis() as u64,
                };
                ready_flag.store(true, Ordering::SeqCst);
                let _ = ready_tx.send(Ok(info));

                while let Ok(job) = rx.recv() {
                    let result = transcribe_with_ctx(
                        &ctx,
                        &mut state,
                        &job.audio,
                        job.prompt.as_deref(),
                        job.quality,
                        threads,
                    );
                    let _ = job.resp.send(result);
                }
            })
            .map_err(|e| format!("No se pudo iniciar el hilo de transcripción: {e}"))?;

        let info = ready_rx
            .recv_timeout(Duration::from_secs(180))
            .map_err(|_| "El transcriptor no respondió al iniciar".to_string())??;

        self.tx = Some(tx);
        self.ready = ready;
        self.info = Some(info.clone());
        Ok(info)
    }

    pub fn transcribe(
        &self,
        audio: Vec<f32>,
        prompt: Option<String>,
        quality: bool,
    ) -> Result<String, String> {
        let tx = self.sender()?;
        let (resp_tx, resp_rx) = mpsc::channel();
        tx.send(JobRequest {
            audio,
            prompt,
            quality,
            resp: resp_tx,
        })
        .map_err(|_| "El transcriptor no está disponible".to_string())?;
        resp_rx
            .recv_timeout(Duration::from_secs(600))
            .map_err(|_| "La transcripción tardó demasiado".to_string())?
    }

    pub fn sender(&self) -> Result<mpsc::Sender<JobRequest>, String> {
        let tx = self
            .tx
            .as_ref()
            .ok_or_else(|| "El transcriptor no está inicializado".to_string())?;
        if !self.ready.load(Ordering::SeqCst) {
            return Err("El transcriptor no está listo".to_string());
        }
        Ok(tx.clone())
    }

    pub fn info(&self) -> Option<TranscriberInfo> {
        self.info.clone()
    }
}

fn load_context(source: &ModelSource) -> Result<WhisperContext, String> {
    let mut params = WhisperContextParameters::default();
    params.use_gpu(false);
    match source {
        ModelSource::Path(path) => {
            WhisperContext::new_with_params(path.to_string_lossy().as_ref(), params)
                .map_err(|e| format!("No se pudo cargar el modelo Whisper: {e}"))
        }
        ModelSource::AndroidAsset(path) => {
            #[cfg(target_os = "android")]
            {
                let bytes = read_android_asset(path)?;
                WhisperContext::new_from_buffer_with_params(&bytes, params)
                    .map_err(|e| format!("No se pudo cargar el modelo Whisper desde asset: {e}"))
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = path;
                Err("Asset Android no disponible en esta plataforma".to_string())
            }
        }
    }
}

fn transcribe_with_ctx(
    _ctx: &WhisperContext,
    state: &mut WhisperState,
    audio: &[f32],
    prompt: Option<&str>,
    quality: bool,
    threads: i32,
) -> Result<String, String> {
    if audio.len() < 1600 {
        return Ok(String::new());
    }

    let strategy = if quality {
        SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: -1.0,
        }
    } else {
        SamplingStrategy::Greedy { best_of: 1 }
    };
    let mut params = FullParams::new(strategy);
    params.set_language(Some("en"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_token_timestamps(false);
    params.set_temperature(0.0);
    params.set_temperature_inc(0.2);
    params.set_n_threads(threads);
    params.set_no_speech_thold(0.6);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    if let Some(p) = prompt.filter(|p| !p.trim().is_empty()) {
        params.set_initial_prompt(p);
    }

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

fn available_threads() -> i32 {
    let n = std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(2);
    (n - 1).clamp(1, 4)
}

fn sanitize(text: &str, duration: f64) -> String {
    let cleaned = text
        .replace("[BLANK_AUDIO]", " ")
        .replace("[blank_audio]", " ")
        .replace("[silence]", " ")
        .replace("[inaudible]", " ")
        .replace("[music]", " ")
        .replace("[musical]", " ")
        .replace("[applause]", " ")
        .replace("[laughter]", " ")
        .replace("[noise]", " ")
        .replace("(silence)", " ")
        .replace("(inaudible)", " ")
        .replace("(music)", " ")
        .replace("(applause)", " ")
        .replace("(laughter)", " ")
        .replace("(noise)", " ")
        .replace('♪', " ")
        .replace('♫', " ")
        .replace('♬', " ")
        .replace('♩', " ");

    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let bare: String = collapsed
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    if bare.is_empty() {
        return String::new();
    }

    if duration < 2.6 {
        let hallucinations = [
            "thankyou",
            "thankyouverymuch",
            "thanksforwatching",
            "thanksforlistening",
            "pleasesubscribe",
            "subscribe",
            "goodbye",
            "goodnight",
            "music",
            "applause",
            "you",
            "bye",
            "okay",
            "oh",
            "mmhmm",
            "uhhuh",
        ];
        if hallucinations.contains(&bare.as_str()) {
            return String::new();
        }
    }

    let lower = collapsed.to_lowercase();
    let artifact = [
        "thanks for watching",
        "thank you for watching",
        "please subscribe",
        "please like and subscribe",
        "subscribe to my channel",
        "subscribe to the channel",
        "subtitles by",
        "transcribed by",
        "amara.org",
    ];
    if duration < 6.0 && artifact.iter().any(|pattern| lower.contains(pattern)) {
        return String::new();
    }
    collapsed
}
