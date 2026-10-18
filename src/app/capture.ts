// User-initiated capture only. Each call opens Chrome's own share picker, where
// the person chooses what to share (we ask Chrome to suggest this tab). Nothing
// runs in the background, no audio is captured, and tracks stop as soon as the
// capture ends. Requires no extension permissions.

export const RECORDING_LIMIT_MS = 2 * 60_000;

type DisplayOptions = DisplayMediaStreamOptions & { preferCurrentTab?: boolean; selfBrowserSurface?: 'include' | 'exclude'; surfaceSwitching?: 'include' | 'exclude' };

function requestStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) return Promise.reject(new Error('This browser can’t capture the screen.'));
  const options: DisplayOptions = { video: { displaySurface: 'browser' } as MediaTrackConstraints, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' };
  return navigator.mediaDevices.getDisplayMedia(options);
}

const stop = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

/** One still frame of what the person chose to share, as a PNG. */
export async function captureScreenshot(): Promise<Blob> {
  const stream = await requestStream();
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 250)); // let the first frame settle
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    video.srcObject = null;
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Screenshot failed.'))), 'image/png'));
  } finally {
    stop(stream);
  }
}

export interface Recording {
  startedAt: number;
  /** Resolves with the video when stopped (by the person, the share bar, or the time limit). */
  done: Promise<{ blob: Blob; durationMs: number }>;
  stop: () => void;
}

export async function startRecording(): Promise<Recording> {
  const stream = await requestStream();
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const done = new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => {
    recorder.onstop = () => { stop(stream); resolve({ blob: new Blob(chunks, { type: 'video/webm' }), durationMs: Date.now() - startedAt }); };
    recorder.onerror = () => { stop(stream); reject(new Error('Recording failed.')); };
  });
  const finish = () => { if (recorder.state !== 'inactive') recorder.stop(); };
  stream.getVideoTracks()[0]?.addEventListener('ended', finish); // Chrome's "Stop sharing" bar
  const limit = setTimeout(finish, RECORDING_LIMIT_MS);
  void done.finally(() => clearTimeout(limit));
  recorder.start(1000);
  return { startedAt, done, stop: finish };
}
