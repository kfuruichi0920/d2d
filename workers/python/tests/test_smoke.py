"""pytest 基盤の疎通確認（P0-4）。

ワーカー本体（main.py / commands/）は P5-1 で実装する。
このテストは CI 上で pytest が動作することのみを保証する。
"""

import sys


def test_python_version() -> None:
    # sdd_tech_stack §5.1: Python 3.11+
    assert sys.version_info >= (3, 11)
