#!/usr/bin/env python3
"""由品牌图标母版生成全平台应用图标与界面品牌标记，无第三方依赖。

母版：build/icon-master.png（256×256，纯黑方形底 + 白色几何字标）。
换标：把新的 .ico 放到 build/icon-source.ico（或直接替换母版 PNG）后重跑本脚本。

产物：
  build/icon.png / icon.ico / icon.icns          # 打包用
  src/renderer/assets/icon.png / icon.ico        # 窗口与渲染层图标
  src/renderer/assets/logo-mark.png              # 透明字标，标题栏与引导页
  src/renderer/assets/logo-wordmark.png          # 透明字标，关于卡片

尺寸策略：16–256 优先取源 ICO 的原生帧（作者已针对小尺寸调过笔画粗细），
512/1024 由 256 帧放大后做边缘锐化重建。系统图标叠加圆角遮罩（TILE_RADIUS），
界面标记抠成「透明底 + 黑色字标」，由 CSS 按主题反相，不再单独为深色切图。
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ASSETS = os.path.join(ROOT, "src", "renderer", "assets")
MASTER = os.path.join(BUILD, "icon-master.png")
SOURCE_ICO = os.path.join(BUILD, "icon-source.ico")

# 系统图标圆角比例（相对画布边长）。源文件是直角方块，桌面与任务栏上略带圆角
# 更像一个应用图标；改 0 即回到原始直角，其他产物无需调整。
TILE_RADIUS = 0.18
MASTER_SIZE = 256

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_TYPES = [
    (16, b"icp4"),
    (32, b"icp5"),
    (64, b"icp6"),
    (128, b"ic07"),
    (256, b"ic08"),
    (512, b"ic09"),
    (1024, b"ic10"),
]
LOGOS = {"logo-mark.png": 0.07, "logo-wordmark.png": 0.12}


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


def read_ico_frames(path):
    """读出 ICO 内所有 PNG 帧，返回 {边长: (w, h, rgba)}。"""
    data = open(path, "rb").read()
    _reserved, kind, count = struct.unpack("<HHH", data[:6])
    if kind != 1:
        raise ValueError(f"{path} 不是有效图标文件")
    frames = {}
    temp = os.path.join(BUILD, ".icon-frame.png")
    for index in range(count):
        off = 6 + index * 16
        width, height, _c, _r, _p, _bpp, size, img_off = struct.unpack(
            "<BBBBHHII", data[off:off + 16]
        )
        if data[img_off:img_off + 8] != b"\x89PNG\r\n\x1a\n":
            continue
        with open(temp, "wb") as handle:
            handle.write(data[img_off:img_off + size])
        try:
            fw, fh, pixels = read_png(temp)
        finally:
            os.remove(temp)
        frames[max(width or 256, fw)] = (fw, fh, pixels)
    if not frames:
        raise ValueError("ICO 中没有 PNG 帧，无法提取母版")
    return frames


# ------------------------------- 几何处理 -------------------------------

def luminance(w, h, rgba):
    """黑底白字的覆盖率场：亮度即字标在底上的占比。"""
    field = [0.0] * (w * h)
    for i in range(w * h):
        alpha = rgba[i * 4 + 3] / 255.0
        if alpha <= 0:
            continue
        lum = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) / 255.0
        field[i] = lum * alpha
    return field


def _kernel(x):
    x = abs(x)
    a = -0.5
    if x <= 1:
        return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1
    if x < 2:
        return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a
    return 0.0


def _taps(src_len, dst_len):
    """预计算每列/每行的重采样权重，缩放时按比例加宽滤波器抑制摩尔纹。"""
    scale = src_len / dst_len
    filt = max(1.0, scale)
    support = 2.0 * filt
    table = []
    for index in range(dst_len):
        center = (index + 0.5) * scale - 0.5
        taps = []
        for src_index in range(int(center - support), int(center + support) + 2):
            if 0 <= src_index < src_len:
                weight = _kernel((src_index - center) / filt)
                if weight:
                    taps.append((src_index, weight))
        total = sum(weight for _index, weight in taps) or 1.0
        table.append([(src_index, weight / total) for src_index, weight in taps])
    return table


def resample(field, sw, sh, dw, dh):
    if (sw, sh) == (dw, dh):
        return list(field)
    x_taps = _taps(sw, dw)
    midway = [0.0] * (dw * sh)
    for y in range(sh):
        base = y * sw
        for x, taps in enumerate(x_taps):
            total = 0.0
            for src_x, weight in taps:
                total += field[base + src_x] * weight
            midway[y * dw + x] = total
    y_taps = _taps(sh, dh)
    out = [0.0] * (dw * dh)
    for y, taps in enumerate(y_taps):
        row = [0.0] * dw
        for src_y, weight in taps:
            base = src_y * dw
            for x in range(dw):
                row[x] += midway[base + x] * weight
        out[y * dw:(y + 1) * dw] = row
    return out


def sharpen(field, amount=0.45):
    """放大后重建立笔画边缘：以 0.5 为轴做轻度对比增强，避免灰边发糊。"""
    return [
        min(1.0, max(0.0, 0.5 + (value - 0.5) * (1.0 + amount)))
        for value in field
    ]


def rounded_alpha(size, ratio):
    """圆角遮罩，按有符号距离场做边缘抗锯齿。"""
    if ratio <= 0:
        return bytearray([255]) * (size * size)
    radius = size * ratio
    half = size / 2.0
    inner = half - radius
    out = bytearray(size * size)
    for y in range(size):
        dy = y + 0.5 - half
        for x in range(size):
            dx = x + 0.5 - half
            qx = abs(dx) - inner
            qy = abs(dy) - inner
            outside = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - radius
            cover = min(1.0, max(0.0, 0.5 - outside))
            out[y * size + x] = int(round(255 * cover))
    return out


def tile_rgba(field, size, radius):
    mask = rounded_alpha(size, radius)
    out = bytearray(size * size * 4)
    for i in range(size * size):
        value = int(round(min(1.0, max(0.0, field[i])) * 255))
        out[i * 4] = value
        out[i * 4 + 1] = value
        out[i * 4 + 2] = value
        out[i * 4 + 3] = mask[i]
    return out


def ink_box(field, w, h, threshold=0.03):
    xs = []
    ys = []
    for y in range(h):
        base = y * w
        for x in range(w):
            if field[base + x] > threshold:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("图标中没有可见笔画")
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def glyph_png(field, w, h, padding):
    """抠出透明底黑字标：亮度转为 alpha，颜色统一压成纯黑。"""
    x0, y0, x1, y1 = ink_box(field, w, h)
    box_w = x1 - x0
    box_h = y1 - y0
    pad_x = int(round(box_w * padding))
    pad_y = int(round(box_h * padding))
    out_w = box_w + 2 * pad_x
    out_h = box_h + 2 * pad_y
    out = bytearray(out_w * out_h * 4)
    for y in range(box_h):
        for x in range(box_w):
            alpha = int(round(min(1.0, max(0.0, field[(y0 + y) * w + x0 + x])) * 255))
            if not alpha:
                continue
            dst = ((y + pad_y) * out_w + x + pad_x) * 4
            out[dst] = 0
            out[dst + 1] = 0
            out[dst + 2] = 0
            out[dst + 3] = alpha
    return out_w, out_h, out


def write(path, data):
    with open(path, "wb") as handle:
        handle.write(data)


def save_png(path, size, rgba):
    write(path, png_bytes(size, size, rgba))


# ------------------------------- 主流程 -------------------------------

def load_source():
    """母版优先；缺失时从源 ICO 的最大帧提取，并顺手修掉导出时的半透明边。"""
    if not os.path.exists(MASTER):
        if not os.path.exists(SOURCE_ICO):
            raise SystemExit("缺少 build/icon-master.png 与 build/icon-source.ico")
        frames = read_ico_frames(SOURCE_ICO)
        w, h, pixels = frames[max(frames)]
        clean = bytearray(pixels)
        for i in range(w * h):
            clean[i * 4 + 3] = 255
        write(MASTER, png_bytes(w, h, clean))
        print("master extracted -> build/icon-master.png")
    w, h, pixels = read_png(MASTER)
    return w, h, pixels


def main():
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)

    width, height, pixels = load_source()
    master = luminance(width, height, pixels)

    frames = {}
    if os.path.exists(SOURCE_ICO):
        for size, (fw, fh, rgba) in read_ico_frames(SOURCE_ICO).items():
            if fw == fh:
                frames[size] = luminance(fw, fh, rgba)

    rendered = {}

    def render(size):
        if size in rendered:
            return rendered[size]
        native = frames.get(size)
        if native and size <= width:
            field = native
        else:
            field = resample(master, width, height, size, size)
            if size > width:
                field = sharpen(field)
        rgba = tile_rgba(field, size, TILE_RADIUS)
        rendered[size] = rgba
        return rgba

    # 打包图标：1024 供 mac/linux，ico 覆盖 Windows 全尺寸
    save_png(os.path.join(BUILD, "icon.png"), 1024, render(1024))
    save_png(os.path.join(ASSETS, "icon.png"), 512, render(512))

    ico_payload = ico_bytes([(size, png_bytes(size, size, render(size))) for size in ICO_SIZES])
    write(os.path.join(BUILD, "icon.ico"), ico_payload)
    write(os.path.join(ASSETS, "icon.ico"), ico_payload)

    icns_payload = icns_bytes(
        [(kind, png_bytes(size, size, render(size))) for size, kind in ICNS_TYPES]
    )
    write(os.path.join(BUILD, "icon.icns"), icns_payload)

    # 界面品牌标记：透明底黑字标，深色主题由 .logo { filter: invert(1) } 反相
    for name, padding in LOGOS.items():
        gw, gh, glyph = glyph_png(master, width, height, padding)
        write(os.path.join(ASSETS, name), png_bytes(gw, gh, glyph))
        print(f"{name}: {gw}x{gh}")

    print("icons: build/icon.{png,ico,icns} + assets/{icon.png,icon.ico}")
    print(f"tile radius {TILE_RADIUS:g}, master {width}x{height}")


if __name__ == "__main__":
    main()
