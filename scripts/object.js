export function onLoad(ctx) {
  console.log('[kinetik] object script loaded:', ctx.editorId, ctx.object?.name || '(unnamed)');
}

export function onStateChange(ctx, nextIdx, prevIdx) {
  void ctx;
  void nextIdx;
  void prevIdx;
}

