// networking.js — Kinetik generic WebRTC P2P networking with PHP signaling
// Host-authoritative model: host broadcasts state to guests, guests send inputs to host.
// Any JSON-serialisable payload can be sent via broadcast() and send().
// Usage:
//   configureNet({ apiBase: 'https://yourserver.com/api' });
//   const code = await createSession();
//   broadcast({ type: 'state', ...whatever });
//   send({ type: 'input', action: 'fire', data: {} });
//   onMessage(msg => { ... });

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
export function send(payload) {
  if (_mode !== 'guest') return;
  _tryStopSignalPolling();
  const hostPeer = _peers.get('host');
  if (hostPeer?.channel?.readyState === 'open') {
    hostPeer.channel.send(JSON.stringify(payload));
  }
}

// ─── Session Info ─────────────────────────────────────────────────────────────

export function getSessionCode() { return _sessionCode; }
export function getPlayerId() { return _playerId; }
export function isHost() { return _mode === 'host'; }
export function isGuest() { return _mode === 'guest'; }
export function getMode() { return _mode; }
export function getPeerCount() { return _peers.size; }

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
  const hostPeer = _peers.get('host');
  if (!hostPeer?.channel || hostPeer.channel.readyState !== 'open') return false;
  hostPeer.channel.send(JSON.stringify({
    type: 'input',
    guestId: _guestId,
    action: 'player_hello',
    data: { displayName },
    timestamp: Date.now(),
  }));
  return true;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getNetworkStats() {
  const connectedPeers = Array.from(_peers.entries())
    .filter(([, peer]) => peer.channel?.readyState === 'open')
    .map(([id]) => id);
  const knownPeers = Array.from(_peers.keys());
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
  };
}

// ─── WebRTC Implementation ────────────────────────────────────────────────────

async function _createOffer(peerId, signalTarget = null) {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
    });

    const channel = pc.createDataChannel('game', { ordered: true });
    _setupDataChannel(channel);

    const peerKey = peerId || '_temp';
    _peers.set(peerKey, { pc, channel: peerId ? null : channel, pendingCandidates: [] });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      if (signalTarget && _sessionCode && _playerId !== 'local') {
        _sendSignal(signalTarget, 'candidate', event.candidate);
        return;
      }
      const peer = _peers.get(peerKey);
      if (!peer) return;
      if (!Array.isArray(peer.pendingCandidates)) peer.pendingCandidates = [];
      peer.pendingCandidates.push(event.candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return pc.localDescription;
  } catch (e) {
    console.error('Failed to create offer:', e);
    return null;
  }
}

async function _acceptAnswer(answer) {
  try {
    const hostPeer = _peers.get('_temp');
    if (!hostPeer?.pc) return;
    const pc = hostPeer.pc;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await _flushPendingIceCandidates(hostPeer);
    _peers.delete('_temp');
    _peers.set('host', { pc, channel: hostPeer.channel });
    pc.ondatachannel = (event) => { _setupDataChannel(event.channel, 'host'); };
  } catch (e) {
    console.error('Failed to accept answer:', e);
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
      _onMessage.forEach(fn => fn(msg));
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  channel.onclose = () => {
    if (label !== 'guest') {
      _onPlayerLeave.forEach(fn => fn(label));
      const peer = _peers.get(label);
      if (peer) peer.channel = null;
    }
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
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  });
  pc.ondatachannel = (event) => { _setupDataChannel(event.channel, remoteId); };
  pc.onicecandidate = (event) => {
    if (event.candidate) _sendSignal(remoteId, 'candidate', event.candidate);
  };
  return pc;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function _cleanup() {
  if (_signalPollTimer) clearInterval(_signalPollTimer);
  for (const [, peer] of _peers) { if (peer.pc) peer.pc.close(); }
  _peers.clear();
  _peerDisplayNames.clear();
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
