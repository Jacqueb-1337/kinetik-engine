import { platformConfig } from './platform.js';

function _getPreferences() {
  if (platformConfig.isMobile && window.Capacitor?.Plugins?.Preferences) {
    return window.Capacitor.Plugins.Preferences;
  }
  return null;
}

export async function readSetting(key) {
  const Preferences = _getPreferences();
  if (Preferences) {
    try {
      const { value } = await Preferences.get({ key: 'sinister_' + key });
      return value !== null ? JSON.parse(value) : null;
    } catch (e) {
      console.warn('[settings] Preferences.get failed:', e);
    }
  }

  if (window.electron?.readSetting) {
    try { return await window.electron.readSetting(key); } catch (e) {
      console.warn('[settings] electron.readSetting failed:', e);
    }
  }

  try {
    const raw = localStorage.getItem('sinister_' + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function writeSetting(key, value) {
  const Preferences = _getPreferences();
  if (Preferences) {
    try {
      await Preferences.set({ key: 'sinister_' + key, value: JSON.stringify(value) });
      return;
    } catch (e) {
      console.warn('[settings] Preferences.set failed:', e);
    }
  }

  if (window.electron?.writeSetting) {
    try { await window.electron.writeSetting(key, value); return; } catch (e) {
      console.warn('[settings] electron.writeSetting failed:', e);
    }
  }

  try { localStorage.setItem('sinister_' + key, JSON.stringify(value)); } catch {}
}
