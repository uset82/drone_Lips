import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function getSpeechRecognition() {
  // Web Speech API (Chrome/Edge). Not supported everywhere.
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function makeId() {
  // Reasonable-enough client-only session id.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'nex-agi/deepseek-v3.1-nex-n1:free';

function normalizeOpenRouterContent(content) {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  }

  return '';
}

function trimChatMessages(rawMessages, limit = 24) {
  const messages = Array.isArray(rawMessages) ? rawMessages : [];

  const system = messages.find((m) => m && m.role === 'system' && typeof m.content === 'string');
  const rest = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-limit);

  return system ? [{ role: 'system', content: system.content }, ...rest] : rest;
}

async function openRouterChatDirect({ apiUrl, apiKey, model, messages }) {
  const body = {
    model,
    messages: trimChatMessages(messages, 24),
    temperature: 0.2,
  };

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'drone-lips',
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || `OpenRouter request failed (${resp.status})`;
    throw new Error(msg);
  }

  const msg = json?.choices?.[0]?.message;
  const text = normalizeOpenRouterContent(msg?.content);
  if (!text) throw new Error('Bad response from OpenRouter.');
  return text;
}

function dispatchDroneCommand(command) {
  try {
    window.dispatchEvent(new CustomEvent('drone-lips:command', { detail: command }));
    return true;
  } catch {
    return false;
  }
}

function extractCommandsFromText(text) {
  const commands = [];
  const lines = String(text ?? '').split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*COMMAND:\s*(\{.*\})\s*$/);
    if (!match) continue;

    try {
      const cmd = JSON.parse(match[1]);
      if (cmd && typeof cmd === 'object') commands.push(cmd);
    } catch {
      // ignore bad JSON
    }
  }

  return commands;
}

function normalizeCommandText(rawText) {
  return String(rawText ?? '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^0-9a-záéíóúüñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findFirstDirection(text) {
  const dirs = [
    { dir: 'left', tokens: ['left', 'izquierda'] },
    { dir: 'right', tokens: ['right', 'derecha'] },
    { dir: 'up', tokens: ['up', 'arriba'] },
    { dir: 'down', tokens: ['down', 'abajo'] },
  ];

  let best = null;

  for (const entry of dirs) {
    for (const token of entry.tokens) {
      const idx = text.indexOf(token);
      if (idx < 0) continue;

      const beforeOk = idx === 0 || text[idx - 1] === ' ';
      const afterIdx = idx + token.length;
      const afterOk = afterIdx >= text.length || text[afterIdx] === ' ';
      if (!beforeOk || !afterOk) continue;

      if (!best || idx < best.idx) best = { idx, dir: entry.dir };
    }
  }

  return best?.dir ?? null;
}

function parseVoiceDroneCommand(rawText) {
  const text = normalizeCommandText(rawText);
  if (!text) return null;

  const direction = findFirstDirection(text);
  const wantsFlip =
    text.includes('flip') ||
    text.includes('roll') ||
    text.includes('barrel roll') ||
    text.includes('voltereta') ||
    text.includes('voltea') ||
    text.includes('gira');

  if (wantsFlip) {
    return { type: 'flip', direction: direction || 'right' };
  }

  const wantsStop =
    text === 'stop' ||
    text.includes(' stop') ||
    text.startsWith('stop ') ||
    text.includes('halt') ||
    text.includes('freeze') ||
    text.includes('parar') ||
    text.includes('alto') ||
    text.includes('detener') ||
    text.includes('detente') ||
    text.includes('detenga');

  if (wantsStop) return { type: 'stop' };

  const wantsMissile =
    text.includes('missile') ||
    text.includes('rocket') ||
    text.includes('misil') ||
    text.includes('cohete') ||
    text.includes('launch') ||
    text.includes('lanz');

  if (wantsMissile) return { type: 'fireMissile' };

  const wantsGuns =
    text.includes('fire') ||
    text.includes('shoot') ||
    text.includes('gun') ||
    text.includes('laser') ||
    text.includes('pew') ||
    text.includes('dispara') ||
    text.includes('fuego');

  if (wantsGuns) return { type: 'fireGuns' };

  if (direction) return { type: 'nudge', direction };

  return null;
}

function maybeDispatchLocalCommand(rawText, options = {}) {
  const text = String(rawText ?? '').trim();
  const lower = text.toLowerCase();
  const source = options?.source === 'voice' ? 'voice' : 'text';

  // Slash commands (reliable even if the dev proxy/server is down)
  if (lower.startsWith('/')) {
    const parts = lower.slice(1).split(/\s+/).filter(Boolean);
    const [cmd, a, b] = parts;

    if (cmd === 'start') {
      dispatchDroneCommand({ type: 'start' });
      return { handled: true, reply: 'Starting game.' };
    }

    if (cmd === 'pause') {
      dispatchDroneCommand({ type: 'pause' });
      return { handled: true, reply: 'Paused.' };
    }

    if (cmd === 'resume') {
      dispatchDroneCommand({ type: 'resume' });
      return { handled: true, reply: 'Resumed.' };
    }

    if (cmd === 'recalibrate' || cmd === 'calibrate') {
      dispatchDroneCommand({ type: 'recalibrate' });
      return { handled: true, reply: 'Recalibrating.' };
    }

    if (cmd === 'cam' || cmd === 'camera') {
      const mode = a;
      if (mode === 'visible' || mode === 'mini' || mode === 'hidden') {
        dispatchDroneCommand({ type: 'setCameraMode', mode });
        return { handled: true, reply: `Camera mode: ${mode}.` };
      }

      dispatchDroneCommand({ type: 'cycleCameraMode' });
      return { handled: true, reply: 'Cycling camera mode.' };
    }

    if (cmd === 'invertx') {
      const value = a === 'on' || a === 'true' || a === '1';
      dispatchDroneCommand({ type: 'setInvertX', value });
      return { handled: true, reply: `Invert X: ${value ? 'on' : 'off'}.` };
    }

    if (cmd === 'sens' || cmd === 'sensitivity') {
      const axis = a;
      const value = Number(b);
      if (axis && Number.isFinite(value)) {
        dispatchDroneCommand({ type: 'setSensitivity', axis, value });
        return { handled: true, reply: `Sensitivity ${axis}: ${value}.` };
      }
    }

    if (cmd === 'settings') {
      const show = a !== 'off' && a !== 'hide' && a !== 'false' && a !== '0';
      dispatchDroneCommand({ type: show ? 'showSettings' : 'hideSettings' });
      return { handled: true, reply: show ? 'Showing settings.' : 'Hiding settings.' };
    }

    if (cmd === 'fire' || cmd === 'shoot' || cmd === 'guns') {
      dispatchDroneCommand({ type: 'fireGuns' });
      return { handled: true, reply: 'Firing guns.' };
    }

    if (cmd === 'missile' || cmd === 'rocket') {
      dispatchDroneCommand({ type: 'fireMissile' });
      return { handled: true, reply: 'Launching missile.' };
    }

    if (cmd === 'stop') {
      dispatchDroneCommand({ type: 'stop' });
      return { handled: true, reply: 'Stopping.' };
    }

    if (cmd === 'left' || cmd === 'right' || cmd === 'up' || cmd === 'down') {
      dispatchDroneCommand({ type: 'nudge', direction: cmd });
      return { handled: true, reply: `Nudge ${cmd}.` };
    }

    if (cmd === 'flip') {
      const direction = a;
      if (
        direction === 'left' ||
        direction === 'right' ||
        direction === 'up' ||
        direction === 'down'
      ) {
        dispatchDroneCommand({ type: 'flip', direction });
        return { handled: true, reply: `Flip ${direction}.` };
      }
      return { handled: true, reply: 'Usage: /flip left|right|up|down' };
    }

    return { handled: true, reply: 'Unknown command.' };
  }

  if (source === 'voice') {
    const cmd = parseVoiceDroneCommand(text);
    if (cmd) {
      dispatchDroneCommand(cmd);
      if (cmd.type === 'fireGuns') return { handled: true, reply: 'Firing guns.' };
      if (cmd.type === 'fireMissile') return { handled: true, reply: 'Launching missile.' };
      if (cmd.type === 'stop') return { handled: true, reply: 'Stopping.' };
      if (cmd.type === 'nudge') return { handled: true, reply: `Nudge ${cmd.direction}.` };
      if (cmd.type === 'flip') return { handled: true, reply: `Flip ${cmd.direction}.` };
    }
  }

  // Light NL shortcuts
  if (lower.includes('hide camera')) {
    dispatchDroneCommand({ type: 'setCameraMode', mode: 'hidden' });
    return { handled: true, reply: 'Camera hidden.' };
  }

  if (lower.includes('show camera')) {
    dispatchDroneCommand({ type: 'setCameraMode', mode: 'visible' });
    return { handled: true, reply: 'Camera visible.' };
  }

  if (lower.includes('minimize camera') || lower.includes('mini camera')) {
    dispatchDroneCommand({ type: 'setCameraMode', mode: 'mini' });
    return { handled: true, reply: 'Camera minimized.' };
  }

  if (lower === 'pause') {
    dispatchDroneCommand({ type: 'pause' });
    return { handled: true, reply: 'Paused.' };
  }

  if (lower === 'resume' || lower === 'continue') {
    dispatchDroneCommand({ type: 'resume' });
    return { handled: true, reply: 'Resumed.' };
  }

  if (lower === 'start' || lower === 'begin') {
    dispatchDroneCommand({ type: 'start' });
    return { handled: true, reply: 'Starting game.' };
  }

  if (lower === 'recalibrate' || lower === 'calibrate') {
    dispatchDroneCommand({ type: 'recalibrate' });
    return { handled: true, reply: 'Recalibrating.' };
  }

  if (lower === 'stop') {
    dispatchDroneCommand({ type: 'stop' });
    return { handled: true, reply: 'Stopping.' };
  }

  if (lower === 'fire' || lower === 'shoot' || lower === 'guns') {
    dispatchDroneCommand({ type: 'fireGuns' });
    return { handled: true, reply: 'Firing guns.' };
  }

  if (lower === 'missile' || lower === 'rocket') {
    dispatchDroneCommand({ type: 'fireMissile' });
    return { handled: true, reply: 'Launching missile.' };
  }

  if (lower === 'left' || lower === 'right' || lower === 'up' || lower === 'down') {
    dispatchDroneCommand({ type: 'nudge', direction: lower });
    return { handled: true, reply: `Nudge ${lower}.` };
  }

  if (
    lower === 'flip left' ||
    lower === 'flip right' ||
    lower === 'flip up' ||
    lower === 'flip down'
  ) {
    const dir = lower.split(/\s+/)[1];
    dispatchDroneCommand({ type: 'flip', direction: dir });
    return { handled: true, reply: `Flip ${dir}.` };
  }

  return { handled: false, reply: null };
}

export default function AuggieChat() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [input, setInput] = useState('');
  const [brainMode, setBrainMode] = useState(false);

  const [directOpenRouter, setDirectOpenRouter] = useState(() => {
    try {
      return window.localStorage.getItem('drone-lips:openrouter:direct') === '1';
    } catch {
      return false;
    }
  });

  const [openRouterApiUrl] = useState(() => {
    try {
      return (
        window.localStorage.getItem('drone-lips:openrouter:api-url') ||
        import.meta.env.PUBLIC_OPENROUTER_API_URL ||
        DEFAULT_OPENROUTER_API_URL
      );
    } catch {
      return import.meta.env.PUBLIC_OPENROUTER_API_URL || DEFAULT_OPENROUTER_API_URL;
    }
  });

  const [openRouterModel, setOpenRouterModel] = useState(() => {
    try {
      return (
        window.localStorage.getItem('drone-lips:openrouter:model') ||
        import.meta.env.PUBLIC_OPENROUTER_MODEL ||
        DEFAULT_OPENROUTER_MODEL
      );
    } catch {
      return import.meta.env.PUBLIC_OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    }
  });

  const [openRouterApiKey, setOpenRouterApiKey] = useState(() => {
    try {
      return (
        window.localStorage.getItem('drone-lips:openrouter:api-key') ||
        import.meta.env.PUBLIC_OPENROUTER_API_KEY ||
        ''
      );
    } catch {
      return import.meta.env.PUBLIC_OPENROUTER_API_KEY || '';
    }
  });

  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [messages, setMessages] = useState(() => [
    {
      role: 'system',
      content:
        'You are Auggie inside the Drone Lips game. The user is playing on iPhone. Be concise.\n\nWhen the user asks to change the game, include a single-line command in this exact format:\nCOMMAND: {"type":"setCameraMode","mode":"hidden"}\n\nSupported command shapes:\n- {"type":"start"}\n- {"type":"recalibrate"}\n- {"type":"pause"} | {"type":"resume"} | {"type":"togglePause"}\n- {"type":"setCameraMode","mode":"visible"|"mini"|"hidden"}\n- {"type":"setInvertX","value":true|false}\n- {"type":"setSensitivity","axis":"open"|"x"|"y","value":number}\n- {"type":"showSettings"} | {"type":"hideSettings"}\n- {"type":"stop"}\n- {"type":"nudge","direction":"left"|"right"|"up"|"down","durationMs"?:number}\n- {"type":"fireGuns"}\n- {"type":"fireMissile"}\n- {"type":"flip","direction":"left"|"right"|"up"|"down"}\n\nIf you output COMMAND, keep the JSON on one line.',
    },
  ]);

  const sessionId = useMemo(() => makeId(), []);
  const listRef = useRef(null);

  const recognitionRef = useRef(null);
  const busyRef = useRef(busy);
  const openRef = useRef(open);
  const brainModeRef = useRef(brainMode);
  const directOpenRouterRef = useRef(directOpenRouter);
  const openRouterApiUrlRef = useRef(openRouterApiUrl);
  const openRouterModelRef = useRef(openRouterModel);
  const openRouterApiKeyRef = useRef(openRouterApiKey);
  const messagesRef = useRef(messages);
  const speakRepliesRef = useRef(speakReplies);
  const wantsListeningRef = useRef(false);
  const pendingVoiceStartRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [open, messages]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    brainModeRef.current = brainMode;
  }, [brainMode]);

  useEffect(() => {
    directOpenRouterRef.current = directOpenRouter;
    try {
      window.localStorage.setItem('drone-lips:openrouter:direct', directOpenRouter ? '1' : '0');
    } catch {
      // ignore
    }
  }, [directOpenRouter]);

  useEffect(() => {
    openRouterApiUrlRef.current = openRouterApiUrl;
    try {
      window.localStorage.setItem('drone-lips:openrouter:api-url', openRouterApiUrl);
    } catch {
      // ignore
    }
  }, [openRouterApiUrl]);

  useEffect(() => {
    openRouterModelRef.current = openRouterModel;
    try {
      window.localStorage.setItem('drone-lips:openrouter:model', openRouterModel);
    } catch {
      // ignore
    }
  }, [openRouterModel]);

  useEffect(() => {
    openRouterApiKeyRef.current = openRouterApiKey;
    try {
      window.localStorage.setItem('drone-lips:openrouter:api-key', openRouterApiKey);
    } catch {
      // ignore
    }
  }, [openRouterApiKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  useEffect(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    setVoiceSupported(true);

    const recognition = new SR();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const last = event.results?.[event.results.length - 1];
      const transcript = last?.[0]?.transcript;
      if (typeof transcript !== 'string') return;

      const text = transcript.trim();
      if (!text) return;

      setInput(text);

      if (last.isFinal) {
        // Auto-send on final transcript.
        sendText(text, { source: 'voice' }).catch(() => undefined);
      }
    };

    recognition.onerror = (e) => {
      const msg = typeof e?.error === 'string' ? e.error : 'voice_error';
      const fatal = msg === 'not-allowed' || msg === 'service-not-allowed' || msg === 'audio-capture';

      setListening(false);
      if (fatal) wantsListeningRef.current = false;

      if (msg === 'no-speech' || msg === 'aborted') {
        // Common when running continuous "always listening" UX. We'll auto-restart on `onend`.
        return;
      }

      setError(`Voice input error: ${msg}`);
    };

    recognition.onend = () => {
      setListening(false);

      if (!wantsListeningRef.current) return;

      window.setTimeout(() => {
        if (!wantsListeningRef.current) return;

        try {
          recognition.start();
          setListening(true);
        } catch {
          // ignore (can happen if already started)
        }
      }, 250);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.stop?.();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(() => {
    setError(null);
    wantsListeningRef.current = true;

    if (!voiceSupported) {
      setError(
        'Voice input is not supported in this browser. On iPhone Safari, the Web Speech API is usually not available-use the keyboard microphone (dictation) instead.',
      );
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      setError(
        'Voice input is not available in this browser. On iPhone Safari, the Web Speech API is usually not supported-use the keyboard microphone (dictation) instead.',
      );
      return;
    }

    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(true);
    }
  }, [voiceSupported]);

  useEffect(() => {
    if (!pendingVoiceStartRef.current) return;
    if (!voiceSupported) return;
    if (listening) return;

    pendingVoiceStartRef.current = false;
    startListening();
  }, [listening, startListening, voiceSupported]);

  const stopListening = useCallback(() => {
    wantsListeningRef.current = false;
    pendingVoiceStartRef.current = false;
    const recognition = recognitionRef.current;
    try {
      recognition?.stop?.();
    } catch {
      // ignore
    }
    setListening(false);
  }, []);

  useEffect(() => {
    const handleOpenChat = () => {
      setOpen(true);
      pendingVoiceStartRef.current = true;
      startListening();
    };

    window.addEventListener('drone-lips:open-chat', handleOpenChat);

    return () => {
      window.removeEventListener('drone-lips:open-chat', handleOpenChat);
    };
  }, [startListening]);

  useEffect(() => {
    const handleVoiceStart = () => {
      pendingVoiceStartRef.current = true;
      startListening();
    };

    const handleVoiceStop = () => {
      stopListening();
    };

    window.addEventListener('drone-lips:voice-start', handleVoiceStart);
    window.addEventListener('drone-lips:voice-stop', handleVoiceStop);

    return () => {
      window.removeEventListener('drone-lips:voice-start', handleVoiceStart);
      window.removeEventListener('drone-lips:voice-stop', handleVoiceStop);
    };
  }, [startListening, stopListening]);

  const speak = (text) => {
    if (!speakRepliesRef.current) return;
    if (!('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = navigator.language || 'en-US';
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    } catch {
      // ignore
    }
  };

  const sendText = async (rawText, options = {}) => {
    const text = String(rawText).trim();
    if (!text || busyRef.current) return;

    setError(null);
    setInput('');

    const nextMessages = [...messagesRef.current, { role: 'user', content: text }];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);

    // Local commands (work even if the dev proxy/server is down)
    const local = maybeDispatchLocalCommand(text, options);
    if (local.handled) {
      const next = [...messagesRef.current, { role: 'assistant', content: local.reply }];
      messagesRef.current = next;
      setMessages(next);
      return;
    }

    busyRef.current = true;
    setBusy(true);

    try {
      const wantsBrain = brainModeRef.current;

      const callServer = async () => {
        const res = await fetch('/api/auggie/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auggie-Session': sessionId,
          },
          body: JSON.stringify({
            messages: nextMessages,
            mode: wantsBrain ? 'brain' : 'chat',
          }),
        });

        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const msg = json?.error || `Request failed (${res.status})`;
          throw new Error(msg);
        }

        const assistantText = json?.message;
        if (typeof assistantText !== 'string') throw new Error('Bad response from server.');
        return assistantText;
      };

      const callDirect = async () => {
        if (wantsBrain) {
          throw new Error('Brain mode requires the local /api/auggie/chat server.');
        }

        const apiKey = String(openRouterApiKeyRef.current || '').trim();
        if (!apiKey) {
          throw new Error(
            'Missing OpenRouter API key. Either run `npm run dev` (local server), or enable Direct and paste your key.',
          );
        }

        const apiUrl = String(openRouterApiUrlRef.current || DEFAULT_OPENROUTER_API_URL).trim();
        const model = String(openRouterModelRef.current || DEFAULT_OPENROUTER_MODEL).trim();

        return openRouterChatDirect({ apiUrl, apiKey, model, messages: nextMessages });
      };

      let assistantText;

      if (directOpenRouterRef.current) {
        assistantText = await callDirect();
      } else {
        try {
          assistantText = await callServer();
        } catch (serverErr) {
          const hasKey = String(openRouterApiKeyRef.current || '').trim().length > 0;
          if (!wantsBrain && hasKey) {
            assistantText = await callDirect();
          } else {
            throw serverErr;
          }
        }
      }

      // Extract and dispatch COMMAND blocks (if any)
      for (const cmd of extractCommandsFromText(assistantText)) {
        dispatchDroneCommand(cmd);
      }

      const next = [...messagesRef.current, { role: 'assistant', content: assistantText }];
      messagesRef.current = next;
      setMessages(next);

      speak(assistantText);
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);

      if (
        msg.includes('OpenRouter auth failed') ||
        msg.includes('OPENROUTER_API_KEY looks like a placeholder') ||
        msg.includes('No cookie auth credentials found')
      ) {
        msg +=
          '\n\nFix: put a real OpenRouter key in your repo root `.env`:\nOPENROUTER_API_KEY="sk-or-v1-..."\nThen restart: `npm run dev` (or `npm run dev:host` for LAN).\n';
      } else if (msg.startsWith('Request failed')) {
        msg += '\n\nTip: start the dev brain server with `npm run dev`, or enable Direct and paste your OpenRouter API key.\n';
      }

      setError(msg);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = async () => {
    await sendText(input, { source: 'text' });
  };

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        width: 360,
        maxWidth: 'calc(100vw - 32px)',
        height: 420,
        maxHeight: 'calc(100vh - 32px)',
        zIndex: 9999,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.18)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong>Auggie</strong>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              opacity: 0.85,
              userSelect: 'none',
            }}
            title={
              directOpenRouter
                ? 'Brain mode requires the local /api/auggie/chat server. Disable Direct to use Brain.'
                : 'Enable tool-using brain mode (dev only).'
            }
          >
            <input
              type="checkbox"
              checked={brainMode}
              onChange={(e) => setBrainMode(e.target.checked)}
              disabled={busy || directOpenRouter}
            />
            Brain
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              opacity: 0.85,
              userSelect: 'none',
            }}
            title="Call OpenRouter directly from the browser (exposes your key)."
          >
            <input
              type="checkbox"
              checked={directOpenRouter}
              onChange={(e) => {
                const next = e.target.checked;
                setDirectOpenRouter(next);
                if (next) setBrainMode(false);
              }}
              disabled={busy}
            />
            Direct
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              opacity: 0.85,
              userSelect: 'none',
            }}
            title={
              voiceSupported
                ? 'Speak assistant replies using your browser TTS.'
                : 'Text-to-speech not available.'
            }
          >
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={(e) => setSpeakReplies(e.target.checked)}
              disabled={busy || !('speechSynthesis' in window)}
            />
            Speak
          </label>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: 16,
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {directOpenRouter ? (
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            display: 'grid',
            gap: 8,
          }}
        >
          <input
            value={openRouterModel}
            onChange={(e) => setOpenRouterModel(e.target.value)}
            placeholder={DEFAULT_OPENROUTER_MODEL}
            disabled={busy}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.35)',
              color: 'white',
              outline: 'none',
              fontSize: 12,
            }}
          />
          <input
            value={openRouterApiKey}
            onChange={(e) => setOpenRouterApiKey(e.target.value)}
            placeholder="OpenRouter API key (sk-or-v1-...)"
            disabled={busy}
            type="password"
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(0,0,0,0.35)',
              color: 'white',
              outline: 'none',
              fontSize: 12,
            }}
          />
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            Direct mode stores these values in localStorage and sends requests straight to OpenRouter.
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        style={{
          flex: 1,
          padding: 12,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.35,
        }}
      >
        {messages
          .filter((m) => m.role !== 'system')
          .map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              style={{ marginBottom: 10, opacity: busy && i === messages.length - 1 ? 0.8 : 1 }}
            >
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>
                {m.role === 'user' ? 'You' : 'Auggie'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            </div>
          ))}

        {busy ? <div style={{ opacity: 0.75 }}>Thinking…</div> : null}
        {error ? <div style={{ color: '#ffb4b4' }}>{error}</div> : null}
      </div>

      <div
        style={{
          padding: 12,
          borderTop: '1px solid rgba(255,255,255,0.12)',
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask Auggie…"
          disabled={busy}
          style={{
            flex: 1,
            padding: '10px 10px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(0,0,0,0.35)',
            color: 'white',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (busy) return;

            setError(null);

            if (!voiceSupported) {
              setError(
                'Voice input is not supported in this browser. On iPhone Safari, the Web Speech API is usually not available-use the keyboard microphone (dictation) instead.',
              );
              return;
            }

            const recognition = recognitionRef.current;
            if (!recognition) {
              setError(
                'Voice input is not available in this browser. On iPhone Safari, the Web Speech API is usually not supported-use the keyboard microphone (dictation) instead.',
              );
              return;
            }

            try {
              if (listening) {
                stopListening();
                return;
              }

              startListening();
            } catch (err) {
              setListening(false);
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          disabled={busy}
          title={
            voiceSupported
              ? listening
                ? 'Stop voice input'
                : 'Start voice input'
              : 'Voice input not supported in this browser'
          }
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background:
              busy || !voiceSupported
                ? 'rgba(255,255,255,0.08)'
                : listening
                  ? 'rgba(255,255,255,0.18)'
                  : 'rgba(255,255,255,0.14)',
            color: 'white',
            cursor: busy ? 'default' : 'pointer',
            opacity: voiceSupported ? 1 : 0.85,
          }}
        >
          {listening ? 'Listening…' : 'Voice'}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={busy}
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: busy ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.14)',
            color: 'white',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
