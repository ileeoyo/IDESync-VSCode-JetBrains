package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.io.File

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

    /**
     * 根据文件路径关闭文件
     * 如果直接路径匹配失败，会尝试通过文件名匹配
     */
    fun closeFileByPath(filePath: String, project: Project, log: Logger) {
        try {
            log.info("准备关闭文件: $filePath")
            val file = File(filePath)
            val virtualFile = LocalFileSystem.getInstance().findFileByIoFile(file)
            val fileEditorManager = FileEditorManager.getInstance(project)

            virtualFile?.let { vFile ->
                if (fileEditorManager.isFileOpen(vFile)) {
                    fileEditorManager.closeFile(vFile)
                    log.info("✅ 成功关闭文件: $filePath")
                    return
                } else {
                    log.warn("⚠️ 文件未打开，无需关闭: $filePath")
                    return
                }
            }

            // 如果精确匹配失败，尝试通过文件名匹配
            log.warn("❌ 精确路径匹配失败: $filePath")
            val fileName = File(filePath).name
            log.info("🔍 尝试通过文件名查找: $fileName")

            val openFiles = fileEditorManager.openFiles
            val matchingFile = openFiles.find { it.name == fileName }

            matchingFile?.let { vFile ->
                log.info("🎯 找到匹配的文件: ${vFile.path}")
                fileEditorManager.closeFile(vFile)
                log.info("✅ 通过文件名匹配成功关闭文件: ${vFile.path}")
            } ?: run {
                log.warn("❌ 未找到匹配的文件: $fileName")
            }
        } catch (e: Exception) {
            log.warn("关闭文件失败: $filePath - ${e.message}", e)
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @param project 项目实例
     * @param log 日志记录器
     * @return 返回打开的TextEditor，如果失败返回null
     */
    fun openFileByPath(filePath: String, project: Project, log: Logger): TextEditor? {
        try {
            log.info("准备打开文件: $filePath")
            val file = File(filePath)
            val virtualFile = LocalFileSystem.getInstance().findFileByIoFile(file)
            val fileEditorManager = FileEditorManager.getInstance(project)

            virtualFile?.let { vFile ->
                // FileEditorManager.openFile() 会自动复用已打开的文件，无需手动检查
                val editors = fileEditorManager.openFile(vFile, false)
                val editor = editors.firstOrNull() as? TextEditor

                if (editor != null) {
                    log.info("✅ 成功打开文件: $filePath")
                    return editor
                } else {
                    log.warn("❌ 无法获取文件编辑器: $filePath")
                    return null
                }
            }
            log.warn("❌ 无法找到要打开的文件: $filePath")
            return null
        } catch (e: Exception) {
            log.warn("打开文件失败: $filePath - ${e.message}", e)
            return null
        }
    }

    /**
     * 导航到指定位置
     * @param textEditor 文本编辑器
     * @param line 行号
     * @param column 列号
     * @param log 日志记录器
     */
    fun navigateToPosition(textEditor: TextEditor, line: Int, column: Int, log: Logger) {
        val position = LogicalPosition(line, column)

        ApplicationManager.getApplication().runWriteAction {
            textEditor.editor.caretModel.moveToLogicalPosition(position)

            // 智能滚动：只在光标不可见时才滚动
            val visibleArea = textEditor.editor.scrollingModel.visibleArea
            val targetPoint = textEditor.editor.logicalPositionToXY(position)

            if (!visibleArea.contains(targetPoint)) {
                textEditor.editor.scrollingModel.scrollToCaret(ScrollType.MAKE_VISIBLE)
                log.info("光标位置不可见，执行滚动到: 行$line, 列$column")
            }
        }
    }
} 