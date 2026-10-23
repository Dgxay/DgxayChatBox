#!/usr/bin/env python3
"""生成 DgxayChatBox 应用图标（PNG + ICO），无第三方依赖。"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ASSETS = os.path.join(ROOT, "src", "renderer", "assets")

CORAL = (255, 107, 74)
AMBER = (255, 176, 32)
WHITE = (255, 255, 255)
DOT_COLORS = [(255, 92, 61), (240, 160, 42), (18, 184, 134)]


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def inside_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1 = sign((px, py), a, b)
    d2 = sign((px, py), b, c)
    d3 = sign((px, py), c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def render(size):
    ss = 2
    W = size * ss
    buf = bytearray(W * W * 4)

    radius = int(0.255 * W)
    for y in range(W):
        row = y * W * 4
        for x in range(W):
            i = row + x * 4
            if not inside_round_rect(x, y, 0, 0, W - 1, W - 1, radius):
                continue
            t = min(1.0, max(0.0, (x * 0.55 + y * 0.45) / W))
            if t < 0.55:
                k = t / 0.55
                color = tuple(int(CORAL[n] + (AMBER[n] - CORAL[n]) * k * 0.55) for n in range(3))
            else:
                k = (t - 0.55) / 0.45
                mid = tuple(int(CORAL[n] + (AMBER[n] - CORAL[n]) * 0.55) for n in range(3))
                color = tuple(int(mid[n] + (AMBER[n] - mid[n]) * k) for n in range(3))
            buf[i:i + 4] = bytes((color[0], color[1], color[2], 255))

    # 气泡尾巴
    tail = ((0.255 * W, 0.60 * W), (0.275 * W, 0.835 * W), (0.475 * W, 0.655 * W))
    x0, y0 = int(0.22 * W), int(0.55 * W)
    x1, y1 = int(0.50 * W), int(0.87 * W)
    for y in range(y0, y1):
        for x in range(x0, x1):
            if inside_triangle(x, y, *tail):
                i = (y * W + x) * 4
                buf[i:i + 4] = bytes((255, 255, 255, 255))

    # 气泡主体
    bx0, by0 = 0.16 * W, 0.255 * W
    bx1, by1 = 0.84 * W, 0.665 * W
    br = 0.135 * W
    for y in range(int(by0), int(by1) + 1):
        for x in range(int(bx0), int(bx1) + 1):
            if inside_round_rect(x, y, bx0, by0, bx1, by1, br):
                i = (y * W + x) * 4
                buf[i:i + 4] = bytes((255, 255, 255, 255))

    # 三个彩色小圆点
    cy = 0.462 * W
    dot_r = 0.036 * W
    for idx, cx_ratio in enumerate((0.365, 0.5, 0.635)):
        cx = cx_ratio * W
        for y in range(int(cy - dot_r) - 1, int(cy + dot_r) + 2):
            for x in range(int(cx - dot_r) - 1, int(cx + dot_r) + 2):
                if 0 <= x < W and 0 <= y < W and (x - cx) ** 2 + (y - cy) ** 2 <= dot_r ** 2:
                    i = (y * W + x) * 4
                    c = DOT_COLORS[idx]
                    buf[i:i + 4] = bytes((c[0], c[1], c[2], 255))

    # 2x 下采样（保留抗锯齿）
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in (0, 1):
                for dx in (0, 1):
                    i = ((y * 2 + dy) * W + (x * 2 + dx)) * 4
                    r += buf[i]
                    g += buf[i + 1]
                    b += buf[i + 2]
                    a += buf[i + 3]
            o = (y * size + x) * 4
            out[o:o + 4] = bytes((r // 4, g // 4, b // 4, a // 4))
    return out


def resize(src, size, nsize):
    out = bytearray(nsize * nsize * 4)
    scale = size / nsize
    for y in range(nsize):
        sy = (y + 0.5) * scale - 0.5
        y0 = max(0, int(math.floor(sy)))
        y1 = min(size - 1, y0 + 1)
        wy = sy - y0
        for x in range(nsize):
            sx = (x + 0.5) * scale - 0.5
            x0 = max(0, int(math.floor(sx)))
            x1 = min(size - 1, x0 + 1)
            wx = sx - x0
            acc = [0.0, 0.0, 0.0, 0.0]
            for yy, wyy in ((y0, 1 - wy), (y1, wy)):
                for xx, wxx in ((x0, 1 - wx), (x1, wx)):
                    i = (yy * size + xx) * 4
                    w = wyy * wxx
                    acc[0] += src[i] * w
                    acc[1] += src[i + 1] * w
                    acc[2] += src[i + 2] * w
                    acc[3] += src[i + 3] * w
            o = (y * nsize + x) * 4
            out[o:o + 4] = bytes(int(round(v)) for v in acc)
    return out


def png_bytes(width, height, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def ico_bytes(images):
    count = len(images)
    header = struct.pack("<HHH", 0, 1, count)
    entries = b""
    offset = 6 + 16 * count
    payload = b""
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    return header + entries + payload


def icns_bytes(entries):
    body = b""
    for kind, data in entries:
        body += kind + struct.pack(">I", 8 + len(data)) + data
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    master = render(1024)
    with open(os.path.join(BUILD, "icon.png"), "wb") as f:
        f.write(png_bytes(1024, 1024, master))
    with open(os.path.join(ASSETS, "icon.png"), "wb") as f:
        f.write(png_bytes(512, 512, resize(master, 1024, 512)))

    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = []
    for size in sizes:
        data = png_bytes(size, size, resize(master, 1024, size))
        images.append((size, data))

    with open(os.path.join(BUILD, "icon.ico"), "wb") as f:
        f.write(ico_bytes(images))

    icns_types = [
        (16, b"icp4"),
        (32, b"icp5"),
        (64, b"icp6"),
        (128, b"ic07"),
        (256, b"ic08"),
        (512, b"ic09"),
        (1024, b"ic10"),
    ]
    icns_entries = []
    for size, kind in icns_types:
        data = png_bytes(size, size, resize(master, 1024, size))
        icns_entries.append((kind, data))
    with open(os.path.join(BUILD, "icon.icns"), "wb") as f:
        f.write(icns_bytes(icns_entries))

    print("icon.png + icon.ico + icon.icns generated")


if __name__ == "__main__":
    main()
