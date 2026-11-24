use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptChunk {
    pub id: String,
    pub text: String,
    pub t0: f64,
    pub t1: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeta {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub duration: f64,
    pub sample_rate: u32,
    #[serde(default)]
    pub peaks: Vec<f32>,
    #[serde(default)]
    pub transcript: Vec<TranscriptChunk>,
    #[serde(default)]
    pub word_count: u32,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub transcribed: bool,
    #[serde(default)]
    pub had_speech: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub usage: u64,
    pub quota: u64,
    pub persisted: bool,
}

pub fn recordings_dir(base: &Path) -> PathBuf {
    base.join("recordings")
}

pub fn meta_path(base: &Path, id: &str) -> PathBuf {
    recordings_dir(base).join(format!("{id}.json"))
}

pub fn audio_path(base: &Path, id: &str) -> PathBuf {
    recordings_dir(base).join(format!("{id}.wav"))
}

pub fn ensure_dirs(base: &Path) -> std::io::Result<()> {
    fs::create_dir_all(recordings_dir(base))
}

pub fn save_recording(
    base: &Path,
    meta: &RecordingMeta,
    audio: Option<&[u8]>,
) -> std::io::Result<()> {
    ensure_dirs(base)?;
    let meta_json = serde_json::to_vec_pretty(meta).map_err(std::io::Error::other)?;
    fs::write(meta_path(base, &meta.id), meta_json)?;
    if let Some(bytes) = audio {
        fs::write(audio_path(base, &meta.id), bytes)?;
    }
    Ok(())
}

pub fn save_meta(base: &Path, meta: &RecordingMeta) -> std::io::Result<()> {
    ensure_dirs(base)?;
    let meta_json = serde_json::to_vec_pretty(meta).map_err(std::io::Error::other)?;
    fs::write(meta_path(base, &meta.id), meta_json)
}

pub fn get_meta(base: &Path, id: &str) -> std::io::Result<Option<RecordingMeta>> {
    let path = meta_path(base, id);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path)?;
    let meta = serde_json::from_slice(&bytes).map_err(std::io::Error::other)?;
    Ok(Some(meta))
}

pub fn get_audio(base: &Path, id: &str) -> std::io::Result<Option<Vec<u8>>> {
    let path = audio_path(base, id);
    if !path.exists() {
        return Ok(None);
    }
    fs::read(path).map(Some)
}

pub fn list_recordings(base: &Path) -> std::io::Result<Vec<RecordingMeta>> {
    ensure_dirs(base)?;
    let mut items: Vec<RecordingMeta> = Vec::new();
    for entry in fs::read_dir(recordings_dir(base))? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match fs::read(&path)
            .and_then(|b| serde_json::from_slice(&b).map_err(std::io::Error::other))
        {
            Ok(meta) => items.push(meta),
            Err(_) => continue,
        }
    }
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

pub fn delete_recording(base: &Path, id: &str) -> std::io::Result<()> {
    let mp = meta_path(base, id);
    let ap = audio_path(base, id);
    if mp.exists() {
        fs::remove_file(mp)?;
    }
    if ap.exists() {
        fs::remove_file(ap)?;
    }
    Ok(())
}

pub fn storage_usage(base: &Path) -> std::io::Result<StorageInfo> {
    ensure_dirs(base)?;
    let mut usage = 0u64;
    for entry in fs::read_dir(recordings_dir(base))? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_file() {
            usage += meta.len();
        }
    }
    Ok(StorageInfo {
        usage,
        quota: 0,
        persisted: true,
    })
}
