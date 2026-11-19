from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

f = TTFont('/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf')
f = instantiateVariableFont(f, {'wght': 800, 'opsz': 32})
gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
hmtx = f['hmtx']

def text_path(txt, cx, cy, size):
    """centered text path (cap-height centered)"""
    scale = size / upm
    width = sum(hmtx[cmap[ord(c)]][0] for c in txt) * scale
    # cap height
    capH = f['OS/2'].sCapHeight * scale
    x0 = cx - width / 2
    base = cy + capH / 2
    pen = SVGPathPen(gs)
    x = x0
    for c in txt:
        g = cmap[ord(c)]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x, base))
        gs[g].draw(tp)
        x += hmtx[g][0] * scale
    return pen.getCommands()

# Card design in its own coordinates: 320 x 352
ROWS = [('A1', '#e11d48', True), ('A2', '#e11d48', False), ('B1', '#f59e0b', False)]
def card():
    out = ['<rect x="0" y="0" width="320" height="352" rx="40" fill="#ffffff"/>']
    for i, (lab, col, checked) in enumerate(ROWS):
        cy = 72 + i * 104
        # checkbox
        if checked:
            out.append(f'<rect x="28" y="{cy-30}" width="60" height="60" rx="14" fill="#059669"/>')
            out.append(f'<path d="M41 {cy+1} L54 {cy+14} L76 {cy-14}" fill="none" stroke="#ffffff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>')
        else:
            out.append(f'<rect x="33" y="{cy-25}" width="50" height="50" rx="11" fill="#ffffff" stroke="#a1a1aa" stroke-width="10"/>')
        # badge
        out.append(f'<rect x="104" y="{cy-32}" width="112" height="64" rx="18" fill="{col}"/>')
        out.append(f'<path d="{text_path(lab, 160, cy, 46)}" fill="#ffffff"/>')
        # task line
        lc = '#d4d4d8' if checked else '#a1a1aa'
        out.append(f'<rect x="230" y="{cy-7}" width="62" height="14" rx="7" fill="{lc}"/>')
    return '\n'.join(out)

C = card()
BG = '''<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#27272a"/><stop offset="1" stop-color="#09090b"/></linearGradient></defs>'''
ACC = '<rect x="0" y="0" width="512" height="512" fill="url(#bg)"/>'

def wrap(w, h, inner):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{inner}</svg>'

# legacy square icon (rounded corners), 512
legacy = wrap(512, 512, BG + '<rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bg)"/>' + f'<g transform="translate(96 80)">{C}</g>')
# full-bleed square (for PWA maskable / apple-touch)
full = wrap(512, 512, BG + ACC + f'<g transform="translate(116 104) scale(0.875)">{C}</g>')
# round icon
s = 0.80
roundi = wrap(512, 512, BG + '<circle cx="256" cy="256" r="256" fill="url(#bg)"/>' + f'<g transform="translate({256-160*s} {256-176*s}) scale({s})">{C}</g>')
# adaptive foreground: 108 units, keep inside 66 safe zone -> card height 60
s2 = 58 / 352
fg = wrap(108, 108, f'<g transform="translate({54-160*s2} {54-176*s2}) scale({s2})">{C}</g>')
open('icon.svg', 'w').write(legacy)
open('icon-full.svg', 'w').write(full)
open('icon-round.svg', 'w').write(roundi)
open('icon-foreground.svg', 'w').write(fg)
