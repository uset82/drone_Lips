import { pickOne } from './math';

export type VoiceCommand =
  | { type: 'fireGuns' }
  | { type: 'fireMissile' }
  | { type: 'stop' }
  | { type: 'togglePause' }
  | { type: 'nudge'; x: number; y: number; durationMs: number }
  | { type: 'flip'; axis: 'x' | 'z'; dir: 1 | -1 };

export type VoiceHandlerOptions = {
  lang?: string;
  onText?: (text: string, isFinal: boolean) => void;
  onCommand?: (cmd: VoiceCommand, rawText: string) => void;
  onError?: (msg: string) => void;
};

function normalize(raw: string) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^0-9a-záéíóúñü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text: string, tokens: string[]) {
  return tokens.some((t) => text.includes(t));
}

function parseVoiceCommand(rawText: string): VoiceCommand | null {
  const text = normalize(rawText);
  if (!text) return null;

  const wantsPause = includesAny(text, ['pause', 'pausa']);
  const wantsResume = includesAny(text, ['resume', 'continuar', 'reanudar']);
  if (wantsPause || wantsResume) return { type: 'togglePause' };

  if (includesAny(text, ['stop', 'alto', 'parar', 'detente', 'detener'])) return { type: 'stop' };

  if (includesAny(text, ['missile', 'misil', 'rocket', 'cohete', 'launch', 'lanz'])) {
    return { type: 'fireMissile' };
  }

  const wantsFlip = includesAny(text, ['flip', 'roll', 'barrel', 'voltereta', 'voltea', 'gira']);
  if (wantsFlip) {
    const dir =
      includesAny(text, ['left', 'izquierda']) ? -1 : includesAny(text, ['right', 'derecha']) ? 1 : 1;
    const axis = includesAny(text, ['up', 'arriba', 'down', 'abajo']) ? 'x' : 'z';
    const finalDir = axis === 'x' && includesAny(text, ['up', 'arriba']) ? -1 : dir;
    return { type: 'flip', axis, dir: finalDir as 1 | -1 };
  }

  const wantsShoot = includesAny(text, ['shoot', 'fire', 'guns', 'gun', 'dispara', 'disparar', 'tirar']);
  if (wantsShoot) return { type: 'fireGuns' };

  const wantsLeft = includesAny(text, ['left', 'izquierda']);
  const wantsRight = includesAny(text, ['right', 'derecha']);
  const wantsUp = includesAny(text, ['up', 'arriba']);
  const wantsDown = includesAny(text, ['down', 'abajo']);

  if (wantsLeft || wantsRight || wantsUp || wantsDown) {
    const x = wantsLeft ? -1 : wantsRight ? 1 : 0;
    const y = wantsUp ? 1 : wantsDown ? -1 : 0;
    return { type: 'nudge', x, y, durationMs: 700 };
  }

  return null;
}

export class VoiceHandler {
  readonly supported: boolean;

  private readonly opts: VoiceHandlerOptions;
  private recognition: any = null;
  private wantsListening = false;
  private listening = false;

  constructor(options: VoiceHandlerOptions = {}) {
    this.opts = options;

    const ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.supported = Boolean(ctor);
    if (!this.supported) return;

    try {
      this.recognition = new ctor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = options.lang || navigator.language || 'en-US';

      this.recognition.onresult = (event: any) => {
        const results = event?.results;
        if (!results) return;

        let transcript = '';
        let isFinal = false;

        for (let i = event.resultIndex; i < results.length; i += 1) {
          const r = results[i];
          if (!r || !r[0]) continue;
          transcript += String(r[0].transcript || '');
          if (r.isFinal) isFinal = true;
        }

        const t = transcript.trim();
        if (!t) return;

        this.opts.onText?.(t, isFinal);

        const cmd = parseVoiceCommand(t);
        if (cmd) this.opts.onCommand?.(cmd, t);
      };

      this.recognition.onerror = (event: any) => {
        const err = event?.error ? String(event.error) : 'voice error';
        this.opts.onError?.(err);
      };

      this.recognition.onend = () => {
        this.listening = false;
        if (!this.wantsListening) return;

        // Restart (Chrome sometimes stops after silence)
        const delays = [40, 90, 140];
        const delay = pickOne(delays);
        window.setTimeout(() => this.safeStart(), delay);
      };
    } catch (err) {
      this.supported = false;
      this.recognition = null;
      this.opts.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  isListening() {
    return this.listening;
  }

  start() {
    this.wantsListening = true;
    this.safeStart();
  }

  stop() {
    this.wantsListening = false;
    this.listening = false;
    try {
      this.recognition?.stop?.();
    } catch {
      // ignore
    }
  }

  private safeStart() {
    if (!this.supported) return;
    if (!this.wantsListening) return;
    if (this.listening) return;

    try {
      this.recognition?.start?.();
      this.listening = true;
    } catch {
      this.listening = true;
    }
  }
}

