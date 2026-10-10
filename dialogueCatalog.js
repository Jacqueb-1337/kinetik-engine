// Kinetik dialogue catalog: project-owned JSON gives each line a stable code ID.
// JSON shape: { "chapter.line": { "speaker": "Name", "text": "Hello.", "audio": "./sounds/line.ogg" } }
let _entries = Object.create(null);
let _activeVoice = null;

export function configureDialogueCatalog(entries = {}) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new TypeError('Dialogue catalog must be an object keyed by stable dialogue IDs.');
  }
  _entries = Object.create(null);
  for (const [id, line] of Object.entries(entries)) {
    if (typeof line?.text !== 'string') continue;
    _entries[id] = {
      id,
      text: line.text,
      speaker: typeof line.speaker === 'string' ? line.speaker : '',
      audio: typeof line.audio === 'string' ? line.audio : '',
    };
  }
  return Object.keys(_entries).length;
}

export function getDialogueEntry(id) {
  return Object.hasOwn(_entries, id) ? { ..._entries[id] } : null;
}

export function resolveDialogue(reference = '', speaker = '') {
  if (typeof reference === 'string' && Object.hasOwn(_entries, reference)) {
    const line = _entries[reference];
    return { ...line, speaker: speaker || line.speaker };
  }
  const text = String(reference ?? '');
  const found = Object.values(_entries).find(line =>
    line.text === text && (!speaker || line.speaker === speaker));
  return found ? { ...found, speaker: speaker || found.speaker } : { id: null, text, speaker, audio: '' };
}

export function stopDialogueAudio() {
  if (!_activeVoice) return;
  _activeVoice.pause();
  _activeVoice = null;
}

export function playDialogueAudio(entry) {
  // A new line replaces the old voice; unvoiced lines silence the previous one.
  stopDialogueAudio();
  const path = entry?.audio?.trim();
  if (!path || typeof Audio === 'undefined') return null;
  const voice = new Audio(path);
  voice.preload = 'auto';
  _activeVoice = voice;
  voice.addEventListener('ended', () => { if (_activeVoice === voice) _activeVoice = null; }, { once: true });
  Promise.resolve(voice.play()).catch(error => {
    if (_activeVoice === voice) _activeVoice = null;
    console.warn('[Kinetik dialogue] Voice unavailable:', path, error);
  });
  return voice;
}
