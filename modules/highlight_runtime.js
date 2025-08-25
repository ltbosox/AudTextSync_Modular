// modules/highlight_runtime.js
import { createHighlighter } from './highlight_exact.js';
import { addLog } from './ui.js';
import { state } from './app_state.js';

// Detect your audio element. Keep both fallbacks if your HTML has two layouts.
const getPlayer = () =>
  document.getElementById('player') ||
  document.getElementById('playerDesktop') ||
  null;

const getIsMobile = () => false; // flip to true if you have a mobile-only UI
const setMobileTimes = null;

// chapter helpers
const getAudioChapters = () => state?.AUDIO_CH || [];
const getCurrentAudioIndex = () => state?.CURRENT_IDX | 0;

export const highlighter = createHighlighter({
  getPlayer,
  getIsMobile,
  setMobileTimes,
  getAudioChapters,
  getCurrentAudioIndex,
  addLog,
});

// Call this RIGHT AFTER you render tokens so the loop knows about them
export function bindTokensAfterRender(words) {
  const desktopHost = document.getElementById('transcript');     // *** matches your HTML
  const mobileHost  = document.getElementById('mText');          // optional
  const desktopTokens = desktopHost ? desktopHost.querySelectorAll('.token') : null;
  const mobileTokens  = mobileHost  ? mobileHost.querySelectorAll('.token')  : null;

  highlighter.setRenderedTokens({ desktopHost, mobileHost, desktopTokens, mobileTokens });
  highlighter.setWords(words || []);
  highlighter.wireClicks({
    desktopHost,
    mobileHost,
    getWordByIdx: (idx) => (words && words[idx]) || null,
  });
  highlighter.attachPlayerListeners();
}
