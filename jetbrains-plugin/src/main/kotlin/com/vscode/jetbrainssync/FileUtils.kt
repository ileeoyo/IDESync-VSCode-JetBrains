package com.vscode.jetbrainssync

import com.intellij.openapi.vfs.VirtualFile

/**
 * 文件工具类
 * 提供文件操作相关的工具方法
 */
object FileUtils {

    /**
     * 判断是否为常规文件编辑器（只允许常规文件系统）
     */
    fun isRegularFileEditor(virtualFile: VirtualFile): Boolean {
        val fileSystem = virtualFile.fileSystem.protocol

        // 白名单机制：只允许常规文件系统协议
        val allowedFileSystems = listOf(
            "file"       // 本地文件系统
        )

        return allowedFileSystems.contains(fileSystem)
    }
} 