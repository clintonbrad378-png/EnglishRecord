export interface TranscriptChunk {
  id: string;
  text: string;
  t0: number;
  t1: number;
  source?: 'live' | 'manual' | 'import';
}

export interface RecordingMeta {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  sampleRate: number;
  peaks: number[];
  transcript: TranscriptChunk[];
  wordCount: number;
  starred: boolean;
  transcribed: boolean;
  hadSpeech: boolean;
}

export type TranscriberStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TranscriberState {
  status: TranscriberStatus;
  error?: string;
  pending: number;
}

export type Route =
  | { name: 'home' }
  | { name: 'record' }
  | { name: 'detail'; id: string }
  | { name: 'settings' };

export interface ThemePreference {
  mode: 'system' | 'light' | 'dark';
}
