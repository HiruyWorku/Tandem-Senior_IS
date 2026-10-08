# Tandem fonts

These are the existing Fraunces, DM Sans and DM Mono faces, served locally to
avoid sending call-page visitors to Google Fonts. They retain the upstream
weight, style and Unicode ranges, with `font-display: swap` for usable fallback
text when a font cannot load. No font service is contacted at runtime.

Downloaded on 2026-10-08 from the Google Fonts CSS API using Chrome's user agent:

`https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap`

`manifest.json` records the original asset URL, SHA-256 and size of each
unmodified WOFF2 file. Duplicate assets shared by multiple weights are stored
once. The pinned files total 429,364 bytes; a browser fetches only the faces and
Unicode subsets used by the page.

Each family uses the SIL Open Font License 1.1. The original copyright and
license notices are included in `dmmono-OFL.txt`, `dmsans-OFL.txt` and
`fraunces-OFL.txt`, retrieved from the corresponding `ofl/<family>/OFL.txt` in
the official [google/fonts repository](https://github.com/google/fonts).
Keep these notices and update the manifest when updating the assets.
