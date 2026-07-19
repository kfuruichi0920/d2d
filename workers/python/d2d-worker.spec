# -*- mode: python ; coding: utf-8 -*-
# D2D Python ワーカーの PyInstaller ビルド定義（P14-5、sdd_tech_stack §5.4）。
#   cd workers/python && python -m PyInstaller d2d-worker.spec --noconfirm
# 出力: workers/python/dist/d2d-worker/（onedir。electron-builder の extraResources が
# resources/workers/python/ へ同梱する）
from PyInstaller.utils.hooks import collect_submodules

# commands/ 配下は動的 import されるため明示的に収録する
hiddenimports = collect_submodules("commands")

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="d2d-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # stdin/stdout JSONL プロトコルのため console 必須
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="d2d-worker",
)
