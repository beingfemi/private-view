# Private View

**Live:** https://private-view-alpha.vercel.app

A 3D gallery invitation — paintings hang on a curved wall that drifts past; drag, scroll, or use the arrow keys to browse. Inspired by [Josh Puckett's Interface Craft × MoMA invite](https://joshpuckett.me/nyc-moma).

- `index.html` / `styles.css` — page and overlay type
- `gallery.js` — Three.js scene; works glide along a U-shaped wall (side walls, eased rounded corners, flat back wall). Artwork list and room tunables live at the top
- `artworks/` — public-domain paintings via Wikimedia Commons

No build step: serve the folder with any static server, e.g. `python3 -m http.server`.
