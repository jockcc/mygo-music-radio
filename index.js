// Radio — internet radio for MyGo Music, from Radio Browser.
//
// A station is a track that never ends: a live stream has no duration and no
// album, so stations are shown as tracks and played as they are. Only the
// codecs the player can decode are offered: HLS and friends are dropped rather
// than shown and failing.

const UA = "MyGoMusicRadio/0.1";
const MIRRORS = [
  "de1.api.radio-browser.info",
  "at1.api.radio-browser.info",
  "nl1.api.radio-browser.info",
  "fi1.api.radio-browser.info",
];
const PAGE = 50; // a page of results, which the app asks for again as you scroll
// How many stations a list grows by each time the reader asks for more. The
// app draws what it is given as a page of its own, and has no way to add to a
// list already drawn: what it is given, it replaces. So a page is given the
// whole list from the top, each time longer — see stationPool.
const STATION_STEP = 20;
// The most the directory answers quickly at a time: it sorts each answer on
// its own, so a long one takes far longer than a short one — measured from
// here, forty stations take seven seconds and eighty ten, against four for
// twenty. Asking twice costs less than asking big once.
const STATION_PART = 50;
// A list of stations is kept while the app is open, so going on from it, or
// back into it from the same link, doesn't ask the directory twice.
const LIST_TTL = 5 * 60 * 1000;
const HISTORY_MAX = 60;

// Tags that hold thousands of stations on Radio Browser, so a genre page is
// never empty.
const GENRES = [
  { name: "Jazz", tag: "jazz" },
  { name: "Classical", tag: "classical" },
  { name: "Electronic", tag: "electronic" },
  { name: "Ambient", tag: "ambient" },
  { name: "Chillout", tag: "chillout" },
  { name: "Lo-fi", tag: "lofi" },
  { name: "Rock", tag: "rock" },
  { name: "Pop", tag: "pop" },
  { name: "Blues", tag: "blues" },
  { name: "Soul", tag: "soul" },
  { name: "Folk", tag: "folk" },
  { name: "News", tag: "news" },
];

// The radio page shows a switch of a few stations, or a grid of them, so this
// is more than the four a switch holds: the page's lower half would be empty
// otherwise. Each takes a logo from a station it plays, fetched once.
const MOODS = [
  {
    id: "focus",
    name: "Focus",
    description: "Long, quiet hours without a word",
    tags: ["ambient", "chillout", "classical"],
  },
  {
    id: "late",
    name: "Late night",
    description: "Jazz, soul and a little static",
    tags: ["jazz", "soul", "blues", "lofi"],
  },
  {
    id: "drive",
    name: "On the way",
    description: "Something to keep the pace",
    tags: ["pop", "rock", "electronic"],
  },
  {
    id: "wander",
    name: "Wander",
    description: "A random corner of the world, every time",
    tags: [],
  },
  {
    id: "cafe",
    name: "Café",
    description: "Low talk and a warm room",
    tags: ["lounge", "bossa", "acoustic"],
  },
  {
    id: "dance",
    name: "Dance",
    description: "Four to the floor",
    tags: ["dance", "house", "techno"],
  },
  {
    id: "sleep",
    name: "Before sleep",
    description: "Slow, faint, and far away",
    tags: ["sleep", "ambient", "piano"],
  },
  {
    id: "news",
    name: "News",
    description: "What is happening, elsewhere",
    tags: ["news", "talk"],
  },
];

const t = (text) => host.t(text);

const load = (key, fallback) => {
  const value = host.storage.get(key);
  return value === undefined || value === null ? fallback : value;
};
const save = (key, value) => host.storage.set(key, value);

// A station seen this run, by id, so playing it needs no request.
const seen = new Map();
const cache = new Map();
// The rows of the last search, kept so that its pages don't ask again for what
// they were already given. One search is looked at at a time.
let pool = null;

function cached(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  return null;
}
function remember(key, data) {
  cache.set(key, { at: Date.now(), data });
  return data;
}

function fail(code, message) {
  const e = new Error(message ? t(message) : t("That didn't work"));
  e.code = code;
  return e;
}

// The mirror to ask: what the listener set, or the one that answered last, or
// else whichever answers first.
let mirror = null;
let probing = null;

function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function mirrorHost(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

// A header the runtime won't let a plugin set isn't worth failing over: ask
// again without it. The directory only asks to be told who is asking.
async function get(url) {
  try {
    return await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
  } catch (e) {
    return await fetch(url);
  }
}

async function firstAnswering() {
  const set = mirrorHost(host.setting("mirror"));
  if (set) return set;
  const last = mirrorHost(load("mirror", ""));
  const order = last ? [last].concat(MIRRORS.filter((m) => m !== last)) : MIRRORS;
  for (const m of order) {
    try {
      const res = await get("https://" + m + "/json/stats");
      if (!res.ok) continue;
      save("mirror", m);
      return m;
    } catch (e) {
      // The next one.
    }
  }
  // None answered: the first is as good a guess as any, and the caller reports
  // what went wrong with it.
  return order[0];
}

async function api(path, params) {
  if (!mirror) {
    if (!probing) probing = firstAnswering().then((m) => (probing = null, m));
    mirror = await probing;
  }
  const query = Object.keys(params || {})
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
    .join("&");
  const url = "https://" + mirror + path + (query ? "?" + query : "");
  let res;
  try {
    res = await get(url);
  } catch (e) {
    mirror = null;
    throw fail("unavailable", "Can't reach the radio directory");
  }
  if (!res.ok) {
    mirror = null;
    throw fail("unavailable", "The radio directory turned the request down");
  }
  return await res.json();
}

// What the player can decode: mp3, flac, ogg, wav, m4a or aac. A station whose
// stream is HLS, WMA or an unknown codec is left out, as is a playlist file.
function playable(s) {
  const url = String(s.url_resolved || s.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const file = url.toLowerCase().split("?")[0].split("#")[0];
  if (/\.(m3u8|m3u|pls|xspf|asx)$/.test(file)) return false;
  const codec = String(s.codec || "").toLowerCase();
  if (codec.includes("hls") || codec.includes("wma") || codec.includes("unknown")) return false;
  if (/mp3|aac|ogg|flac|m4a|wav/.test(codec)) return true;
  return /\.(mp3|aac|ogg|oga|flac|m4a|wav)$/.test(file);
}

function streamType(s) {
  const file = String(s.url_resolved || s.url || "").toLowerCase().split("?")[0];
  const codec = String(s.codec || "").toLowerCase();
  if (codec.includes("flac") || /\.flac$/.test(file)) return "flac";
  if (codec.includes("ogg") || /\.(ogg|oga)$/.test(file)) return "ogg";
  if (/\.m4a$/.test(file)) return "m4a";
  if (codec.includes("aac") || /\.aac$/.test(file)) return "aac";
  if (codec.includes("wav") || /\.wav$/.test(file)) return "wav";
  return "mp3";
}

function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–|]+|[\s\-–|]+$/g, "")
    .trim();
}

// Songs that are the same stream, or the same station listed twice, would fill
// a page with one name over and over.
function unique(list) {
  const streams = new Set();
  const names = new Set();
  const out = [];
  for (const s of list) {
    if (!playable(s)) continue;
    const url = String(s.url_resolved || s.url || "").split("#")[0];
    const stream = hostOf(url) + url.split("?")[0].replace(/^https?:\/\/[^/]+/i, "");
    const name = cleanName(s.name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
    if (streams.has(stream)) continue;
    if (name && names.has(name)) continue;
    streams.add(stream);
    if (name) names.add(name);
    out.push(s);
  }
  return out;
}

// What is kept of a station on this machine: enough to show it and to play it
// again without asking the directory. Takes a station or one already kept.
function snapshot(s) {
  const st = s && s.stationuuid ? s : fromSnapshot(s);
  return {
    id: st.stationuuid,
    name: cleanName(st.name),
    imageUrl: picture(st),
    url: st.homepage || "",
    stream: st.url_resolved || st.url || "",
    country: st.country || "",
    countrycode: st.countrycode || "",
    tags: st.tags || "",
    codec: st.codec || "",
    bitrate: st.bitrate || 0,
  };
}

// A kept station, told as the directory tells one.
function fromSnapshot(s) {
  return {
    stationuuid: s.id,
    name: s.name,
    favicon: s.imageUrl,
    homepage: s.url,
    url_resolved: s.stream,
    country: s.country,
    countrycode: s.countrycode,
    tags: s.tags,
    codec: s.codec,
    bitrate: s.bitrate,
  };
}

// A live stream has no length. The player draws an empty progress bar for one,
// and a 0:00 that never moves, so what this is has to be said where a plugin
// can: under the name.
function albumOf(tags) {
  const said = tags.slice(0, 2).join(" / ");
  return said ? t("Live") + " · " + said : t("Live");
}

// What the app draws as a station's cover. A track has no picture of its own:
// every cover it shows is its album's, so this goes in the album's imageUrl.
// The app decodes PNG, JPEG and WebP, by the bytes rather than the name, so a
// .ico that holds a PNG still shows; one that holds an icon doesn't, and an
// SVG never does, which is the one kind left out.
function picture(s) {
  const url = String(s.favicon || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  if (/\.svg([?#]|$)/i.test(url)) return "";
  return url;
}

function toTrack(s) {
  const tags = String(s.tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const country = s.country || s.countrycode || "";
  const album = { name: albumOf(tags) };
  const art = picture(s);
  if (art) album.imageUrl = art;
  const track = {
    id: s.stationuuid,
    name: cleanName(s.name),
    album,
    duration: 0,
  };
  if (country) track.artists = [{ id: s.countrycode || country, name: country }];
  if (s.homepage) track.url = s.homepage;
  if (s.lastcheckok === 0 || s.lastcheckok === false) track.unavailable = true;
  return track;
}

function toTracks(list) {
  return unique(list).map((s) => {
    seen.set(s.stationuuid, s);
    return toTrack(s);
  });
}

async function byId(id) {
  const known = seen.get(id);
  if (known) return known;
  try {
    const list = await api("/json/stations/byuuid/" + encodeURIComponent(id), {});
    if (Array.isArray(list) && list.length) {
      seen.set(id, list[0]);
      return list[0];
    }
  } catch (e) {
    // Without the directory, what was kept of it still plays.
  }
  const saved = favourites().find((f) => f.id === id) || history().find((h) => h.id === id);
  return saved ? fromSnapshot(saved) : null;
}

async function searchStations(params) {
  const list = await api("/json/stations/search", params);
  return Array.isArray(list) ? list : [];
}

// The stations of a list, read from its top. Asking for more gives this list
// and more, never the part that came after it on its own: the app opens what
// it is handed as a page, so a page holding only the new stations would read
// as the list having been thrown away and started again from there.
//
// So what has been read is kept, and a page asks for as much as it should hold
// and no more — twenty at a time, which is a screen and a half.
const pools = new Map();

async function stationPool(key, params, want) {
  let pool = pools.get(key);
  if (!pool || Date.now() - pool.at > LIST_TTL) {
    pool = { at: Date.now(), list: [], done: false };
    pools.set(key, pool);
  }
  while (!pool.done) {
    const have = unique(pool.list).length;
    if (have >= want) break;
    // A little more than is missing: some of what comes back is of a codec the
    // player can't read, and would leave the list short of what was asked for.
    const need = Math.min(Math.max((want - have) * 2, STATION_STEP), STATION_PART);
    const part = await searchStations(
      Object.assign({}, params, { limit: need, offset: pool.list.length }),
    );
    pool.list = pool.list.concat(part);
    // The directory had less to give than was asked for: that is the end.
    if (part.length < need) pool.done = true;
  }
  const usable = unique(pool.list);
  return { list: usable.slice(0, want), end: pool.done && usable.length <= want };
}

// The page after the one shown is fetched while it is read, so that the app's
// See All opens on what is already here: it opens a page of its own, which
// asks the directory all over again, and takes the answer whole — four seconds
// of skeleton for what the reader meant as one more screen of the same list.
const warming = new Set();

function warm(key, params, want, end) {
  if (end || warming.has(key)) return;
  warming.add(key);
  const done = () => warming.delete(key);
  stationPool(key, params, want).then(done, done);
}

async function topClick(limit) {
  const hit = cached("hot:" + limit, 15 * 60 * 1000);
  if (hit) return hit;
  try {
    const list = await api("/json/stations/topclick/" + limit, {});
    const shaped = unique(Array.isArray(list) ? list : []);
    if (limit >= 20) save("hot", shaped.map(snapshot));
    return remember("hot:" + limit, shaped);
  } catch (e) {
    // What was here last time is better than nothing, without a network.
    const last = load("hot", []);
    if (last.length) return last.map(fromSnapshot);
    throw e;
  }
}

async function countries() {
  const hit = cached("countries", 24 * 60 * 60 * 1000);
  if (hit) return hit;
  try {
    const list = await api("/json/countries", {});
    const shaped = (Array.isArray(list) ? list : [])
      .map((c) => ({
        code: c.iso_3166_1 || "",
        name: c.name || c.iso_3166_1 || "",
        count: c.stationcount || 0,
      }))
      .filter((c) => c.code && c.count > 40)
      .sort((a, b) => b.count - a.count);
    save("countries", shaped);
    return remember("countries", shaped);
  } catch (e) {
    const last = load("countries", []);
    if (last.length) return last;
    return [];
  }
}

// The stations of a mood: a random tag of it, then a page of what answers.
async function moodStations(mood, limit) {
  const tags = mood.tags.length
    ? mood.tags
    : GENRES.map((g) => g.tag);
  const tag = tags[Math.floor(Math.random() * tags.length)];
  const list = await searchStations({
    tag: tag,
    limit: limit || 40,
    order: "random",
    hidebroken: "true",
  });
  return list;
}

function history() {
  return load("history", []);
}

function pushHistory(station) {
  const entry = snapshot(station);
  const rest = history().filter((h) => h.id !== entry.id);
  save("history", [entry].concat(rest).slice(0, HISTORY_MAX));
}

function favourites() {
  return load("favourites", []);
}

function pageOf(kind, a, b) {
  const offset = Math.max(0, parseInt(b, 10) || 0);
  return { kind, key: a || "", offset };
}

// A page of stations, from the top of the list down to where it has been read
// to, with the way on while the directory has more. A page a source makes up
// has no foot that loads by itself, so the way on is the app's own See All,
// which needs a heading to sit on: a card would be a cover with no picture in
// it, as a link has no shape but a cover's.
function stationsPage(raw, title, order, next) {
  const tracks = toTracks(raw);
  const section = { tracks, empty: t("Nothing here right now") };
  if (next) {
    section.title = t("Stations");
    section.morePage = next;
  }
  return {
    title,
    subtitle: order + " · " + t("{n} stations").replace("{n}", String(tracks.length)),
    sections: [section],
  };
}

export function setSetting({ key } = {}) {
  if (key === "mirror") {
    mirror = null;
    cache.delete("countries");
  }
}

// Home: a card of what is playing around the world, then the ways in.
export async function home() {
  const sections = [];

  let hot = [];
  try {
    hot = await topClick(24);
  } catch (e) {
    hot = [];
  }
  const hotTracks = toTracks(hot);
  sections.push({
    title: t("Hot now"),
    tracks: hotTracks,
    morePage: "hot:0:0",
    pageTitle: t("Most played"),
    subtitle: t("By how many times listeners opened them today"),
    empty: t("The directory didn't answer. Try again in a moment"),
  });

  const recent = history().slice(0, 6);
  const keptRecent = recent.map((h) => toTrack(fromSnapshot(h)));

  // The ways in, with the covers they have: a page waits a moment for what it
  // lacks rather than showing a wall of empty cards. No card takes a picture
  // already on the page, the rows above included.
  const list = await countries();
  const used = usedCovers();
  for (const tr of hotTracks) {
    if (tr.album && tr.album.imageUrl) used.add(tr.album.imageUrl);
  }
  for (const tr of keptRecent) {
    if (tr.album && tr.album.imageUrl) used.add(tr.album.imageUrl);
  }
  const [moodStations, genreLinks, countryCards] = await Promise.all([
    moods(1800, used),
    genres(1800, used),
    countryLinks(list, 8, 1800, used),
  ]);

  sections.push({ title: t("Moods"), stations: moodStations });

  sections.push({
    title: t("Genres"),
    links: genreLinks,
    morePage: "all:0:0",
  });

  sections.push({
    title: t("Countries"),
    links: countryCards,
    morePage: "countries:0:0",
    empty: t("No countries to show yet"),
  });

  if (keptRecent.length) {
    sections.push({
      title: t("Keep listening"),
      tracks: keptRecent,
    });
  }

  return {
    title: t("Radio"),
    subtitle: t("Stations from everywhere, played as they are"),
    sections,
  };
}

export async function browse({ page } = {}) {
  const parts = String(page || "").split(":");
  const kind = parts[0];
  const page_ = pageOf(kind, parts[1], parts[2]);

  if (kind === "all" || kind === "countries") {
    const list = await countries();
    if (kind === "countries") {
      return {
        title: t("Countries"),
        subtitle: t("Every country the directory knows"),
        sections: [{ links: countryLinksKept(list), empty: t("No countries to show yet") }],
      };
    }
    // The biggest countries carry a cover; the rest are a tap away, where a
    // list of names is what one wants anyway.
    const used = usedCovers();
    const [genreLinks, countryCards] = await Promise.all([
      genres(3000, used),
      countryLinks(list, 36, 3000, used),
    ]);
    return {
      title: t("All stations"),
      subtitle: t("Every country the directory knows"),
      sections: [
        { title: t("Genres"), links: genreLinks },
        {
          title: t("Countries"),
          links: countryCards,
          morePage: "countries:0:0",
          empty: t("No countries to show yet"),
        },
      ],
    };
  }

  if (kind === "recent") {
    const list = history();
    return {
      title: t("Recently played"),
      sections: [
        {
          tracks: list.map((h) => toTrack(fromSnapshot(h))),
          empty: t("Nothing played yet"),
        },
      ],
    };
  }

  if (kind === "hot") {
    // Everything the directory knows, most played first. topclick takes a
    // count and no offset, so it can't be read a page at a time: search
    // ordered by clicks is the same list, and can.
    const want = page_.offset + STATION_STEP;
    const ask = { order: "clickcount", reverse: "true", hidebroken: "true" };
    let got;
    try {
      got = await stationPool("hot", ask, want);
    } catch (e) {
      // What was kept of the last look beats nothing, without a network.
      const kept = load("hot", []).map(fromSnapshot);
      if (!kept.length) throw e;
      return stationsPage(
        kept,
        t("Most played"),
        t("By how many times listeners opened them today"),
      );
    }
    warm("hot", ask, want + STATION_STEP, got.end);
    return stationsPage(
      got.list,
      t("Most played"),
      t("By how many times listeners opened them today"),
      got.end ? null : "hot:0:" + want,
    );
  }

  if (kind === "genre") {
    const genre = GENRES.find((g) => g.tag === page_.key);
    const title = t(genre ? genre.name : page_.key);
    const want = page_.offset + STATION_STEP;
    const ask = { order: "clickcount", reverse: "true", hidebroken: "true" };
    const byTag = Object.assign({ tag: page_.key }, ask);
    let key = "genre:" + page_.key;
    let used = byTag;
    let got = await stationPool(key, used, want);
    // A tag nobody uses yet: look for it in names instead, so the page says
    // something rather than standing empty.
    if (!got.list.length) {
      key = "genre:" + page_.key + ":name";
      used = Object.assign({}, ask, { name: page_.key });
      got = await stationPool(key, used, want);
    }
    warm(key, used, want + STATION_STEP, got.end);
    return stationsPage(
      got.list,
      title,
      t("Ranked by how many listen"),
      got.end ? null : "genre:" + page_.key + ":" + want,
    );
  }

  if (kind === "country") {
    const list = await countries();
    const found = list.find((c) => c.code === page_.key);
    const title = found ? found.name : page_.key;
    const want = page_.offset + STATION_STEP;
    const ask = {
      countrycode: page_.key,
      order: "clickcount",
      reverse: "true",
      hidebroken: "true",
    };
    const got = await stationPool("country:" + page_.key, ask, want);
    warm("country:" + page_.key, ask, want + STATION_STEP, got.end);
    return stationsPage(
      got.list,
      title,
      t("Ranked by how many listen"),
      got.end ? null : "country:" + page_.key + ":" + want,
    );
  }

  throw fail("unavailable", "No such page");
}

// A search is read from the top and slid along: the app asks for the next page
// by how many stations it already shows, so an offset into the directory's own
// rows would hand the same station over twice whenever one was dropped, as any
// station of a codec the player can't read is.
const POOL_TTL = 5 * 60 * 1000;

async function searchRows(query, need) {
  const key = String(query).toLowerCase();
  if (pool && pool.key === key && Date.now() - pool.at < POOL_TTL) {
    if (pool.whole || pool.rows.length >= need) return pool.rows;
  }
  const rows = await searchStations({
    name: query,
    limit: need,
    offset: 0,
    order: "clickcount",
    reverse: "true",
    hidebroken: "true",
  });
  pool = { key, rows, whole: rows.length < need, at: Date.now() };
  return rows;
}

export async function search({ query, kind, offset } = {}) {
  if (kind !== "tracks") return { more: false };
  const q = String(query || "").trim();
  if (!q) return { tracks: [], more: false };
  const from = Math.max(0, offset || 0);
  // One page of slack past the one asked for, so that a full page of answers
  // doesn't read as the end of them.
  const rows = await searchRows(q, from + PAGE * 2);
  const list = toTracks(rows);
  return { tracks: list.slice(from, from + PAGE), more: list.length > from + PAGE };
}

export function suggest({ query } = {}) {
  const q = String(query || "").toLowerCase();
  const names = new Set();
  favourites().forEach((f) => names.add(f.name));
  history().forEach((h) => names.add(h.name));
  seen.forEach((s) => names.add(cleanName(s.name)));
  return Array.from(names)
    .filter((n) => n && n.toLowerCase().indexOf(q) === 0)
    .slice(0, 8);
}

// Covers for what isn't a station.
//
// A genre, a mood, a country has no picture of its own: the directory only has
// the favicons of stations. So each takes the picture of a station it plays,
// and the choice is kept on this machine, so that a page opens with its covers
// instead of asking for them every time. A page waits a moment for what it
// lacks, shows what came, and the rest fills in the next time it opens.

const ART_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // what was found holds this long
const ART_MISS_AGE = 24 * 60 * 60 * 1000; // a miss is asked again the next day
const ART_SLOTS = 6; // how many looks at the directory at once
const ART_WORKERS = 6;

function artBook(key) {
  const book = load(key, {});
  return book && typeof book === "object" ? book : {};
}

// What was found for a key, while it still holds: a miss is kept too, so that
// it isn't asked again on every page.
function kept(book, key) {
  const hit = book[key];
  if (!hit) return null;
  const age = Date.now() - (hit.t || 0);
  return age > (hit.u ? ART_MAX_AGE : ART_MISS_AGE) ? null : hit;
}

function artOf(book, key) {
  const hit = kept(book, key);
  return hit ? hit.u : "";
}

// The stations this run has seen, and the hot list kept from last time: a
// cover from one of those costs no request at all.
function knownStations() {
  const out = Array.from(seen.values());
  for (const h of load("hot", [])) out.push(fromSnapshot(h));
  return out;
}

function artIn(pool, ask) {
  const tags = ask.tags || [];
  const out = [];
  for (const s of pool) {
    if (tags.length) {
      const own = String(s.tags || "")
        .toLowerCase()
        .split(",")
        .map((x) => x.trim());
      if (!tags.some((tag) => own.indexOf(tag) >= 0)) continue;
    } else if (ask.countrycode) {
      if (String(s.countrycode || "").toUpperCase() !== ask.countrycode) continue;
    }
    const art = picture(s);
    if (art && out.indexOf(art) < 0) out.push(art);
  }
  return out;
}

// A gate over the directory, however many pages are asking.
let artFree = ART_SLOTS;
const artWaiting = [];

function artSlot() {
  if (artFree > 0) {
    artFree--;
    return Promise.resolve();
  }
  return new Promise((resolve) => artWaiting.push(resolve));
}

function artDone() {
  const next = artWaiting.shift();
  if (next) next();
  else artFree++;
}

// Asks the directory which stations of a thing have a picture, the most
// listened first: a station many listen to is one whose picture still loads.
// It answers a list, so that the caller may skip the ones already on the page.
async function askArt(ask) {
  const params = {
    limit: 20,
    order: "clickcount",
    reverse: "true",
    hidebroken: "true",
  };
  if (ask.tags && ask.tags.length) {
    params.tag = ask.tags[Math.floor(Math.random() * ask.tags.length)];
  } else if (ask.countrycode) {
    params.countrycode = ask.countrycode;
  } else {
    return [];
  }
  const list = await searchStations(params);
  const out = [];
  for (const s of list) {
    if (!playable(s)) continue;
    const art = picture(s);
    if (art && out.indexOf(art) < 0) out.push(art);
  }
  return out;
}

// The first picture of the list that nothing else shows. A card without one
// is a card without one: two the same reads as a mistake, because it is one.
function pickArt(cands, taken) {
  for (const u of cands) {
    if (!taken.has(u)) return u;
  }
  return "";
}

// Gives every ask a cover: from what is kept, from a station already known, or
// from the directory, a few at a time and no longer than wait.
async function ensureArt(bookKey, asks, wait, used) {
  const book = artBook(bookKey);
  const taken = used || new Set();
  const pool = knownStations();
  // What is kept holds its place, and the rest keep away from it.
  for (const ask of asks) {
    const hit = kept(book, ask.key);
    if (hit && hit.u) taken.add(hit.u);
  }
  const todo = [];
  let changed = false;
  for (const ask of asks) {
    if (kept(book, ask.key)) continue;
    const art = pickArt(artIn(pool, ask), taken);
    if (art) {
      book[ask.key] = { u: art, t: Date.now() };
      taken.add(art);
      changed = true;
    } else {
      todo.push(ask);
    }
  }
  if (todo.length) {
    const stop = Date.now() + (wait || 2000);
    let next = 0;
    const work = async () => {
      while (next < todo.length && Date.now() < stop) {
        const ask = todo[next++];
        // A mood plays several tags: one with nothing new may still have a
        // picture under another.
        const tries = [];
        if (ask.tags && ask.tags.length > 1) {
          const shuffled = ask.tags.slice();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const swap = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = swap;
          }
          tries.push(shuffled[0], shuffled[1]);
        } else {
          tries.push("");
        }
        let art = "";
        let ran = true;
        for (const tag of tries) {
          await artSlot();
          if (Date.now() >= stop) {
            artDone();
            ran = false;
            break;
          }
          let cands = null;
          try {
            cands = await askArt(tag ? { key: ask.key, tags: [tag] } : ask);
          } catch (e) {
            cands = null; // The directory didn't answer: ask again next time.
          } finally {
            artDone();
          }
          if (cands === null) {
            ran = false;
            break;
          }
          art = pickArt(cands, taken);
          if (art) break;
        }
        if (!ran) continue;
        if (art) taken.add(art);
        book[ask.key] = { u: art, t: Date.now() };
        changed = true;
      }
    };
    const many = Math.min(ART_WORKERS, todo.length);
    await Promise.all(Array.from({ length: many }, work));
  }
  if (changed) save(bookKey, book);
  return book;
}

// Two keys with one picture, kept by an older version: the later one lets go
// and picks again.
function dedupeCovers() {
  const shown = new Set();
  for (const key of ["moodCover", "genreCover", "countryCover"]) {
    const book = artBook(key);
    let changed = false;
    for (const k of Object.keys(book)) {
      const hit = kept(book, k);
      if (!hit || !hit.u) continue;
      if (shown.has(hit.u)) {
        delete book[k];
        changed = true;
      } else {
        shown.add(hit.u);
      }
    }
    if (changed) save(key, book);
  }
}

// Every picture the plugin shows anywhere: a page keeps its cards apart.
function usedCovers() {
  dedupeCovers();
  const used = new Set();
  for (const key of ["moodCover", "genreCover", "countryCover"]) {
    const book = artBook(key);
    for (const k of Object.keys(book)) {
      const hit = kept(book, k);
      if (hit && hit.u) used.add(hit.u);
    }
  }
  return used;
}

async function moods(wait, used) {
  const book = await ensureArt(
    "moodCover",
    MOODS.map((m) => ({
      key: m.id,
      tags: m.tags.length ? m.tags : GENRES.map((g) => g.tag),
    })),
    wait,
    used,
  );
  return MOODS.map((m) => ({
    id: m.id,
    name: t(m.name),
    description: t(m.description),
    imageUrl: artOf(book, m.id),
  }));
}

async function genres(wait, used) {
  const book = await ensureArt(
    "genreCover",
    GENRES.map((g) => ({ key: g.tag, tags: [g.tag] })),
    wait,
    used,
  );
  return GENRES.map((g) => {
    const link = { title: t(g.name), page: "genre:" + g.tag + ":0" };
    const art = artOf(book, g.tag);
    if (art) link.imageUrl = art;
    return link;
  });
}

async function countryLinks(list, limit, wait, used) {
  const shown = list.slice(0, limit || list.length);
  const book = await ensureArt(
    "countryCover",
    shown.map((c) => ({ key: c.code, countrycode: c.code })),
    wait,
    used,
  );
  return shown.map((c) => {
    const link = { title: c.name, subtitle: String(c.count), page: "country:" + c.code + ":0" };
    const art = artOf(book, c.code);
    if (art) link.imageUrl = art;
    return link;
  });
}

// Every country, with the covers found so far.
function countryLinksKept(list) {
  const book = artBook("countryCover");
  return list.map((c) => {
    const link = { title: c.name, subtitle: String(c.count), page: "country:" + c.code + ":0" };
    const art = artOf(book, c.code);
    if (art) link.imageUrl = art;
    return link;
  });
}

export async function stations() {
  return moods(3000, usedCovers());
}

export async function stationNext({ id } = {}) {
  const mood = MOODS.find((m) => m.id === id) || MOODS[0];
  const list = await moodStations(mood, 40);
  return toTracks(list);
}

export function recent() {
  return history().map((h) => toTrack(fromSnapshot(h)));
}

export function played({ id } = {}) {
  const known = seen.get(id);
  if (known) return pushHistory(known);
  const saved = history().find((h) => h.id === id) || favourites().find((f) => f.id === id);
  if (saved) pushHistory(saved);
}

export function liked({ offset } = {}) {
  const list = favourites().map((f) => toTrack(fromSnapshot(f)));
  return { tracks: offset > 0 ? [] : list, more: false };
}

export function isLiked({ ids } = {}) {
  const set = new Set(favourites().map((f) => f.id));
  return Object.fromEntries((ids || []).map((id) => [id, set.has(id)]));
}

export async function like({ id, on } = {}) {
  const list = favourites().filter((f) => f.id !== id);
  if (!on) return save("favourites", list);
  const station = seen.get(id) || (await byId(id));
  if (!station) throw fail("unavailable", "That station is gone");
  save("favourites", [snapshot(station)].concat(list));
}

export async function stream({ id } = {}) {
  const station = await byId(id);
  if (!station) throw fail("unavailable", "That station is gone");
  const url = String(station.url_resolved || station.url || "").trim();
  if (!url) throw fail("unavailable", "This station has no address to play");
  pushHistory(station);
  return { url, type: streamType(station) };
}
