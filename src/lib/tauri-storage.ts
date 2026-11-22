import { invoke } from '@tauri-apps/api/core';
import type { RecordingMeta } from '../types';

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  return invoke<RecordingMeta[]>('list_recordings');
}

export async function getMeta(id: string): Promise<RecordingMeta | null> {
  return invoke<RecordingMeta | null>('get_recording', { id });
}

export async function getAudio(id: string): Promise<Blob | null> {
  const b64 = await invoke<string | null>('get_audio_base64', { id });
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}

export async function saveRecording(meta: RecordingMeta, audio?: Blob): Promise<void> {
  const audioBase64 = audio ? bytesToBase64(new Uint8Array(await audio.arrayBuffer())) : null;
  await invoke('save_recording', { meta, audioBase64 });
}

export async function saveMeta(meta: RecordingMeta): Promise<void> {
  await invoke('save_meta', { meta });
}

export async function deleteRecording(id: string): Promise<void> {
  await invoke('delete_recording', { id });
}

export async function storageUsage(): Promise<StorageInfo> {
  return invoke<StorageInfo>('storage_info');
}

export async function requestPersistence(): Promise<boolean> {
  return true;
}
