# Needle

A vinyl-first music player for the desktop. Two pages: the side that is
playing, and the settings that shape it — nothing else. The play page holds the
record, the words as they are sung, and where the needle is.

Built with Tauri 2 and Vite. Sources are pluggable: the built-in session, local
files, NetEase Cloud Music and QQ Music all answer the same small interface, so
the page does not know where a song came from.

## Run

```bash
npm install
npm run app        # Tauri window
npm run dev        # browser, for working on the page
```

`npm run dev` proxies NetEase and QQ Music through the Vite server, so search
and lyrics work in a browser; playback through the network needs the desktop
window, which signs the requests and caches the audio.

## Sources

`src/music/types.ts` describes what a source may answer:

| Answer | What it does |
| --- | --- |
| `tracks()` | the library a source already has |
| `search(query)` | find songs |
| `stream(track)` | an `AudioBuffer` or a URL, plus its headers |
| `lyrics(track)` | timed lines for the stage |

Every answer is optional. A source that only searches never shows a player
control it cannot honour. This is the shape of a MyGo Music plugin
(`vendor/mygo-music/internal/music/music.go`), with the same names for the
functions and the same idea that the source stamps its own tracks.

Add a source in `src/sources/`, register it in `src/sources/index.ts`, and its
name appears in the source menu and in Settings. Nothing in the player changes.

## Settings

The settings page is the whole configuration surface: sources on or off, volume,
autoplay, platter spin, label (album art or the printed one), lyric size,
neighbour blur, how the sung word is marked, the audio cache size and a button
to empty it, and the keyboard map. Everything persists in `localStorage`.

### NetEase Cloud Music

- Search: `POST /api/cloudsearch/pc`
- Lyrics: `GET /api/song/lyric`
- Playback: the encrypted `eapi` `/api/song/enhance/player/url/v1`, then one
  download into the app cache, because a WebView cannot send the Referer the
  CDN wants.

An account is not required for the songs that are free; a song that needs a
subscription says so.

### QQ Music

- Search: `client_search_cp`
- Lyrics: `fcg_query_lyric_new.fcg`
- Playback: the `vkey` handshake through `musicu.fcg`.

QQ Music withholds most audio from anonymous callers, so many songs report that
they need a subscription. The app never substitutes the 30 second preview.

## The reference

`vendor/mygo-music` is a submodule of [egoist/mygo-music](https://github.com/egoist/mygo-music),
a native Go player that runs each source as a JavaScript plugin. Its source
interface, plugin manifest and host globals are the model for `MusicSource`
here; the notes are in `docs/mygo-music.md`.

## Notes

- Art from NetEase and QQ Music belongs to their owners; the app stores one
  cached copy per song for playback, nothing more.
