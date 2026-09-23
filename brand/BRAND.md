# Patchr brand kit

Everything here is rendered from `Patchr_Brand.blend`. To regenerate every export, open the file in Blender, switch to the Text Editor, open `render_all.py` and press **Run Script** (Alt+P).

## The mark
The mark is a "P" made of changelog lines: a rounded stem and three rounded bars. The longer middle bar is pink; it stands for *the newest change*. The wordmark is **Inter ExtraBold**, lowercase `patchr`, tracked at about −0.04em.

## Which file to use where

| Where | File |
|---|---|
| Discord bot avatar | `export/discord/patchr-avatar-1024.png` |
| Discord bot banner | `export/discord/patchr-banner-1500x600.png` |
| Embed author / footer icon | `export/embeds/patchr-footer-256.png` |
| Change-type emojis (upload as application emojis) | `export/embeds/badge-new-128.png`, `badge-fix-128.png`, `badge-change-128.png` |
| Website header logo (light background) | `export/web/logo-horizontal-on-light.svg` (PNG also provided) |
| Website header logo (dark background) | `export/web/logo-horizontal-on-dark.svg` (PNG also provided) |
| Website hero | `export/web/hero-3d.png` (transparent) or `hero-3d-bg.png` |
| Favicon | `export/web/favicon.svg` + `favicon-16/32/48.png` |
| iOS home screen | `export/web/apple-touch-icon-180.png` |
| PWA manifest | `export/web/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` |
| Link previews (Open Graph / Twitter) | `export/web/og-image-1200x630.png` |
| GitHub repo social preview | `export/github/social-preview-1280x640.png` |
| README header | `export/github/readme-banner-1280x320.png` |
| Standalone mark | `export/web/mark.svg`, `mark-1024.png` |
| Overview | `export/brand-board.png` |

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
<meta property="og:image" content="https://YOUR-DOMAIN/og-image-1200x630.png">
<meta name="theme-color" content="#17142B">
```

## Colour

| Name | Hex | Use |
|---|---|---|
| Ink | `#17142B` | Tile, primary text on light |
| Pink | `#FF5E8A` | The "new" bar, highlights, **Discord embed colour** |
| White | `#FFFFFF` | Glyph, text on dark |
| Deep ink | `#0E0C1A` | Dark backgrounds |
| Mist | `#F4F2FA` | Light backgrounds |
| Haze | `#BDB7D9` | Secondary text on dark |
| Muted | `#6B6785` | Secondary text on light |
| Mint | `#3DDC97` | "Fix" badge |
| Lilac | `#8B7CFF` | "Change" badge |

Discord embed colours as integers (for the `color` field):

| Colour | Hex | Integer |
|---|---|---|
| Pink, default / new | `#FF5E8A` | `16735882` |
| Mint, fixes | `#3DDC97` | `4054167` |
| Lilac, changes | `#8B7CFF` | `9141503` |

## Type
- **Inter ExtraBold** (`fonts/Inter_28pt-ExtraBold.ttf`): wordmark and headlines, with tight tracking.
- **Inter Medium** (`fonts/Inter_24pt-Medium.ttf`): tagline and interface text.
- Tagline: *Patch notes, posted beautifully.*

Inter is licensed under the SIL Open Font License (`fonts/OFL.txt`).

## Usage
- **Clear space:** keep at least one bar-height of empty space around the tile (about 9% of the tile's width).
- **Minimum sizes:** below 48 px, use the favicon files. They're a pixel-snapped variant with thicker bars.
- **Circle crops** (Discord, most avatars): use `patchr-avatar-1024.png`. The mark is sized to sit inside the circle.
- **Don't** recolour the bars, swap which bar is pink, stretch the tile, put the ink tile on an ink background without contrast, or set the wordmark in another font.
