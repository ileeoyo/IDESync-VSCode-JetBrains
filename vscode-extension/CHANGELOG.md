# Change Log

## [1.3.0]
- **代码选中范围同步**：新增选中文本的实时同步功能，支持多IDE间精确同步代码选中范围

## [1.2.0]
- **自动启动同步**：新增配置项支持IDE启动后自动开启同步功能，默认关闭需手动启用
- **优化VSCode文件关闭逻辑**：修复部分情况tab显示但无法关闭的问题，提升同步可靠性
- **自动化发布流程**：集成changelog-reader-action，支持从CHANGELOG.md自动生成GitHub Release描述

## [1.1.0]
- **全量同步补偿机制**：新增窗口失焦时的全量工作区同步功能，解决长期使用中增量同步失败导致的状态不一致问题

## [1.0.20]
- **同步机制升级**：将WebSocket同步更换为UDP组播同步，实现去中心化发布订阅模式
- **多编辑器支持**：本机同时打开的IDEA、Cursor、Windsurf、VSCode等多IDE实例可实时同步
- **稳定性保障**：自带自动消息去重和清理机制
- **动态端口配置**：支持通过端口创建独立同步组，分组间互不干扰
- **即改即用**：端口配置实时生效，无需重启IDE
- **通信优化**：本机同步优先使用回环接口，提升效率

## [1.0.19]
- Added file close synchronization between VSCode and JetBrains

## [1.0.18]
- Files now always open in non-preview mode