import type { StageLine, Token } from "./types";

/**
 * LRC sheets, as NetEase and most players write them: one time per line, an
 * optional translation, and no word timings. We spread each line's words over
 * the time it is shown, weighted by how long each word takes to say.
 */

export type LyricLine = { at: number; text: string };

const STAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
const CREDIT =
  /^(作词|作曲|编曲|制作|监制|出品|发行|录音|混音|母带|合声|和声|吉他|贝斯|鼓|弦乐|键盘|人声|演唱|原唱|词|曲|Lyrics|Composer|Arranger|Producer|Mixed|Mastered|Written|Music|Vocals|Guitar|Bass|Drums|Strings|Recorded|Engineer|Mixing)[^:：]{0,8}[:：]/i;

export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    STAMP.lastIndex = 0;
    const stamps = [...raw.matchAll(STAMP)];
    if (!stamps.length) continue;
    const last = stamps[stamps.length - 1];
    const body = raw.slice((last.index ?? 0) + last[0].length).trim();
    if (!body) continue;
    for (const stamp of stamps) {
      const at =
        Number(stamp[1]) * 60 + Number(stamp[2]) + (stamp[3] ? Number(`0.${stamp[3]}`) : 0);
      lines.push({ at, text: body });
    }
  }
  lines.sort((a, b) => a.at - b.at);
  return lines.filter((line, index) => index === 0 || line.at !== lines[index - 1].at);
}

/** Credit lines read as metadata, not as something to sing. */
function singable(lines: LyricLine[]): LyricLine[] {
  return lines.filter((line) => !CREDIT.test(line.text));
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const PUNCT = /^[\s·、，。！？；：""''（）《》—…\-–,.!?;:'"()[\]]+$/;

/** Latin words stay whole; a run of Chinese or Japanese breaks per character. */
export function splitWords(text: string): string[] {
  if (!CJK.test(text)) return text.split(/\s+/).filter(Boolean);
  const words: string[] = [];
  let latin = "";
  const flush = () => {
    if (latin) words.push(latin);
    latin = "";
  };
  for (const char of text) {
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (/[A-Za-z0-9'’]/.test(char)) {
      latin += char;
      continue;
    }
    flush();
    if (PUNCT.test(char) && words.length) {
      words[words.length - 1] += char;
    } else if (!PUNCT.test(char)) {
      words.push(char);
    }
  }
  flush();
  return words;
}

/** Turns a sheet into the timed lines the stage draws. */
export function toStage(lyrics: LyricLine[], duration: number): StageLine[] {
  const lines = singable(lyrics);
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const end = next ? next.at : Math.max(line.at + 4, duration);
    const span = Math.max(0.8, end - line.at);
    const words = splitWords(line.text);
    const weights = words.map((word) => Math.max(1, word.replace(PUNCT, "").length));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cursor = line.at;

    const tokens: Token[] = words.map((word, i) => {
      const width = (weights[i] / total) * span;
      const token: Token = { notes: [], word, at: cursor, dur: width };
      cursor += width;
      return token;
    });

    return { at: line.at, end, tokens };
  });
}
