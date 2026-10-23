#!/usr/bin/env python3
"""在非 Linux 环境把 electron-builder 的 linux-unpacked 目录打成 Debian/Ubuntu .deb。

用法：
    python scripts/make-deb.py
    python scripts/make-deb.py --app-dir dist/linux-unpacked --out dist/DgxayChatBox-1.0.0-amd64.deb
"""
import argparse
import gzip
import io
import json
import os
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_pkg():
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
        return json.load(f)


def add_dir_tree(tar, src, arc_root):
    for current, dirs, files in os.walk(src):
        dirs.sort()
        files.sort()
        rel = os.path.relpath(current, src).replace("\\", "/")
        arc_dir = f"{arc_root}/{rel}" if rel != "." else arc_root
        info = tarfile.TarInfo(arc_dir)
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.mtime = 0
        tar.addfile(info)

        for name in files:
            full = os.path.join(current, name)
            arc = f"{arc_dir}/{name}"
            ti = tar.gettarinfo(full, arcname=arc)
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = "root"
            ti.mtime = 0
            if ti.isfile():
                if name == "chrome-sandbox":
                    ti.mode = 0o4755
                elif name in ("dgxay-chatbox", "chrome_crashpad_handler"):
                    ti.mode = 0o755
                else:
                    ti.mode = 0o644
                with open(full, "rb") as fh:
                    tar.addfile(ti, fh)
            else:
                tar.addfile(ti)


def add_bytes(tar, name, data, mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.mtime = 0
    tar.addfile(info, io.BytesIO(data))


def tar_xz(entries, path):
    with tarfile.open(path, "w:xz", format=tarfile.GNU_FORMAT) as tar:
        for name, data, mode in entries:
            add_bytes(tar, name, data, mode)


def tar_gz(entries, path):
    with tarfile.open(path, "w:gz", format=tarfile.GNU_FORMAT) as tar:
        for name, data, mode in entries:
            add_bytes(tar, name, data, mode)


def ar_member(name, data, mode=0o100644):
    header = (
        name.ljust(16)[:16]
        + str(int(time.time())).ljust(12)[:12]
        + "0".ljust(6)
        + "0".ljust(6)
        + format(mode, "o").ljust(8)[:8]
        + str(len(data)).ljust(10)[:10]
        + "`\n"
    ).encode("ascii")
    assert len(header) == 60
    body = data + (b"\n" if len(data) % 2 else b"")
    return header + body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", default=os.path.join(ROOT, "dist", "linux-unpacked"))
    parser.add_argument("--out", default=None)
    parser.add_argument("--maintainer", default="Dgxay <dgxay@users.noreply.github.com>")
    args = parser.parse_args()

    pkg = read_pkg()
    name = pkg["name"]  # dgxay-chatbox
    version = pkg["version"]
    product = pkg["productName"]
    out = args.out or os.path.join(ROOT, "dist", f"{product}-{version}-amd64.deb")
    app_dir = args.app_dir

    if not os.path.isdir(app_dir):
        raise SystemExit(f"找不到 {app_dir}，请先运行 electron-builder --linux dir")

    size_kb = 0
    for current, _dirs, files in os.walk(app_dir):
        for f in files:
            try:
                size_kb += os.path.getsize(os.path.join(current, f))
            except OSError:
                pass
    size_kb = max(1, round(size_kb / 1024))

    icon_path = os.path.join(ROOT, "build", "icon.png")
    icon512_path = os.path.join(ROOT, "src", "renderer", "assets", "icon.png")

    work = os.path.join(ROOT, ".deb-build")
    os.makedirs(work, exist_ok=True)
    data_tar = os.path.join(work, "data.tar.xz")
    control_tar = os.path.join(work, "control.tar.gz")

    # data.tar.xz
    desktop = f"""[Desktop Entry]
Type=Application
Name={product}
GenericName=AI Chat Client
Comment=Multi-protocol AI desktop workspace
Exec=/opt/{product}/{name} %U
Icon={name}
Terminal=false
Categories=Utility;Development;
StartupWMClass={name}
"""
    data_entries = []

    with tarfile.open(data_tar, "w:xz", format=tarfile.GNU_FORMAT, preset=6) as tar:
        add_dir_tree(tar, app_dir, f"opt/{product}")

        for target, arcname in (
            (desktop.encode("utf-8"), f"usr/share/applications/{name}.desktop"),
            (open(icon_path, "rb").read(), f"usr/share/icons/hicolor/1024x1024/apps/{name}.png"),
        ):
            add_bytes(tar, arcname, target, 0o644)
        if os.path.exists(icon512_path):
            add_bytes(tar, f"usr/share/icons/hicolor/512x512/apps/{name}.png", open(icon512_path, "rb").read(), 0o644)

    postinst = f"""#!/bin/bash
set -e
APP_DIR=/opt/{product}
EXEC={name}
if [ -f "$APP_DIR/chrome-sandbox" ]; then
  if [ -L /proc/self/ns/user ] && unshare --user true 2>/dev/null; then
    chmod 0755 "$APP_DIR/chrome-sandbox" || true
  else
    chmod 4755 "$APP_DIR/chrome-sandbox" || true
  fi
fi
if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --install "/usr/bin/$EXEC" "$EXEC" "$APP_DIR/$EXEC" 100 || ln -sf "$APP_DIR/$EXEC" "/usr/bin/$EXEC"
else
  ln -sf "$APP_DIR/$EXEC" "/usr/bin/$EXEC"
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q /usr/share/icons/hicolor || true
exit 0
"""
    prerm = f"""#!/bin/bash
set -e
EXEC={name}
if command -v update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove "$EXEC" "/usr/bin/$EXEC" || true
fi
rm -f "/usr/bin/$EXEC"
exit 0
"""

    control = f"""Package: {name}
Version: {version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: {args.maintainer}
Installed-Size: {size_kb}
Depends: libgtk-3-0 | libgtk-3-0t64, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0 | libatspi2.0-0t64, libuuid1, libsecret-1-0, libasound2 | libasound2t64, libgbm1
Recommends: libayatana-appindicator3-1 | libappindicator3-1
Homepage: https://github.com/dgxay/DgxayChatBox
Description: {product} - multi-protocol AI desktop workspace
 A local-first AI desktop client supporting OpenAI ChatCompletions,
 Anthropic Messages and OpenAI Responses API, with a sandboxed work mode.
"""

    tar_gz(
        [
            ("./control", control.encode("utf-8"), 0o644),
            ("./postinst", postinst.encode("utf-8"), 0o755),
            ("./prerm", prerm.encode("utf-8"), 0o755),
        ],
        control_tar,
    )

    with open(os.path.join(work, "debian-binary"), "wb") as f:
        f.write(b"2.0\n")

    parts = [
        ar_member("debian-binary", b"2.0\n"),
        ar_member("control.tar.gz", open(control_tar, "rb").read()),
        ar_member("data.tar.xz", open(data_tar, "rb").read()),
    ]
    with open(out, "wb") as f:
        f.write(b"!<arch>\n")
        for part in parts:
            f.write(part)

    print(f"built {out} ({os.path.getsize(out) / 1024 / 1024:.1f} MB, installed {size_kb} KB)")


if __name__ == "__main__":
    main()
