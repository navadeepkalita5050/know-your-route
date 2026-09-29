def encode(coords):
    out = []; plat = plng = 0
    for x, y in coords:
        lat, lng = int(round(y * 1e5)), int(round(x * 1e5))
        for v in (lat - plat, lng - plng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plng = lat, lng
    return ''.join(out)

