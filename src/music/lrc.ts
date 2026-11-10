import type { StageLine, Token } from "./types";

/**
 * LRC sheets, as NetEase and most players write them: one time per line, an
 * optional translation, and no word timings. We spread each line's words over
 * the time it is shown, weighted by how long each word takes to say.
 */

export type LyricLine = { at: number; text: string };

const STAMP = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
const CREDIT =
  /^(作词|作曲|编曲|制作|监制|出品|发行|录音|混音|母带|合声|和声|吉他|贝斯|鼓|弦乐|键盘|人声|演唱|原唱|封面|企划|统筹|设计|美术|摄影|插画|配唱|和音|旁白|版权|鸣谢|词|曲|Lyrics|Composer|Arranger|Producer|Mixed|Mastered|Written|Music|Vocals|Guitar|Bass|Drums|Strings|Recorded|Engineer|Mixing)[^:：]{0,10}[:：]/i;

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
  return lines.filter((line, index) => {
    if (CREDIT.test(line.text)) return false;
    // "封面设计：ELANUS" and its neighbours: a short prefix and a colon in the
    // opening block is a credit, whatever the job is called.
    if (index < 16 && /^[^：:]{2,14}[：:]/.test(line.text)) return false;
    return true;
  });
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

/**
 * "发如雪 - 周杰伦 (Jay Chou)" is a header, not a lyric. Drop a line that reads
 * like the title and the artist of the record that is playing.
 */
function isHeader(text: string, title?: string, artist?: string): boolean {
  if (!/[—–-]/.test(text)) return false;
  const flat = text.toLowerCase().replace(/\s+/g, " ");
  const needle = (value?: string) => value?.toLowerCase().trim();
  const t = needle(title);
  const a = needle(artist);
  return Boolean((t && t.length > 1 && flat.includes(t)) || (a && a.length > 1 && flat.includes(a)));
}

/** Turns a sheet into the timed lines the stage draws. */
export function toStage(
  lyrics: LyricLine[],
  duration: number,
  track?: { title?: string; artist?: string },
): StageLine[] {
  const lines = singable(lyrics).filter((line) => !isHeader(line.text, track?.title, track?.artist));
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const end = next ? next.at : Math.max(line.at + 4, duration);
    const span = Math.max(0.8, end - line.at);
    const words = splitWords(line.text);
    const weights = words.map((word) => Math.max(1, word.replace(PUNCT, "").length));
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    // A sheet gives one time per line. The words are spread over the part of
    // the span the line is actually sung in, not over the silence that follows
    // it — otherwise every word trails the voice, and the last word of a line
    // trails by the most, which reads as the stage being one word behind.
    const rate = CJK.test(line.text) ? 0.34 : 0.12;
    const sung = Math.min(span, Math.max(0.9, total * rate));
    let cursor = line.at;

    const tokens: Token[] = words.map((word, i) => {
      const width = (weights[i] / total) * sung;
      const token: Token = { notes: [], word, at: cursor, dur: width };
      cursor += width;
      return token;
    });

    return { at: line.at, end, tokens };
  });
}
