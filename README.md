# Malaysia Free Live TV — Nuvio Addon

A Nuvio/Stremio-compatible live-TV addon for free Malaysian channels.

## Included channel targets

RTM: TV1, TV2, TV Okey, Sukan RTM, Berita RTM, TV6, Dewan Rakyat, Dewan Negara.

Media Prima: TV3, Drama Sangat, DidikTV KPM, 8TV, TV9.

Other FTA: Awesome TV, TV AlHijrah, Suke TV, BERNAMA TV, TVS.

The addon only shows a channel when it is found in one of the configured upstream public playlists. This avoids showing dead placeholders.

## EPG

Uses AqFad2811 XMLTV data:

- https://raw.githubusercontent.com/AqFad2811/epg/main/rtmklik.xml
- https://raw.githubusercontent.com/AqFad2811/epg/main/epg.xml

The addon displays current/next programme information in each channel's metadata when XMLTV data is available.

## Upstream stream sources

- https://raw.githubusercontent.com/weareblahs/freeview/main/mytv_broadcasting.m3u8
- https://rtm.samsam123.name.my/rtm-live.m3u8

No video is proxied or restreamed by this addon. It returns the original upstream media URL to Nuvio.

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
