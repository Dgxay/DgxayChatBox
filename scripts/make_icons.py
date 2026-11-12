#!/usr/bin/env python3
"""由 D.AI 字标母版生成应用图标与界面品牌标记，无第三方依赖。

母版：build/icon-master.png（透明背景、纯黑字标）。
若母版不存在，首次运行会从 build/icon.ico 的最大 PNG 帧中提取并裁剪。

产物：
  build/icon.png / icon.ico / icon.icns          # 打包用
  src/renderer/assets/icon.png / icon.ico        # 窗口与渲染层图标
  src/renderer/assets/logo-mark.png              # 「D.」单字，小尺寸与标题栏
  src/renderer/assets/logo-wordmark.png          # 完整 D.AI，关于页

尺寸规则：<=64px 使用「D.」单字保证可读；>=128px 使用完整字标。
系统图标叠加浅色圆角底板（OS_PLATE），界面内的 logo-*.png 保持透明并由 CSS 反相。
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ASSETS = os.path.join(ROOT, "src", "renderer", "assets")
MASTER = os.path.join(BUILD, "icon-master.png")
ICO_SOURCE = os.path.join(BUILD, "icon.ico")

# 系统图标：浅色圆角底板 + 黑色字标，保证在深色任务栏/桌面上仍然可见。
# 若想回到纯透明字标，把 OS_PLATE 改为 False 即可。
OS_PLATE = True
PLATE_COLOR = (241, 241, 238)
PLATE_RADIUS = 0.225

# 字标在底板中的占比：完整字标偏宽，单字接近方形
WORDMARK_RATIO = 0.80
MARK_RATIO = 0.66
MONOGRAM_MAX = 64  # 该尺寸及以下使用单字，以上使用完整字标


# ------------------------------- PNG 读写 -------------------------------

def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"不是 PNG：{path}")
    pos = 8
    idat = b""
    width = height = depth = color = interlace = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, depth, color, _comp, _filt, interlace = struct.unpack(">IIBBBBB", chunk)
        elif tag == b"IDAT":
            idat += chunk
        elif tag == b"IEND":
            break
    if depth != 8 or color != 6 or interlace != 0:
        raise ValueError("母版需为 8 位 RGBA、非隔行 PNG")

    raw = zlib.decompress(idat)
    channels = 4
    stride = width * channels
    out = bytearray(width * height * 4)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        filt = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            value = line[i]
            if filt == 1:
                value += a
            elif filt == 2:
                value += b
            elif filt == 3:
                value += (a + b) >> 1
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                value += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[i] = value & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, out


def png_bytes(width, height, rgba):
    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    raw = b"".join(
        b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height)
    )
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# ------------------------------- ICO / ICNS -------------------------------

def ico_bytes(images):
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    payload = b""
    offset = 6 + 16 * len(images)
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


def extract_master_from_ico(path):
    """从 ICO 中取最大 PNG 帧，裁剪到墨迹范围后作为母版。"""
    data = open(path, "rb").read()
    _reserved, kind, count = struct.unpack("<HHH", data[:6])
    if kind != 1:
        raise ValueError("build/icon.ico 不是有效图标文件")
    best = None
    for index in range(count):
        off = 6 + index * 16
        width, height, _c, _r, _p, _bpp, size, img_off = struct.unpack(
            "<BBBBHHII", data[off:off + 16]
        )
        if data[img_off:img_off + 8] != b"\x89PNG\r\n\x1a\n":
            continue
        if best is None or (width or 256) > best[0]:
            best = ((width or 256), data[img_off:img_off + size])
    if not best:
        raise ValueError("ICO 中没有 PNG 帧，无法提取母版")
    temp = os.path.join(BUILD, ".icon-source.png")
    with open(temp, "wb") as handle:
        handle.write(best[1])
    try:
        width, height, pixels = read_png(temp)
    finally:
        os.remove(temp)
    box = ink_box(width, height, pixels)
    return crop(pixels, width, box)


# ------------------------------- 几何处理 -------------------------------

def ink_box(width, height, rgba, threshold=8):
    xs = []
    ys = []
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if rgba[row + x * 4 + 3] > threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("图标中没有可见像素")
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def crop(rgba, width, box):
    x0, y0, x1, y1 = box
    out_w = x1 - x0
    out_h = y1 - y0
    out = bytearray(out_w * out_h * 4)
    for y in range(out_h):
        src = ((y0 + y) * width + x0) * 4
        out[y * out_w * 4:(y + 1) * out_w * 4] = rgba[src:src + out_w * 4]
    return out_w, out_h, out


def column_spans(width, height, rgba, threshold=16):
    spans = []
    start = None
    for x in range(width):
        count = 0
        for y in range(height):
            if rgba[(y * width + x) * 4 + 3] > threshold:
                count += 1
        if count and start is None:
            start = x
        elif not count and start is not None:
            spans.append((start, x))
            start = None
    if start is not None:
        spans.append((start, width))
    return spans


def split_monogram(width, height, rgba):
    """在「D.」之后切分：找到句点（窄笔画）右侧的留白。"""
    spans = column_spans(width, height, rgba)
    cut = width
    for index in range(1, len(spans)):
        prev_w = spans[index - 1][1] - spans[index - 1][0]
        cur_w = spans[index][1] - spans[index][0]
        if prev_w > width * 0.3 and cur_w <= width * 0.16:
            cut = spans[index][1]
            break
    return cut


def resample(src, sw, sh, dw, dh):
    """带 alpha 预乘的双三次重采样，避免边缘发灰。"""
    def kernel(x):
        x = abs(x)
        a = -0.5
        if x <= 1:
            return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1
        if x < 2:
            return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a
        return 0.0

    premul = [0.0] * (sw * sh * 4)
    for i in range(sw * sh):
        alpha = src[i * 4 + 3] / 255.0
        premul[i * 4] = src[i * 4] * alpha
        premul[i * 4 + 1] = src[i * 4 + 1] * alpha
        premul[i * 4 + 2] = src[i * 4 + 2] * alpha
        premul[i * 4 + 3] = src[i * 4 + 3]

    # 水平
    tmp = [0.0] * (dw * sh * 4)
    scale_x = sw / dw
    # 放大时滤波器宽度保持 2 个源像素，缩小时按比例加宽，否则放大退化成最近邻
    filter_x = max(1.0, scale_x)
    support_x = 2.0 * filter_x
    for y in range(sh):
        for x in range(dw):
            center = (x + 0.5) * scale_x - 0.5
            left = int(center - support_x)
            right = int(center + support_x) + 1
            acc = [0.0, 0.0, 0.0, 0.0]
            total = 0.0
            for sx in range(left, right + 1):
                if sx < 0 or sx >= sw:
                    continue
                weight = kernel((sx - center) / filter_x)
                if not weight:
                    continue
                base = (y * sw + sx) * 4
                acc[0] += premul[base] * weight
                acc[1] += premul[base + 1] * weight
                acc[2] += premul[base + 2] * weight
                acc[3] += premul[base + 3] * weight
                total += weight
            out = (y * dw + x) * 4
            if total:
                tmp[out] = acc[0] / total
                tmp[out + 1] = acc[1] / total
                tmp[out + 2] = acc[2] / total
                tmp[out + 3] = acc[3] / total

    # 垂直
    scale_y = sh / dh
    filter_y = max(1.0, scale_y)
    support_y = 2.0 * filter_y
    out_bytes = bytearray(dw * dh * 4)
    for y in range(dh):
        center = (y + 0.5) * scale_y - 0.5
        top = int(center - support_y)
        bottom = int(center + support_y) + 1
        for x in range(dw):
            acc = [0.0, 0.0, 0.0, 0.0]
            total = 0.0
            for sy in range(top, bottom + 1):
                if sy < 0 or sy >= sh:
                    continue
                weight = kernel((sy - center) / filter_y)
                if not weight:
                    continue
                base = (sy * dw + x) * 4
                acc[0] += tmp[base] * weight
                acc[1] += tmp[base + 1] * weight
                acc[2] += tmp[base + 2] * weight
                acc[3] += tmp[base + 3] * weight
                total += weight
            if total:
                acc = [value / total for value in acc]
            alpha = acc[3]
            index = (y * dw + x) * 4
            if alpha > 0:
                out_bytes[index] = min(255, max(0, int(round(acc[0] * 255.0 / alpha))))
                out_bytes[index + 1] = min(255, max(0, int(round(acc[1] * 255.0 / alpha))))
                out_bytes[index + 2] = min(255, max(0, int(round(acc[2] * 255.0 / alpha))))
                out_bytes[index + 3] = min(255, max(0, int(round(alpha))))
    return out_bytes


def compose(mark, size, ratio):
    """把标记等比缩放并居中放入透明方形画布。"""
    mw, mh, pixels = mark
    box = size * ratio
    scale = min(box / mw, box / mh)
    dw = max(1, int(round(mw * scale)))
    dh = max(1, int(round(mh * scale)))
    scaled = resample(pixels, mw, mh, dw, dh)
    canvas = bytearray(size * size * 4)
    ox = (size - dw) // 2
    oy = (size - dh) // 2
    for y in range(dh):
        src = y * dw * 4
        dst = ((oy + y) * size + ox) * 4
        canvas[dst:dst + dw * 4] = scaled[src:src + dw * 4]
    return canvas


def plate_canvas(size):
    """浅色圆角底板，按有符号距离场做边缘抗锯齿。"""
    radius = size * PLATE_RADIUS
    half = size / 2.0
    inner = half - radius
    out = bytearray(size * size * 4)
    for y in range(size):
        dy = y + 0.5 - half
        for x in range(size):
            dx = x + 0.5 - half
            qx = abs(dx) - inner
            qy = abs(dy) - inner
            outside = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius
            cover = min(1.0, max(0.0, 0.5 - outside))
            if cover <= 0:
                continue
            index = (y * size + x) * 4
            out[index] = PLATE_COLOR[0]
            out[index + 1] = PLATE_COLOR[1]
            out[index + 2] = PLATE_COLOR[2]
            out[index + 3] = int(round(255 * cover))
    return out


def compose_icon(mark, size, ratio):
    """系统图标：字标叠在浅色底板上；OS_PLATE 关闭时退回透明画布。"""
    if not OS_PLATE:
        return compose(mark, size, ratio)
    canvas = plate_canvas(size)
    mw, mh, pixels = mark
    box = size * ratio
    scale = min(box / mw, box / mh)
    dw = max(1, int(round(mw * scale)))
    dh = max(1, int(round(mh * scale)))
    scaled = resample(pixels, mw, mh, dw, dh)
    ox = (size - dw) // 2
    oy = (size - dh) // 2
    for y in range(dh):
        for x in range(dw):
            src = (y * dw + x) * 4
            alpha = scaled[src + 3] / 255.0
            if alpha <= 0:
                continue
            dst = ((oy + y) * size + ox + x) * 4
            canvas[dst] = int(round(scaled[src] * alpha + canvas[dst] * (1 - alpha)))
            canvas[dst + 1] = int(round(scaled[src + 1] * alpha + canvas[dst + 1] * (1 - alpha)))
            canvas[dst + 2] = int(round(scaled[src + 2] * alpha + canvas[dst + 2] * (1 - alpha)))
    return canvas


# ------------------------------- 主流程 -------------------------------

def load_master():
    if os.path.exists(MASTER):
        width, height, pixels = read_png(MASTER)
        return width, height, pixels
    width, height, pixels = extract_master_from_ico(ICO_SOURCE)
    with open(MASTER, "wb") as handle:
        handle.write(png_bytes(width, height, pixels))
    print("master extracted -> build/icon-master.png")
    return width, height, pixels


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    width, height, pixels = load_master()
    cut = split_monogram(width, height, pixels)
    monogram = crop(pixels, width, (0, 0, max(1, cut), height))
    full = (width, height, pixels)

    # 打包图标
    with open(os.path.join(BUILD, "icon.png"), "wb") as handle:
        handle.write(png_bytes(1024, 1024, compose_icon(full, 1024, WORDMARK_RATIO)))
    with open(os.path.join(ASSETS, "icon.png"), "wb") as handle:
        handle.write(png_bytes(512, 512, compose_icon(full, 512, WORDMARK_RATIO)))

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = []
    for size in ico_sizes:
        mark = monogram if size <= MONOGRAM_MAX else full
        ratio = MARK_RATIO if size <= MONOGRAM_MAX else WORDMARK_RATIO
        ico_images.append((size, png_bytes(size, size, compose_icon(mark, size, ratio))))

    ico_payload = ico_bytes(ico_images)
    with open(os.path.join(BUILD, "icon.ico"), "wb") as handle:
        handle.write(ico_payload)
    with open(os.path.join(ASSETS, "icon.ico"), "wb") as handle:
        handle.write(ico_payload)

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
        mark = monogram if size <= MONOGRAM_MAX else full
        ratio = MARK_RATIO if size <= MONOGRAM_MAX else WORDMARK_RATIO
        icns_entries.append((kind, png_bytes(size, size, compose_icon(mark, size, ratio))))
    with open(os.path.join(BUILD, "icon.icns"), "wb") as handle:
        handle.write(icns_bytes(icns_entries))

    # 界面品牌标记：保留原始裁剪，不额外留白
    with open(os.path.join(ASSETS, "logo-mark.png"), "wb") as handle:
        handle.write(png_bytes(monogram[0], monogram[1], monogram[2]))
    with open(os.path.join(ASSETS, "logo-wordmark.png"), "wb") as handle:
        handle.write(png_bytes(width, height, pixels))

    print(
        "icons: build/icon.{png,ico,icns}, assets/{icon.png,icon.ico,logo-mark.png,logo-wordmark.png}"
    )
    print(f"monogram split at x={cut} (master {width}x{height})")


if __name__ == "__main__":
    main()
