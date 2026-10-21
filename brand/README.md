# Brand assets

`logo-master.png` is the original 1254×1254 artwork (v5.6 copper logo; the previous violet/gold logo is kept as `logo-master-v1-violet-gold.png`).
Re-run the generator with `python3 tools/brand.py` after replacing it. Everything in `assets/` is
generated from it, so re-generate rather than editing the PNGs by hand.

| File | Size | Used for |
|---|---|---|
| `assets/icon.png` | 1024 | App icon (iOS + Android legacy) |
| `assets/adaptive-icon.png` | 1024 | Android adaptive icon foreground (monogram at 66% so the circle mask never clips it) |
| `assets/splash.png` | 1284×2778 | Launch screen, full lockup on black |
| `assets/logo.png` | 512, transparent | In-app splash and the activation screen hero |
| `assets/notification-icon.png` | 96, white silhouette | Android status-bar notification icon (Android renders it as a flat white shape — a gold image would show as a blob) |
| `assets/favicon.png` | 48 | Web |

Backgrounds are warm black (`#0A0807`, sampled from the artwork) so they match the artwork with no seam.
`app.json` uses the same value for the splash and adaptive-icon backgrounds.

For a printed banner or visiting card, use `logo-master.png` directly.


Also generated: `play-icon-512.png` (Play Store icon), `play-feature-1024x500.png` (Play Store feature graphic), `logo-lockup-transparent.png`, `logo-monogram-transparent.png` and `logo-tile-1024.png` for print and social posts.
