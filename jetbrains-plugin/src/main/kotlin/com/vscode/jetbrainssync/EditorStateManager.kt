package com.vscode.jetbrainssync

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.ide.progress.ModalTaskOwner.project
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantReadWriteLock
import javax.swing.Timer
import kotlin.concurrent.read
import kotlin.concurrent.write

/**
 * 编辑器状态管理器
 * 负责管理编辑器状态的缓存、防抖和去重逻辑
 */
class EditorStateManager(
    private val project: Project
) {
    private val log: Logger = Logger.getInstance(EditorStateManager::class.java)

    // 按文件路径分组的防抖定时器
    private val debounceTimers: ConcurrentHashMap<String, Timer> = ConcurrentHashMap()

    // 读写锁，保护定时器操作的原子性
    private val timersLock = ReentrantReadWriteLock()

    // 防抖延迟
    private val debounceDelayMs = 300

    private var stateChangeCallback: StateChangeCallback? = null

    // 回调接口
    interface StateChangeCallback {
        fun onStateChanged(state: EditorState)
    }

    fun setStateChangeCallback(callback: StateChangeCallback) {
        this.stateChangeCallback = callback
    }

    /**
     * 创建编辑器状态对象
     */
    fun createEditorState(
        editor: Editor,
        file: VirtualFile,
        action: ActionType,
        isActive: Boolean = false
    ): EditorState {
        return EditorState(
            action = action,
            filePath = file.path,
            line = editor.caretModel.logicalPosition.line,
            column = editor.caretModel.logicalPosition.column,
            source = SourceType.JETBRAINS,
            isActive = isActive,
            timestamp = formatTimestamp()
        )
    }

    /**
     * 创建关闭状态对象
     */
    fun createCloseState(filePath: String, isActive: Boolean = false): EditorState {
        return EditorState(
            action = ActionType.CLOSE,
            filePath = filePath,
            line = 0,
            column = 0,
            source = SourceType.JETBRAINS,
            isActive = isActive,
            timestamp = formatTimestamp()
        )
    }


    /**
     * 创建工作区同步状态
     */
    fun createWorkspaceSyncState(isActive: Boolean = false): EditorState {
        val fileEditorManager = FileEditorManager.getInstance(project)
        val editor = fileEditorManager.selectedTextEditor
        val file = fileEditorManager.selectedFiles.firstOrNull()
        val openedFiles = FileUtils.getAllOpenedFiles()

        return if (editor != null && file != null) {
            EditorState(
                action = ActionType.WORKSPACE_SYNC,
                filePath = file.path,
                line = editor.caretModel.logicalPosition.line,
                column = editor.caretModel.logicalPosition.column,
                source = SourceType.JETBRAINS,
                isActive = isActive,
                timestamp = formatTimestamp(),
                openedFiles = openedFiles
            )
        } else {
            // 没有活跃编辑器时，使用空的文件路径和位置
            EditorState(
                action = ActionType.WORKSPACE_SYNC,
                filePath = "",
                line = 0,
                column = 0,
                source = SourceType.JETBRAINS,
                isActive = isActive,
                timestamp = formatTimestamp(),
                openedFiles = openedFiles
            )
        }
    }

    /**
     * 清理指定文件路径的防抖定时器
     * 使用写锁确保操作原子性
     */
    private fun clearDebounceTimer(filePath: String) {
        timersLock.write {
            val timer = debounceTimers.remove(filePath)
            if (timer != null) {
                timer.stop()
                log.debug("清理文件防抖定时器: $filePath")
            }
        }
    }

    /**
     * 防抖更新状态
     */
    fun debouncedUpdateState(state: EditorState) {
        val filePath = state.filePath

        timersLock.write {
            // 清除该文件之前的防抖定时器
            val oldTimer = debounceTimers.remove(filePath)
            oldTimer?.stop()

            // 创建新的防抖定时器
            val timer = Timer(debounceDelayMs) {
                try {
                    updateState(state)
                } catch (e: Exception) {
                    log.warn("更新状态时发生错误", e)
                } finally {
                    // 无论是否发生异常，都要清理定时器，防止内存泄漏
                    timersLock.write {
                        debounceTimers.remove(filePath)
                    }
                }
            }
            timer.isRepeats = false

            debounceTimers[filePath] = timer
            timer.start()
        }
    }

    /**
     * 立即更新状态（无防抖）
     */
    fun updateState(state: EditorState) {
        // 如果是文件关闭操作，立即清理防抖定时器
        if (state.action == ActionType.CLOSE) {
            clearDebounceTimer(state.filePath)
        }
        // 通知状态变化
        stateChangeCallback?.onStateChanged(state)
    }

    /**
     * 发送当前状态
     */
    fun sendCurrentState(isActive: Boolean) {
        val currentState = getCurrentActiveEditorState();
        if (currentState != null) {
            this.updateState(currentState)
            log.info("发送当前状态: ${currentState.filePath}")
        }
    }

    /**
     * 获取当前活跃编辑器的状态
     */
    fun getCurrentActiveEditorState(): EditorState? {
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
                    isActive = true,
                    timestamp = formatTimestamp()
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
     * 清理资源
     */
    fun dispose() {
        log.info("开始清理编辑器状态管理器资源")

        timersLock.write {
            // 清理所有防抖定时器
            for ((filePath, timer) in debounceTimers) {
                timer.stop()
                log.debug("清理防抖定时器: $filePath")
            }
            debounceTimers.clear()
        }

        log.info("编辑器状态管理器资源清理完成")
    }
}
