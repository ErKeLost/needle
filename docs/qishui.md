# 汽水音乐: what works and how

Verified on this machine (2026-11-09) against the official client 3.8.0.

## Signing

The API wants `X-Helios` and `X-Medusa` on `/luna/pc/**`. Both come from
ByteDance's `bdms.node`, an N-API addon extracted from the official app:

```
/Applications/汽水音乐.app  (data in ~/Library/Application Support/SodaMusic/Packages/3.8.0)
  app.asar.unpacked/bdms.node
  app.asar.unpacked/libMetaSecML.dylib
```

`vendor`:

- `src-tauri/resources/qishui/qishui-signer` — the 475-line N-API host from
  `lane128/mygo-music-qishui` (`native/signer/signer.cpp`), compiled with the
  flags in `native/signer/build.mjs`
- `bdms.node` + `libMetaSecML.dylib` beside it; the host `dlopen`s `bdms.node`
  from its own directory

Protocol: stdin is three big-endian u32 length-prefixed fields — device id
(16 digits), full URL (must contain `device_id=<id>` once), headers as
`name\r\nvalue\r\n...`. stdout is the same pair format with `X-Helios` and
`X-Medusa`.

## Requests

- Search: `GET api.qishui.com/luna/search/track?…&q=…`, UA
  `com.luna.music/100198030 (Linux; U; Android 15; zh_CN; …)`, catalog params
  (`aid=386088`, `device_platform`, `device_id`, …). No signature needed.
- Track: `GET /luna/pc/track_v2?track_id=…` + the signature headers, UA
  `LunaPC/3.7.0(452316191)`. Returns:
  - `track_player.url_player_info` — a signed VOD play-info URL
  - `lyric.content` — per-character timings, e.g.
    `[14690,6530]<0,210,0>故<210,200,0>事…` (start ms, duration ms, then
    `<offset,duration,?>char`), one line per `\n`
  - `track` metadata

No account was needed for the track tested; cookies can be added later the
same way as the other sources.

## Still to wire in the app

1. `src-tauri/src/qishui.rs`: spawn the signer, `qishui_search`,
   `qishui_track`, `qishui_stream` (fetch play-info → audio URL → cache)
2. `src/sources/qishui.ts`: `search` / `lyrics` / `stream`, parsing the
   per-character lyric sheet into the stage's lines
3. `bundle.resources` in `tauri.conf.json` for the three binaries
