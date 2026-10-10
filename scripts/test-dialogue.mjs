import assert from 'node:assert/strict';
import {
  configureDialogueCatalog, getDialogueEntry, resolveDialogue,
  playDialogueAudio, stopDialogueAudio,
} from '../dialogueCatalog.js';

const started = [];
let stopped = 0;
globalThis.Audio = class {
  constructor(path) { this.path = path; }
  addEventListener() {}
  play() { started.push(this.path); return Promise.resolve(); }
  pause() { stopped++; }
};

assert.equal(configureDialogueCatalog({
  'intro.hello': { text: 'Welcome back.', speaker: 'Mother', audio: './sounds/mother.ogg' },
  'intro.empty': { text: 'Unvoiced.', speaker: 'Player', audio: '' },
}), 2);
assert.deepEqual(getDialogueEntry('intro.hello'), {
  id: 'intro.hello', text: 'Welcome back.', speaker: 'Mother', audio: './sounds/mother.ogg'
});
assert.equal(getDialogueEntry('does.not.exist'), null);
assert.equal(resolveDialogue('intro.hello').speaker, 'Mother');
assert.equal(resolveDialogue('intro.hello').text, 'Welcome back.');
assert.equal(resolveDialogue('Welcome back.', 'Mother').audio, './sounds/mother.ogg');
assert.equal(resolveDialogue('Unmapped text', 'Player').id, null);
playDialogueAudio(resolveDialogue('intro.hello'));
assert.deepEqual(started, ['./sounds/mother.ogg']);
playDialogueAudio(resolveDialogue('intro.empty'));
assert.equal(stopped, 1);
stopDialogueAudio();
console.log('Kinetik dialogue catalog tests passed');
