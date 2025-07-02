package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * 文件操作处理器
 * 负责处理文件的打开、关闭和导航操作
 */
class FileOperationHandler(private val project: Project) {
    private val log: Logger = Logger.getInstance(FileOperationHandler::class.java)

    /**
     * 处理接收到的编辑器状态
     */
    fun handleIncomingState(state: EditorState) {
        ApplicationManager.getApplication().invokeLater {
            try {
                when (state.action) {
                    ActionType.CLOSE -> handleFileClose(state)
                    else -> handleFileOpenOrNavigate(state)
                }
            } catch (e: Exception) {
                log.warn("处理消息操作失败: ${e.message}", e)
            }
        }
    }

    /**
     * 处理文件关闭操作
     */
    private fun handleFileClose(state: EditorState) {
        log.info("准备关闭文件: ${state.filePath}")

        // 使用EditorState的平台兼容路径
        val compatiblePath = state.getCompatiblePath()

        val file = File(compatiblePath)
        val virtualFile = LocalFileSystem.getInstance().findFileByIoFile(file)

        virtualFile?.let { vFile ->
            log.info("找到目标文件，准备关闭: ${vFile.path}")
            val fileEditorManager = FileEditorManager.getInstance(project)
            val isOpen = fileEditorManager.isFileOpen(vFile)
            log.info("文件当前状态: ${if (isOpen) "已打开" else "未打开"}")

            if (isOpen) {
                fileEditorManager.closeFile(vFile)
                log.info("✅ 成功关闭文件: ${vFile.path}")
            } else {
                log.warn("⚠️ 文件未打开，无需关闭: ${vFile.path}")
            }
        } ?: run {
            log.warn("❌ 无法找到要关闭的文件: $compatiblePath")
            // 尝试通过文件名匹配
            findAndCloseFileByName(compatiblePath)
        }
    }

    /**
     * 处理文件打开和导航操作
     */
    private fun handleFileOpenOrNavigate(state: EditorState) {
        log.info("准备导航文件: ${state.filePath}, 行${state.line}, 列${state.column}")

        // 使用EditorState的平台兼容路径
        val compatiblePath = state.getCompatiblePath()
        val file = File(compatiblePath)
        val virtualFile = LocalFileSystem.getInstance().findFileByIoFile(file)

        virtualFile?.let { vFile ->
            val fileEditorManager = FileEditorManager.getInstance(project)

            // 检查文件是否已经打开
            val existingEditor = fileEditorManager.selectedEditors
                .firstOrNull { it.file == vFile } as? TextEditor

            val editor = existingEditor ?: run {
                val editors = fileEditorManager.openFile(vFile, false)
                editors.firstOrNull() as? TextEditor
            }

            editor?.let { textEditor ->
                navigateToPosition(textEditor, state.line, state.column)
                log.info("✅ 成功同步到文件: ${compatiblePath}, 行${state.line}, 列${state.column}")
            }
        } ?: run {
            log.warn("无法找到文件: $compatiblePath")
        }
    }

    /**
     * 导航到指定位置
     */
    private fun navigateToPosition(textEditor: TextEditor, line: Int, column: Int) {
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


    /**
     * 通过文件名在项目中查找并关闭文件
     */
    private fun findAndCloseFileByName(filePath: String) {
        try {
            val fileName = File(filePath).name
            log.info("🔍 尝试通过文件名查找: $fileName")

            val fileEditorManager = FileEditorManager.getInstance(project)
            val openFiles = fileEditorManager.openFiles

            // 查找匹配的文件名
            val matchingFile = openFiles.find { it.name == fileName }
            matchingFile?.let { file ->
                log.info("🎯 找到匹配的文件: ${file.path}")
                fileEditorManager.closeFile(file)
                log.info("✅ 通过文件名匹配成功关闭文件: ${file.path}")
            } ?: run {
                log.warn("❌ 未找到匹配的文件名: $fileName")
            }

        } catch (e: Exception) {
            log.warn("通过文件名查找失败: ${e.message}", e)
        }
    }
}
