# -*- coding: utf-8 -*-
"""读取 workbuddy共享模型.spec 里定义的 exe 名，供 build.bat 调用。

用法: python _exe_name.py
输出: 一行 exe 名（不含 .exe）
"""
import io
import os
import re
import sys

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workbuddy共享模型.spec")


def main() -> int:
    if not os.path.exists(SPEC):
        sys.stderr.write("spec not found: %s\n" % SPEC)
        return 1
    text = io.open(SPEC, encoding="utf-8").read()
    m = re.search(r"name\s*=\s*['\"](.+?)['\"]", text)
    if not m:
        sys.stderr.write("cannot find name= in spec\n")
        return 1
    # 用 stdout 传回，带 BOM 的写法在 cmd 里可能带怪字符，单纯 print 即可
    print(m.group(1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())