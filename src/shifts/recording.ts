import { RECORDING_LIMIT_MS } from '../app/capture.ts';
export interface VoiceRecording { stop(): void; done: Promise<Blob> }
export async function recordVoice(persist: (blob: Blob, partial: boolean) => Promise<void>): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Voice recording is unavailable here. Attach an audio file or type your EOD instead.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks: Blob[] = [];
  let saving = Promise.resolve(), timer: ReturnType<typeof setTimeout>, failed: Error | null = null;
  const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (!event.data.size) return;
      chunks.push(event.data);
      const blob = new Blob(chunks, { type: recorder.mimeType });
      saving = saving.then(() => persist(blob, true)).catch(error => { failed = error instanceof Error ? error : new Error('Voice draft could not be saved.'); stop(); });
    };
    recorder.onerror = () => { failed = new Error('Recording interrupted. Saved audio remains available for review.'); stop(); };
    recorder.onstop = () => {
      clearTimeout(timer); stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType });
      void saving.then(() => persist(blob, failed !== null)).then(() => failed ? reject(failed) : resolve(blob)).catch(reject);
    };
  });
  try { recorder.start(1000); timer = setTimeout(stop, RECORDING_LIMIT_MS); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  return { stop, done };
}
// Only explicitly supported ON-DEVICE recognition is enabled. Never silently sends audio to another provider.
interface LocalSpeech { processLocally: boolean; lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null }
export function localDictation(onText: (text: string) => void, onError: (text: string) => void): { start(): void; stop(): void } | null {
  const ctor = (window as unknown as { SpeechRecognition?: new () => LocalSpeech }).SpeechRecognition;
  if (!ctor) return null;
  const recognition = new ctor();
  if (!('processLocally' in recognition)) return null;
  recognition.processLocally = true; recognition.lang = navigator.language; recognition.continuous = false; recognition.interimResults = false;
  recognition.onresult = event => onText(Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' '));
  recognition.onerror = event => onError(`Local transcription unavailable (${event.error}). Your recording or text draft is still available.`);
  return recognition;
}
