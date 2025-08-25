// Global shared state (for cross-module access)
export const state = {
  AUDIO_FILE: null,
  AUDIO_CH: [],            // array of {title,start,end,idx}
  SLICED_WAVS: new Map(),  // idx -> { blob, url, name }
  CHAPTER_CACHE: new Map(),// idx -> words[]
  REF_TEXT: '',
  CURRENT_IDX: 0,
  PLAIN_TEXT: [],
  TEXT_CH: [],         // array of { title, text, idx } from EPUB
  MAP_OFFSET: 0,       // textStartIndex - audioStartIndex
  ALIGNED_ONCE: false, // UI convenience (optional)
};
