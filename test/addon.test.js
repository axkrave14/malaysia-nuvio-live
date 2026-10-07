const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app, parseM3U, chooseAllowed, metaBase, streamBase } = require('../server');

test('preserves full Drama Sangat Referer and decodes encoded headers', () => {
  const [source] = parseM3U(`#EXTM3U
#EXTINF:-1,Drama Sangat
#EXTVLCOPT:http-user-agent=Mozilla/5.0
https://example.com/index.m3u8|Referer=https://example.com/embed?vid=123&autoplay=1&mute=0&User-Agent=Mozilla%2F5.0`);
  assert.equal(source.requestHeaders.Referer, 'https://example.com/embed?vid=123&autoplay=1&mute=0');
  assert.equal(source.requestHeaders['User-Agent'], 'Mozilla/5.0');
  assert.equal(source.url, 'https://example.com/index.m3u8');
});

test('keeps fallback streams, deduplicates identical sources and prefers HLS', () => {
  const sources = parseM3U(`#EXTINF:-1,TV1
https://example.com/manifest.mpd
#EXTINF:-1,TV1
https://example.com/live.m3u8
#EXTINF:-1,TV1
https://example.com/live.m3u8
#EXTINF:-1,Unlisted Channel
https://example.com/unlisted.m3u8`);
  const [channel] = chooseAllowed(sources);
  assert.equal(chooseAllowed(sources).length, 1);
  assert.equal(channel.streams.length, 2);
  assert.equal(channel.streams[0].url, 'https://example.com/live.m3u8');
});

test('does not leak headers between channels or emit declared DRM feeds', () => {
  const sources = parseM3U(`#EXTINF:-1,TV3
#EXTVLCOPT:http-referrer=https://example.com/
https://example.com/one.m3u8
#EXTINF:-1,TV9
https://example.com/two.m3u8
#EXTINF:-1,TV1
#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha
https://example.com/drm.mpd`);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[1].requestHeaders, {});
});

test('metadata requests landscape PNG and stream headers use the Android supported field', () => {
  const channel = { name: 'Drama Sangat', group: 'Media Prima' };
  const meta = metaBase(channel, 'https://addon.example');
  assert.equal(meta.posterShape, 'landscape');
  assert.equal(meta.poster, 'https://addon.example/posters/drama-sangat.png');
  const stream = streamBase(channel, { url: 'https://example.com/live.m3u8', requestHeaders: { Referer: 'https://example.com/' } }, 0);
  assert.equal(stream.behaviorHints.proxyHeaders.request.Referer, 'https://example.com/');
});

test('HTTP catalog, metadata, streams, posters and CORS work together', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => '#EXTM3U\n#EXTINF:-1,Drama Sangat\n#EXTVLCOPT:http-referrer=https://example.com/\nhttps://example.com/live.m3u8' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const catalogResponse = await originalFetch(`${base}/catalog/tv/malaysia-free-live.json`);
    assert.equal(catalogResponse.headers.get('access-control-allow-origin'), '*');
    const catalog = await catalogResponse.json();
    assert.equal(catalog.metas[0].posterShape, 'landscape');
    const poster = await originalFetch(catalog.metas[0].poster);
    const png = Buffer.from(await poster.arrayBuffer());
    assert.equal(poster.status, 200);
    assert.equal(png.readUInt32BE(16), 960);
    assert.equal(png.readUInt32BE(20), 540);
    const meta = await (await originalFetch(`${base}/meta/tv/mytv:drama-sangat.json`)).json();
    assert.equal(meta.meta.posterShape, 'landscape');
    const streams = await (await originalFetch(`${base}/stream/tv/mytv:drama-sangat.json`)).json();
    assert.equal(streams.streams[0].behaviorHints.proxyHeaders.request.Referer, 'https://example.com/');
    assert.deepEqual(await (await originalFetch(`${base}/stream/tv/mytv:missing.json`)).json(), { streams: [] });
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
