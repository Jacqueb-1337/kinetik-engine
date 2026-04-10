// platform.js - Platform detection and configuration
export const platformConfig = {
  // Platform type: 'windows', 'mac', 'linux', 'android', 'web'
  platform: detectPlatform(),
  
  // Feature flags based on platform
  get isMobile() {
    return this.platform === 'android' || this.platform === 'ios';
  },
  
  get isDesktop() {
    return this.platform === 'windows' || this.platform === 'mac' || this.platform === 'linux';
  },
  
  get needsOnScreenControls() {
    return this.isMobile;
  },
  
  get supportsPointerLock() {
    return this.isDesktop || this.platform === 'web';
  },
  
  get needsTouchInput() {
    return this.isMobile;
  }
};

function detectPlatform() {
  // Check for build-time platform override
  if (typeof PLATFORM_BUILD !== 'undefined') {
    return PLATFORM_BUILD;
  }
  
  // Check for Electron
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    const platform = process.platform;
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'mac';
    if (platform === 'linux') return 'linux';
  }
  
  // Check for Android/iOS (Capacitor or native WebView)
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('android')) return 'android';
  if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'ios';
  
  // Default to web
  return 'web';
}

// Log platform on load
console.log('Platform detected:', platformConfig.platform);
console.log('Mobile:', platformConfig.isMobile);
console.log('Desktop:', platformConfig.isDesktop);
console.log('Needs on-screen controls:', platformConfig.needsOnScreenControls);
