const express = require('express');
const { XMLParser } = require('fast-xml-parser');
const { CHANNELS } = require('./channels');

const app = express();
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});
app.use('/posters', express.static(require('path').join(__dirname, 'public/posters'), { maxAge: '1d' }));
const PORT = process.env.PORT || 7000;

const SOURCES = [
  'https://raw.githubusercontent.com/weareblahs/freeview/main/mytv_broadcasting.m3u8',
  'https://rtm.samsam123.name.my/rtm-live.m3u8'
];

const EPG_SOURCES = [
  'https://raw.githubusercontent.com/AqFad2811/epg/main/rtmklik.xml',
  'https://raw.githubusercontent.com/AqFad2811/epg/main/epg.xml'
];

const manifest = {
  id: 'my.malaysia.free.live.tv',
  version: '1.0.1',
  name: 'Malaysia Free Live TV',
  description: 'Free Malaysian live TV for Nuvio/Stremio using public/official stream sources and AqFad2811 XMLTV EPG.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  catalogs: [
    {
      type: 'tv',
      id: 'malaysia-free-live',
      name: 'Malaysia Free Live TV'
    }
  ],
  idPrefixes: ['mytv:'],
  behaviorHints: { p2p: false, adult: false }
};

let playlistCache = { expires: 0, channels: [] };
let epgCache = { expires: 0, programmes: new Map() };

function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseAttrs(line) {
  const attrs = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) attrs[m[1]] = m[2];
  return attrs;
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let pending = null;
  let requestHeaders = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const attrs = parseAttrs(line);
      const comma = line.lastIndexOf(',');
      const name = comma >= 0 ? line.slice(comma + 1).trim() : (attrs['tvg-name'] || 'Unknown');
      pending = {
        name,
        tvgId: attrs['tvg-id'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        requestHeaders: {},
        requiresDrm: false
      };
      requestHeaders = {};
      continue;
    }

    if (line.startsWith('#KODIPROP:inputstream.adaptive.license_type=')) {
      if (pending) pending.requiresDrm = true;
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
      requestHeaders.Referer = line.split('=').slice(1).join('=');
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      requestHeaders['User-Agent'] = line.split('=').slice(1).join('=');
      continue;
    }

    if (!line.startsWith('#') && pending) {
      let url = line;
      if (url.includes('|')) {
        const [base, optString] = url.split('|', 2);
        url = base;
        for (const pair of optString.split(/&(?=(?:Referer|Referrer|User-Agent|Origin)=)/i)) {
          const [k, ...rest] = pair.split('=');
          if (!k || !rest.length) continue;
          let v = rest.join('=');
          try { v = decodeURIComponent(v); } catch (_) {}
          if (/^referr?er$/i.test(k)) requestHeaders.Referer = v;
          if (/^user-agent$/i.test(k)) requestHeaders['User-Agent'] = v;
          if (/^origin$/i.test(k)) requestHeaders.Origin = v;
        }
      }
      if (/^https?:\/\//i.test(url) && !pending.requiresDrm) {
        out.push({ ...pending, url, requestHeaders: { ...requestHeaders } });
      }
      pending = null;
      requestHeaders = {};
    }
  }
  return out;
}

function chooseAllowed(rawChannels) {
  const selected = [];
  for (const def of CHANNELS) {
    const hits = rawChannels.filter(ch => def.aliases.some(a => a.toLowerCase() === ch.name.toLowerCase()));
    const seen = new Set();
    const streams = hits.filter(hit => {
      const key = JSON.stringify([hit.url, hit.requestHeaders]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => Number(/\.m3u8(?:[?]|$)/i.test(b.url)) - Number(/\.m3u8(?:[?]|$)/i.test(a.url)));
    if (!streams.length) continue;
    selected.push({ ...def, logo: hits.find(ch => ch.logo)?.logo || '', streams });
  }
  return selected;
}

async function getChannels() {
  if (Date.now() < playlistCache.expires) return playlistCache.channels;

  const all = [];
  for (const src of SOURCES) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 Nuvio-Malaysia-Live/1.0' } });
      if (!r.ok) continue;
      all.push(...parseM3U(await r.text()));
    } catch (_) {}
  }

  const fresh = chooseAllowed(all);
  const channels = fresh.length ? fresh : playlistCache.channels;
  playlistCache = { expires: Date.now() + (fresh.length ? 10 * 60 * 1000 : 30000), channels };
  return channels;
}

function parseXmltvDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone] = m;
  const base = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (!zone) return new Date(base + '+08:00');
  const z = `${zone.slice(0,3)}:${zone.slice(3)}`;
  return new Date(base + z);
}

function valText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return valText(v[0]);
  return v['#text'] || '';
}

async function getEpg() {
  if (Date.now() < epgCache.expires) return epgCache.programmes;
  const map = new Map();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

  for (const src of EPG_SOURCES) {
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 Nuvio-Malaysia-Live/1.0' } });
      if (!r.ok) continue;
      const xml = await r.text();
      const obj = parser.parse(xml);
      const progs = obj?.tv?.programme || [];
      for (const p of Array.isArray(progs) ? progs : [progs]) {
        const id = String(p['@_channel'] || '');
        if (!id) continue;
        const item = {
          start: parseXmltvDate(p['@_start']),
          stop: parseXmltvDate(p['@_stop']),
          title: valText(p.title),
          desc: valText(p.desc)
        };
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(item);
      }
    } catch (_) {}
  }

  for (const arr of map.values()) arr.sort((a,b) => (a.start || 0) - (b.start || 0));
  epgCache = { expires: Date.now() + 30 * 60 * 1000, programmes: map };
  return map;
}

function nowNextFor(epg, ids) {
  const now = new Date();
  const candidates = [];
  for (const id of ids) {
    const arr = epg.get(id) || [];
    if (arr.length) candidates.push(arr);
  }
  const arr = candidates[0] || [];
  const current = arr.find(p => p.start && p.stop && p.start <= now && now < p.stop);
  const next = arr.find(p => p.start && p.start > now);
  return { current, next };
}

function formatTime(d) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
}

function publicBase(req) {
  const configured = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  // Render terminates HTTPS before forwarding to this process.
  const protocol = req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' ? 'https' : req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function metaBase(ch, baseUrl) {
  return {
    id: `mytv:${slugify(ch.name)}`,
    type: 'tv',
    name: ch.name,
    poster: `${baseUrl}/posters/${slugify(ch.name)}.png`,
    background: `${baseUrl}/posters/${slugify(ch.name)}.png`,
    logo: ch.logo || undefined,
    posterShape: 'landscape',
    genres: [ch.group, 'Live TV', 'Malaysia'],
    releaseInfo: 'Live'
  };
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html><html><body style="font-family:sans-serif;max-width:760px;margin:40px auto"><h1>Malaysia Free Live TV</h1><p>Nuvio/Stremio-compatible addon.</p><p>Install URL: <code>${escapeHtml((process.env.PUBLIC_URL || '').replace(/\/$/, '') || '[your deployed URL]')}/manifest.json</code></p><p>This addon only surfaces free/public Malaysian channels from upstream sources and does not proxy or restream video.</p></body></html>`);
});

app.get('/manifest.json', (_req, res) => res.json(manifest));

app.get('/catalog/tv/malaysia-free-live.json', async (req, res) => {
  const channels = await getChannels();
  res.json({ metas: channels.map(ch => metaBase(ch, publicBase(req))) });
});

app.get('/meta/tv/:id.json', async (req, res) => {
  const channels = await getChannels();
  const ch = channels.find(x => `mytv:${slugify(x.name)}` === req.params.id);
  if (!ch) return res.json({ meta: null });

  const epg = await getEpg();
  const { current, next } = nowNextFor(epg, [ch.epgId, ch.name]);
  const lines = [];
  if (current) lines.push(`Now ${formatTime(current.start)}–${formatTime(current.stop)}: ${current.title}`);
  if (next) lines.push(`Next ${formatTime(next.start)}: ${next.title}`);
  lines.push(`${ch.group} • Free Malaysian live TV`);

  res.json({
    meta: {
      ...metaBase(ch, publicBase(req)),
      description: lines.join('\n'),
      videos: [{ id: `mytv:${slugify(ch.name)}`, title: ch.name, released: new Date().toISOString() }]
    }
  });
});

app.get('/stream/tv/:id.json', async (req, res) => {
  const channels = await getChannels();
  const ch = channels.find(x => `mytv:${slugify(x.name)}` === req.params.id);
  if (!ch) return res.json({ streams: [] });

  res.json({ streams: ch.streams.map((source, index) => streamBase(ch, source, index)) });
});

app.get('/health', async (_req, res) => {
  const channels = await getChannels();
  res.json({ ok: true, channels: channels.map(c => c.name), count: channels.length });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function streamBase(ch, source, index) {
  const behaviorHints = { notWebReady: true };
  if (Object.keys(source.requestHeaders || {}).length) {
    behaviorHints.proxyHeaders = { request: source.requestHeaders };
  }
  const format = /\.m3u8(?:[?]|$)/i.test(source.url) ? 'HLS' : /\.mpd(?:[?]|$)/i.test(source.url) ? 'DASH' : 'Live';
  return { name: 'Malaysia Free Live TV', title: `${ch.name} • ${format} • Source ${index + 1}`, url: source.url, behaviorHints };
}

if (require.main === module) {
  app.listen(PORT, () => console.log(`Malaysia Free Live TV addon listening on :${PORT}`));
}
module.exports = { app, parseM3U, chooseAllowed, metaBase, streamBase };
