// modules/highlight_exact.js
// Highlighter with robust seek handling: clears any existing highlights immediately on seek.

function findWordIndexAtTime(words, t) {
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid];
    if (t < w.start) hi = mid - 1;
    else if (t > w.end) lo = mid + 1;
    else { ans = mid; break; }
  }
  if (ans !== -1) return ans;
  return Math.min(Math.max(lo - 1, 0), words.length - 1);
}

export function createHighlighter(opts) {
  const {
    getPlayer,
    getIsMobile,
    setMobileTimes,
    getAudioChapters,
    getCurrentAudioIndex,
    addLog,
  } = opts;

  const state = {
    words: [],
    desktopHost: null,
    mobileHost: null,
    desktopTokens: null,
    mobileTokens: null,
    lastActiveIdx: -1,
    rafId: null,
    wiredPlayer: false,
  };

  function setWords(words) {
    state.words = Array.isArray(words) ? words : [];
    state.lastActiveIdx = -1;
  }

  function setRenderedTokens({ desktopHost, mobileHost, desktopTokens, mobileTokens }) {
    state.desktopHost   = desktopHost || null;
    state.mobileHost    = mobileHost  || null;
    state.desktopTokens = desktopTokens || null;
    state.mobileTokens  = mobileTokens  || null;
    state.lastActiveIdx = -1;
    clearActiveClasses();
  }

  function clearActiveClasses() {
    const clear = (nodeList) => {
      if (!nodeList) return;
      nodeList.forEach(n => n.classList.remove('active'));
    };
    clear(state.desktopTokens);
    clear(state.mobileTokens);
  }

  function markActive(idx) {
    if (idx === state.lastActiveIdx) return;
    // remove old
    if (state.lastActiveIdx >= 0) {
      const oldD = state.desktopTokens?.[state.lastActiveIdx];
      const oldM = state.mobileTokens?.[state.lastActiveIdx];
      if (oldD) oldD.classList.remove('active');
      if (oldM) oldM.classList.remove('active');
    }
    state.lastActiveIdx = idx;
    const d = state.desktopTokens?.[idx];
    const m = state.mobileTokens?.[idx];
    if (d) d.classList.add('active');
    if (m) m.classList.add('active');

    // keep token in view
    if (d && d.scrollIntoView && state.desktopHost) {
      const hostRect = state.desktopHost.getBoundingClientRect();
      const rect = d.getBoundingClientRect();
      if (rect.top < hostRect.top || rect.bottom > hostRect.bottom) {
        d.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function getPlaybackAbsoluteTime() {
    const player = getPlayer && getPlayer();
    if (!player) return 0;
    const chIdx = (getCurrentAudioIndex && getCurrentAudioIndex()) | 0;
    const ch = (getAudioChapters && getAudioChapters()[chIdx]) || { start: 0 };
    const chapterStart = Number(ch.start) || 0;
    return chapterStart + (Number(player.currentTime) || 0);
  }

  function tick() {
    const words = state.words;
    if (!words || words.length === 0) {
      state.rafId = requestAnimationFrame(tick);
      return;
    }
    const tAbs = getPlaybackAbsoluteTime();
    const idx = findWordIndexAtTime(words, tAbs);
    if (idx >= 0) {
      markActive(idx);
      if (setMobileTimes && getIsMobile && getIsMobile()) {
        const player = getPlayer && getPlayer();
        if (player) setMobileTimes(player.currentTime, player.duration || 0);
      }
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.rafId == null) state.rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  // NEW: performs a full reset of highlighting (used on any seek)
  function resetHighlighting() {
    clearActiveClasses();
    state.lastActiveIdx = -1;
  }

  function attachPlayerListeners() {
    if (state.wiredPlayer) return;
    const player = getPlayer && getPlayer();
    if (!player) return;
    state.wiredPlayer = true;

    player.addEventListener('play', () => {
      startLoop();
    });

    player.addEventListener('pause', () => {
      // keep last highlight, just stop advancing
      stopLoop();
    });

    // IMPORTANT: Clear highlights immediately when user seeks.
    player.addEventListener('seeking', () => {
      resetHighlighting();   // <-- this removes any existing 'active' classes
    });
    // Some browsers fire 'seeked' more reliably than 'seeking'; handle both.
    player.addEventListener('seeked', () => {
      resetHighlighting();   // <-- ensures a clean state after seek completes
    });

    player.addEventListener('ended', () => {
      stopLoop();
      resetHighlighting();
    });

    if (!player.paused && !player.ended) startLoop();

    try { addLog && addLog('info','Highlighter wired to player'); } catch {}
  }

  function wireClicks({ desktopHost, mobileHost, getWordByIdx }) {
    const onClick = (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('token')) return;
      const idx = Number(t.dataset.idx);
      if (!Number.isFinite(idx)) return;
      const w = getWordByIdx ? getWordByIdx(idx) : null;
      if (!w) return;
      const player = getPlayer && getPlayer();
      if (!player) return;

      const chIdx = (getCurrentAudioIndex && getCurrentAudioIndex()) | 0;
      const ch = (getAudioChapters && getAudioChapters()[chIdx]) || { start: 0 };
      const chapterStart = Number(ch.start) || 0;
      const seekTime = Math.max(0, (Number(w.start) || 0) - chapterStart);

      // NEW: Clear any existing highlight BEFORE jumping
      resetHighlighting();

      player.currentTime = seekTime;
      player.play().catch(()=>{});
    };

    if (desktopHost) desktopHost.addEventListener('click', onClick);
    if (mobileHost)  mobileHost.addEventListener('click', onClick);
  }

  return {
    setWords,
    setRenderedTokens,
    wireClicks,
    attachPlayerListeners,
    // expose for debugging if needed
    _debug: { resetHighlighting }
  };
}
