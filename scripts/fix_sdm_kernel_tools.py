#!/usr/bin/env python3
"""修复 sdm_kernel_tools 项目中的 SQLAlchemy 模型问题。"""

import re

def fix_models_file(filepath: str):
    """修复 models.py 文件中的 metadata 字段名冲突。"""
    with open(filepath, 'r') as f:
        content = f.read()

    # 替换 metadata: Mapped[dict] 为 extra_data: Mapped[dict]
    content = content.replace(
        'metadata: Mapped[dict]',
        'extra_data: Mapped[dict]'
    )

    # 如果需要替换其他地方对 metadata 的引用
    # content = content.replace('.metadata', '.extra_data')

    with open(filepath, 'w') as f:
        f.write(content)

    print(f"Fixed: {filepath}")

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        fix_models_file(sys.argv[1])
    else:
        # 默认路径
        default_path = "/home/wang/workspace/sdm_kernel_tools/src/storage/models.py"
        fix_models_file(default_path)