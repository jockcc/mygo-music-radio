# Radio for MyGo Music

An internet radio plugin for [MyGo Music](https://music.egoist.dev): around 30,000
stations from [Radio Browser](https://www.radio-browser.info), browsed by genre,
country and mood, playing straight from the station.

## Install

Open the app with this link — it downloads the plugin and asks before installing it:

```
mygo-music://install-plugin?repo=jockcc/mygo-music-radio
```

Or, by hand: download `plugin.zip` from the latest release, unzip it into
`~/Library/Application Support/MyGo Music/plugins/radio/`, and restart the app.

## What it does

- **Home** — eight mood stations (focus, late night, drive, wander, café, dance,
  sleep, news), plus genres and countries, each with a cover.
- **Stations** — the eight moods as switchable stations; each one plays on and on.
- **All stations** — genres and countries as grids, and the whole country list.
- **Search** — by name, genre, country, language.
- **Liked / Recently played** — the app's own lists, so they work across plugins.
- Every list holds 20 stations; **See All** on its heading opens the same list,
  twenty longer, and the next twenty are fetched while you read (see
  [Known limits](#known-limits) for why it is a new page and not an append).

## Settings

**Server** — the Radio Browser mirror to use, such as `de1.api.radio-browser.info`.
Leave it empty and the plugin picks the fastest of `de1`, `at1`, `nl1`, `fi1`
itself, and moves on to another when one fails.

## Disk use while a station plays

Live streams have no length, so the player buffers them in a temporary file under
`~/Library/Caches/MyGo Music/songs/*.part` rather than in memory — roughly 34 MB
per hour at 128 kbps. The file is removed the moment playback stops or you switch
station, so listening does not pile up.

Two things are worth knowing:

- **Quitting while a station is still playing leaves that file behind.** One file
  per such quit. Quit after stopping playback and nothing is left.
- **Settings → cache cannot see or clear them**, because it only counts kept
  songs. So "0 MB used" can be wrong, and the clear button does nothing for
  someone who only listens to radio.

To clean up by hand:

```sh
rm ~/Library/Caches/MyGo Music/songs/*.part
```

This is an app-side gap, not something a plugin can reach: a plugin has no access
to that folder and no hook that runs on quit.

<!-- Once an issue is open upstream, link it here. -->


## Known limits

**"See All" opens a new page — it cannot add to the one you are on.** A plugin's
page is built whole, in one `browse()` call, and the app has no way to append
rows to a page it has already drawn: there is no footer that loads by itself, and
opening the same page again is a no-op. So the way on is the app's own **See All**
button, which opens the same list, twenty longer, as a new page — the rows are
kept, the scroll position is not. Two consequences a plugin cannot fix:

- the label is the app's (`See All` / 查看全部), not "load more";
- coming back means the back button, not staying where you were.

A card at the bottom of the list is the only alternative the API offers, and a
link card always draws a cover — with no picture it is a grey note icon, which
looks broken. That is why the button is at the heading instead.

**The directory is slow, and it is not the network.** Radio Browser sorts on its
own side; measured from one machine on a working connection:

| stations asked for | answer time |
| --- | --- |
| 20 | 4.7 s |
| 40 | 6.8 s |
| 80 | 10.0 s |

The plugin asks for 50 at most, and starts fetching the next page while you read
the one you have, so `See All` usually opens on rows already here (measured: 6 ms
instead of 6 s). The first page still takes what it takes.

**A first visit is slow, and covers are most of it.** Opening Home once made 11
requests and took 17 s, one of them 10.5 s: every card's picture is looked up in
the directory, six at a time. Covers are kept for seven days, so a second visit
is much quicker — measured 8 s, and less after that. On a bad day at the
directory, longer.

**No HLS (`.m3u8`) stations.** The player decodes MP3, AAC/ADTS, Ogg Vorbis,
FLAC, WAV, ALAC and MP4; HLS stations are hidden rather than shown broken. About
20% of Radio Browser's list is HLS, so a genre page of 20 may be drawn from 30-odd
answers.

**Covers.** Radio Browser has an icon for roughly two thirds of its stations, so
some cards fall back to a plain note icon. Nothing to fix on this side; a station
with no icon plays just as well.

**A station has no length.** The progress bar stays at 0 and seeking does
nothing: a live stream is not a file, and the app's player has nothing to seek
in. It also means "add to playlist" and "next track" have no duration to work
with.

## 中文

MyGo Music 的网络电台插件，聚合 Radio Browser 约 3 万个电台，按流派、国家、心情浏览。

**安装**：在浏览器打开 `mygo-music://install-plugin?repo=jockcc/mygo-music-radio`，
或把 release 里的 `plugin.zip` 解压到 `~/Library/Application Support/MyGo Music/plugins/radio/` 后重启应用。

**关于磁盘占用（已知问题）**

直播流没有长度，播放器只能把它缓冲到一个临时文件
`~/Library/Caches/MyGo Music/songs/*.part`（128 kbps 约 34 MB/小时）。停止播放或
切换电台时这个文件会被立刻删除，正常收听不会累积。

但有两件事要知道：

- **一边播放一边退出应用，会把这个文件留下**，每次退出留一个；先停止播放再退出则不会留。
- **设置里的"缓存"看不到也清不掉它**，因为那里只统计已保存的歌曲。所以显示的
  "0 MB" 可能不准，对只听电台的人来说"清除缓存"按钮也无效。

手动清理：

```sh
rm ~/Library/Caches/MyGo Music/songs/*.part
```

这是应用侧的问题，插件做不到：插件既没有访问该目录的权限，也没有退出时执行的回调。

**其他已知问题**

1. **"加载更多"不是一个按钮，是应用的"查看全部"。** 插件的一页由一次 `browse()`
   整页生成，应用没有任何办法把新行追加到已经画好的页面上：没有底部自动加载，
   再次打开同一个页面也是空操作。所以只能用应用自己的 **查看全部 / See All**：
   它把同一个列表加长 20 个后当作**新页面**打开——行都在，滚动位置回到顶部。
   由此还有两个插件改不了的点：文案是应用的，不叫"加载更多"；想回到原位置只能按后退。
   而列表末尾放卡片是 API 唯一的选择，可 `Link` 卡片必定画封面位，没有图就是灰底音符，
   看起来像坏了——所以按钮放在了标题行。
2. **目录本身慢，不是网络问题。** Radio Browser 在服务端排序，实测同一台机器良好网络下：
   20 个结果 4.7 秒、40 个 6.8 秒、80 个 10 秒。插件单次最多取 50 个，并在你读列表时
   就预取下一页，所以"查看全部"通常立刻出结果（实测 6 毫秒，而冷启动 6 秒）；
   第一页该等多久还是多久。**首次打开首页实测 11 个请求、17 秒**（单请求最长 10.5 秒），
   主要花在给每张卡片找封面上；封面缓存 7 天，第二次约 8 秒，之后更快；目录负载高时会更久。
3. **不支持 HLS（`.m3u8`）电台。** 播放器只解码 MP3 / AAC / Ogg Vorbis / FLAC / WAV /
   ALAC / MP4，HLS 台被过滤掉而不显示成坏的；目录里约 20% 是 HLS，所以一页 20 个
   实际是从三十多条结果里筛出来的。
4. **封面只覆盖约三分之二。** Radio Browser 上三分之一的台没有图标，会显示音符占位，
   不影响播放。
5. **电台没有时长。** 进度条恒为 0、拖动无效——直播流不是文件，播放器没有可跳转的位置；
   "加入播放列表""下一首"也没有时长可依据。

## License

MIT
