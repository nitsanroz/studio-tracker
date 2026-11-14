"""Builds public/fonts/hidden-digits.woff — the font behind "Hide numbers".

Only the digits 0-9, every one drawn as THE SAME soft smudge (so the shape
says nothing about which digit it was), each exactly one advance wide (so a
run of digits reads as one smudged bar, no overlap stripes). Held mode puts
this font first in every font stack; letters, Hebrew, ₪ and % fall through to
the real fonts, so only the numbers disappear (Nitsan, 2026-11-12).

The smudge is COLR v0: four stacked layers in a grey that reads on white and
on navy, each a little more opaque and a little shorter, so the edges are
soft. The plain outline under it (for anything without colour-font support)
is a solid rounded bar.

Run: pip install fonttools (anywhere), then
  python3 scripts/build-hidden-digits-font.py
"""
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.colorLib.builder import buildCOLR, buildCPAL
import os

UPM = 1000
ADV = 560          # about Saans' digit width
ASC, DESC = 950, -250
GREY = (0x7C / 255, 0x86 / 255, 0x9F / 255)


def bar(y0, y1, r):
    """A full-advance bar from y0 to y1 with rounded top and bottom edges (radius r)."""
    pen = TTGlyphPen(None)
    pen.moveTo((0, y0 + r))
    pen.qCurveTo((0, y0), (r, y0))
    pen.lineTo((ADV - r, y0))
    pen.qCurveTo((ADV, y0), (ADV, y0 + r))
    pen.lineTo((ADV, y1 - r))
    pen.qCurveTo((ADV, y1), (ADV - r, y1))
    pen.lineTo((r, y1))
    pen.qCurveTo((0, y1), (0, y1 - r))
    pen.closePath()
    return pen.glyph()


LAYERS = [(-70, 790, 0.16), (-20, 740, 0.20), (40, 680, 0.26), (110, 610, 0.34)]

digits = [str(d) for d in range(10)]
names = [".notdef", "smudge", "l0", "l1", "l2", "l3"]
glyphs = {".notdef": TTGlyphPen(None).glyph(), "smudge": bar(-20, 740, 60)}
for i, (y0, y1, _) in enumerate(LAYERS):
    glyphs[f"l{i}"] = bar(y0, y1, 50)
# Every digit maps to the same glyph, so nothing about the digit survives.
cmap = {ord(d): "smudge" for d in digits}

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n: (ADV if n != ".notdef" else 0, 0) for n in names})
fb.setupHorizontalHeader(ascent=ASC, descent=DESC)
fb.setupNameTable({"familyName": "Hidden Digits", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=ASC, sTypoDescender=DESC, usWinAscent=ASC, usWinDescent=-DESC)
fb.setupPost()
fb.font["CPAL"] = buildCPAL([[(*GREY, a) for (_, _, a) in LAYERS]])
fb.font["COLR"] = buildCOLR({"smudge": [(f"l{i}", i) for i in range(len(LAYERS))]})

out = os.path.join(os.path.dirname(__file__), "..", "public", "fonts", "hidden-digits.woff")
os.makedirs(os.path.dirname(out), exist_ok=True)
fb.font.flavor = "woff"
fb.save(out)
print("wrote", os.path.normpath(out), os.path.getsize(out), "bytes")
