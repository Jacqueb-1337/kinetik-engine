const UUID_KEY = 'sinister_player_uuid';
const NAME_KEY = 'sinister_display_name';

function _genUuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function getPlayerUuid() {
  let id = localStorage.getItem(UUID_KEY);
  if (!id) {
    id = _genUuid();
    localStorage.setItem(UUID_KEY, id);
  }
  return id;
}

export function getDisplayName() {
  return localStorage.getItem(NAME_KEY) || getPlayerUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

export function setDisplayName(name) {
  const trimmed = name.trim().slice(0, 20);
  if (trimmed) {
    localStorage.setItem(NAME_KEY, trimmed);
    return trimmed;
  }
  return getDisplayName();
}
