// settings.js — Cross-platform persistent settings
//
// Priority chain per platform:
//   Mobile (Android/iOS):  @capacitor/preferences  (native SharedPreferences / NSUserDefaults)
//   Desktop (Electron):    IPC → app.getPath('userData')/settings/<key>.json
//   Web / fallback:        localStorage

import { platformConfig } from './platform.js';

let _Preferences = null;

async function _getPreferences() {
  if (_Preferences) return _Preferences;
  if (platformConfig.isMobile) {
    try {
      const mod = await import('@capacitor/preferences');
      _Preferences = mod.Preferences;
      return _Preferences;
    } catch (e) {
      console.warn('[settings] @capacitor/preferences not available:', e);
    }
  }
  return null;
}

export async function readSetting(key) {
  const Preferences = await _getPreferences();
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
  const Preferences = await _getPreferences();
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
