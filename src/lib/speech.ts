'use client';

// Thin wrapper around the browser's Web Speech API (SpeechSynthesis).
// Chosen deliberately over any cloud TTS API: it's free, works offline,
// needs no account/API key, and matches ReadFlow's zero-budget,
// no-backend philosophy.

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Resolves once the browser's voice list is actually populated.
 * Chrome/Edge load voices asynchronously (via the `voiceschanged` event) —
 * calling getVoices() immediately on mount very often returns an empty
 * array, which is the classic bug behind an empty "choose a voice" list.
 */
export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener('voiceschanged', finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', finish);
    // Safety net: some browsers never fire voiceschanged if voices were
    // already cached internally.
    setTimeout(finish, 1200);
  });
}

/**
 * Force-initialise the TTS engine with a tiny, nearly-silent utterance.
 * Chrome initialises speech synthesis lazily, and the very first real
 * speak() can be silently dropped or clipped. Must use a pronounceable
 * token (not whitespace): whitespace-only utterances never "end" on some
 * engines and would wedge the utterance queue before real speech starts.
 * volume 0 + rate 3 keeps it inaudible; the pause() right after keeps it
 * from delaying the first real utterance on slow engines.
 */
export function warmUpSpeech(): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) return;
  try {
    const warmup = new SpeechSynthesisUtterance('un');
    warmup.volume = 0;
    warmup.rate = 3;
    synth.speak(warmup);
  } catch { /* warm-up is best-effort */ }
}

/** French voices first (this app is French-first), then the rest, each group alphabetised by name. */
export function sortVoicesForPicker(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => {
    const aFr = a.lang.toLowerCase().startsWith('fr');
    const bFr = b.lang.toLowerCase().startsWith('fr');
    if (aFr !== bFr) return aFr ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function findVoice(voices: SpeechSynthesisVoice[], voiceURI: string | null): SpeechSynthesisVoice | null {
  if (!voiceURI) return null;
  return voices.find((v) => v.voiceURI === voiceURI) || null;
}
