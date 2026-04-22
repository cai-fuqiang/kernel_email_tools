#!/usr/bin/env bash
# ============================================================
# init_kernel_repo.sh — 初始化 Linux 内核本地 git 仓库
#
# 功能：
#   1. clone torvalds/linux.git（主仓库，v2.6.12 ~ latest）
#   2. clone history/history.git（历史仓库，v0.01 ~ v2.6.11）
#   3. 将 history 仓库作为 remote 加入主仓库并执行 graft 接合
#
# 用法：
#   bash scripts/init_kernel_repo.sh [--repo-dir DIR] [--history-dir DIR]
# ============================================================

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/workspace/kernel_linux}"
HISTORY_DIR="${HISTORY_DIR:-$HOME/workspace/kernel_linux_history}"

KERNEL_GIT="https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git"
HISTORY_GIT="https://git.kernel.org/pub/scm/linux/kernel/git/history/history.git"

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo-dir)   REPO_DIR="$2"; shift 2 ;;
        --history-dir) HISTORY_DIR="$2"; shift 2 ;;
        *)            echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "=== Linux Kernel Repository Initialization ==="
echo "Main repo:    $REPO_DIR"
echo "History repo: $HISTORY_DIR"
echo ""

# ---- Step 1: Clone 主仓库 ----
if [ -d "$REPO_DIR/.git" ]; then
    echo "[1/4] Main repo already exists, fetching latest..."
    cd "$REPO_DIR"
    git fetch --tags origin
else
    echo "[1/4] Cloning main kernel repo (this may take a while)..."
    git clone --bare "$KERNEL_GIT" "$REPO_DIR"
fi

# ---- Step 2: Clone 历史仓库 ----
if [ -d "$HISTORY_DIR/.git" ] || [ -f "$HISTORY_DIR/HEAD" ]; then
    echo "[2/4] History repo already exists, fetching latest..."
    cd "$HISTORY_DIR"
    git fetch --tags origin 2>/dev/null || true
else
    echo "[2/4] Cloning history repo..."
    git clone --bare "$HISTORY_GIT" "$HISTORY_DIR"
fi

# ---- Step 3: 将 history 作为 remote 加入主仓库 ----
echo "[3/4] Adding history as remote in main repo..."
cd "$REPO_DIR"

if git remote | grep -q "^history$"; then
    echo "  Remote 'history' already exists, fetching..."
    git fetch history --tags 2>/dev/null || true
else
    git remote add history "$HISTORY_DIR"
    git fetch history --tags
fi

# ---- Step 4: Graft 接合 ----
# Linux v2.6.12-rc2 的第一个 commit 的 parent 应指向 history 仓库的最后一个 commit
echo "[4/4] Setting up graft to join histories..."

# 找到主仓库最早的 commit（v2.6.12-rc2 的初始 commit）
OLDEST_MAIN=$(git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)
# 找到 history 仓库的最新 commit
NEWEST_HISTORY=$(git rev-parse history/master 2>/dev/null || echo "")

if [ -n "$OLDEST_MAIN" ] && [ -n "$NEWEST_HISTORY" ]; then
    # 检查是否已有 graft
    if git replace -l | grep -q "$OLDEST_MAIN" 2>/dev/null; then
        echo "  Graft already exists for $OLDEST_MAIN"
    else
        echo "  Grafting: $OLDEST_MAIN -> parent $NEWEST_HISTORY"
        git replace --graft "$OLDEST_MAIN" "$NEWEST_HISTORY"
    fi
else
    echo "  WARNING: Could not determine graft points."
    echo "  OLDEST_MAIN=$OLDEST_MAIN"
    echo "  NEWEST_HISTORY=$NEWEST_HISTORY"
    echo "  Skipping graft. You may need to do this manually."
fi

# ---- 验证 ----
echo ""
echo "=== Verification ==="
TOTAL_TAGS=$(git tag -l "v*" | wc -l)
echo "Total kernel version tags: $TOTAL_TAGS"

# 检查几个关键版本
for tag in v0.01 v1.0 v2.6.12 v5.15 v6.1 v6.6; do
    if git rev-parse "$tag" &>/dev/null; then
        echo "  $tag: OK"
    else
        echo "  $tag: NOT FOUND"
    fi
done

echo ""
echo "=== Done ==="
echo "Repo ready at: $REPO_DIR"