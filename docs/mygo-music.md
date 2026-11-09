# How MyGo Music takes on a platform

Notes from `vendor/mygo-music` (0.1.22), read before wiring NetEase here.
It is a Go app drawn with MyGo's own UI, no WebView, and every service beyond
local files arrives as a plugin.

## A plugin is a folder, not a build

```
my-plugin/
  plugin.json
  index.js        (or .ts)
```

```json
{
  "id": "netease",
  "name": "网易云音乐",
  "version": "0.1.7",
  "minAppVersion": "0.1.20",
  "main": "index.js",
  "playback": "stream",
  "permissions": { "network": ["music.163.com", "interfacepc.music.163.com"] },
  "settings": [{ "key": "region", "label": "Region" }],
  "navigation": [{ "builtin": "home" }, { "title": "Charts", "page": "charts" }]
}
```

`playback` is `stream` (the app plays a URL the plugin hands it) or `remote`
(the plugin drives a device elsewhere). `plugin.json` also declares the sidebar
the plugin adds, the settings it wants, and which hosts its `fetch` may reach.

## One interface, every field optional

`internal/music/music.go` defines `Source` with over fifty methods: `Search`,
`Playlist`, `Album`, `Artist`, `Like`, `Lyrics`, `Stream`, `StationNext`,
`Comments`, `RemotePlay`… A plugin exports a function for each thing it does,
by the same name. The app asks `Can("lyrics")` before drawing a lyric button;
what a plugin does not export, it does not pretend to do.

Each export takes one object and returns a value or a promise:

```js
export async function search({ query, kind, offset }) {
  const res = await fetch(`https://api.example.com/search?q=${encodeURIComponent(query)}`);
  return { tracks: (await res.json()).items.map(toTrack), more: false };
}

export function stream({ id, quality }) {
  return { url: `https://cdn.example.com/${id}.mp3`, type: "mp3" };
}

export async function lyrics({ id }) {
  return { lrc: "[00:12.00]…", translation: "" };
}
```

Tracks come back without a source; the host stamps `track.Source = plugin.ID`
so a queue can mix sources and still know who plays what. Artist names, album
art and durations are the plugin's own data, normalised into `music.Track`.

## What a plugin is allowed to touch

Each plugin runs in its own embedded JS runtime (moejs), with timeouts, a 256 MB
memory cap, and a `host` global:

| Host | Why |
| --- | --- |
| `host.storage.get/set/remove` | the plugin's own key-value store |
| `host.setting(key)` | values the listener typed in Settings |
| `host.t(key)`, `host.language()` | its own translations |
| `host.openURL(url)` | open a page in the browser, http(s) only |
| `host.crypto.md5`, `host.crypto.aesEcbEncrypt` | what signed APIs need |
| `host.waitForRedirect`, `host.webSignIn` | cookie login without a password |
| `host.spawn` | run a binary, only with the process permission |

`fetch` is restricted to the `permissions.network` hosts. Errors carry a code —
`signIn`, `setup`, `unavailable`, `unsupported` — so the app can show "sign in
first" instead of a raw message.

## The NetEase plugin

`sogud/mygo-music-netease`, which the plugins page lists, is the model for this
app's source:

- **Search** goes to `music.163.com/api/cloudsearch/pc`, which carries album art
  the plain search endpoint leaves out.
- **Lyrics** come from `/api/song/lyric?lv=1&tv=-1`, with a desktop `eapi` call
  as a fallback when the web sheet is empty.
- **Playback** needs `eapi`: the path and a JSON body (with `header`, `deviceId`
  and `requestId`) are joined with `-36cd479b6b5-`, hashed with MD5, encrypted
  with AES-128-ECB under `e82ckenh8dichen8`, and posted as `params=…` to
  `interfacepc.music.163.com`. The reply holds a CDN URL that only plays with a
  NetEase `Referer` and UA.
- Cookies (`MUSIC_U`, `__csrf`, `NMTID`) are kept in plugin storage, not on
  disk as a browser profile.

Every one of those details lives behind the source interface; the player never
sees an endpoint.

## What this app copies, and what it does not

`src/music/types.ts` keeps the shape: `tracks / search / stream / lyrics`, each
optional, each taking one object. Duplicate work is dropped — there is one page,
so there is no `home`, `playlist` or `comments` call to answer.

The runtime is different. Needle has a WebView, so sources are TypeScript in the
app rather than a sandboxed JS runtime; the signing and the download that would
need native reach live in Rust (`src-tauri/src/netease.rs`, `qq.rs`). A plugin
format that ships `.js` folders would be the next step, not this one.
