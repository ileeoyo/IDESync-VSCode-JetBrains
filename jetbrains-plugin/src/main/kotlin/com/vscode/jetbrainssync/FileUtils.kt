package com.vscode.jetbrainssync

import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * 文件工具类
 * 提供文件操作相关的工具方法
 */
object FileUtils {

    /**
     * 检查文件是否在其他编辑器中仍然打开
     */
    fun isFileOpenInOtherTabs(file: VirtualFile, project: Project): Boolean {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.isFileOpen(file)
    }

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

    /**
     * 获取当前所有打开的文件路径
     * 只返回常规文件编辑器，过滤掉特殊标签窗口
     */
    fun getAllOpenedFiles(project: Project): List<String> {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.openFiles
            .filter { virtualFile ->
                // 只保留常规文件编辑器，过滤掉所有特殊标签窗口
                isRegularFileEditor(virtualFile)
            }
            .map { it.path }
    }
} 