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

echo ">>>>> 2. 拉取远程 public 仓库的 main 分支..."
git pull public main
echo

echo ">>>>> 3. 合并本地 main 分支（压缩提交）..."
git merge main --squash --no-commit
echo

echo ">>>>> 4. 创建发布提交..."
COMMIT_MSG="$(date +'%Y%m%d') - $1"
echo "提交信息: $COMMIT_MSG"
git commit -m "$COMMIT_MSG"
echo

echo ">>>>> 5. 推送到远程 public 仓库..."
git push public public-sync:main
echo

echo ">>>>> 6. 在 public-sync 分支创建版本标签..."
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

echo ">>>>> 7. 切换回 main 分支..."
git checkout main
echo

echo ">>>>> 8. 合并 public-sync 分支..."
git merge public-sync
echo

echo ">>>>> 9. 推送 main 分支到远程..."
git push
echo

echo
echo "=== 发布完成 ==="
echo "✅ 版本已成功发布到 public 仓库"
