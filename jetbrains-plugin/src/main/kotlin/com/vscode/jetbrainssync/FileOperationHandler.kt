package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger

/**
 * 文件操作处理器
 * 负责处理文件的打开、关闭和导航操作
 */
class FileOperationHandler(
    private val editorStateManager: EditorStateManager,
    private val windowStateManager: WindowStateManager,
    private val fileUtils: FileUtils
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
                    ActionType.OPEN -> handleFileOpenOrNavigate(state, false)
                    else -> handleFileOpenOrNavigate(state, false)
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
        fileUtils.closeFileByPath(compatiblePath)
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
            // 获取当前编辑器活跃状态
            var currentActiveState = isCurrentWindowActive();
            log.info("当前编辑器活跃状态: $currentActiveState");
            // 如果当前编辑器活跃，保存当前编辑器状态
            val savedActiveEditorState: EditorState? = editorStateManager.getCurrentActiveEditorState(windowStateManager.isWindowActive(forceRealTime = true))
            if (savedActiveEditorState != null) {
                log.info("保存当前的活跃编辑器状态: ${savedActiveEditorState.filePath}，${savedActiveEditorState.getCursorLog()}，${savedActiveEditorState.getSelectionLog()}")
            } else {
                log.info("当前没有活跃编辑器")
            }

            // 获取当前所有打开的文件
            val currentOpenedFiles = fileUtils.getAllOpenedFiles()
            val targetFiles = state.openedFiles.map { filePath ->
                // 创建临时EditorState以使用路径转换逻辑
                val tempState = EditorState(ActionType.OPEN, filePath, 0, 0)
                tempState.getCompatiblePath()
            }

            log.info("当前打开文件: ${currentOpenedFiles.size}个")
            log.info("目标文件: ${targetFiles.size}个")
            log.info("当前打开的常规文件列表: ${currentOpenedFiles.joinToString(", ") { fileUtils.extractFileName(it) }}")

            // 关闭多余的文件（当前打开但目标中不存在的文件）
            val filesToClose = currentOpenedFiles.filter { file -> !targetFiles.contains(file) }
            for (fileToClose in filesToClose) {
                fileUtils.closeFileByPath(fileToClose)
            }

            // 打开缺失的文件（目标中存在但当前未打开的文件）
            val filesToOpen = targetFiles.filter { file -> !currentOpenedFiles.contains(file) }
            for (fileToOpen in filesToOpen) {
                fileUtils.openFileByPath(fileToOpen, false)
            }

            // 再次获取当前编辑器活跃状态（防止状态延迟变更）
            currentActiveState = isCurrentWindowActive();
            if (currentActiveState) {
                if (savedActiveEditorState != null && !filesToOpen.isEmpty()) {
                    restoreLocalState(savedActiveEditorState, false)
                } else {
                    log.info("没有活跃编辑器状态，不进行恢复")
                }
            } else {
                followRemoteState(state)
            }

            log.info("✅ 工作区同步完成")
        } catch (e: Exception) {
            log.warn("工作区同步失败: ${e.message}", e)
        }
    }

    /**
     * 恢复本地编辑器状态
     */
    private fun restoreLocalState(state: EditorState, focusEditor: Boolean = true) {
        log.info("恢复本地状态: ${state.filePath}，focused=${focusEditor}，${state.getCursorLog()}，${state.getSelectionLog()}")
        handleFileOpenOrNavigate(state, focusEditor)
    }

    /**
     * 跟随远程编辑器状态
     */
    private fun followRemoteState(state: EditorState) {
        log.info("跟随远程状态: ${state.filePath}，${state.getCursorLog()}，${state.getSelectionLog()}")
        handleFileOpenOrNavigate(state, false)
    }

    /**
     * 处理文件打开和导航操作
     */
    private fun handleFileOpenOrNavigate(state: EditorState, focusEditor: Boolean = true) {
        if (state.hasSelection()) {
            log.info("进行文件选中并导航操作: ${state.filePath}，导航到: ${state.getCursor()}，${state.getSelectionLog()}")
        } else {
            log.info("进行文件导航操作: ${state.filePath}，导航到: ${state.getCursorLog()}")
        }

        val editor = fileUtils.openFileByPath(state.getCompatiblePath(), focusEditor)
        editor?.let { textEditor ->
            // 使用统一的选中和光标处理逻辑
            fileUtils.handleSelectionAndNavigate(
                textEditor,
                state.line,
                state.column,
                state.selectionStartLine,
                state.selectionStartColumn,
                state.selectionEndLine,
                state.selectionEndColumn
            )
        } ?: run {
            log.warn("无法打开文件进行导航: ${state.getCompatiblePath()}")
        }
    }


    /**
     * 检查当前编辑器是否处于活跃状态
     */
    private fun isCurrentWindowActive(): Boolean {
        // 对于关键的编辑器状态检查，使用强制实时查询确保准确性
        return windowStateManager.isWindowActive(forceRealTime = true)
    }


}
