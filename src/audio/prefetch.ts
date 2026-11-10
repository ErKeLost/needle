import type { MusicSource, StageLine, Stream, Track } from "../music/types";

/**
 * The sides either side of the one on the platter.
 *
 * A source only hands back audio once it has finished fetching it, so a cold
 * press on "next" waits for a download. Everything a track needs is asked for
 * ahead of time here, and `load` picks the ready answer up instead of starting
 * the same request again.
 */

type Waiting<T> = { promise: Promise<T>; at: number };

/** How many tracks stay warm. Two ahead is enough; more is just bandwidth. */
const KEEP = 6;
/**
 * An address is worth reusing for a moment — two clicks on one side should not
 * resolve twice — but not for a session: once the file is on this machine the
 * next look should find it instead of the old stream.
 */
const ADDRESS_TTL = 30_000;

const streams = new Map<string, Waiting<Stream>>();
const sheets = new Map<string, Waiting<StageLine[]>>();

function keyOf(source: MusicSource, track: Track): string {
  return `${source.id}:${track.id}`;
}

function remember<T>(
  cache: Map<string, Waiting<T>>,
  key: string,
  start: () => Promise<T>,
  ttl = Infinity,
): Promise<T> {
  const known = cache.get(key);
  if (known && Date.now() - known.at < ttl) return known.promise;

  const promise = start();
  cache.set(key, { promise, at: Date.now() });
  // A failed fetch is forgotten, so the next attempt is a real one.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });

  // Oldest first, but never the one being asked for now.
  for (const stale of [...cache.keys()]) {
    if (cache.size <= KEEP) break;
    if (stale === key) continue;
    cache.delete(stale);
  }
  return promise;
}

/** The playable address for a track, resolved once however often it is asked for. */
export function streamOf(source: MusicSource, track: Track, cookie?: string): Promise<Stream> {
  return remember(
    streams,
    keyOf(source, track),
    () => source.stream(track, { cookie }),
    ADDRESS_TTL,
  );
}

/** The lyric sheet for a track, fetched once however often it is asked for. */
export function linesOf(source: MusicSource, track: Track): Promise<StageLine[]> {
  if (!source.lyrics) return Promise.resolve(track.lines);
  const lyrics = source.lyrics.bind(source);
  return remember(sheets, keyOf(source, track), () => lyrics(track));
}

/**
 * Fetch what the next presses will want, one side after another so they never
 * compete with the side already playing. `stillWanted` is how a caller stops
 * the walk when the listener has moved somewhere else.
 */
export async function warmAhead(
  source: MusicSource,
  tracks: Track[],
  cookie?: string,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  for (const track of tracks) {
    if (!stillWanted()) return;
    if (source.lyrics && !track.lines.length) void linesOf(source, track).catch(() => undefined);
    try {
      // A whole file, not a stream: the point of the warm-up is that the next
      // press finds the side already on this machine.
      if (source.warm) await source.warm(track, { cookie });
      else await streamOf(source, track, cookie);
    } catch {
      // A warm-up that fails costs nothing; the press itself will try again.
    }
  }
}
