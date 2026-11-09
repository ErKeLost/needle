import type { MusicSource } from "../music/types";
import { localSource } from "./local";
import { neteaseSource } from "./netease";
import { qqSource } from "./qq";
import { qishuiSource } from "./qishui";
import { sessionSource } from "./session";
import { buildSession } from "../music/session";

/**
 * The sources this window offers. A source is a plain object of optional
 * answers — search, stream, lyrics — shaped after the MyGo Music plugins in
 * `vendor/mygo-music`: add one here and the page can play it, with no other
 * change to the player.
 */
export function musicSources(session = sessionSource(buildSession())): MusicSource[] {
  return [session, neteaseSource, qqSource, qishuiSource, localSource];
}

export { localSource, neteaseSource, qishuiSource, qqSource, sessionSource };
