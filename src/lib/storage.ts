import { isTauri } from './tauri';
import type { RecordingMeta } from '../types';
import * as idb from './idb';
import * as tauriStorage from './tauri-storage';

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted?: boolean;
}

export async function saveRecording(meta: RecordingMeta, audio?: Blob): Promise<void> {
  if (isTauri()) return tauriStorage.saveRecording(meta, audio);
  return idb.saveRecording(meta, audio);
}

export async function saveMeta(meta: RecordingMeta): Promise<void> {
  if (isTauri()) return tauriStorage.saveMeta(meta);
  return idb.saveMeta(meta);
}

export async function getMeta(id: string): Promise<RecordingMeta | undefined> {
  if (isTauri()) return (await tauriStorage.getMeta(id)) ?? undefined;
  return idb.getMeta(id);
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  if (isTauri()) return (await tauriStorage.getAudio(id)) ?? undefined;
  return idb.getAudio(id);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  if (isTauri()) return tauriStorage.listRecordings();
  return idb.listRecordings();
}

export async function deleteRecording(id: string): Promise<void> {
  if (isTauri()) return tauriStorage.deleteRecording(id);
  return idb.deleteRecording(id);
}

export async function storageUsage(): Promise<StorageInfo> {
  if (isTauri()) return tauriStorage.storageUsage();
  return idb.storageUsage();
}

export async function requestPersistence(): Promise<boolean> {
  if (isTauri()) return tauriStorage.requestPersistence();
  return idb.requestPersistence();
}
