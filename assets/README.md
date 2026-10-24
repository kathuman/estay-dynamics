# Estay Dynamics — brand assets ("Closing the gap")

Colours: Petrol #0E3B43 · Ivory #F4F1EA · Amber #E8A33D · Ink #14181A
Typeface: IBM Plex Sans (SemiBold for the name, Regular for the tagline). All text in the SVGs is outlined, so no font install is needed to use them.

## Which file where

| Use | File |
|---|---|
| Master icon (print, large display) | icon/svg/estay-icon.svg |
| Icon at 24–48 px (goal line removed, heavier strokes) | icon/svg/estay-icon-small.svg |
| Icon at 16–20 px (plain ED + amber bar) | icon/svg/estay-icon-favicon.svg |
| Mark without tile, on light / dark | icon/svg/estay-glyph-dark-on-light.svg / -light-on-dark.svg |
| One-colour (fax, embossing, watermark) | icon/svg/estay-glyph-mono-black.svg / -mono-white.svg |
| Icon PNGs, transparent corners | icon/png/estay-icon-{16…1024}.png |
| Website favicon | web/favicon.ico + web/favicon.svg |
| iOS home screen | web/apple-touch-icon.png (square; iOS rounds it) |
| Android / PWA | web/android-chrome-192.png, -512.png, maskable-512.png |
| LinkedIn / GitHub / X / Teams avatar | social/avatar-400.png (or -1024) — full-bleed square, platforms crop it |
| Logo on white (docs, website nav) | lockup/estay-lockup-light.svg (+ @2x PNG) |
| Logo on dark | lockup/estay-lockup-dark.svg (+ @2x PNG) |
| Logo with tagline | lockup/estay-lockup-*-tagline.svg |
| Email signature | lockup/email-signature-600w.png — insert at 300 px wide |
| LinkedIn personal banner | headers/linkedin-banner-1584x396.png (content kept clear of the profile photo) |
| LinkedIn company page | headers/linkedin-company-1128x191.png |
| X / Twitter header | headers/x-header-1500x500.png |
| Link preview (og:image) | headers/og-image-1200x630.png |
| Website hero strip | headers/web-header-1920x480.svg / .png |
| Slide or report header bar | headers/slide-header-1920x200.png |

## Favicon snippet

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="https://YOUR-DOMAIN/og-image-1200x630.png">
```

## Rules
- Never use the full icon (with dotted goal line) below 64 px; use the small or favicon variants.
- Minimum clear space around the mark: one quarter of its height.
- Do not recolour the curve and the goal line the same colour on a light background; the gap story disappears.
