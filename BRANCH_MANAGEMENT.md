# 分支管理指南

## 项目概述

本项目采用双仓库管理模式，包含一个私有开发仓库和一个公开发布仓库。

## 仓库结构

### 远程仓库

-   **origin** (私有仓库): `git@github.com:[username]/[project-name]-Private.git`
-   **public** (公开仓库): `git@github.com:[username]/[project-name].git`

### 分支映射关系

#### 本地分支 → 远程分支映射

```
本地分支          →  远程分支              →  用途
main             →  origin/main          →  私有仓库主分支同步
dev              →  origin/dev           →  私有仓库开发分支同步
public-sync      →  public/main          →  公开仓库发布分支同步
```

#### 详细分支说明

**本地分支:**

-   **main**: 主开发分支，跟踪 `origin/main`，用于稳定版本开发
-   **dev**: 开发分支，跟踪 `origin/dev`，用于日常功能开发和实验
-   **public-sync**: 公开发布分支，跟踪 `public/main`，用于同步到公开仓库

**远程分支:**

-   **origin/main**: 私有仓库主分支，包含完整开发历史
-   **origin/dev**: 私有仓库开发分支，包含最新开发进度
-   **public/main**: 公开仓库主分支，包含压缩后的发布版本

### 分支流转图

```
开发流程:
dev (本地) ←→ origin/dev (私有远程)
    ↓ merge
main (本地) ←→ origin/main (私有远程)
    ↓ squash merge
public-sync (本地) ←→ public/main (公开远程)
    ↓ merge back
main (本地) ←→ origin/main (私有远程)
```

**流转说明:**

1. 日常开发在 `dev` 分支进行，定期推送到 `origin/dev`
2. 功能完成后，将 `dev` 合并到 `main`，推送到 `origin/main`
3. 发布时，将 `main` 压缩合并到 `public-sync`，推送到 `public/main`
4. 发布完成后，将 `public-sync` 合并回 `main`，保持同步


## 发布脚本详解

`publish-public.sh` 脚本执行以下步骤：

1. **参数验证**: 检查是否提供版本描述
2. **分支检查**: 确保当前在 main 分支
3. **依赖检查**: 验证 public-sync 分支和 public 远程仓库存在
4. **代码同步**: 拉取最新的 main 分支代码
5. **分支切换**: 切换到 public-sync 分支
6. **远程同步**: 拉取公开仓库的最新代码
7. **代码合并**: 将 main 分支的更改压缩合并到 public-sync
8. **创建提交**: 使用格式化的提交信息创建发布提交
9. **推送发布**: 将更改推送到公开仓库
10. **回归主分支**: 切换回 main 分支并同步 public-sync 的更改

### 提交信息格式

发布提交使用以下格式：

```
YYYYMMDD - 版本描述
```

示例：`20250724 - 新增功能优化`

## 初始化设置

如果是新环境，需要进行以下设置：

### 1. 添加公开仓库远程地址

```bash
git remote add public git@github.com:[username]/[project-name].git
```

### 2. 创建 public-sync 分支

```bash
# 获取远程分支
git fetch public

# 如果公开仓库已有 main 分支
git checkout -b public-sync public/main

# 如果公开仓库是新仓库
git checkout -b public-sync main

# 推送分支到公开仓库
git push -u public public-sync:main
```