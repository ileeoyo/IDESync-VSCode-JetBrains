package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
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
    private lateinit var project: Project
    private lateinit var log: Logger

    /**
     * 初始化工具类
     * @param project 项目实例
     * @param log 日志记录器
     */
    fun initialize(project: Project, log: Logger) {
        this.project = project
        this.log = log
    }

    /**
     * 检查文件是否在其他编辑器中仍然打开
     */
    fun isFileOpenInOtherTabs(file: VirtualFile): Boolean {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.isFileOpen(file)
    }

    /**
     * 判断是否为常规文件编辑器（只允许常规文件系统）
     */
    fun isRegularFile(virtualFile: VirtualFile): Boolean {
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
    fun getAllOpenedFiles(): List<String> {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.openFiles
            .filter { virtualFile ->
                // 只保留常规文件编辑器，过滤掉所有特殊标签窗口
                isRegularFile(virtualFile)
            }
            .map { it.path }
    }


    /**
     * 从文件路径提取文件名
     * @param filePath 文件路径
     * @return 文件名
     */
    fun extractFileName(filePath: String): String {
        return File(filePath).name
    }

    /**
     * 获取编辑器的文件路径
     * @param virtualFile 虚拟文件
     * @return 文件路径
     */
    fun getVirtualFilePath(virtualFile: VirtualFile): String {
        return virtualFile.path
    }

    /**
     * 获取编辑器的光标位置
     * @param editor 文本编辑器
     * @return 光标位置 Pair<行号, 列号>
     */
    fun getEditorCursorPosition(editor: Editor): Pair<Int, Int> {
        val position = editor.caretModel.logicalPosition
        return Pair(position.line, position.column)
    }

    /**
     * 获取编辑器的选中范围坐标
     * @param editor 文本编辑器
     * @return 选中范围坐标 (startLine, startColumn, endLine, endColumn)，如果没有选中则返回null
     */
    fun getSelectionCoordinates(editor: Editor): Quadruple<Int, Int, Int, Int>? {
        val selectionModel = editor.selectionModel
        val hasSelection = selectionModel.hasSelection()

        return if (hasSelection) {
            val startPosition = editor.offsetToLogicalPosition(selectionModel.selectionStart)
            val endPosition = editor.offsetToLogicalPosition(selectionModel.selectionEnd)
            Quadruple(startPosition.line, startPosition.column, endPosition.line, endPosition.column)
        } else {
            null
        }
    }

    /**
     * 四元组数据类，用于返回选中范围的四个坐标
     */
    data class Quadruple<out A, out B, out C, out D>(
        val first: A,
        val second: B,
        val third: C,
        val fourth: D
    )


    /**
     * 获取当前选中的文件和编辑器
     * @return Pair<TextEditor?, VirtualFile?> 编辑器和虚拟文件的组合
     */
    fun getCurrentActiveEditorAndFile(): Pair<Editor?, VirtualFile?> {
        val fileEditorManager = FileEditorManager.getInstance(project)
        val selectedEditor = fileEditorManager.selectedTextEditor
        val selectedFile = fileEditorManager.selectedFiles.firstOrNull()
        if (selectedFile != null && isRegularFile(selectedFile)) {
            return Pair(selectedEditor, selectedFile)
        }
        return Pair(null, null);
    }

    /**
     * 根据文件路径关闭文件
     * 如果直接路径匹配失败，会尝试通过文件名匹配
     */
    fun closeFileByPath(filePath: String) {
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
            log.warn("❌ 文件未找到: $filePath")
        } catch (e: Exception) {
            log.warn("关闭文件失败: $filePath - ${e.message}", e)
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @return 返回打开的TextEditor，如果失败返回null
     */
    fun openFileByPath(filePath: String): TextEditor? {
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
            log.warn("❌ 文件未找到: $filePath")
            return null
        } catch (e: Exception) {
            log.warn("打开文件失败: $filePath - ${e.message}", e)
            return null
        }
    }


    /**
     * 统一处理选中和光标移动
     * 先处理选中状态（有选中则设置选中，无选中则清除选中），然后确保光标位置在可视区域内
     * @param textEditor 文本编辑器
     * @param line 光标行号
     * @param column 光标列号
     * @param startLine 选中开始行号（可选）
     * @param startColumn 选中开始列号（可选）
     * @param endLine 选中结束行号（可选）
     * @param endColumn 选中结束列号（可选）
     */
    fun handleSelectionAndNavigate(
        textEditor: TextEditor,
        line: Int,
        column: Int,
        startLine: Int? = null,
        startColumn: Int? = null,
        endLine: Int? = null,
        endColumn: Int? = null
    ) {
        try {
            log.info("准备处理选中和光标导航: 光标位置($line, $column), 选中范围(${startLine ?: "无"},${startColumn ?: "无"}-${endLine ?: "无"},${endColumn ?: "无"})")

            ApplicationManager.getApplication().runWriteAction {
                val selectionModel = textEditor.editor.selectionModel

                // 先处理选中状态
                if (startLine != null && startColumn != null && endLine != null && endColumn != null) {
                    // 有选中范围，设置选中
                    val startPosition = LogicalPosition(startLine, startColumn)
                    val endPosition = LogicalPosition(endLine, endColumn)

                    selectionModel.setSelection(
                        textEditor.editor.logicalPositionToOffset(startPosition),
                        textEditor.editor.logicalPositionToOffset(endPosition)
                    )
                    log.info("✅ 成功设置选中范围: (${startLine},${startColumn})-(${endLine},${endColumn})")
                } else {
                    // 无选中范围，清除选中
                    selectionModel.removeSelection()
                    log.info("✅ 成功清除选中状态")
                }

                // 然后移动光标到指定位置
                val cursorPosition = LogicalPosition(line, column)
                textEditor.editor.caretModel.moveToLogicalPosition(cursorPosition)
                log.info("✅ 成功移动光标到位置: 行$line, 列$column")

                // 确保光标位置在可视区域内
                val visibleArea = textEditor.editor.scrollingModel.visibleArea
                val targetPoint = textEditor.editor.logicalPositionToXY(cursorPosition)

                if (!visibleArea.contains(targetPoint)) {
                    textEditor.editor.scrollingModel.scrollToCaret(ScrollType.MAKE_VISIBLE)
                    log.info("✅ 光标位置不可见，已执行滚动到: 行$line, 列$column")
                } else {
                    log.info("光标位置已在可视区域内，无需滚动")
                }
            }
            log.info("✅ 选中和光标导航处理完成")
        } catch (e: Exception) {
            log.warn("❌ 处理选中和光标导航失败: 光标位置($line, $column) - ${e.message}", e)
        }
    }
}