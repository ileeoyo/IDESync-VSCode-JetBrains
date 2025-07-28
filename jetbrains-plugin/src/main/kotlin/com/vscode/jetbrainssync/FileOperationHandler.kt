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
class FileOperationHandler(
    private val project: Project
) {
    private val log: Logger = Logger.getInstance(FileOperationHandler::class.java)

    /**
     * 处理接收到的编辑器状态
     */
    fun handleIncomingState(state: EditorState) {
        ApplicationManager.getApplication().invokeLater {
            try {
                when (state.action) {
                    ActionType.CLOSE -> handleFileClose(state)
                    ActionType.WORKSPACE_SYNC -> handleWorkspaceSync(state)
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
        log.info("进行文件关闭操作: ${state.filePath}")
        val compatiblePath = state.getCompatiblePath()
        closeFileByPath(compatiblePath)
    }

    /**
     * 处理工作区同步操作
     */
    private fun handleWorkspaceSync(state: EditorState) {
        log.info("进行工作区同步操作：目标文件数量: ${state.openedFiles?.size ?: 0}")

        if (state.openedFiles.isNullOrEmpty()) {
            log.info("工作区同步消息中没有打开的文件，跳过处理")
            return
        }

        try {
            // 如果当前编辑器活跃，保存当前编辑器状态
            var savedActiveEditorState: EditorState? = null
            if (isCurrentEditorActive()) {
                savedActiveEditorState = getCurrentActiveEditorState()
                log.info("保存当前活跃编辑器状态: ${savedActiveEditorState?.filePath}")
            }

            // 获取当前所有打开的文件
            val currentOpenedFiles = getCurrentOpenedFiles()
            val targetFiles = state.openedFiles.map { filePath ->
                // 创建临时EditorState以使用路径转换逻辑
                val tempState = EditorState(ActionType.OPEN, filePath, 0, 0)
                tempState.getCompatiblePath()
            }

            log.info("当前打开文件: ${currentOpenedFiles.size}个")
            log.info("目标文件: ${targetFiles.size}个")
            log.info("当前打开的常规文件列表: ${currentOpenedFiles.map { java.io.File(it).name }.joinToString(", ")}")

            // 关闭多余的文件（当前打开但目标中不存在的文件）
            val filesToClose = currentOpenedFiles.filter { file -> !targetFiles.contains(file) }
            for (fileToClose in filesToClose) {
                closeFileByPath(fileToClose)
            }

            // 打开缺失的文件（目标中存在但当前未打开的文件）
            val filesToOpen = targetFiles.filter { file -> !currentOpenedFiles.contains(file) }
            for (fileToOpen in filesToOpen) {
                openFileByPath(fileToOpen)
            }

            // 恢复之前保存的活跃编辑器状态，或处理指定的活跃文件
            if (savedActiveEditorState != null) {
                log.info("恢复之前保存的活跃编辑器状态: ${savedActiveEditorState.filePath}")
                handleFileOpenOrNavigate(savedActiveEditorState)
            } else if (state.filePath.isNotEmpty() && !isCurrentEditorActive()) {
                handleFileOpenOrNavigate(state)
            }

            log.info("✅ 工作区同步完成")
        } catch (e: Exception) {
            log.warn("工作区同步失败: ${e.message}", e)
        }
    }

    /**
     * 处理文件打开和导航操作
     */
    private fun handleFileOpenOrNavigate(state: EditorState) {
        log.info("进行文件导航操作: ${state.filePath}, 行${state.line}, 列${state.column}")

        val compatiblePath = state.getCompatiblePath()
        val editor = openFileByPath(compatiblePath)

        editor?.let { textEditor ->
            navigateToPosition(textEditor, state.line, state.column)
            log.info("✅ 成功同步到文件: ${compatiblePath}, 行${state.line}, 列${state.column}")
        } ?: run {
            log.warn("无法打开文件进行导航: $compatiblePath")
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
     * 获取当前所有打开的文件路径
     * 只返回常规文件标签，过滤掉特殊标签窗口
     */
    private fun getCurrentOpenedFiles(): List<String> {
        val fileEditorManager = FileEditorManager.getInstance(project)
        return fileEditorManager.openFiles
            .filter { virtualFile ->
                // 只保留常规文件编辑器，过滤掉所有特殊标签窗口
                FileUtils.isRegularFileEditor(virtualFile)
            }
            .map { it.path }
    }


    /**
     * 根据文件路径关闭文件
     * 如果直接路径匹配失败，会尝试通过文件名匹配
     */
    private fun closeFileByPath(filePath: String) {
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
     * 检查当前编辑器是否处于活跃状态
     */
    private fun isCurrentEditorActive(): Boolean {
        return isCurrentWindowFocused()
    }

    /**
     * 实时获取当前窗口是否聚焦
     * 不依赖事件状态，直接从IntelliJ API获取实时状态
     */
    private fun isCurrentWindowFocused(): Boolean {
        return ApplicationManager.getApplication().isActive
    }

    /**
     * 获取当前活跃编辑器的状态
     */
    private fun getCurrentActiveEditorState(): EditorState? {
        return try {
            val fileEditorManager = FileEditorManager.getInstance(project)
            val selectedEditor = fileEditorManager.selectedTextEditor
            val selectedFile = fileEditorManager.selectedFiles.firstOrNull()

            if (selectedEditor != null && selectedFile != null) {
                val position = selectedEditor.caretModel.logicalPosition
                EditorState(
                    action = ActionType.NAVIGATE,
                    filePath = selectedFile.path,
                    line = position.line,
                    column = position.column,
                    source = SourceType.JETBRAINS,
                    isActive = true
                )
            } else {
                null
            }
        } catch (e: Exception) {
            log.warn("获取当前活跃编辑器状态失败: ${e.message}", e)
            null
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @return 返回打开的TextEditor，如果失败返回null
     */
    private fun openFileByPath(filePath: String): TextEditor? {
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
}
