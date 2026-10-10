// networking.js — Kinetik generic WebRTC P2P networking with PHP signaling
// Host-authoritative model: host broadcasts state to guests, guests send inputs to host.
// Any JSON-serialisable payload can be sent via broadcast() and send().
// Voice chat rides on the same RTCPeerConnections (audio tracks + renegotiation over
// the data channel). Host acts as an audio relay so guests hear each other.
// Usage:
//   configureNet({ apiBase: 'https://yourserver.com/api' });
//   const code = await createSession();
//   broadcast({ type: 'state', ...whatever });
//   send({ type: 'input', action: 'fire', data: {} });
//   onMessage(msg => { ... });
//   await enableVoiceChat(); setVoiceMuted(true);

let _apiBase = '';

export function configureNet({ apiBase }) {
  if (apiBase) _apiBase = apiBase.replace(/\/$/, '');
}

const SIGNAL_POLL_INTERVAL = 500;

let _capacitorCoreModule = undefined;

async function _getCapacitorCoreModule() {
  if (_capacitorCoreModule !== undefined) return _capacitorCoreModule;
  try {
    _capacitorCoreModule = await import('@capacitor/core');
  } catch (_) {
    _capacitorCoreModule = null;
  }
  return _capacitorCoreModule;
}

async function _nativeApiFetch(url, init = {}, capacitorHttp) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  let data;

  if (init.body !== undefined) {
    if (typeof init.body === 'string') {
      try {
        data = JSON.parse(init.body);
        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
      } catch (_) {
        data = init.body;
      }
    } else {
      data = init.body;
    }
  }

  const response = await capacitorHttp.request({ url, method, headers, data });
  const status = Number(response?.status || 0);
  const payload = response?.data;

  return {
    status,
    async json() {
      if (typeof payload === 'string') {
        try { return JSON.parse(payload); }
        catch (_) { return { success: false, error: payload }; }
      }
      return payload;
    },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');
    }
  };
}

async function _apiFetch(path, init = {}) {
  const capacitorCore = await _getCapacitorCoreModule();
  const useNativeHttp =
    capacitorCore?.Capacitor?.isNativePlatform?.() === true &&
    typeof capacitorCore?.CapacitorHttp?.request === 'function';

  const url = `${_apiBase}/${path}`;
  const res = useNativeHttp
    ? await _nativeApiFetch(url, init, capacitorCore.CapacitorHttp)
    : await fetch(url, init);
  return res;
}

// ─── Networking State ─────────────────────────────────────────────────────────

let _mode = 'offline'; // 'offline' | 'host' | 'guest'
let _sessionCode = null;
let _sessionId = null;
let _guestId = null;
let _playerId = 'local';

const _peers = new Map();
const _onMessage = [];
const _onPlayerJoin = [];
const _onPlayerLeave = [];
const _peerDisplayNames = new Map();

let _signalPollTimer = null;
let _signalPollFailures = 0;
const MAX_SIGNAL_POLL_FAILURES = 10;
let _keepPolling = false;

// Guest -> host messages queued while the data channel is still connecting
const _guestOutQueue = [];
const GUEST_OUT_QUEUE_MAX = 200;

// ─── Voice chat state ─────────────────────────────────────────────────────────
let _voiceEnabled = false;
let _voiceMuted = false;
let _localVoiceStream = null;
const _voiceAudioEls = new Map();    // `${peerId}:${trackId}` -> <audio>
const _remoteVoiceTracks = new Map(); // peerId -> Map(trackId -> { track, stream }) (host relay)
const _onVoiceStateChanged = [];
const _pendingAudioPlay = [];
let _gestureArmed = false;

function _jsonBody(data) { return JSON.stringify(data); }

async function _flushPendingIceCandidates(peer) {
  if (!peer?.pc || !Array.isArray(peer.pendingRemoteCandidates) || !peer.pendingRemoteCandidates.length) return;
  const pending = peer.pendingRemoteCandidates.splice(0);
  for (const candidate of pending) {
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn('Failed to add ICE candidate:', e);
    }
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

// Fires for every message received from any peer (state, input, custom).
// Internal protocol messages (type: 'names') are handled here and not forwarded.
export function onMessage(fn) { _onMessage.push(fn); }
export function onPlayerJoin(fn) { _onPlayerJoin.push(fn); }
export function onPlayerLeave(fn) { _onPlayerLeave.push(fn); }

// ─── Session API ──────────────────────────────────────────────────────────────

export async function createSession() {
  const offer = await _createOffer(null);
  if (!offer) return null;

  try {
    const res = await _apiFetch('create_session.php', {
      method: 'POST',
      body: _jsonBody({ offer, hostName: 'Host' })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    _mode = 'host';
    _sessionCode = json.code;
    _sessionId = json.sessionId;
    _playerId = 'host';

    // The offer posted above is only stored server-side; guests connect by sending
    // their own offers via signaling. Drop the vestigial local peer so it doesn't
    // pollute peer counts or keep signal polling alive forever.
    const tmp = _peers.get('_temp');
    if (tmp) {
      try { tmp.pc?.close(); } catch (_) {}
      _peers.delete('_temp');
    }

    _startSignalPolling();
    return json.code;
  } catch (e) {
    console.error('Failed to create session:', e);
    return null;
  }
}

export async function joinSession(code) {
  const offer = await _createOffer(null, 'host');
  if (!offer) return false;

  try {
    const res = await _apiFetch('join_session.php', {
      method: 'POST',
      body: _jsonBody({ code, offer, guestName: 'Guest' })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    _mode = 'guest';
    _sessionCode = code;
    _sessionId = json.sessionId;
    _guestId = json.guestId;
    _playerId = _guestId;

    const tmpPeer = _peers.get('_temp');
    if (tmpPeer) {
      _peers.delete('_temp');
      _peers.set('host', tmpPeer);
      if (Array.isArray(tmpPeer.pendingCandidates) && tmpPeer.pendingCandidates.length) {
        for (const candidate of tmpPeer.pendingCandidates) {
          _sendSignal('host', 'candidate', candidate);
        }
        tmpPeer.pendingCandidates = [];
      }
    }

    _startSignalPolling();
    return true;
  } catch (e) {
    console.error('Failed to join session:', e);
    return false;
  }
}

export async function endSession() {
  if (!_sessionCode) return;
  try {
    await _apiFetch('end_session.php', {
      method: 'POST',
      body: _jsonBody({ code: _sessionCode, sessionId: _sessionId })
    });
  } catch (e) {
    console.error('Failed to end session:', e);
  }
  _cleanup();
}

// ─── Data Transfer ────────────────────────────────────────────────────────────

// Host: send any JSON payload to all connected guests.
export function broadcast(payload) {
  if (_mode !== 'host') return;
  const msg = JSON.stringify(payload);
  for (const [, peer] of _peers) {
    if (peer.channel?.readyState === 'open') peer.channel.send(msg);
  }
  _tryStopSignalPolling();
}

// Guest: send any JSON payload to the host.
// Queued if the data channel is still connecting, flushed on open.
export function send(payload) {
  if (_mode !== 'guest') return;
  _tryStopSignalPolling();
  const hostPeer = _peers.get('host');
  if (hostPeer?.channel?.readyState === 'open') {
    hostPeer.channel.send(JSON.stringify(payload));
  } else if (_guestOutQueue.length < GUEST_OUT_QUEUE_MAX) {
    _guestOutQueue.push(JSON.stringify(payload));
  }
}

function _flushGuestOutQueue() {
  const hostPeer = _peers.get('host');
  if (!hostPeer?.channel || hostPeer.channel.readyState !== 'open') return;
  const pending = _guestOutQueue.splice(0);
  for (const msg of pending) hostPeer.channel.send(msg);
}

// ─── Session Info ─────────────────────────────────────────────────────────────

export function getSessionCode() { return _sessionCode; }
export function getPlayerId() { return _playerId; }
export function isHost() { return _mode === 'host'; }
export function isGuest() { return _mode === 'guest'; }
export function getMode() { return _mode; }
// Number of remote peers with an OPEN data channel (host: connected guests; guest: 1 when connected to host).
export function getPeerCount() {
  let n = 0;
  for (const [id, peer] of _peers) {
    if (id !== '_temp' && peer.channel?.readyState === 'open') n++;
  }
  return n;
}

// ─── Signal Polling Control ───────────────────────────────────────────────────

export function setKeepPolling(val) { _keepPolling = !!val; }
export function restartSignalPolling() { if (_sessionCode) _startSignalPolling(); }

function _tryStopSignalPolling() {
  if (!_signalPollTimer || _keepPolling) return;
  const allOpen = [..._peers.values()].every(p => p.channel?.readyState === 'open');
  if (allOpen && _peers.size > 0) {
    clearInterval(_signalPollTimer);
    _signalPollTimer = null;
    _signalPollFailures = 0;
  }
}

// ─── Display Names ────────────────────────────────────────────────────────────

export function setPeerDisplayName(peerId, name) {
  if (name) _peerDisplayNames.set(peerId, name);
}

export function getPeerDisplayNames() {
  return new Map(_peerDisplayNames);
}

// Convenience: guest announces its display name to the host.
// Networking handles the internal player_hello protocol.
export function sendPlayerHello(displayName) {
  if (_mode !== 'guest') return false;
  send({
    type: 'input',
    guestId: _guestId,
    action: 'player_hello',
    data: { displayName },
    timestamp: Date.now(),
  });
  return true;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getNetworkStats() {
  const connectedPeers = Array.from(_peers.entries())
    .filter(([id, peer]) => id !== '_temp' && peer.channel?.readyState === 'open')
    .map(([id]) => id);
  const knownPeers = Array.from(_peers.keys()).filter(id => id !== '_temp');
  const isHostMode = _mode === 'host';
  return {
    mode: _mode,
    sessionCode: _sessionCode,
    playerId: _playerId,
    peerCount: connectedPeers.length,
    peers: connectedPeers,
    knownPeers,
    knownPeerCount: knownPeers.length,
    isHost: isHostMode,
    hostId: isHostMode ? _playerId : (connectedPeers[0] ?? null),
    peerDisplayNames: Object.fromEntries(_peerDisplayNames),
    voiceEnabled: _voiceEnabled,
    voiceMuted: _voiceMuted,
  };
}

// ─── WebRTC Implementation ────────────────────────────────────────────────────

const RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
};

function _peerEntryByPc(pc) {
  for (const [id, peer] of _peers) {
    if (peer.pc === pc) return [id, peer];
  }
  return [null, null];
}

// Remove a peer whose connection is gone: close pc, drop voice, notify game.
function _peerLost(id) {
  const peer = _peers.get(id);
  if (!peer) return;
  _peers.delete(id);
  try { peer.pc?.close(); } catch (_) {}
  _voiceCleanupForPeer(id);
  if (id !== '_temp') _onPlayerLeave.forEach(fn => fn(id));
}

function _watchConnectionState(pc) {
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      const [id] = _peerEntryByPc(pc);
      if (id && id !== '_temp') _peerLost(id);
    }
  };
}

async function _createOffer(peerId, signalTarget = null) {
  try {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    const channel = pc.createDataChannel('game', { ordered: true });
    // Label the channel with the remote peer's id so join/leave events fire
    // (a guest's remote peer is the host).
    _setupDataChannel(channel, signalTarget ?? peerId ?? 'guest');
    _wireVoicePc(pc);
    _watchConnectionState(pc);

    const peerKey = peerId || '_temp';
    _peers.set(peerKey, { pc, channel, pendingCandidates: [] });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const [, peerRec] = _peerEntryByPc(pc);
      // After the data channel is up, relay renegotiation ICE over it directly.
      if (peerRec?.channel?.readyState === 'open') {
        peerRec.channel.send(JSON.stringify({ type: 'voice-ice', candidate: event.candidate }));
        return;
      }
      if (signalTarget && _sessionCode && _playerId !== 'local') {
        _sendSignal(signalTarget, 'candidate', event.candidate);
        return;
      }
      if (!peerRec) return;
      if (!Array.isArray(peerRec.pendingCandidates)) peerRec.pendingCandidates = [];
      peerRec.pendingCandidates.push(event.candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return pc.localDescription;
  } catch (e) {
    console.error('Failed to create offer:', e);
    return null;
  }
}

function _setupDataChannel(channel, label = 'guest') {
  if (label !== 'guest') {
    const peer = _peers.get(label);
    if (peer) peer.channel = channel;
  }

  channel.onopen = () => {
    if (label !== 'guest') {
      _onPlayerJoin.forEach(fn => fn(label));
      _broadcastNames();
      if (_mode === 'guest') _flushGuestOutQueue();
      if (_mode === 'host') _syncVoiceTracksToPeer(label);
    }
  };

  channel.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Internal: update display name map on player_hello
      if (msg.type === 'input' && msg.action === 'player_hello' && msg.guestId && msg.data?.displayName) {
        _peerDisplayNames.set(msg.guestId, msg.data.displayName);
        _broadcastNames();
      }
      // Internal: names sync is fully consumed here, not forwarded to the game
      if (msg.type === 'names') {
        for (const [id, name] of Object.entries(msg.names || {})) {
          _peerDisplayNames.set(id, name);
        }
        return;
      }
      // Internal: voice chat renegotiation, consumed here
      if (msg.type === 'voice-sdp') { _handleVoiceSdp(label, msg.sdp); return; }
      if (msg.type === 'voice-ice') { _handleVoiceIce(label, msg.candidate); return; }
      _onMessage.forEach(fn => fn(msg));
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  channel.onclose = () => {
    if (label !== 'guest') _peerLost(label);
  };
}

// ─── Signaling (ICE Candidate Relay) ─────────────────────────────────────────

function _startSignalPolling() {
  if (_signalPollTimer) clearInterval(_signalPollTimer);
  _signalPollFailures = 0;

  _signalPollTimer = setInterval(async () => {
    if (!_sessionCode) return;
    try {
      const res = await _apiFetch(
        `signal.php?code=${encodeURIComponent(_sessionCode)}&to=${encodeURIComponent(_playerId)}`
      );
      const json = await res.json();
      _signalPollFailures = 0;
      if (json.success && json.messages) {
        for (const msg of json.messages) { _handleSignalMessage(msg); }
      }
    } catch (e) {
      _signalPollFailures++;
      if (_signalPollFailures >= MAX_SIGNAL_POLL_FAILURES) {
        console.warn(`Signal polling stopped after ${MAX_SIGNAL_POLL_FAILURES} consecutive failures`);
        clearInterval(_signalPollTimer);
        _signalPollTimer = null;
      }
    }
  }, SIGNAL_POLL_INTERVAL);
}

function _handleSignalMessage(msg) {
  const from = msg.from;
  if (from === _playerId) return;
  let peer = _peers.get(from);

  if (!peer && msg.type === 'offer') {
    peer = { pc: _createAnswerPC(from), channel: null, pendingRemoteCandidates: [] };
    _peers.set(from, peer);
  }
  if (!peer?.pc) return;

  if (msg.type === 'offer') {
    peer.pc.setRemoteDescription(new RTCSessionDescription(msg.data)).then(async () => {
      await _flushPendingIceCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      _sendSignal(from, 'answer', answer);
    }).catch(e => console.error('Failed to handle offer:', e));
  } else if (msg.type === 'answer') {
    peer.pc.setRemoteDescription(new RTCSessionDescription(msg.data))
      .then(() => _flushPendingIceCandidates(peer))
      .catch(e => console.error('Failed to handle answer:', e));
  } else if (msg.type === 'candidate' && msg.data) {
    if (!peer.pc.remoteDescription) {
      if (!Array.isArray(peer.pendingRemoteCandidates)) peer.pendingRemoteCandidates = [];
      peer.pendingRemoteCandidates.push(msg.data);
      return;
    }
    peer.pc.addIceCandidate(new RTCIceCandidate(msg.data))
      .catch(e => console.warn('Failed to add ICE candidate:', e));
  }
}

async function _sendSignal(to, type, data) {
  if (!_sessionCode) return;
  try {
    await _apiFetch('signal.php', {
      method: 'POST',
      body: _jsonBody({ code: _sessionCode, from: _playerId, to, type, data })
    });
  } catch (e) {
    console.error('Failed to send signal:', e);
  }
}

function _createAnswerPC(remoteId) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pc.ondatachannel = (event) => { _setupDataChannel(event.channel, remoteId); };
  _wireVoicePc(pc);
  _watchConnectionState(pc);
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const peer = _peers.get(remoteId);
    if (peer?.channel?.readyState === 'open') {
      peer.channel.send(JSON.stringify({ type: 'voice-ice', candidate: event.candidate }));
      return;
    }
    _sendSignal(remoteId, 'candidate', event.candidate);
  };
  return pc;
}

// ─── Voice Chat ───────────────────────────────────────────────────────────────
// Audio tracks are added to the existing game RTCPeerConnections. Renegotiation
// SDP/ICE flows over the (already open) data channel using the "perfect
// negotiation" pattern: guests are polite, the host is impolite and wins glare.
// The host relays every guest's audio to all other guests so a star topology
// gives full-mesh audibility.

export function isVoiceChatEnabled() { return _voiceEnabled; }
export function isVoiceMuted() { return _voiceMuted; }
export function onVoiceStateChanged(fn) { _onVoiceStateChanged.push(fn); }

function _emitVoiceState() {
  _onVoiceStateChanged.forEach(fn => fn({ enabled: _voiceEnabled, muted: _voiceMuted }));
}

// Capture the mic and stream it to all connected peers. Returns false if the
// mic is unavailable or permission was denied.
export async function enableVoiceChat() {
  if (_voiceEnabled) return true;
  if (_mode === 'offline') return false;
  try {
    _localVoiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    console.warn('[voice] Microphone unavailable:', e);
    return false;
  }
  _voiceEnabled = true;
  _localVoiceStream.getAudioTracks().forEach(t => { t.enabled = !_voiceMuted; });
  for (const [id, peer] of _peers) {
    if (id === '_temp' || !peer.pc) continue;
    for (const track of _localVoiceStream.getAudioTracks()) {
      try { peer.pc.addTrack(track, _localVoiceStream); } catch (e) { console.warn('[voice] addTrack failed:', e); }
    }
  }
  _emitVoiceState();
  return true;
}

export function disableVoiceChat() {
  if (!_voiceEnabled && !_localVoiceStream) return;
  _voiceEnabled = false;
  const tracks = _localVoiceStream ? _localVoiceStream.getTracks() : [];
  for (const [, peer] of _peers) {
    if (!peer.pc) continue;
    for (const sender of peer.pc.getSenders()) {
      if (sender.track && tracks.includes(sender.track)) {
        try { peer.pc.removeTrack(sender); } catch (_) {}
      }
    }
  }
  tracks.forEach(t => { try { t.stop(); } catch (_) {} });
  _localVoiceStream = null;
  _emitVoiceState();
}

export function setVoiceMuted(muted) {
  _voiceMuted = !!muted;
  _localVoiceStream?.getAudioTracks().forEach(t => { t.enabled = !_voiceMuted; });
  _emitVoiceState();
}

function _wireVoicePc(pc) {
  pc.onnegotiationneeded = async () => {
    const [, peer] = _peerEntryByPc(pc);
    // Renegotiation is only possible once the data channel is open.
    if (!peer || peer.channel?.readyState !== 'open') return;
    try {
      peer.makingOffer = true;
      await pc.setLocalDescription();
      peer.channel.send(JSON.stringify({ type: 'voice-sdp', sdp: pc.localDescription }));
    } catch (e) {
      console.warn('[voice] negotiation failed:', e);
    } finally {
      peer.makingOffer = false;
    }
  };
  pc.ontrack = (event) => { _handleRemoteTrack(pc, event); };
}

async function _handleVoiceSdp(peerId, sdp) {
  const peer = _peers.get(peerId);
  if (!peer?.pc || !sdp?.type) return;
  const pc = peer.pc;
  const polite = _mode === 'guest';
  const collision = sdp.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
  if (collision && !polite) return; // impolite side ignores; polite side re-offers
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp)); // implicit rollback when polite
    if (sdp.type === 'offer') {
      await pc.setLocalDescription();
      if (peer.channel?.readyState === 'open') {
        peer.channel.send(JSON.stringify({ type: 'voice-sdp', sdp: pc.localDescription }));
      }
    }
  } catch (e) {
    console.warn('[voice] SDP handling failed:', e);
  }
}

function _handleVoiceIce(peerId, candidate) {
  const peer = _peers.get(peerId);
  if (!peer?.pc || !candidate) return;
  peer.pc.addIceCandidate(new RTCIceCandidate(candidate))
    .catch(e => console.warn('[voice] ICE candidate failed:', e));
}

function _handleRemoteTrack(pc, event) {
  if (event.track?.kind !== 'audio') return;
  const [peerId] = _peerEntryByPc(pc);
  if (!peerId || peerId === '_temp') return;
  const track = event.track;
  const stream = event.streams?.[0] ?? new MediaStream([track]);

  _playRemoteTrack(peerId, track);

  // Host relays each guest's audio to every other guest.
  if (_mode === 'host') {
    if (!_remoteVoiceTracks.has(peerId)) _remoteVoiceTracks.set(peerId, new Map());
    _remoteVoiceTracks.get(peerId).set(track.id, { track, stream });
    track.addEventListener('ended', () => { _remoteVoiceTracks.get(peerId)?.delete(track.id); });
    for (const [targetId, target] of _peers) {
      if (targetId === peerId || targetId === '_temp') continue;
      _forwardTrackToPeer(peerId, track, stream, targetId, target);
    }
  }
}

function _forwardTrackToPeer(srcId, track, stream, targetId, target) {
  if (!target?.pc) return;
  if (!target.forwardedSenders) target.forwardedSenders = new Map();
  const list = target.forwardedSenders.get(srcId) ?? [];
  if (list.some(s => s.track === track)) return;
  try {
    const sender = target.pc.addTrack(track, stream);
    list.push(sender);
    target.forwardedSenders.set(srcId, list);
  } catch (e) {
    console.warn('[voice] forward failed:', e);
  }
}

// Host: push own mic + all known guest tracks to a (newly connected) peer.
function _syncVoiceTracksToPeer(peerId) {
  if (_mode !== 'host') return;
  const target = _peers.get(peerId);
  if (!target?.pc) return;
  if (_voiceEnabled && _localVoiceStream) {
    for (const track of _localVoiceStream.getAudioTracks()) {
      const already = target.pc.getSenders().some(s => s.track === track);
      if (!already) {
        try { target.pc.addTrack(track, _localVoiceStream); } catch (_) {}
      }
    }
  }
  for (const [srcId, tracks] of _remoteVoiceTracks) {
    if (srcId === peerId) continue;
    for (const { track, stream } of tracks.values()) {
      if (track.readyState !== 'live') continue;
      _forwardTrackToPeer(srcId, track, stream, peerId, target);
    }
  }
}

function _playRemoteTrack(peerId, track) {
  const key = `${peerId}:${track.id}`;
  if (_voiceAudioEls.has(key)) return;
  const el = document.createElement('audio');
  el.autoplay = true;
  el.setAttribute('playsinline', '');
  el.style.display = 'none';
  el.srcObject = new MediaStream([track]);
  document.body.appendChild(el);
  el.play().catch(() => { _pendingAudioPlay.push(el); _armGestureResume(); });
  _voiceAudioEls.set(key, el);
  track.addEventListener('ended', () => _removeVoiceAudioEl(key));
}

function _removeVoiceAudioEl(key) {
  const el = _voiceAudioEls.get(key);
  if (!el) return;
  el.srcObject = null;
  el.remove();
  _voiceAudioEls.delete(key);
}

// Browsers may block autoplay until a user gesture; retry pending audio then.
function _armGestureResume() {
  if (_gestureArmed) return;
  _gestureArmed = true;
  const resume = () => {
    _gestureArmed = false;
    document.removeEventListener('pointerdown', resume);
    document.removeEventListener('keydown', resume);
    const els = _pendingAudioPlay.splice(0);
    els.forEach(el => el.play().catch(() => {}));
  };
  document.addEventListener('pointerdown', resume);
  document.addEventListener('keydown', resume);
}

function _voiceCleanupForPeer(peerId) {
  for (const key of Array.from(_voiceAudioEls.keys())) {
    if (key.startsWith(`${peerId}:`)) _removeVoiceAudioEl(key);
  }
  _remoteVoiceTracks.delete(peerId);
  // Stop relaying this peer's audio to everyone else.
  for (const [, target] of _peers) {
    const senders = target.forwardedSenders?.get(peerId);
    if (!senders) continue;
    for (const sender of senders) {
      try { target.pc?.removeTrack(sender); } catch (_) {}
    }
    target.forwardedSenders.delete(peerId);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function _cleanup() {
  if (_signalPollTimer) clearInterval(_signalPollTimer);
  _signalPollTimer = null;
  disableVoiceChat();
  for (const [id] of Array.from(_peers)) _voiceCleanupForPeer(id);
  for (const [, peer] of _peers) { if (peer.pc) { try { peer.pc.close(); } catch (_) {} } }
  _peers.clear();
  _peerDisplayNames.clear();
  _guestOutQueue.length = 0;
  _mode = 'offline';
  _sessionCode = null;
  _sessionId = null;
  _guestId = null;
  _playerId = 'local';
  _keepPolling = false;
}

function _broadcastNames() {
  if (_mode !== 'host') return;
  const msg = JSON.stringify({ type: 'names', names: Object.fromEntries(_peerDisplayNames) });
  for (const [, peer] of _peers) {
    if (peer.channel?.readyState === 'open') peer.channel.send(msg);
  }
}
