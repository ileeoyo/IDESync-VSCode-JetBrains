#!/bin/bash
set -e

# 检查是否提供了必需的参数
if [ -z "$1" ]; then
    echo "错误：缺少必需的参数"
    echo "使用方法: $0 <版本描述>"
    echo "示例: $0 '新增功能优化'"
    exit 1
fi

# 检查当前分支是否为 main
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "错误：必须在 main 分支上执行发布脚本"
    echo "当前分支: $CURRENT_BRANCH"
    echo "请先切换到 main 分支: git checkout main"
    exit 1
fi

# 检查是否存在 public-sync 分支
if ! git show-ref --verify --quiet refs/heads/public-sync; then
    echo "错误：本地不存在 public-sync 分支"

    # 检查是否配置了 public 远程仓库
    if ! git remote get-url public >/dev/null 2>&1; then
        echo "错误：未配置 public 远程仓库"
        echo
        echo "请按以下步骤配置："
        echo "1. 添加 public 远程仓库："
        echo "   git remote add public git@github.com:用户名/仓库名.git"
        echo "   (或使用 HTTPS: git remote add public https://github.com/用户名/仓库名.git)"
        echo
        echo "2. 获取远程分支并创建本地 public-sync 分支："
        echo "   git fetch public"
        echo "   # 如果远程仓库有 main 分支："
        echo "   git checkout -b public-sync public/main"
        echo "   # 如果远程仓库是新仓库（没有 main 分支）："
        echo "   git checkout -b public-sync main"
        echo
        echo "3. 推送 public-sync 分支到远程仓库："
        echo "   git push -u public public-sync:main"
        echo
        echo "4. 重新运行此脚本"
        exit 1
    else
        echo "检测到已配置 public 远程仓库，但缺少 public-sync 分支"
        echo
        echo "请执行以下命令创建 public-sync 分支："
        echo "   git fetch public"
        echo "   # 如果远程仓库有 main 分支："
        echo "   git checkout -b public-sync public/main"
        echo "   # 如果远程仓库是新仓库（没有 main 分支）："
        echo "   git checkout -b public-sync main"
        echo
        echo "然后推送到远程仓库："
        echo "   git push -u public public-sync:main"
        echo
        echo "最后重新运行此脚本"
        exit 1
    fi
fi

echo "=== 开始发布流程 ==="
echo "版本描述: $1"
echo "发布时间: $(date +'%Y-%m-%d %H:%M:%S')"
echo

echo ">>>>> 0. 拉取远程 main 分支最新代码..."
git pull origin main
echo

echo ">>>>> 1. 切换到 public-sync 分支..."
git checkout public-sync
echo

echo ">>>>> 2. 确保 public-sync 分支与远程 public/main 同步..."
# 获取远程最新信息
git fetch public

# 检查本地 public-sync 和远程 public/main 的关系
LOCAL_COMMIT=$(git rev-parse public-sync)
REMOTE_COMMIT=$(git rev-parse public/main)

echo "本地 public-sync 提交: $LOCAL_COMMIT"
echo "远程 public/main 提交: $REMOTE_COMMIT"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    echo "✅ 本地 public-sync 分支与远程 public/main 已同步"
elif git merge-base --is-ancestor public/main public-sync; then
    echo "📋 本地 public-sync 分支领先于远程 public/main"
    echo "本地领先的提交："
    git log --oneline public/main..public-sync
    echo "✅ 保留本地更改，这些更改将包含在本次发布中"
elif git merge-base --is-ancestor public-sync public/main; then
    echo "📥 远程 public/main 领先，正在更新本地分支..."
    git merge --ff-only public/main
    echo "✅ 已更新本地 public-sync 分支到远程状态"
else
    echo "❌ 错误：本地 public-sync 和远程 public/main 存在分歧"
    echo "本地提交: $LOCAL_COMMIT"
    echo "远程提交: $REMOTE_COMMIT"
    echo
    echo "显示分歧的提交："
    echo "本地独有的提交："
    git log --oneline public/main..public-sync 2>/dev/null || echo "无"
    echo "远程独有的提交："
    git log --oneline public-sync..public/main 2>/dev/null || echo "无"
    echo
    echo "建议的解决方案："
    echo "1. 手动检查并合并冲突"
    echo "2. 或删除本地 public-sync 分支重新创建: git branch -D public-sync && git checkout -b public-sync public/main"
    exit 1
fi
echo

echo ">>>>> 3. 检查 public-sync 分支和 main 分支是否有差异..."
# 检查两个分支是否有差异
if git diff --quiet public-sync main; then
    echo "✅ public-sync 分支和 main 分支没有差异，无需进行 squash merge"
    echo "跳过合并步骤..."
    
    echo
    echo ">>>>> 跳过到步骤 8. 切换回 main 分支..."
    git checkout main
    echo
    
    echo "=== 发布完成 ==="
    echo "✅ 两分支已同步，无需发布新版本"
    exit 0
else
    echo "📋 检测到 public-sync 分支和 main 分支存在差异，继续执行 squash merge..."
fi
echo

echo ">>>>> 4. 合并本地 main 分支（压缩提交）..."
# 确保当前分支是 public-sync
CURRENT_BRANCH_BEFORE_MERGE=$(git branch --show-current)
if [ "$CURRENT_BRANCH_BEFORE_MERGE" != "public-sync" ]; then
    echo "错误：执行 merge 操作时必须在 public-sync 分支"
    echo "当前分支: $CURRENT_BRANCH_BEFORE_MERGE"
    echo "请检查脚本逻辑或手动切换到 public-sync 分支"
    exit 1
fi
git merge main --squash --no-commit
echo

echo ">>>>> 5. 创建发布提交..."
COMMIT_MSG="$(date +'%Y%m%d') - $1"
echo "提交信息: $COMMIT_MSG"
git commit -m "$COMMIT_MSG"
echo

echo ">>>>> 6. 推送到远程 public 仓库..."
git push public public-sync:main
echo

echo ">>>>> 7. 在 public-sync 分支创建版本标签..."
# 询问是否需要创建标签
read -r -p "是否需要创建版本标签？(y/N): " CREATE_TAG
if [[ "$CREATE_TAG" =~ ^[Yy]$ ]]; then
    read -r -p "请输入版本号 (如: v1.4.0): " VERSION_TAG
    if [[ -n "$VERSION_TAG" ]]; then
        echo "创建标签: $VERSION_TAG"
        git tag -a "$VERSION_TAG" -m "$COMMIT_MSG"
        echo "推送标签到 public 仓库..."
        git push public "$VERSION_TAG"
        echo "推送标签到 origin 仓库..."
        git push origin "$VERSION_TAG"
    else
        echo "未提供版本号，跳过标签创建"
    fi
else
    echo "跳过标签创建"
fi
echo

echo ">>>>> 8. 切换回 main 分支..."
git checkout main
echo

echo ">>>>> 9. 将发布提交合并回 main 分支..."
# 检查是否需要合并
MAIN_COMMIT=$(git rev-parse main)
PUBLIC_SYNC_COMMIT=$(git rev-parse public-sync)

if [ "$MAIN_COMMIT" = "$PUBLIC_SYNC_COMMIT" ]; then
    echo "✅ main 分支已经是最新状态，无需合并"
else
    echo "正在将 public-sync 的发布提交合并到 main..."
    git merge public-sync --no-ff -m "Merge published changes from public-sync"
    echo "✅ 已将发布提交合并到 main 分支"
fi
echo

echo ">>>>> 10. 推送 main 分支到远程..."
git push
echo

echo
echo "=== 发布完成 ==="
echo "✅ 版本已成功发布到 public 仓库"
