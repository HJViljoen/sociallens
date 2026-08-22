#!/usr/bin/env python3
"""Generate the Verbatim one-screen redesign artboards (.dc.html) + canvas.json.

Every artboard is a static 1440x900 desktop frame built from the app's real
tokens (app/globals.css on main): cream #F6F1E7, ink #14291F, pine #14503A,
Plus Jakarta Sans + JetBrains Mono, sidebar #FCF9F1, bucket colours
client=green / category=slate / competitor=clay, evidence quotes = clay rule.
"""
import json, math, os

OUT = os.path.dirname(os.path.abspath(__file__))

# ── tokens ────────────────────────────────────────────────────────────────
INK = "#14291F"; CREAM = "#F6F1E7"; CARD = "#FDFAF3"; PINE = "#14503A"
MUTED = "#5F6B5E"; BORDER = "#E4DCCC"; SAND = "#ECE7DA"
POS = "#1B6144"; WARN = "#B9822B"; NEG = "#B4472F"
CLAY = "#C4633F"; OCHRE = "#C99A3B"; SLATE = "#4E6E9E"; PLUM = "#8A5A7A"
BUCKET = {"client": POS, "category": SLATE, "competitor": CLAY}
CH = ["#0F3B2B", "#2E8B5E", "#7C9A6B", "#A8B98C", "#4B6B4A"]

CSS = f"""
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{{box-sizing:border-box}}
body{{margin:0;background:{CREAM};color:{INK};font-family:'Plus Jakarta Sans',ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.45;-webkit-font-smoothing:antialiased}}
a{{color:{PINE};text-decoration:none}} a:hover{{color:#0F3B2B}}
.mono{{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}}
.shell{{position:relative;width:1440px;height:900px;overflow:hidden;background:{CREAM}}}
.crowd{{position:absolute;inset:0;background:url(./crowd.svg) center bottom / cover no-repeat;opacity:.1;-webkit-mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,.35) 8%,#000 34%,#000 100%);mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,.35) 8%,#000 34%,#000 100%);pointer-events:none}}
.sidebar{{position:absolute;left:8px;top:8px;width:256px;height:884px;background:#FCF9F1;border-radius:18px;box-shadow:0 0 0 1px #E7DFD0,0 1px 2px rgba(0,0,0,.04);display:flex;flex-direction:column;padding:8px}}
.brand{{display:flex;align-items:center;gap:10px;padding:12px 12px 10px}}
.brand .mark{{width:28px;height:28px;border-radius:8px;background:{PINE}}}
.brand .name{{font-size:18px;font-weight:700;letter-spacing:-.01em;color:{INK}}}
.nav{{display:flex;flex-direction:column;gap:6px;padding:0 0px;margin-top:4px}}
.nav a{{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:10px;font-weight:500;color:#55605A;font-size:13.5px}}
.nav a.active{{background:#E3EEE3;color:{PINE}}}
.nav a svg{{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}}
.nav .spacer{{flex:1}}
.content{{position:absolute;left:272px;top:8px;right:0;bottom:0}}
.topbar{{position:absolute;left:0;right:0;top:0;height:48px;display:flex;align-items:center;gap:12px;padding:0 24px 0 16px;border-bottom:1px solid rgba(228,220,204,.6)}}
.topbar .trigger{{width:16px;height:16px;stroke:#55605A;fill:none;stroke-width:1.75}}
.topbar .title{{font-weight:600;font-size:14px}}
.topbar .ctx{{color:{MUTED};font-size:12px}}
.topbar .sep{{width:1px;height:16px;background:{BORDER}}}
.topbar .right{{margin-left:auto;display:flex;align-items:center;gap:8px}}
.pill{{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:500;color:#3F4B44;background:rgba(253,250,243,.8);box-shadow:0 0 0 1px {BORDER}}}
.pill.primary{{color:{PINE};box-shadow:0 0 0 1px rgba(20,80,58,.3)}}
.pill.on{{background:#E3EEE3;color:{PINE};box-shadow:none}}
.pill svg{{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2}}
.grid{{position:absolute;left:24px;top:72px;width:1120px;height:776px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));grid-template-rows:repeat(6,116px);gap:16px}}
.tile{{position:relative;background:{CARD};border-radius:10px;box-shadow:0 0 0 1px rgba(228,220,204,.9),0 1px 2px rgba(18,42,31,.05),0 10px 24px -14px rgba(18,42,31,.22);padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}}
.tile.hero{{background:radial-gradient(120% 120% at 100% 0%,rgba(255,255,255,.12),transparent 55%),linear-gradient(150deg,#1A5C43 0%,#113E2C 100%);color:#F5F1E6;box-shadow:0 1px 2px rgba(18,42,31,.1),0 18px 40px -16px rgba(18,42,31,.45)}}
.tile.warm{{box-shadow:0 0 0 1px rgba(196,99,63,.45),0 1px 2px rgba(18,42,31,.05),0 10px 24px -14px rgba(18,42,31,.22)}}
.tile.strip{{flex-direction:row;align-items:stretch;padding:0;gap:0}}
.cell{{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:4px;min-width:0;border-right:1px solid rgba(228,220,204,.8)}}
.cell:last-child{{border-right:0}}
.head{{display:flex;align-items:baseline;justify-content:space-between;gap:8px}}
.eyebrow{{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#6B756B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.hero .eyebrow{{color:rgba(245,241,230,.72)}}
.meta{{font-size:11px;color:#7A847A;white-space:nowrap}}
.hero .meta{{color:rgba(245,241,230,.6)}}
.foot{{margin-top:auto;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:500;color:{PINE}}}
.hero .foot{{color:#DCE8DD}}
.foot .note{{color:#7A847A;font-weight:400}}
.val{{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;font-size:24px;line-height:1;font-weight:600;letter-spacing:-.03em}}
.val.big{{font-size:34px}}
.val.small{{font-size:18px}}
.unit{{font-size:12px;color:{MUTED};font-weight:500;letter-spacing:0;font-family:'Plus Jakarta Sans',sans-serif}}
.delta{{font-family:'JetBrains Mono',monospace;font-size:11px;color:#7A847A}}
.delta.up{{color:{POS}}} .delta.down{{color:{CLAY}}}
.hl{{font-size:15px;line-height:1.3;font-weight:600;letter-spacing:-.012em;text-wrap:balance}}
.hl.lg{{font-size:19px;line-height:1.25}}
.body{{font-size:12.5px;line-height:1.45;color:#2B3A31}}
.hero .body{{color:rgba(245,241,230,.88)}}
.sub{{font-size:11.5px;color:{MUTED};line-height:1.4}}
.quote{{font-style:italic;font-size:12.5px;line-height:1.4;color:#2B3A31;border-left:2px solid {CLAY};padding-left:8px}}
.hero .quote{{color:#F1EBDD;border-left-color:#D99A7A}}
.quote .who{{display:block;font-style:normal;font-size:10.5px;color:#7A847A;margin-top:2px}}
.hero .quote .who{{color:rgba(245,241,230,.6)}}
.chip{{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:500;white-space:nowrap}}
.chip .dot,.dot{{width:6px;height:6px;border-radius:50%;display:inline-block;flex:none}}
.chips{{display:flex;flex-wrap:wrap;gap:4px}}
.row{{display:flex;align-items:center;gap:8px;min-width:0}}
.row > .row{{flex:none;white-space:nowrap}}
.row .lbl{{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px}}
.bar{{height:6px;border-radius:3px;background:{SAND};overflow:hidden;flex:none}}
.bar i{{display:block;height:100%;border-radius:3px}}
.pbar{{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px}}
.pbar i{{display:block;height:100%}}
.tabs{{display:flex;gap:2px;border-bottom:1px solid rgba(228,220,204,.9);margin:0 -14px;padding:0 14px}}
.tabs span{{font-size:11.5px;font-weight:500;color:#6B756B;padding:2px 8px 6px;border-bottom:2px solid transparent;white-space:nowrap}}
.tabs span.on{{color:{PINE};border-bottom-color:{PINE}}}
.tabs b{{font-weight:500;color:#9AA39A;margin-left:3px;font-family:'JetBrains Mono',monospace;font-size:10.5px}}
.list{{display:flex;flex-direction:column;gap:6px;min-height:0}}
.list.tight{{gap:4px}}
.divided > * + *{{border-top:1px solid rgba(228,220,204,.7);padding-top:6px}}
.kv{{display:flex;justify-content:space-between;gap:8px;font-size:12px}}
.legend{{display:flex;flex-direction:column;gap:5px;font-size:11.5px}}
.legend .row{{gap:6px}}
.legend .k{{flex:1;color:#3F4B44}}
.legend .v{{font-family:'JetBrains Mono',monospace;font-size:11.5px;font-weight:600}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:0}}
.three{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;min-height:0}}
.ax{{font-family:'JetBrains Mono',monospace;font-size:10px;fill:#8A948A}}
.sched{{font-size:11px;color:#7A847A}}
.num{{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;font-size:11.5px;color:#3F4B44}}
.num.b{{font-weight:600;color:{INK}}}
.prio{{width:7px;height:7px;border-radius:50%;flex:none}}
table.t{{border-collapse:collapse;width:100%;font-size:12px}}
table.t th{{text-align:left;font-weight:500;color:#7A847A;font-size:11px;padding:2px 6px 6px 0;border-bottom:1px solid rgba(228,220,204,.9)}}
table.t td{{padding:5px 6px 5px 0;border-bottom:1px solid rgba(228,220,204,.5);vertical-align:middle;white-space:nowrap}}
table.t td.n,table.t th.n{{text-align:right;font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}}
.ghost{{color:#9AA39A}}
.scrollhint{{position:absolute;right:14px;bottom:10px;font-size:10.5px;color:#9AA39A}}
.av{{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#fff;flex:none}}
.input{{display:flex;align-items:center;gap:10px;height:44px;padding:0 8px 0 16px;border-radius:999px;background:#FDFAF3;box-shadow:0 0 0 1px {BORDER},0 10px 30px -14px rgba(18,42,31,.3);color:#7A847A;font-size:14px}}
.input .send{{margin-left:auto;width:30px;height:30px;border-radius:50%;background:#A9BFAE;display:flex;align-items:center;justify-content:center}}
.input .send svg{{width:14px;height:14px;stroke:#fff;fill:none;stroke-width:2.2}}
.note{{font-size:11px;color:#7A847A}}
"""

# ── icons (stroke, 24 viewBox) ─────────────────────────────────────────────
ICO = {
 "grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 "target": '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
 "msg": '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12z"/>',
 "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 "spark": '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
 "swords": '<path d="M5 5l14 14"/><path d="M19 5L5 19"/><path d="M5 9V5h4"/><path d="M15 5h4v4"/><path d="M5 15v4h4"/><path d="M15 19h4v-4"/>',
 "play": '<path d="M6 4l14 8-14 8z"/>',
 "file": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
 "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 13.5a6 6 0 0 1 4 6.5"/>',
 "card": '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 "cog": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
 "out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
 "panel": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
 "chev": '<path d="M6 9l6 6 6-6"/>',
 "help": '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
 "up": '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
 "tt": '<path d="M14 3v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3a5 5 0 0 0 5 5"/>',
 "yt": '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
 "ig": '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><path d="M16.5 7.5h.01"/>',
 "rd": '<circle cx="12" cy="13" r="7"/><circle cx="9.5" cy="13" r=".8"/><circle cx="14.5" cy="13" r=".8"/><path d="M9.5 16c1.5 1 3.5 1 5 0"/><path d="M12 6l1.5-3 3 1"/>',
}
def ico(name, size=16, extra=""):
    return f'<svg viewBox="0 0 24 24" width="{size}" height="{size}" {extra}>{ICO[name]}</svg>'

NAV = [("grid","Dashboard"),("target","Market Intelligence"),("msg","Voice of Customer"),("user","Consumer Profile"),("spark","Verbatim Agent"),("swords","Competitive Intel"),("play","Content"),("file","Reports"),("users","Team"),("card","Billing"),("cog","Settings")]

def sidebar(active):
    items = "".join(f'<a class="{"active" if lbl==active else ""}" href="#">{ico(i)}<span>{lbl}</span></a>' for i,lbl in NAV)
    return f'''<div class="sidebar"><div class="brand"><span class="mark"></span><span class="name">Verbatim</span></div>
<div class="nav">{items}</div><div class="spacer" style="flex:1"></div><div class="nav"><a href="#">{ico("out")}<span>Logout</span></a></div></div>'''

def topbar(title, ctx, right_html=""):
    return f'''<div class="topbar">{ico("panel",16,'class="trigger"')}<span class="sep"></span><span class="title">{title}</span><span class="ctx">{ctx}</span>
<div class="right">{right_html}<span class="pill primary">{ico("help")}How to read this page</span></div></div>'''

def page(active, title, ctx, right_html, grid_html, extra_css=""):
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>{CSS}{extra_css}</style>
</helmet>
<div class="shell"><div class="crowd"></div>
{sidebar(active)}
<div class="content">{topbar(title, ctx, right_html)}
<div class="grid">
{grid_html}
</div></div></div>
</x-dc>
</body>
</html>'''

# ── chart helpers ──────────────────────────────────────────────────────────
def spark(pts, w=90, h=26, color=PINE, fill=False, end=True, stroke=1.5):
    lo, hi = min(pts), max(pts); rng = (hi-lo) or 1
    xs = [i*(w-4)/(len(pts)-1)+2 for i in range(len(pts))]
    ys = [h-3-(p-lo)/rng*(h-6) for p in pts]
    poly = " ".join(f"{x:.1f},{y:.1f}" for x,y in zip(xs,ys))
    area = f'<polygon points="{xs[0]:.1f},{h-1} {poly} {xs[-1]:.1f},{h-1}" fill="{color}" opacity=".12"/>' if fill else ""
    dot = f'<circle cx="{xs[-1]:.1f}" cy="{ys[-1]:.1f}" r="2.6" fill="{color}" stroke="{CARD}" stroke-width="1.5"/>' if end else ""
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="overflow:visible;flex:none">{area}<polyline points="{poly}" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linejoin="round" stroke-linecap="round"/>{dot}</svg>'

def ring(segs, size=120, thick=14, center="", sub=""):
    """segs: [(value, color)] -> donut with 2px gaps; center label."""
    r = (size-thick)/2; cx = cy = size/2; C = 2*math.pi*r; total = sum(v for v,_ in segs)
    out = []; off = 0.0; gap = 2.5
    for v,c in segs:
        L = C*v/total - gap
        out.append(f'<circle r="{r}" cx="{cx}" cy="{cy}" fill="none" stroke="{c}" stroke-width="{thick}" stroke-dasharray="{max(L,0):.2f} {C:.2f}" stroke-dashoffset="{-off:.2f}" transform="rotate(-90 {cx} {cy})"/>')
        off += C*v/total
    txt = f'<text x="{cx}" y="{cy+2}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="22" font-weight="600" fill="{INK}" letter-spacing="-1">{center}</text>' if center else ""
    txt += f'<text x="{cx}" y="{cy+16}" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-size="10" fill="{MUTED}">{sub}</text>' if sub else ""
    return f'<svg viewBox="0 0 {size} {size}" width="{size}" height="{size}" style="flex:none">{"".join(out)}{txt}</svg>'

def hbar(pct, color, w=None, h=6):
    style = f"width:{w}px;" if w else "flex:1;"
    return f'<span class="bar" style="{style}height:{h}px"><i style="width:{pct}%;background:{color}"></i></span>'

def pbar(parts, h=8):
    return '<div class="pbar" style="height:%dpx">' % h + "".join(f'<i style="flex:{v};background:{c}"></i>' for v,c in parts) + '</div>'

NEW = None
def chip(text, bg, fg, dot=None):
    d = f'<span class="dot" style="background:{dot}"></span>' if dot else ""
    return f'<span class="chip" style="background:{bg};color:{fg}">{d}{text}</span>'

NEW = chip("New","#E3EEE3",PINE)

def linechart(series, w=560, h=150, labels=None, ylab=None, pad_l=34, pad_r=70):
    """series: [(name, pts, color)]; shared y from 0..max*1.1; end labels."""
    allv = [v for _,p,_ in series for v in p]; hi = max(allv)*1.12; n = len(series[0][1])
    x = lambda i: pad_l + i*(w-pad_l-pad_r)/(n-1)
    y = lambda v: 12 + (h-30)*(1 - v/hi)
    g = f'<line x1="{pad_l}" y1="{y(0)}" x2="{w-pad_r}" y2="{y(0)}" stroke="{BORDER}" stroke-width="1"/>'
    g += f'<line x1="{pad_l}" y1="{y(hi/2)}" x2="{w-pad_r}" y2="{y(hi/2)}" stroke="{SAND}" stroke-width="1"/>'
    g += f'<text class="ax" x="{pad_l-6}" y="{y(0)+3}" text-anchor="end">0</text><text class="ax" x="{pad_l-6}" y="{y(hi/2)+3}" text-anchor="end">{ylab(hi/2) if ylab else round(hi/2)}</text>'
    for name,pts,c in series:
        poly = " ".join(f"{x(i):.1f},{y(v):.1f}" for i,v in enumerate(pts))
        g += f'<polyline points="{poly}" fill="none" stroke="{c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
        g += f'<circle cx="{x(n-1):.1f}" cy="{y(pts[-1]):.1f}" r="3.2" fill="{c}" stroke="{CARD}" stroke-width="1.5"/>'
        g += f'<text x="{x(n-1)+8:.1f}" y="{y(pts[-1])+4:.1f}" font-family="Plus Jakarta Sans,sans-serif" font-size="11" font-weight="600" fill="{INK}">{name} <tspan font-family="JetBrains Mono,monospace" font-weight="500">{pts[-1]}%</tspan></text>'
    if labels:
        for i,l in enumerate(labels):
            g += f'<text class="ax" x="{x(i):.1f}" y="{h-4}" text-anchor="middle">{l}</text>'
    return f'<svg viewBox="0 0 {w} {h}" width="100%" height="{h}" preserveAspectRatio="none" style="overflow:visible">{g}</svg>'

def figure(size=150, color=PINE):
    return f'<svg viewBox="0 0 100 120" width="{size*100/120:.0f}" height="{size}" fill="none" stroke="{color}" stroke-width="3" stroke-linecap="round"><circle cx="50" cy="22" r="13"/><path d="M24 118 Q20 60 50 58 Q80 60 76 118"/></svg>'

def plat(names):
    return "".join(ico(n,12,f'style="stroke:#55605A;fill:none;stroke-width:1.8"') for n in names)

# ── page 1: Dashboard ──────────────────────────────────────────────────────
def dashboard():
    strip = f'''<div class="tile strip" style="grid-column:span 12;grid-row:span 1">
<div class="cell"><span class="eyebrow">Tracking</span><div class="row" style="gap:6px"><span class="val">7<span class="unit"> terms</span></span></div><span class="sub">1 brand · 1 competitor · 5 category</span><div class="row" style="gap:6px;margin-top:2px">{plat(["tt","yt","ig","rd"])}<span class="sub">4 platforms · weekly</span></div></div>
<div class="cell"><span class="eyebrow">Videos this update</span><div class="row"><span class="val">468</span>{spark([312,340,398,521,468],fill=True)}</div><span class="delta down">−53 vs last update</span><span class="sub">2,306 all-time</span></div>
<div class="cell"><span class="eyebrow">Comments analysed</span><div class="row"><span class="val">6,163</span>{spark([2100,2900,3600,5059,6163],fill=True)}</div><span class="delta up">+22% vs last update</span><span class="sub">18,391 all-time</span></div>
<div class="cell"><span class="eyebrow">Themes heard</span><div class="row" style="gap:6px"><span class="val">120</span><span class="unit">confirmed</span></div><div class="row" style="gap:6px"><span class="num">45 early</span><span class="ghost">·</span><span class="num">181 heard once</span></div><span class="sub">846 in your theme registry</span></div>
<div class="cell"><span class="eyebrow">Where the conversation is</span><div class="list" style="margin-top:1px;gap:2px;font-size:11.5px">
<div class="row">{ico("tt",12)}<span class="lbl">TikTok</span>{hbar(100,PINE,w=70,h=5)}<span class="num">212</span></div>
<div class="row">{ico("ig",12)}<span class="lbl">Instagram</span>{hbar(66,PINE,w=70,h=5)}<span class="num">140</span></div>
<div class="row">{ico("yt",12)}<span class="lbl">YouTube</span>{hbar(46,PINE,w=70,h=5)}<span class="num">98</span></div>
<div class="row">{ico("rd",12)}<span class="lbl">Reddit</span>{hbar(9,PINE,w=70,h=5)}<span class="num">18</span></div></div></div>
</div>'''
    brief = f'''<div class="tile hero" style="grid-column:span 7;grid-row:span 3;padding:18px 20px;gap:12px">
<div class="head"><span class="eyebrow">Executive brief · this update</span><span class="meta">Sun 16 Aug · read 1 min</span></div>
<div class="hl lg" style="max-width:560px">People are looking for prosthetic brands that pair inspiring progress with plain help on fit, use, and access.</div>
<div class="three" style="gap:16px;margin-top:2px">
<div><div class="val small" style="margin-bottom:4px">64 <span class="unit" style="color:rgba(245,241,230,.7)">conversations</span></div><div class="body">Resilience that inspires others is the thread the conversation keeps returning to — lived progress stories open consideration more than technical language.</div></div>
<div><div class="val small" style="margin-bottom:4px">85% <span class="unit" style="color:rgba(245,241,230,.7)">positive</span></div><div class="body">The emotional read is hope sitting beside pain, stigma and access friction — Össur needs to sound human and practical in the same breath.</div></div>
<div><div class="val small" style="margin-bottom:4px">5.8% <span class="unit" style="color:rgba(245,241,230,.7)">of tracked conversation</span></div><div class="body">Category education on access, daily use and device imagination is being set elsewhere before people reach Össur.</div></div>
</div>
<div class="quote" style="max-width:600px">“the $50,000 prosthetic that I was getting made cut off circulation and it hurt putting it on.. they said they wouldn’t remake it”<span class="who">TikTok · under a category video · one of 22 voices behind the top recommendation</span></div>
<div class="foot"><span class="pill" style="background:rgba(245,241,230,.12);color:#F5F1E6;box-shadow:0 0 0 1px rgba(245,241,230,.35)">The one thing to do → Launch a Fit Rescue program for the first 90 days</span><span>Read the full brief →</span></div>
</div>'''
    sentiment = f'''<div class="tile" style="grid-column:span 5;grid-row:span 1">
<div class="head"><span class="eyebrow">Audience sentiment</span><span class="meta">496 judged · this update</span></div>
<div class="row" style="gap:14px;align-items:flex-end"><div><span class="val big">85%</span><span class="unit"> positive</span></div><span class="delta up" style="margin-bottom:4px">+4 pt since last update</span></div>
{pbar([(85,POS),(9.5,OCHRE),(3.2,"#D9D2C2"),(2.2,NEG)])}
<div class="row" style="gap:12px;font-size:11px;color:#3F4B44"><span class="row" style="gap:4px"><span class="dot" style="background:{POS}"></span>Positive 422</span><span class="row" style="gap:4px"><span class="dot" style="background:{OCHRE}"></span>Mixed 47</span><span class="row" style="gap:4px"><span class="dot" style="background:#D9D2C2"></span>Neutral 16</span><span class="row" style="gap:4px"><span class="dot" style="background:{NEG}"></span>Negative 11</span></div>
</div>'''
    share = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">Share of tracked conversation</span><span class="meta">by videos · this update</span></div>
<div class="row" style="gap:18px;align-items:center;flex:1">{ring([(5.8,PINE),(16,CLAY),(78.2,"#D9D2C2")],size=132,thick=16,center="5.8%",sub="you")}
<div class="legend" style="flex:1">
<div class="row"><span class="dot" style="background:{PINE}"></span><span class="k">Össur</span><span class="v">5.8%</span><span class="delta up">+2.3 pt</span></div>
<div class="row"><span class="dot" style="background:{CLAY}"></span><span class="k">Ottobock</span><span class="v">16.0%</span><span class="delta down">+5.3 pt</span></div>
<div class="row"><span class="dot" style="background:#D9D2C2"></span><span class="k">Rest of the category</span><span class="v">78.2%</span><span class="delta">−7.6 pt</span></div>
<div class="sub" style="margin-top:6px">27 of your videos · 75 Ottobock · 366 category. Ottobock grew faster than you this week, mostly on TikTok.</div>
</div></div>
<div class="foot"><span>Where you stand vs Ottobock →</span><span class="note">share of tracked volume, not the whole web</span></div>
</div>'''
    th = [("Admiration for resilience and spirit","category",64,False),("Interest in owning a prosthesis","category",46,False),("Audience of amputees and survivors","category",46,False),("Excitement about prosthetic innovation","category",22,False),("Pain while wearing prosthetics","category",19,False),("Prosthetic cost and affordability","category",18,False),("Encouragement from the community","category",15,True),("Össur content inspires athletes","client",11,False)]
    rows = "".join(f'<div class="row"><span class="dot" style="background:{BUCKET[b]}"></span><span class="lbl">{l}</span>{NEW if new else ""}{hbar(n/64*100,BUCKET[b],w=110,h=6)}<span class="num b" style="width:24px;text-align:right">{n}</span></div>' for l,b,n,new in th)
    themes = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">What your market is talking about</span><span class="meta">conversations per theme</span></div>
<div class="list tight">{rows}</div>
<div class="foot"><span>All 120 confirmed themes →</span><span class="row" style="gap:8px;font-size:10.5px;color:#7A847A"><span class="row" style="gap:4px"><span class="dot" style="background:{POS}"></span>your audience</span><span class="row" style="gap:4px"><span class="dot" style="background:{SLATE}"></span>category</span><span class="row" style="gap:4px"><span class="dot" style="background:{CLAY}"></span>Ottobock’s</span></span></div>
</div>'''
    mv = [("Your share",[3.1,3.4,3.9,3.5,5.8],"5.8%","+2.3 pt",PINE,True),("Ottobock’s share",[9.2,9.8,10.1,10.7,16.0],"16%","+5.3 pt",CLAY,False),("Positive sentiment",[79,80,83,81,85],"85%","+4 pt",POS,True),("Conversations",[2100,2900,3600,5059,6163],"6.2K","+22%",PINE,True),("Themes confirmed",[62,74,88,104,120],"120","+16",SLATE,True)]
    mrows = "".join(f'<div class="row" style="gap:10px"><span class="lbl" style="font-size:12px;flex:1.3">{n}</span>{spark(p,w=104,h=22,color=c)}<span class="num b" style="width:38px;text-align:right">{v}</span><span class="delta {"up" if up else "down"}" style="width:48px;text-align:right">{d}</span></div>' for n,p,v,d,c,up in mv)
    movement = f'''<div class="tile" style="grid-column:span 4;grid-row:span 2">
<div class="head"><span class="eyebrow">Since your first update</span><span class="meta">5 updates · Jul 19 → Aug 16</span></div>
<div class="list" style="gap:9px;margin-top:2px">{mrows}</div>
<div class="foot"><span>Open movement →</span><span class="note">deltas vs last update</span></div>
</div>'''
    rec = f'''<div class="tile warm" style="grid-column:span 3;grid-row:span 1">
<div class="head"><span class="eyebrow">Top recommendation</span><span class="meta">high priority</span></div>
<div class="hl" style="font-size:13.5px">Launch an Össur Fit Rescue program for the first 90 days after delivery</div>
<div class="foot"><span>Why, and the voices (22) →</span>{chip("Strong evidence","#E3EEE3",PINE)}</div>
</div>'''
    acct = f'''<div class="tile" style="grid-column:span 3;grid-row:span 1">
<div class="head"><span class="eyebrow">On your accounts</span><span class="meta">followers</span></div>
<div class="list tight">
<div class="row">{ico("ig",12)}<span class="lbl">Instagram</span>{spark([58900,59400,60100,60400,61234],w=56,h=16)}<span class="num b">61.2K</span><span class="delta up">+1.4%</span></div>
<div class="row">{ico("tt",12)}<span class="lbl">TikTok</span>{spark([22100,22400,22900,23000,23263],w=56,h=16)}<span class="num b">23.3K</span><span class="delta up">+1.1%</span></div>
<div class="row">{ico("yt",12)}<span class="lbl">YouTube</span>{spark([12300,12350,12400,12450,12500],w=56,h=16)}<span class="num b">12.5K</span><span class="delta">+0.4%</span></div>
</div></div>'''
    return page("Dashboard","Dashboard","Össur · updated Sun 16 Aug · next update Sun 23 Aug 06:00",
        f'<span class="pill">Last 5 updates {ico("chev")}</span>',
        strip+brief+sentiment+share+themes+movement+rec+acct)

# ── bespoke compositions (round 2) ────────────────────────────────────────

def squarify(values, x, y, w, h):
    """Squarified treemap. values: list of areas (desc) summing to w*h. Returns rects in input order."""
    rects = []
    def worst(row, length):
        s = sum(row); mx = max(row); mn = min(row)
        return max(length*length*mx/(s*s), s*s/(length*length*mn))
    def layout(row, x, y, w, h):
        s = sum(row)
        if w >= h:
            rw = s/h; yy = y
            for r in row:
                rh = r/rw; rects.append((x, yy, rw, rh)); yy += rh
            return x+rw, y, w-rw, h
        else:
            rh = s/w; xx = x
            for r in row:
                rw = r/rh; rects.append((xx, y, rw, rh)); xx += rw
            return x, y+rh, w, h-rh
    row = []; vals = list(values)
    while vals:
        length = min(w, h) or 1
        v = vals[0]
        if not row or worst(row+[v], length) <= worst(row, length):
            row.append(v); vals.pop(0)
        else:
            x, y, w, h = layout(row, x, y, w, h); row = []
    if row: layout(row, x, y, w, h)
    return rects

TINT = {"client": ("#E3EEE3", POS), "category": ("#E4E8EF", SLATE), "competitor": ("#F3DFD5", CLAY)}
CATC = {"Praise":("#E3EEE3",PINE),"Purchase intent":("#E8E3EE","#5E3F6A"),"Demographic":("#E4E8EF","#3B5478"),"Pain point":("#F3DFD5","#8B3A22"),"Question":("#F6E7D2","#8A5A1B")}

# ── Market Intelligence: the decision ledger ──────────────────────────────
def market():
    PC = {"high":"#C99A3B","medium":"#A8B98C","low":"#D9D2C2"}
    recs = [("medium","Build an Össur Access Navigator with price framing, coverage steps and appeal support",18,"Cost and affordability · How to get one"),
            ("medium","Turn Össur’s soccer equity into goal-based mobility pathways with clinics and adaptive-sport partners",14,"Össur content inspires athletes · Interest in owning"),
            ("low","Make appearance and personalisation part of the product decision, not an afterthought",12,"Creative customisation · Realistic prosthetics"),
            ("low","Build a clinician-and-creator network for real-life adaptation stories",9,"Admiration for resilience · Encouragement")]
    rrows = "".join(f'''<div class="list" style="gap:3px;padding:9px 0;border-top:1px solid rgba(228,220,204,.8)">
<div class="row" style="gap:10px;align-items:flex-start"><span class="num b" style="width:14px;color:#9AA39A">{i+2}</span><span class="prio" style="background:{PC[p]};margin-top:6px"></span><span class="hl" style="font-size:13.5px;flex:1;font-weight:600">{t}</span><span class="num" style="flex:none">{n} conv.</span></div>
<div class="row" style="gap:8px;padding-left:31px"><span class="sub" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Grounded in {g}</span><span class="row" style="gap:4px;font-size:10.5px;color:#7A847A"><span class="pill" style="height:18px;padding:0 7px;font-size:10.5px">Acknowledge</span><span class="pill" style="height:18px;padding:0 7px;font-size:10.5px">Acted on</span></span></div>
</div>''' for i,(p,t,n,g) in enumerate(recs))
    agenda = f'''<div class="tile" style="grid-column:span 5;grid-row:span 6;padding:16px 18px;gap:0">
<div class="head" style="margin-bottom:10px"><span class="eyebrow">What to do · this update</span><span class="meta">5 recommendations · ordered by evidence</span></div>
<div class="list" style="gap:6px;padding-bottom:12px">
<div class="row" style="gap:10px;align-items:flex-start"><span class="num b" style="width:14px;color:#9AA39A">1</span><span class="prio" style="background:{PC["high"]};margin-top:7px"></span><span class="hl" style="font-size:17px;line-height:1.25;flex:1">Launch an Össur Fit Rescue program for the first 90 days after delivery</span></div>
<div style="padding-left:31px" class="list">
<div class="row" style="gap:4px">{chip("High priority","#F6E7D2","#8A5A1B")}{chip("Strong evidence","#E3EEE3",PINE)}{chip("22 conversations",SAND,"#5F6B5E")}</div>
<div class="body">People are trying to work out whether pain, sweating, skin breakdown, sleeve movement or end-of-day fatigue comes from socket fit, liner choice, alignment or normal adaptation. When Össur leaves that question to the clinic, the category answers it instead — and the answer is often “live with it”.</div>
<div class="quote">“the $50,000 prosthetic that I was getting made cut off circulation and it hurt putting it on.. they said they wouldn’t remake it”<span class="who">TikTok · category video · one of 22</span></div>
<div class="row" style="gap:10px;font-size:11px;font-weight:500;color:{PINE}"><span>See the voices (22) →</span><span class="pill" style="height:20px;padding:0 8px;font-size:10.5px">Acknowledge</span><span class="pill" style="height:20px;padding:0 8px;font-size:10.5px">Mark acted on</span></div>
</div></div>
{rrows}
<div class="foot" style="padding-top:8px"><span>All recommendations, incl. dismissed →</span><span class="row" style="gap:8px;font-size:10.5px;color:#7A847A"><span class="row" style="gap:4px"><span class="prio" style="background:{PC["high"]}"></span>high</span><span class="row" style="gap:4px"><span class="prio" style="background:{PC["medium"]}"></span>medium</span><span class="row" style="gap:4px"><span class="prio" style="background:{PC["low"]}"></span>low</span></span></div>
</div>'''
    def quad(title, items, chipc):
        li = "".join(f'<div class="row" style="align-items:flex-start;gap:7px"><span class="dot" style="background:{chipc};margin-top:6px"></span><span class="body" style="font-size:11.5px">{i}</span></div>' for i in items)
        return f'<div class="list" style="gap:4px;padding:8px 12px"><span class="eyebrow" style="color:{chipc}">{title}</span>{li}</div>'
    short = f'''<div class="tile" style="grid-column:span 7;grid-row:span 2;padding:0;gap:0">
<div class="head" style="padding:12px 14px 6px"><span class="eyebrow">The short read</span><span class="meta">what the market is telling Össur · from 6,163 conversations</span></div>
<div style="display:grid;grid-template-columns:1fr 1fr;flex:1;border-top:1px solid rgba(228,220,204,.8)">
<div style="border-right:1px solid rgba(228,220,204,.8);border-bottom:1px solid rgba(228,220,204,.8)">{quad("Unmet needs",["Plain help on fit in the first weeks — socket, liner, alignment or adaptation?","A legible path through price, coverage and appeals."],"#8B3A22")}</div>
<div style="border-bottom:1px solid rgba(228,220,204,.8)">{quad("Buying triggers",["Proof that someone like them reached a workable outcome.","Clear contact points and human explanations, not spec sheets."],PINE)}</div>
<div style="border-right:1px solid rgba(228,220,204,.8)">{quad("Who stands out",["Ottobock — design-led desire, “freedom” before specs.","Prosthetist channels explaining ProFlex plainly."],"#3B5478")}</div>
<div>{quad("Threats to watch",["Price and access frustration narrated outside Össur.","A lighter presence lets others define affordability."],"#8A5A1B")}</div>
</div></div>'''
    V = {"echo":("Echoed","#E3EEE3",PINE),"push":("Pushed back","#F3DFD5","#8B3A22"),"silent":("Not talked about",SAND,"#5F6B5E")}
    claims = [("“Built for the demands of sport”","echo","“Straight legs give you no wiggle on the board, they make floats… to keep you stable.”"),
              ("“Comfort you stop thinking about”","push","“end-of-day fatigue is real. Nobody tells you about the sweat.”"),
              ("“Trusted by clinicians worldwide”","echo","“my prosthetist swears by the Pro-Flex”"),
              ("“Easy to get started with Össur”","silent","— nobody in the tracked conversation mentions getting started")]
    crows = "".join(f'''<div style="display:grid;grid-template-columns:1fr 118px 1.3fr;gap:10px;align-items:center;padding:5px 0;border-top:1px solid rgba(228,220,204,.7)">
<span class="body" style="font-size:12px;font-weight:600">{c}</span><div style="text-align:center">{chip(*V[v])}</div><span class="{'quote' if v!='silent' else 'sub'}" style="font-size:12px">{q}</span></div>''' for c,v,q in claims)
    svh = f'''<div class="tile" style="grid-column:span 7;grid-row:span 2;gap:4px">
<div class="head"><span class="eyebrow">What you say vs what they hear</span><span class="meta">13 claims from your own videos · 3 echoed · 2 pushed back · 8 silent</span></div>
<div style="display:grid;grid-template-columns:1fr 118px 1.3fr;gap:10px;font-size:10.5px;color:#7A847A;font-weight:600;letter-spacing:.05em;text-transform:uppercase"><span>You say</span><span style="text-align:center">Verdict</span><span>They hear</span></div>
<div class="list" style="gap:0">{crows}</div>
<div class="foot"><span>All 13 claims →</span><span class="note">your claims come from your own video transcripts; their side from comments on category videos</span></div></div>'''
    ins = f'''<div class="tile" style="grid-column:span 4;grid-row:span 2">
<div class="head"><span class="eyebrow">Key insights</span><span class="row" style="gap:4px">{chip("6 confirmed","#E3EEE3",PINE)}{chip("4 early","#F6E7D2","#8A5A1B")}</span></div>
<div class="list divided" style="gap:6px">
<div class="list" style="gap:2px"><span class="hl" style="font-size:13px">Pricing talk has a different emotional tone around Össur</span><span class="sub">An information request near you; a fight near Ottobock and the category · 20 conversations</span></div>
<div class="list" style="gap:2px"><span class="hl" style="font-size:13px">Inspiration opens the door; practical answers close the sale</span><span class="sub">Progress stories earn attention, then people ask how it works, costs and fits · 46</span></div>
</div><div class="foot"><span>All 10 findings →</span><span class="note">4 early signals in the drawer</span></div></div>'''
    about = f'''<div class="tile" style="grid-column:span 3;grid-row:span 1">
<div class="head"><span class="eyebrow">Said about you</span><span class="meta">10 videos</span></div>
<div class="quote" style="font-size:12px">“ProFlex LP is compatible with the Unity Vacuum System from Össur…”<span class="who">McMorris Prosthetic Services · YouTube</span></div>
<div class="foot"><span>All 10 →</span></div></div>'''
    news = f'''<div class="tile" style="grid-column:span 3;grid-row:span 1">
<div class="head"><span class="eyebrow">In the news</span><span class="meta">8 · context, not cause</span></div>
<div class="row" style="gap:8px;align-items:flex-start">{chip("Ottobock","#F3DFD5","#8B3A22")}<span class="body" style="font-size:12px">Ottobock × Zalando adaptive fashion line announced for Q4.</span></div>
<div class="foot"><span>7 more →</span></div></div>'''
    brand = f'''<div class="tile" style="grid-column:span 6;grid-row:span 1">
<div class="head"><span class="eyebrow">Brand-side voice this update</span><span class="meta">who is doing the talking</span></div>
{pbar([(26,PINE),(10,"#7C9A6B"),(142,CLAY)],h=10)}
<div class="row" style="gap:14px;font-size:11.5px;color:#3F4B44"><span class="row" style="gap:5px"><span class="dot" style="background:{PINE}"></span>You 26 videos</span><span class="row" style="gap:5px"><span class="dot" style="background:#7C9A6B"></span>Others about you 10</span><span class="row" style="gap:5px"><span class="dot" style="background:{CLAY}"></span>Ottobock 142</span><span class="sub" style="margin-left:auto">Ottobock out-publishes you 5 to 1</span></div></div>'''
    return page("Market Intelligence","Market Intelligence","What should we do? · Össur · Sun 16 Aug",
        f'<span class="pill">This update {ico("chev")}</span><span class="pill">Status: open {ico("chev")}</span>',
        agenda+short+svh+ins+about+news)

# ── Voice of Customer: the theme map ───────────────────────────────────────
def voice():
    TH = [("Admiration for resilience and spirit","category","Praise",64,[40,48,52,60,64],False),("Interest in owning a prosthesis","category","Purchase intent",46,[20,24,30,41,46],False),("Audience of amputees and survivors","category","Demographic",46,[30,33,40,44,46],False),("Excitement about prosthetic innovation","category","Praise",22,[26,30,28,27,22],False),("Pain while wearing prosthetics","category","Pain point",19,[8,10,12,15,19],False),("Prosthetic cost and affordability","category","Question",18,[6,7,9,11,18],False),("How the prosthetic works","category","Question",16,[12,13,13,15,16],False),("Realistic prosthetics and confidence","category","Praise",15,None,False),("Encouragement from the community","category","Praise",15,None,True),("Heroism and personal resilience","competitor","Praise",14,None,True),("Socket fit and limb changes","category","Pain point",12,[5,6,8,8,12],False),("Creative customisation ideas","category","Praise",12,None,False),("Össur content inspires athletes","client","Praise",11,[9,9,10,10,11],False)]
    W,H = 708,372
    total = sum(t[3] for t in TH); areas = [t[3]/total*W*H for t in TH]
    rects = squarify(areas, 0, 0, W, H)
    blocks = []
    for (l,b,c,n,p,new),(x,y,w,h) in zip(TH,rects):
        bg,fg = TINT[b]; big = w>150 and h>70; mid = w>95 and h>48
        fs = 13 if big else (11.5 if mid else 10.5)
        lab = f'<div style="font-weight:600;font-size:{fs}px;line-height:1.2;color:{INK};overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:{3 if big else 2};-webkit-box-orient:vertical">{l}</div>'
        cnt = f'<div class="row" style="gap:6px;margin-top:auto"><span class="num b" style="font-size:{15 if big else 12}px">{n}</span>{chip(c,*CATC[c]) if big else ""}{NEW if (new and mid) else ""}{spark(p,w=54,h=14,color=fg,end=False) if (big and p) else ""}</div>'
        blocks.append(f'<div style="position:absolute;left:{x+2.5:.1f}px;top:{y+2.5:.1f}px;width:{w-5:.1f}px;height:{h-5:.1f}px;background:{bg};border-radius:6px;padding:{8 if mid else 5}px {9 if mid else 6}px;display:flex;flex-direction:column;gap:3px;overflow:hidden;box-shadow:0 0 0 1px {fg}">{lab}{cnt}</div>')
    themap = f'''<div class="tile" style="grid-column:span 8;grid-row:span 4;gap:6px">
<div class="head"><span class="eyebrow">The conversation, by theme</span><span class="meta">120 confirmed · 45 early · 181 heard once · block size = conversations this update</span></div>
<div class="tabs"><span class="on">All<b>120</b></span><span>Pain points<b>18</b></span><span>Questions<b>22</b></span><span>Praise<b>41</b></span><span>Purchase intent<b>9</b></span><span>Demographic<b>6</b></span><span>Switching<b>3</b></span><span class="meta" style="margin-left:auto;padding:2px 0">Journey: any {ico("chev")}</span></div>
<div style="position:relative;width:{W}px;height:{H}px;margin-top:4px">{"".join(blocks)}</div>
<div class="foot"><span>All 120 themes as a list → <span class="note" style="margin-left:8px">top 13 shown · click a block to hear its voices</span></span><span class="row" style="gap:10px;font-size:10.5px;color:#7A847A"><span class="row" style="gap:4px"><span class="dot" style="background:{POS}"></span>your audience</span><span class="row" style="gap:4px"><span class="dot" style="background:{SLATE}"></span>wider category</span><span class="row" style="gap:4px"><span class="dot" style="background:{CLAY}"></span>Ottobock’s</span></span></div></div>'''
    movers = f'''<div class="tile" style="grid-column:span 4;grid-row:span 2">
<div class="head"><span class="eyebrow">Gaining and fading</span><span class="meta">vs last update</span></div>
<div class="list divided" style="gap:6px">
<div class="row"><span class="delta up" style="width:28px">▲ 7</span><span class="lbl">Prosthetic cost and affordability</span>{spark([6,7,9,11,18],w=52,h=16,color=POS)}</div>
<div class="row"><span class="delta up" style="width:28px">▲ 4</span><span class="lbl">Socket fit and limb changes</span>{spark([5,6,8,8,12],w=52,h=16,color=POS)}</div>
<div class="row"><span class="delta down" style="width:28px">▼ 5</span><span class="lbl">Excitement about prosthetic innovation</span>{spark([26,30,28,27,22],w=52,h=16,color=CLAY)}</div>
<div class="row"><span class="delta down" style="width:28px">▼ 3</span><span class="lbl">Creative customisation ideas</span>{spark([14,15,15,15,12],w=52,h=16,color=CLAY)}</div>
<div class="row">{chip("New","#E3EEE3",PINE)}<span class="lbl">Encouragement from the community</span><span class="num">15</span></div>
<div class="row">{chip("New","#F3DFD5","#8B3A22")}<span class="lbl">Heroism and personal resilience · Ottobock’s</span><span class="num">14</span></div>
</div>
<div class="foot"><span>All movers →</span><span class="note">themes heard in ≥2 updates</span></div></div>'''
    lang = f'''<div class="tile" style="grid-column:span 4;grid-row:span 1">
<div class="head"><span class="eyebrow">How your customers talk</span><span class="meta">24 phrases</span></div>
<div class="chips">{"".join(chip(t,SAND,"#3F4B44") for t in ["end-of-day fatigue","socket fit","running blade","insurance fight","the light-up one","ply socks"])}</div>
<div class="foot"><span>Borrow the language →</span></div></div>'''
    mood = f'''<div class="tile" style="grid-column:span 4;grid-row:span 1">
<div class="head"><span class="eyebrow">Audience mood</span><span class="meta">top emotions</span></div>
<div class="list tight">
<div class="row"><span class="lbl">Hope</span>{hbar(100,POS,w=120,h=6)}<span class="num b">38%</span></div>
<div class="row"><span class="lbl">Frustration</span>{hbar(58,CLAY,w=120,h=6)}<span class="num b">22%</span></div>
<div class="row"><span class="lbl">Pride</span>{hbar(50,POS,w=120,h=6)}<span class="num b">19%</span></div>
</div></div>'''
    QS = [("Pain while wearing prosthetics","#F3DFD5","#8B3A22","the $50,000 prosthetic that I was getting made cut off circulation and it hurt putting it on.. they said they wouldn’t remake it","TikTok · 1.2K likes"),
          ("Prosthetic cost and affordability","#F6E7D2","#8A5A1B","fought for 4 years to get a new leg, I lost 37 lbs and was up to 18 ply socks and couldn’t walk normally before my insurance relented","YouTube"),
          ("Össur content inspires athletes","#E3EEE3",PINE,"You are really awesome congrats to you Way to go Kickin arse taken names unstoppable","Instagram · your post"),
          ("Encouragement from the community","#E3EEE3",PINE,"I have a below knee amputation was taken from me when I was 20 I’m 26 now and it never gets easier good too see someone being positive","TikTok"),
          ("Socket fit and limb changes","#F3DFD5","#8B3A22","Stairs definitely suck but I’m getting better at them","Instagram")]
    qcards = "".join(f'<div class="list" style="gap:6px;flex:1;min-width:0;padding:0 12px;border-left:1px solid rgba(228,220,204,.8)">{chip(t,bg,fg)}<div class="quote" style="font-size:12.5px">“{q}”<span class="who">{w}</span></div></div>' for t,bg,fg,q,w in QS)
    voices = f'''<div class="tile" style="grid-column:span 12;grid-row:span 2">
<div class="head"><span class="eyebrow">Hear these voices</span><span class="meta">5 of 6,163 · rotates on every visit · verbatim, unedited — a clay rule means a real person said this</span></div>
<div class="row" style="align-items:stretch;gap:0;margin-left:-12px;flex:1">{qcards}</div>
<div class="foot"><span>Next five →</span><span class="note">language samples and early signals (45) live in the drawer</span></div></div>'''
    return page("Voice of Customer","Voice of Customer","What are they saying? · Sun 16 Aug",
        f'<span class="pill on">All audiences</span><span class="pill">Yours <b class="mono" style="font-weight:500;color:#7A847A">11</b></span><span class="pill">Ottobock’s <b class="mono" style="font-weight:500;color:#7A847A">14</b></span><span class="pill">Category <b class="mono" style="font-weight:500;color:#7A847A">95</b></span>',
        themap+movers+lang+mood+voices)

# ── Competitive: the face-off ──────────────────────────────────────────────
def competitive():
    def face(label, a, b, fa, fb, unit=""):
        mx = max(a,b) or 1
        return f'''<div style="display:grid;grid-template-columns:1fr 150px 1fr;gap:10px;align-items:center;padding:3px 0">
<div class="row" style="justify-content:flex-end;gap:8px"><span class="num b" style="font-size:12.5px">{fa}</span>{hbar(100,PINE,w=int(170*a/mx) or 2,h=10)}</div>
<div style="text-align:center;font-size:11.5px;color:#3F4B44;font-weight:500">{label}</div>
<div class="row" style="gap:8px">{hbar(100,CLAY,w=int(170*b/mx) or 2,h=10)}<span class="num b" style="font-size:12.5px">{fb}</span></div></div>'''
    rows = face("Videos this update",27,75,"27","75") + face("Comments under them",410,1180,"410","1,180") + face("Share of tracked conversation",5.8,16,"5.8%","16%") + face("Engagement per video",4.1,3.2,"4.1%","3.2%") + face("Positive sentiment",88,81,"88%","81%") + face("Themes owned",11,14,"11","14")
    faceoff = f'''<div class="tile" style="grid-column:span 12;grid-row:span 2;gap:4px;padding:12px 18px">
<div style="display:grid;grid-template-columns:1fr 150px 1fr;gap:10px;align-items:end">
<div class="list" style="gap:2px;align-items:flex-end;text-align:right"><span class="eyebrow" style="color:{PINE}">Össur · you</span><span class="hl" style="font-size:13px;font-weight:500;color:#2B3A31">Praised for quality, trust and authentic prosthetic work</span></div>
<div style="text-align:center"><span class="eyebrow">This update</span></div>
<div class="list" style="gap:2px"><span class="eyebrow" style="color:{CLAY}">Ottobock</span><span class="hl" style="font-size:13px;font-weight:500;color:#2B3A31">Praised for devices that look good and braces that restore freedom</span></div>
</div>
<div style="margin-top:4px">{rows}</div>
<div class="foot"><span>Full comparison, incl. the wider category (366 videos · 78%) →</span><span class="note">both brands grew share this update; Ottobock’s jump is 19 extra TikToks, 14 from one creator</span></div></div>'''
    chart = f'''<div class="tile" style="grid-column:span 7;grid-row:span 4;gap:6px">
<div class="head"><span class="eyebrow">Share of tracked conversation over time</span><span class="meta">by videos · 5 updates · rest of the category not drawn</span></div>
{linechart([("Össur",[3.1,3.4,3.9,3.5,5.8],PINE),("Ottobock",[9.2,9.8,10.1,10.7,16.0],CLAY)],w=620,h=290,labels=["19 Jul","26 Jul","2 Aug","9 Aug","16 Aug"],ylab=lambda v: f"{v:.0f}%",pad_r=100)}
<div class="foot"><span>Why Ottobock moved this week →</span><span class="note">share of tracked volume, not web share of voice</span></div></div>'''
    def finding(kind, kc, title, text, cov, quote=None):
        q = f'<div class="quote" style="font-size:11.5px">{quote}</div>' if quote else ""
        return f'<div class="list" style="gap:4px;padding:8px 0;border-top:1px solid rgba(228,220,204,.7)"><div class="row" style="gap:6px">{chip(kind,*kc)}<span class="meta">{cov}</span></div><div class="hl" style="font-size:13px">{title}</div><div class="body" style="font-size:11.5px">{text}</div>{q}</div>'
    findings = f'''<div class="tile" style="grid-column:span 5;grid-row:span 4;gap:0">
<div class="head" style="margin-bottom:2px"><span class="eyebrow">What the voices say about the match-up</span><span class="meta">5 findings</span></div>
<div class="list" style="gap:0;overflow:hidden">
{finding("Where you lead",("#E3EEE3",PINE),"Sport-specific mobility stories are an Össur lane","You are tied to soccer-centred progress; Ottobock and the category frame movement through rehab courage and running milestones.","11 comments")}
{finding("Threat",("#F3DFD5","#8B3A22"),"Ottobock is building product desire around design and freedom","Their praise is about how devices look and the freedom a brace gives back; yours is about trust.","8 comments · thin","“I love the light up one😍”")}
{finding("Content gap",("#F6E7D2","#8A5A1B"),"Insurance and access navigation is missing from your public education","Insurance fights and system barriers are narrated under Ottobock and the category; under you, questions stop at “how much”.","18 comments")}
{finding("Switching",("#E8E3EE","#5E3F6A"),"2 signals: one towards you, one away","“my clinic is moving me off the Ottobock foot to the Pro-Flex” · “tried Össur liners, went back — sweat”","cross-mentions: 6")}
</div>
<div class="foot" style="padding-top:6px"><span>All 5 findings + the pricing-tone differential →</span></div></div>'''
    return page("Competitive Intel","Competitive Intelligence","Where do we stand vs Ottobock? · Össur · Sun 16 Aug",
        f'<span class="pill">vs Ottobock {ico("chev")}</span><span class="pill">Last 5 updates {ico("chev")}</span>', faceoff+chart+findings)

# ── Content: the reply inbox + playbook ───────────────────────────────────
def content():
    R = [("Buying signal",("#E8E3EE","#5E3F6A"),"Where can I get the running blade fitted in Texas? My clinic only does Ottobock.","TikTok","2d","under a category video · 1.2K likes on the video"),
         ("Question",("#F6E7D2","#8A5A1B"),"Does the Pro-Flex work with the Unity vacuum or do I need a different liner?","YouTube","3d","under McMorris Prosthetic Services"),
         ("Question",("#F6E7D2","#8A5A1B"),"how do you wash your hair?","Instagram","4d","under your post · 41 likes"),
         ("Buying signal",("#E8E3EE","#5E3F6A"),"I have one of these! I got it for getting around after a foot surgery. It takes a little getting used to.","Instagram","5d","under your post"),
         ("Question",("#F6E7D2","#8A5A1B"),"yo cuánto cuesta? do I need to pay for the foot?","TikTok","5d","under a category video · Spanish"),
         ("Misinformation",("#F3DFD5","#8B3A22"),"these are free if you ask the VA, nobody pays","YouTube","6d","awareness only — never a reply prompt")]
    rrows = "".join(f'''<div style="display:grid;grid-template-columns:108px 1fr 150px 58px;gap:10px;align-items:start;padding:8px 0;border-top:1px solid rgba(228,220,204,.7)">
{chip(k,*kc)}<div class="list" style="gap:2px"><div class="quote" style="font-size:12.5px">“{q}”</div><span class="sub">{ctx}</span></div><span class="meta" style="padding-top:2px">{p} · {d}</span><span style="font-size:11px;font-weight:500;color:{PINE};text-align:right;padding-top:2px">Reply →</span></div>''' for k,kc,q,p,d,ctx in R)
    inbox = f'''<div class="tile" style="grid-column:span 7;grid-row:span 4;gap:4px">
<div class="head"><span class="eyebrow">Worth a reply</span><span class="meta">13 this week · evidence only · intent first</span></div>
<div class="row" style="gap:4px;margin:2px 0 4px">{chip("All 13","#E3EEE3",PINE)}{chip("Buying signals 4",SAND,"#3F4B44")}{chip("Questions 7",SAND,"#3F4B44")}{chip("Misinformation 2",SAND,"#3F4B44")}<span class="meta" style="margin-left:auto">sorted by intent, then recency</span></div>
<div class="list" style="gap:0;overflow:hidden">{rrows}</div>
<div class="foot"><span>7 more →</span><span class="note">replies are written by you; Verbatim only finds the moments</span></div></div>'''
    play = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2;gap:6px">
<div class="head"><span class="eyebrow">What works right now</span><span class="meta">engagement vs median · this update</span></div>
<div class="two" style="gap:14px">
<div class="list tight" style="gap:5px"><span class="eyebrow" style="font-size:10px">Hooks</span>
{"".join(f'<div class="row"><span class="lbl" style="font-size:12px">{l}</span>{hbar(p,PINE,w=70,h=5)}<span class="num b" style="width:30px;text-align:right">{v}</span></div>' for l,p,v in [("Before / after",100,"2.4×"),("Direct question",75,"1.8×"),("Shock stat",62,"1.5×"),("Face to camera",50,"1.2×"),("Trend sound",30,"0.7×")])}</div>
<div class="list tight" style="gap:5px"><span class="eyebrow" style="font-size:10px">Formats</span>
{"".join(f'<div class="row"><span class="lbl" style="font-size:12px">{l}</span>{hbar(p,PINE,w=70,h=5)}<span class="num b" style="width:30px;text-align:right">{v}</span></div>' for l,p,v in [("Day-in-the-life",100,"1.9×"),("Clinic / fitting",84,"1.6×"),("Sport clip",74,"1.4×"),("Explainer",58,"1.1×"),("Brand ad",26,"0.5×")])}</div>
</div>
<div class="list" style="gap:4px;margin-top:2px"><div class="row" style="gap:8px"><span class="val small" style="white-space:nowrap;width:82px">15–30 s</span><span class="sub">earns 2.1× the engagement of 60 s+ · 212 videos</span></div><div class="row" style="gap:8px"><span class="val small" style="width:82px">14</span><span class="sub">videos on the “Built for the day” original sound · gaining</span></div></div>
<div class="foot"><span>Playbooks side by side →</span></div></div>'''
    field = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">The field this update</span><span class="meta">468 videos · 405 analysed</span></div>
<table class="t"><tr><th>Who</th><th class="n">Videos</th><th class="n">Views</th><th>Engagement</th></tr>
<tr><td><span class="row" style="gap:6px"><span class="dot" style="background:{PINE}"></span>Össur</span></td><td class="n">27</td><td class="n">129K</td><td><span class="row" style="gap:6px">{hbar(62,PINE,w=70,h=5)}<span class="num">4.1%</span></span></td></tr>
<tr><td><span class="row" style="gap:6px"><span class="dot" style="background:{CLAY}"></span>Ottobock</span></td><td class="n">75</td><td class="n">73K</td><td><span class="row" style="gap:6px">{hbar(48,CLAY,w=70,h=5)}<span class="num">3.2%</span></span></td></tr>
<tr><td><span class="row" style="gap:6px"><span class="dot" style="background:{SLATE}"></span>Category creators</span></td><td class="n">366</td><td class="n">18.2M</td><td><span class="row" style="gap:6px">{hbar(100,SLATE,w=70,h=5)}<span class="num">6.6%</span></span></td></tr></table>
<div class="sub">You out-engage Ottobock per video but post a third as often; creators own reach.</div>
<div class="foot"><span>All 468 videos →</span></div></div>'''
    voices = f'''<div class="tile" style="grid-column:span 7;grid-row:span 2">
<div class="head"><span class="eyebrow">Top voices this update</span><span class="meta">by views · who shapes the conversation</span></div>
<div class="list divided" style="gap:3px;line-height:1.3">
{"".join(f'<div class="row" style="gap:10px"><span class="av" style="background:{c}">{i}</span><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12.5px">{h} <span class="sub">· {r} · {t}</span></div></div>{hbar(p,c,w=90,h=5)}<span class="num b" style="width:44px;text-align:right">{v}</span></div>' for i,h,r,t,v,p,c in [("AC","@amputee.coach","creator","daily-life tips · 6 videos this update","1.2M",100,SLATE),("OB","@ottobock","competitor","hero-athlete films · 9 videos","410K",34,CLAY),("RB","@runningblade.life","creator","sport · 4 videos","380K",32,SLATE),("ÖS","@ossur","you","3 videos","129K",11,PINE)])}
</div>
<div class="foot"><span>All voices →</span></div></div>'''
    accounts = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">On your accounts</span><span class="meta">followers · daily · 30 days</span></div>
<div class="list" style="gap:6px">
<div class="row" style="gap:10px">{ico("ig",14)}<div style="flex:1">{spark([58900,59000,59200,59400,59500,60100,60300,60400,60900,61234],w=200,h=24,fill=True)}</div><div style="text-align:right;min-width:96px"><div class="num b">61.2K</div><span class="delta up" style="white-space:nowrap">+1,240 · explained</span></div></div>
<div class="row" style="gap:10px">{ico("tt",14)}<div style="flex:1">{spark([22100,22200,22400,22500,22900,22950,23000,23100,23200,23263],w=200,h=24,fill=True)}</div><div style="text-align:right;min-width:96px"><div class="num b">23.3K</div><span class="delta up">+260</span></div></div>
<div class="row" style="gap:10px">{ico("yt",14)}<div style="flex:1">{spark([12300,12320,12350,12380,12400,12420,12450,12470,12490,12500],w=200,h=24,fill=True)}</div><div style="text-align:right;min-width:96px"><div class="num b">12.5K</div><span class="delta">+50</span></div></div>
</div>
<div class="row" style="gap:8px;align-items:flex-start"><span class="dot" style="background:{WARN};margin-top:5px"></span><span class="body" style="font-size:11.5px">Instagram jump on 11 Aug lines up with the running-blade reel — 3 themes behind it.</span></div></div>'''
    return page("Content","Content","What content works, and who to answer? · Össur · Sun 16 Aug",
        f'<span class="pill">This update {ico("chev")}</span><span class="pill">All platforms {ico("chev")}</span>', inbox+play+field+voices+accounts)

# ── page 8: System sheet ───────────────────────────────────────────────────
def system():
    sw = lambda c,n,h: f'<div class="list" style="gap:4px;align-items:center"><span style="width:36px;height:36px;border-radius:9px;background:{c};box-shadow:0 0 0 1px rgba(0,0,0,.06)"></span><span style="font-size:11px;font-weight:600">{n}</span><span class="mono" style="font-size:10px;color:#7A847A">{h}</span></div>'
    swatches = "".join(sw(c,n,c) for c,n in [(CREAM,"Canvas"),(CARD,"Tile"),(INK,"Ink"),(PINE,"Pine"),("#FCF9F1","Sidebar"),(POS,"Positive / you"),(SLATE,"Category"),(CLAY,"Competitor · evidence"),(OCHRE,"Mixed / early"),(NEG,"Negative"),(SAND,"Sand"),("#D9D2C2","Rest")])
    tokens = f'''<div class="tile" style="grid-column:span 7;grid-row:span 2">
<div class="head"><span class="eyebrow">Colour — unchanged tokens, new jobs</span><span class="meta">app/globals.css</span></div>
<div class="row" style="gap:14px;flex-wrap:wrap">{swatches}</div>
<div class="sub">Green = you / good / interactive · slate = wider category · clay = Ottobock <i>and</i> the verbatim rule · ochre = mixed / early · rest-of-field is sand, so the thing that matters is the only colour.</div></div>'''
    type_ = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">Type scale · ratio 1.2 · base 13</span><span class="meta">Plus Jakarta Sans + JetBrains Mono</span></div>
<div class="list" style="gap:5px">
<div class="row"><span class="hl lg" style="flex:1">Hero headline 19 / 600</span><span class="meta">brief, featured rec</span></div>
<div class="row"><span class="hl" style="flex:1">Finding headline 15 / 600</span><span class="meta">tiles</span></div>
<div class="row"><span class="body" style="flex:1">Body 12.5 / 400 / 1.45 — the reasoning, two lines max before “open”</span><span class="meta">tiles</span></div>
<div class="row"><span class="eyebrow" style="flex:1">Eyebrow 10.5 / 600 / caps / .07em</span><span class="meta">tile titles</span></div>
<div class="row"><span class="sub" style="flex:1">Sub / meta 11 / 400 muted</span><span class="meta">context</span></div>
<div class="row"><span class="val" style="flex:1">6,163 <span class="unit">mono 24 / 600 tabular</span></span><span class="meta">counts</span></div>
<div class="row"><span class="delta up" style="flex:1">+22% vs last update · mono 11</span><span class="meta">deltas</span></div>
</div></div>'''
    vocab = f'''<div class="tile" style="grid-column:span 7;grid-row:span 2">
<div class="head"><span class="eyebrow">Grid · 12 × 6 of 116 px · 16 px gap · 1440×900</span><span class="meta">≤ 9 tiles a page · one hero · every page its own shape</span></div>
<div style="display:grid;grid-template-columns:repeat(12,1fr);grid-template-rows:repeat(4,28px);gap:4px;flex:1">
<div style="grid-column:span 12;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">Strip 12×1 — the page’s counted receipts (5 cells)</div>
<div style="grid-column:span 7;grid-row:span 2;background:{PINE};color:#fff;border-radius:4px;font-size:10px;padding:2px 6px">Hero 7×2–3 — the one thing to read (dark on Dashboard only)</div>
<div style="grid-column:span 5;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">W 5×1 — stat + proportion</div>
<div style="grid-column:span 5;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">W 5×2 — ring / list</div>
<div style="grid-column:span 4;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">M 4×1–2 — chart, finding</div>
<div style="grid-column:span 3;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">S 3×1 — one fact</div>
<div style="grid-column:span 3;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">S 3×2 — short list</div>
<div style="grid-column:span 2;background:{SAND};border-radius:4px;font-size:10px;padding:2px 6px">—</div>
</div>
<div class="sub">Same grid, same tile anatomy (eyebrow + meta · content · footer → drawer) — but each page composes it differently: Dashboard = strip + dark brief + supports · Market = a tall agenda of recommendations + evidence panels · Voice = a theme map + movers + a quote ribbon · Competitive = a face-off + the share line + findings · Content = a reply inbox + playbook. Below 1280 px everything stacks in importance order and scrolls.</div></div>'''
    charts = f'''<div class="tile" style="grid-column:span 5;grid-row:span 2">
<div class="head"><span class="eyebrow">Chart primitives · all server-rendered SVG</span><span class="meta">components/charts/</span></div>
<div class="two" style="gap:12px">
<div class="list" style="gap:8px">
<div class="row"><span class="lbl" style="font-size:11.5px">Stat + sparkline</span><span class="val small">468</span>{spark([312,340,398,521,468],w=70,h=20,fill=True)}</div>
<div class="list" style="gap:3px"><span class="lbl" style="font-size:11.5px">Proportion bar</span>{pbar([(85,POS),(9.5,OCHRE),(3.2,"#D9D2C2"),(2.2,NEG)])}</div>
<div class="row"><span class="lbl" style="font-size:11.5px">Ranked bar</span>{hbar(72,SLATE,w=90,h=6)}<span class="num b">46</span></div>
<div class="row"><span class="lbl" style="font-size:11.5px">Mover</span><span class="delta up">▲ 7</span>{spark([6,7,9,11,18],w=56,h=16,color=POS)}</div>
</div>
<div class="row" style="gap:10px;align-items:center">{ring([(5.8,PINE),(16,CLAY),(78.2,"#D9D2C2")],size=84,thick=11,center="5.8%")}<div class="sub">Ring — share only, ≤ 4 slices, centre = your number. The one place a circle is allowed.</div></div>
</div>
<div class="sub">Lines for “over time” with end labels, no legend box. Counts of real voices are shown in full; model confidence is never a number — it gates and orders.</div></div>'''
    rules = f'''<div class="tile" style="grid-column:span 12;grid-row:span 2">
<div class="head"><span class="eyebrow">Rules the pages were built to</span></div>
<div class="three" style="gap:20px">
<div class="list" style="gap:6px"><div class="hl" style="font-size:13px">1 · One screen, one question</div><div class="body" style="font-size:12px">Each page answers its client question inside 1440×900. Depth is one click away in a right-hand drawer; nothing important lives below the fold because there is no fold.</div><div class="hl" style="font-size:13px">2 · Size encodes importance — and every page has its own shape</div><div class="body" style="font-size:12px">One hero a page; the eye lands on it first. Equal-size grids are banned, and so is the same layout twice: the composition comes from the page’s content.</div></div>
<div class="list" style="gap:6px"><div class="hl" style="font-size:13px">3 · Numbers are voices, not scores</div><div class="body" style="font-size:12px">Terms tracked, videos, comments, themes, share, sentiment split — shown big, in mono, with movement. Model confidence stays a word (Strong evidence / Early signal).</div><div class="hl" style="font-size:13px">4 · Trends live where they are relevant</div><div class="body" style="font-size:12px">Share over time → Competitive. Theme movers → Voice. Sentiment and volume → Dashboard. Accounts → Content. The Trends page is gone; every movement block gates on ≥2 updates.</div></div>
<div class="list" style="gap:6px"><div class="hl" style="font-size:13px">5 · Evidence is the signature</div><div class="body" style="font-size:12px">A clay rule means a real person said this. Every finding tile carries one verbatim and a count; “see the voices” is the most-clicked link in the product.</div><div class="hl" style="font-size:13px">6 · Honest empties</div><div class="body" style="font-size:12px">A tile with too little data says so in one line and stays its size — the grid never collapses, and a new client’s first week still looks like a product.</div></div>
</div></div>'''
    return page("Dashboard","Design system","the one-screen redesign · tokens, type, tiles, charts, rules","", tokens+type_+vocab+charts+rules)

# ── write ─────────────────────────────────────────────────────────────────
PAGES = [("Main","Dashboard",dashboard),("Market","Market Intelligence",market),("Voice","Voice of Customer",voice),("Competitive","Competitive Intelligence",competitive),("Content","Content",content),("System","Design system",system)]
for stem,_,fn in PAGES:
    with open(os.path.join(OUT, f"{stem}.dc.html"),"w") as f: f.write(fn())

W,H,GX,GY = 1440,900,120,160
pos = {"Main":(0,0),"Market":(W+GX,0),"Voice":(2*(W+GX),0),"Competitive":(0,H+GY),"Content":(W+GX,H+GY),"System":(2*(W+GX),H+GY)}
canvas = {"artboards":[{"file":f"{s}.dc.html","title":t,"x":pos[s][0],"y":pos[s][1],"w":W,"h":H} for s,t,_ in PAGES],
 "annotations":[
  {"id":"brief","x":0,"y":-150,"w":560,"text":"Verbatim — one-screen redesign, round 2 (22 Aug 2026)\nDashboard approved (unchanged from round 1). Market, Voice, Competitive and Content rebuilt as bespoke compositions of the same family — each page's shape comes from its own content. Consumer Profile and Verbatim Agent keep their current designs (figure + connectors; crowd landing) and only take the density tokens."},
  {"id":"read","x":620,"y":-150,"w":420,"text":"Row 1: Dashboard · Market (the decision ledger) · Voice (the theme map). Row 2: Competitive (the face-off) · Content (the reply inbox + playbook) · the system sheet.\nReal Össur content from the 16 Aug update; sparkline history and a few counts are illustrative."},
  {"id":"open","x":1100,"y":-150,"w":440,"text":"Open questions\n1. Market: is the left-hand agenda of recommendations the right spine, or should the short read lead?\n2. Voice: theme map vs the ranked list — keep the map as the hero?\n3. Competitive: face-off first, or the share line first?\n4. Content: the reply inbox as hero — is that the daily-use page you want?"}],
 "launch":{"view":"canvas"}}
with open(os.path.join(OUT,"canvas.json"),"w") as f: json.dump(canvas,f,indent=1)
print("wrote", [s for s,_,_ in PAGES])
