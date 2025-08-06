package com.vscode.jetbrainssync

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.messages.MessageBusConnection

/**
 * 事件监听管理器
 * 统一管理各种编辑器事件监听器，将事件转换为标准的操作任务
 */
class EventListenerManager(
    private val project: Project,
    private val editorStateManager: EditorStateManager,
    private val windowStateManager: WindowStateManager
) {
    private val log: Logger = Logger.getInstance(EventListenerManager::class.java)

    // 全局唯一的光标监听器引用
    private var currentCaretListener: com.intellij.openapi.editor.event.CaretListener? = null

    // 全局唯一的选中监听器引用
    private var currentSelectionListener: com.intellij.openapi.editor.event.SelectionListener? = null
    private var currentEditor: Editor? = null
    private var messageBusConnection: MessageBusConnection? = null


    /**
     * 设置编辑器监听器
     */
    fun setupEditorListeners() {
        log.info("设置编辑器监听器")
        messageBusConnection = project.messageBus.connect();
        messageBusConnection?.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun fileOpened(source: FileEditorManager, file: VirtualFile) {
                    if (!FileUtils.isRegularFile(file)) {
                        log.info("事件-文件打开: ${file.path} - 非常规文件，已忽略")
                        return
                    }
                    log.info("事件-文件打开: ${file.path}")
                    val editor = source.selectedTextEditor
                    editor?.let {
                        val state = editorStateManager.createEditorState(
                            it, file, ActionType.OPEN, windowStateManager.isWindowActive()
                        )
                        log.info("准备发送打开消息: $state")
                        editorStateManager.updateState(state)
                        setupCaretListener(it)
                        setupSelectionListener(it)
                        currentEditor = it
                    }
                }

                override fun fileClosed(source: FileEditorManager, file: VirtualFile) {
                    if (!FileUtils.isRegularFile(file)) {
                        log.info("事件-文件关闭: ${file.path} - 非常规文件，已忽略")
                        return
                    }
                    log.info("事件-文件关闭: ${file.path}")

                    // 检查文件是否在其他编辑器中仍然打开
                    val isStillOpen = FileUtils.isFileOpenInOtherTabs(file)
                    if (isStillOpen) {
                        log.info("文件在其他编辑器中仍然打开，跳过关闭消息: ${file.path}")
                        return
                    }

                    // 创建关闭状态并发送到队列（无需依赖editor对象）
                    val state = editorStateManager.createCloseState(file.path, windowStateManager.isWindowActive())
                    log.info("准备发送关闭消息: $state")
                    editorStateManager.updateState(state)
                }

                override fun selectionChanged(event: FileEditorManagerEvent) {
                    if (event.newFile != null) {
                        if (!FileUtils.isRegularFile(event.newFile!!)) {
                            log.info("事件-文件改变: ${event.newFile!!.path} - 非常规文件，已忽略")
                            return
                        }
                        log.info("事件-文件改变: ${event.newFile!!.path}")
                        val (editor, _) = FileUtils.getCurrentActiveEditorAndFile()
                        editor?.let {
                            val state = editorStateManager.createEditorState(
                                it, event.newFile!!, ActionType.NAVIGATE, windowStateManager.isWindowActive()
                            )
                            log.info("准备发送导航消息: ${state.filePath}，${state.getCursorInfo()}，${state.getSelectionInfoStr()}")
                            editorStateManager.debouncedUpdateState(state)
                            setupCaretListener(it)
                            setupSelectionListener(it)
                            currentEditor = it
                        }
                    }
                }
            }
        )
        log.info("编辑器监听器设置完成")
    }

    /**
     * 设置光标监听器
     * 全局唯一，每次设置新监听器时会销毁之前的监听器
     */
    private fun setupCaretListener(editor: Editor) {
        log.info("开始设置光标监听器")

        // 销毁之前的光标监听器
        destroyCurrentCaretListener()

        // 创建新的光标监听器
        val newCaretListener = object : com.intellij.openapi.editor.event.CaretListener {
            override fun caretPositionChanged(event: com.intellij.openapi.editor.event.CaretEvent) {
                log.info("事件-光标改变")
                // 动态获取当前真正的文件
                val currentFile = event.editor.virtualFile
                if (currentFile != null) {
                    if (!FileUtils.isRegularFile(currentFile)) {
                        log.info("事件-光标改变: ${currentFile.path} - 非常规文件，已忽略")
                        return
                    }
                    log.info("事件-光标改变： 当前文件: ${currentFile.path}, 光标位置: 行${event.newPosition.line + 1}, 列${event.newPosition.column + 1}")

                    val state = editorStateManager.createEditorState(
                        event.editor, currentFile, ActionType.NAVIGATE, windowStateManager.isWindowActive()
                    )
                    log.info("准备发送导航消息: ${state.filePath}，${state.getCursorInfo()}，${state.getSelectionInfoStr()}")
                    editorStateManager.debouncedUpdateState(state)
                } else {
                    log.warn("事件-光标改变：无法获取当前文件，跳过处理")
                }
            }
        }

        // 添加新的监听器
        editor.caretModel.addCaretListener(newCaretListener)

        // 保存引用以便后续管理
        currentCaretListener = newCaretListener

        log.info("光标监听器设置完成")
    }

    /**
     * 设置选中监听器
     * 全局唯一，每次设置新监听器时会销毁之前的监听器
     */
    private fun setupSelectionListener(editor: Editor) {
        log.info("开始设置选中监听器")

        // 销毁之前的选中监听器
        destroyCurrentSelectionListener()

        // 创建新的选中监听器
        val newSelectionListener = object : com.intellij.openapi.editor.event.SelectionListener {
            override fun selectionChanged(event: com.intellij.openapi.editor.event.SelectionEvent) {
                log.info("事件-选中改变")
                // 动态获取当前真正的文件
                val currentFile = event.editor.virtualFile
                if (currentFile != null) {
                    if (!FileUtils.isRegularFile(currentFile)) {
                        log.info("事件-选中改变: ${currentFile.path} - 非常规文件，已忽略")
                        return
                    }

                    val selectionModel = event.editor.selectionModel
                    val hasSelection = selectionModel.hasSelection()
                    log.info("事件-选中改变: ${currentFile.path}, 是否有选中: $hasSelection")

                    if (hasSelection) {
                        val startPosition = event.editor.offsetToLogicalPosition(selectionModel.selectionStart)
                        val endPosition = event.editor.offsetToLogicalPosition(selectionModel.selectionEnd)
                        log.info("选中范围: ${startPosition.line},${startPosition.column}-${endPosition.line},${endPosition.column}")
                    }

                    val state = editorStateManager.createEditorState(
                        event.editor, currentFile, ActionType.NAVIGATE, windowStateManager.isWindowActive()
                    )
                    log.info("准备发送导航消息: ${state.filePath}，${state.getCursorInfo()}，${state.getSelectionInfoStr()}")
                    editorStateManager.debouncedUpdateState(state)
                } else {
                    log.warn("事件-选中改变：无法获取当前文件，跳过处理")
                }
            }
        }

        // 添加新的监听器
        editor.selectionModel.addSelectionListener(newSelectionListener)

        // 保存引用以便后续管理
        currentSelectionListener = newSelectionListener

        log.info("选中监听器设置完成")
    }

    /**
     * 销毁当前的光标监听器
     */
    private fun destroyCurrentCaretListener() {
        if (currentCaretListener != null && currentEditor != null) {
            log.info("销毁之前的光标监听器")
            try {
                currentEditor!!.caretModel.removeCaretListener(currentCaretListener!!)
                log.info("光标监听器销毁成功")
            } catch (e: Exception) {
                log.warn("销毁光标监听器时出现异常: ${e.message}")
            }
            currentCaretListener = null
        }
    }

    /**
     * 销毁当前的选中监听器
     */
    private fun destroyCurrentSelectionListener() {
        if (currentSelectionListener != null && currentEditor != null) {
            log.info("销毁之前的选中监听器")
            try {
                currentEditor!!.selectionModel.removeSelectionListener(currentSelectionListener!!)
                log.info("选中监听器销毁成功")
            } catch (e: Exception) {
                log.warn("销毁选中监听器时出现异常: ${e.message}")
            }
            currentSelectionListener = null
        }
    }


    /**
     * 清理资源
     */
    fun dispose() {
        log.info("开始清理EventListenerManager资源")
        messageBusConnection?.disconnect()
        messageBusConnection?.dispose()
        destroyCurrentCaretListener()
        destroyCurrentSelectionListener()
        currentEditor = null
        log.info("EventListenerManager资源清理完成")
    }
}
