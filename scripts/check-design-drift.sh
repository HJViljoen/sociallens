#!/usr/bin/env bash
# Design drift guards (MASTER.md §Visual identity rule 9). Fails the build when
# the app slides back toward the cream/pine AI-default look.
#   (a) every neutral in app/globals.css must be cool: blue >= red (cream fails)
#   (b) the only saturated greens in app/globals.css are the Verbatim green set
#   (c) no backdrop-blur anywhere in the app (marketing under app/site excluded)
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import re, sys, colorsys
css = open('app/globals.css').read()
# only the app token blocks — marketing's .site-theme keeps its own palette until its rewrite
app_css = css.split('/* ── Marketing theme')[0]
hexes = re.findall(r'#([0-9A-Fa-f]{6})\b', app_css)
allowed_green = {'0E8A5F','DDF3E9','0B6E4C','2FBF85','173B2D','7EDDB4','0B1F16'}
bad = []
for h in set(x.upper() for x in hexes):
    r,g,b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    hue,l,s = colorsys.rgb_to_hls(r/255,g/255,b/255)
    hue *= 360
    if max(r,g,b)-min(r,g,b) <= 12:          # a neutral
        if b < r: bad.append(f'warm neutral #{h} (blue {b} < red {r})')
    elif 100 <= hue <= 175 and s > 0.25:      # a saturated green
        if h not in allowed_green: bad.append(f'unlisted green #{h} (hue {hue:.0f})')
if bad:
    print('design drift:'); [print('  -', x) for x in bad]; sys.exit(1)
print('drift guard (a)(b): ok')
PY

if grep -rn "backdrop-blur" app components --include='*.tsx' --include='*.ts' --include='*.css' 2>/dev/null | grep -v '^app/site' ; then
  echo "design drift: backdrop-blur found in the app (rule 3: depth by elevation, no glass)"; exit 1
fi
echo "drift guard (c): ok"
