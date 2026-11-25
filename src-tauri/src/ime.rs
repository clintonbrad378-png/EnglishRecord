use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use jni::{
    objects::{JFloatArray, JObject, JString},
    sys::jstring,
    JNIEnv,
};

use crate::transcription::{ModelSource, TranscriptionService};

static IME_TRANSCRIBER: OnceLock<Mutex<TranscriptionService>> = OnceLock::new();

fn transcriber() -> &'static Mutex<TranscriptionService> {
    IME_TRANSCRIBER.get_or_init(|| Mutex::new(TranscriptionService::new()))
}

fn throw_runtime(env: &mut JNIEnv, message: &str) {
    let _ = env.exception_clear();
    let _ = env.throw_new("java/lang/RuntimeException", message);
}

#[no_mangle]
pub extern "system" fn Java_com_englishrecord_app_VoiceImeService_nativeTranscribe(
    mut env: JNIEnv,
    _instance: JObject,
    samples: JFloatArray,
    model_path: JString,
) -> jstring {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<String, String> {
        let length = env
            .get_array_length(&samples)
            .map_err(|e| format!("Audio inválido: {e}"))?;
        if length <= 0 {
            return Ok(String::new());
        }

        let mut audio = vec![0f32; length as usize];
        env.get_float_array_region(&samples, 0, &mut audio)
            .map_err(|e| format!("No se pudo leer el audio: {e}"))?;

        let model_path: String = env
            .get_string(&model_path)
            .map_err(|e| format!("Ruta del modelo inválida: {e}"))?
            .into();
        if model_path.is_empty() {
            return Err("No se indicó la ruta del modelo de voz.".to_string());
        }

        let audio = prepare_audio(audio);
        if audio.len() < 1_600 {
            return Ok(String::new());
        }

        let mut guard = transcriber()
            .lock()
            .map_err(|_| "El transcriptor no está disponible.".to_string())?;
        if guard.info().is_none() {
            guard.init(ModelSource::Path(PathBuf::from(model_path)))?;
        }
        let text = guard.transcribe(audio, None, false)?;
        Ok(text.trim().to_string())
    }));

    match result {
        Ok(Ok(text)) => match env.new_string(text) {
            Ok(output) => output.into_raw(),
            Err(error) => {
                throw_runtime(
                    &mut env,
                    &format!("No se pudo devolver el texto transcrito: {error}"),
                );
                std::ptr::null_mut()
            }
        },
        Ok(Err(error)) => {
            throw_runtime(&mut env, &error);
            std::ptr::null_mut()
        }
        Err(_) => {
            throw_runtime(&mut env, "El transcriptor falló inesperadamente.");
            std::ptr::null_mut()
        }
    }
}

fn prepare_audio(audio: Vec<f32>) -> Vec<f32> {
    const FRAME: usize = 320;
    const VOICE_RMS: f32 = 0.006;
    const PADDING_FRAMES: usize = 10;

    let mut first = None;
    let mut last = 0usize;
    for (index, frame) in audio.chunks(FRAME).enumerate() {
        let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
        if rms > VOICE_RMS {
            first.get_or_insert(index);
            last = index;
        }
    }

    let Some(first) = first else {
        return Vec::new();
    };

    let start = first.saturating_sub(PADDING_FRAMES) * FRAME;
    let end = ((last + 1 + PADDING_FRAMES) * FRAME).min(audio.len());
    let mut trimmed = audio[start..end].to_vec();
    if trimmed.is_empty() {
        return trimmed;
    }

    let rms = (trimmed.iter().map(|s| s * s).sum::<f32>() / trimmed.len() as f32).sqrt();
    if rms > 1e-5 {
        let peak = trimmed.iter().fold(0f32, |max, sample| max.max(sample.abs()));
        let target_gain = 0.08 / rms;
        let peak_limit = if peak > 1e-5 { 0.98 / peak } else { target_gain };
        let gain = target_gain.clamp(1.0, 8.0).min(peak_limit);
        if gain > 1.0 {
            for sample in &mut trimmed {
                *sample *= gain;
            }
        }
    }

    trimmed
}
