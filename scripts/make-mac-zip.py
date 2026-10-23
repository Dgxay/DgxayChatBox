#!/usr/bin/env python3
"""把 electron-packager 生成的 .app 打成 macOS arm64 便携安装包（zip）。

在 Windows / Linux 上无法生成 DMG 时使用；zip 内含 Install-DgxayChatBox.command，
会在目标 Mac 上复制到「应用程序」并做 ad-hoc 签名。

用法：
    python scripts/make-mac-zip.py --app path/to/DgxayChatBox.app
"""
import argparse
import json
import os
import plistlib
import shutil
import stat
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

README = """DgxayChatBox {version} - macOS arm64 (Apple Silicon)

安装方式：
1. 双击 Install-DgxayChatBox.command，按提示安装到「应用程序」并启动。
2. 也可以手动把 DgxayChatBox.app 拖入「应用程序」后右键 -> 打开。

说明：
- 本包未使用 Apple Developer ID 签名，安装脚本会在本机做 ad-hoc 签名并清除 quarantine。
- 若系统仍拦截，请在终端执行：xattr -cr /Applications/DgxayChatBox.app
- 正式 DMG 安装包需在 macOS 上构建：npm run dist:mac
"""

INSTALLER = """#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/DgxayChatBox.app"
if [ ! -d "$SRC" ]; then
  echo "找不到 DgxayChatBox.app，请确认压缩包已完整解压。"
  read -r -p "按回车退出..." _
  exit 1
fi
if [ -w /Applications ]; then
  DEST="/Applications/DgxayChatBox.app"
else
  mkdir -p "$HOME/Applications"
  DEST="$HOME/Applications/DgxayChatBox.app"
fi
echo "正在安装到 $DEST ..."
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true
fi
echo "安装完成，正在启动..."
open "$DEST"
"""


def is_macho(path):
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
        return magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")
    except OSError:
        return False


def main():
    with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as f:
        pkg = json.load(f)
    version = pkg["version"]

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, help="Path to DgxayChatBox.app")
    parser.add_argument("--out", default=os.path.join(ROOT, "dist", f"DgxayChatBox-{version}-arm64-mac.zip"))
    args = parser.parse_args()

    app = os.path.abspath(args.app)
    if not os.path.isdir(app):
        raise SystemExit(f"找不到 {app}")

    resources = os.path.join(app, "Contents", "Resources")
    icon = os.path.join(ROOT, "build", "icon.icns")
    if os.path.exists(icon) and os.path.isdir(resources):
        shutil.copyfile(icon, os.path.join(resources, "icon.icns"))
        info_path = os.path.join(app, "Contents", "Info.plist")
        with open(info_path, "rb") as f:
            info = plistlib.load(f)
        info["CFBundleIconFile"] = "icon.icns"
        with open(info_path, "wb") as f:
            plistlib.dump(info, f, fmt=plistlib.FMT_XML, sort_keys=False)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    root = os.path.dirname(app)
    count = 0

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name, data, mode in (
            ("README-mac.txt", README.format(version=version).encode("utf-8"), 0o100644),
            ("Install-DgxayChatBox.command", INSTALLER.encode("utf-8"), 0o100755),
        ):
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = mode << 16
            z.writestr(info, data)

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames.sort()
            filenames.sort()
            rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
            if rel_dir == ".":
                rel_dir = ""
            for name in dirnames:
                full = os.path.join(dirpath, name)
                rel = f"{rel_dir}/{name}" if rel_dir else name
                st = os.lstat(full)
                if stat.S_ISLNK(st.st_mode):
                    info = zipfile.ZipInfo(rel)
                    info.create_system = 3
                    info.external_attr = 0o120777 << 16
                    z.writestr(info, os.readlink(full))
                    count += 1
                    continue
                info = zipfile.ZipInfo(rel + "/")
                info.create_system = 3
                info.external_attr = (0o40755 << 16) | 0x10
                z.writestr(info, b"")
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = f"{rel_dir}/{name}" if rel_dir else name
                st = os.lstat(full)
                info = zipfile.ZipInfo(rel)
                info.create_system = 3
                if stat.S_ISLNK(st.st_mode):
                    info.external_attr = 0o120777 << 16
                    z.writestr(info, os.readlink(full))
                else:
                    mode = 0o755 if is_macho(full) else 0o644
                    info.external_attr = mode << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    with open(full, "rb") as f:
                        z.writestr(info, f.read())
                count += 1

    print(f"built {args.out} ({os.path.getsize(args.out) / 1024 / 1024:.1f} MB, {count} files)")


if __name__ == "__main__":
    main()
