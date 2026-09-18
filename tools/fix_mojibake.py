import os

ROOT = 'js'
FILES = sorted(os.path.join(ROOT, f) for f in os.listdir(ROOT) if f.endswith('.js'))

def has_latin1_range(txt):
    for ch in txt:
        o = ord(ch)
        if 0x80 <= o <= 0xFF:
            return True
    return False

def repair_line(ln):
    # returns (new_line_bytes or None) if line was mojibake and repairable.
    try:
        txt = ln.decode('utf-8')
        strict_ok = True
    except UnicodeDecodeError:
        txt = ln.decode('utf-8', errors='replace')
        strict_ok = False
    if not has_latin1_range(txt):
        return None
    try:
        mid = txt.encode('cp1251')
    except UnicodeEncodeError:
        return None
    repl = mid.decode('utf-8', errors='replace')
    if '\ufffd' in repl or repl == txt:
        return None
    # plausible: repaired text should contain readable Cyrillic if the
    # original line carried any non-ascii cyrillic.
    cyr = lambda s: sum(1 for c in s if '\u0400' <= c <= '\u04ff')
    if not strict_ok and cyr(repl) == 0:
        return None
    return repl.encode('utf-8')

problems = []   # lines with lone broken bytes (FFFD), not auto-repairable
for f in FILES:
    data = open(f, 'rb').read()
    lines = data.split(b'\n')
    fixed = 0
    examples = []
    for i, ln in enumerate(lines):
        try:
            txt = ln.decode('utf-8')
            strict_ok = True
        except UnicodeDecodeError:
            txt = ln.decode('utf-8', errors='replace')
            strict_ok = False
        if not strict_ok and not has_latin1_range(txt):
            # strict decode failed but no latin1-range char -> lone broken byte
            problems.append((f, i + 1, txt[:90]))
            continue
        nb = repair_line(ln)
        if nb is not None and nb != ln:
            lines[i] = nb
            fixed += 1
            if len(examples) < 4:
                examples.append((i + 1, txt[:70], nb.decode('utf-8', 'replace')[:70]))
    if fixed:
        open(f, 'wb').write(b'\n'.join(lines))
        print('== %s: %d lines fixed & SAVED' % (f, fixed))
        for (l, b, a) in examples:
            print('   L%d  %r' % (l, a))
print()
print('LONE-BROKEN-BYTE LINES (manual review):', len(problems))
for (f, l, s) in problems[:20]:
    print('   %s:%d  %r' % (f, l, s))