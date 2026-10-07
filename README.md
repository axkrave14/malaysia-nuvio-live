# Malaysia Free Live TV — Nuvio Addon

A Nuvio/Stremio-compatible live-TV addon for free Malaysian channels.

## Included channel targets

RTM: TV1, TV2, TV Okey, Sukan RTM, Berita RTM, TV6, Dewan Rakyat, Dewan Negara.

Media Prima: TV3, Drama Sangat, DidikTV KPM, 8TV, TV9.

Other FTA: Awesome TV, TV AlHijrah, Suke TV, BERNAMA TV, TVS.

The addon only shows a channel when it is found in one of the configured upstream public playlists. Playlist presence does not guarantee that a feed is currently playable.

## EPG

Uses AqFad2811 XMLTV data:

- https://raw.githubusercontent.com/AqFad2811/epg/main/rtmklik.xml
- https://raw.githubusercontent.com/AqFad2811/epg/main/epg.xml

The addon displays current/next programme information in each channel's metadata when XMLTV data is available.

## Upstream stream sources

- https://raw.githubusercontent.com/weareblahs/freeview/main/mytv_broadcasting.m3u8
- https://rtm.samsam123.name.my/rtm-live.m3u8

No video is proxied or restreamed by this addon. It returns the original upstream media URLs to Nuvio, with HLS listed first and additional sources retained as fallbacks. Required Referer and User-Agent headers are passed through `behaviorHints.proxyHeaders.request`. Feeds explicitly marked as DRM-protected are excluded.

## Landscape cards and playback fixes (v1.0.1)

Catalog and detail metadata now use `posterShape: "landscape"` and bundled 960 × 540 PNG cards. Original broadcaster logos remain available as the metadata logo. Set `PUBLIC_URL` to your public HTTPS origin if it differs from `RENDER_EXTERNAL_URL`.

The playlist parser preserves query parameters inside Referer URLs and decodes percent-encoded header values. Matching streams are deduplicated and presented as selectable sources, with HLS first. Fetches time out after 10 seconds; if all playlist fetches fail, the previous channel list is retained and retried after 30 seconds.

These fixes cannot revive an expired URL, supply a broadcaster login, or guarantee playback of the archived Drama Sangat feed. Header support also depends on the Nuvio version installed on your device.

After deploying this update, restart Nuvio. If old cards remain cached, remove and reinstall the addon using the same manifest URL. If one source fails, try another source listed for that channel.

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:7000/manifest.json
```

## Deploy to Render

1. Create a new GitHub repository.
2. Upload all files in this folder.
3. In Render, choose **New > Blueprint** and select your repository. `render.yaml` will configure the service.
4. After deployment, your Nuvio addon URL is:

```text
https://YOUR-RENDER-SERVICE.onrender.com/manifest.json
```

5. In Nuvio Android, install the addon using that `manifest.json` URL.

## Notes

Some Malaysian broadcasters rotate stream URLs or require temporary authentication. If a channel stops working, update its upstream source rather than proxying/rebroadcasting the video.

Some MPEG-DASH (`.mpd`) or HLS (`.m3u8`) feeds may be geo-restricted to Malaysia.

## Verify

```bash
npm test
```

Tests use fixture streams to verify header handling, source selection, metadata, PNG dimensions, CORS and HTTP endpoints. They do not validate live broadcaster availability.
