# Needle

A vinyl-first music player for the desktop. Two pages: the side that is
playing, and the settings that shape it.

The record is a real object on screen — a pressed disc with grooves, a lifted
tonearm, a tick halo and a cue arc. The words are timed, and the sung word
takes the light. Music comes from NetEase Cloud Music, QQ Music, Soda Music or
files on this machine, each behind the same small source interface.

Built with **Tauri 2**, **Vite**, **React**, **HeroUI v3**, **Tailwind 4** and
**Motion**.

## What it does

- **Play page** — turntable, tonearm, chord/lyric stage, position, volume.
  The disc keeps the album's colours pressed into its marbling; the label is the
  cover. Pause lifts the arm and stops the platter; the queue carries on by
  itself when a side ends.
- **Lyrics** — LRC from NetEase and QQ, per-character timings from Soda Music,
  with a shimmer that sweeps the line being sung.
- **Library drawer** — the account's playlists, liked songs and the charts each
  service publishes, opened from the button beside the source menu.
- **Settings** — sources on or off, volume, autoplay, platter spin, label
  (album art or printed), lyric size, neighbour blur, how the sung word is
  marked, audio cache size and clearing, the keyboard map.
- **Sign-in** — QR in the app, the way the phone apps expect it. No password is
  ever typed here.
- **Updates** — the app checks GitHub for a newer release on launch, installs it
  and restarts. Releases are signed with the updater key.

## Sources

| Source | Search | Playback | Lyrics | Library |
| --- | --- | --- | --- | --- |
| NetEase Cloud Music | ✓ | ✓ (some songs need an account) | ✓ LRC | playlists, liked, charts |
| QQ Music | ✓ | ✓ after sign-in | ✓ LRC | playlists, charts |
| Soda Music | ✓ | ✓ (signed requests) | ✓ per character | — |
| This machine | — | ✓ | `.lrc` beside the file | — |

Every answer is optional: a source that cannot do something never shows a
control it cannot honour.

### How a source is written

`src/music/types.ts` describes the interface — `tracks`, `search`, `stream`,
`lyrics`, `chart`. Add an object in `src/sources/`, register it in
`src/sources/index.ts`, and it appears in the menu and the settings. The player
does not know which service it is talking to.

The shape is copied from [MyGo Music](https://github.com/egoist/mygo-music),
whose sources are JavaScript plugins: one function per capability, one object
of parameters, the source stamping its own tracks. `vendor/mygo-music` is a
submodule of it, and `docs/mygo-music.md` records what was learned there;
`docs/qishui.md` records Soda's signing.

## Run

```bash
npm install
npm run app      # the desktop window
npm run dev      # the page in a browser, for layout work
```

The browser build proxies NetEase and QQ through the dev server, so search and
lyrics work there; playback through the network needs the desktop app, which
signs requests and caches audio.

### Requirements

- Node 20 or newer
- Rust stable
- On Linux: `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`

## Release

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` builds macOS (Apple Silicon only), Windows,
Linux and an Android APK, uploads the bundles and opens a draft release with
`latest.json` for the updater.

Signing needs two repository secrets:

```
TAURI_SIGNING_PRIVATE_KEY           the contents of ~/.tauri/needle.key
TAURI_SIGNING_PRIVATE_KEY_PASSWORD  its password (empty if none)
```

The matching public key is already in `src-tauri/tauri.conf.json`; without the
private key the updater artefact is not produced and installed apps will not
find an update.
`.github/workflows/ci.yml` type-checks and builds every push and pull request.

## Layout

```
src/
  App.tsx              the two pages and the player state
  components/          deck, chord lane, transport, search, library, settings
  sources/             one file per service, plus the registry
  audio/               transport for buffers and files
  music/               types, notes, LRC parsing
src-tauri/
  src/netease.rs       search, chart, library, player URL, cookie jar, cache
  src/netease_login.rs QR sign-in (unikey → client/login, through eapi)
  src/qq.rs            search, charts, playlists, UrlGetVkey playback
  src/qq_login.rs      QR sign-in and the check_sig → oauth exchange
  src/qishui.rs        signed track requests and the audio cache
  src/qishui_login.rs  ByteDance passport QR sign-in
  src/art.rs           the cover palette the vinyl is dyed with
docs/                  notes on MyGo Music and on Soda's signing
```

## Notes and limits

- **Soda Music's signer is not in this repository.** `src-tauri/resources/qishui`
  holds a compiled host plus ByteDance's `bdms.node` and its platform library,
  which are not ours to redistribute. Without them, search and lyrics still
  work and playback says the signer is missing. `docs/qishui.md` explains how
  to assemble it locally.
- **NetEase risk control** answers `-460` when an address asks too often; the
  app keeps a cookie jar, retries with jitter, caches the chart and plays
  cached audio first. Waiting is part of using it.
- **QQ Music** needs a signed-in session for audio, and its profile CGI often
  refuses even then; the name comes from the sign-in response.
- The app keeps one cached copy per song for playback. Artwork and audio belong
  to their services.

## Credits

- [MyGo Music](https://github.com/egoist/mygo-music) for the source-per-plugin
  architecture this follows.
- [HeroUI](https://www.heroui.com) for the controls, [Motion](https://motion.dev)
  for the stage, [Tailwind CSS](https://tailwindcss.com) for the layout.
- Instrument Sans and IBM Plex Mono, under the SIL Open Font License.
