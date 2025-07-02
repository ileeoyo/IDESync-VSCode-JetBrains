package com.vscode.jetbrainssync

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project

/**
 * VSCode与JetBrains同步服务（重构版）
 *
 * 采用模块化设计，主要组件：
 * - WebSocket连接管理器：负责连接的建立、维护和重连
 * - 编辑器状态管理器：管理状态缓存、防抖和去重
 * - 文件操作处理器：处理文件的打开、关闭和导航
 * - 事件监听管理器：统一管理各种事件监听器
 * - 消息处理器：处理消息的序列化和反序列化
 * - 操作队列处理器：确保操作的原子性和顺序性
 */
@Service(Service.Level.PROJECT)
class VSCodeJetBrainsSyncService(private val project: Project) : Disposable {
    private val log: Logger = Logger.getInstance(VSCodeJetBrainsSyncService::class.java)

    // 核心组件
    private val editorStateManager = EditorStateManager(project)
    private val fileOperationHandler = FileOperationHandler(project)
    private val messageProcessor = MessageProcessor(fileOperationHandler)
    private val webSocketManager = WebSocketConnectionManager(project, messageProcessor)
    private val eventListenerManager = EventListenerManager(project, editorStateManager)
    private val operationQueueProcessor = OperationQueueProcessor(messageProcessor, webSocketManager)


    init {
        log.info("初始化VSCode-JetBrains同步服务（重构版）")
        // 设置状态栏
        setupStatusBar()

        // 设置组件间的回调关系
        setupComponentCallbacks()
        // 初始化事件监听器
        eventListenerManager.setupEditorListeners()
        eventListenerManager.setupWindowListeners()

        log.info("同步服务初始化完成")
    }


    /**
     * 设置状态栏组件
     */
    private fun setupStatusBar() {
        ApplicationManager.getApplication().invokeLater {
            SyncStatusBarWidgetFactory().createWidget(project)
            log.info("状态栏组件设置完成")
        }
    }

    /**
     * 设置组件间的回调关系
     */
    private fun setupComponentCallbacks() {
        // 连接状态变化回调
        webSocketManager.setConnectionCallback(object : ConnectionCallback {
            override fun onConnected() {
                log.info("连接状态变更: 已连接");
                updateStatusBarWidget()
                editorStateManager.sendCurrentState(eventListenerManager.isActiveWindow())
            }

            override fun onDisconnected() {
                log.info("连接状态变更: 已断开");
                updateStatusBarWidget()
            }

            override fun onReconnecting() {
                log.info("连接状态变更: 正在重连");
                updateStatusBarWidget()
            }
        })

        // 状态变化回调
        editorStateManager.setStateChangeCallback(object : EditorStateManager.StateChangeCallback {
            override fun onStateChanged(state: EditorState) {
                if (eventListenerManager.isActiveWindow()) {
                    operationQueueProcessor.addOperation(state)
                }
            }
        })
    }

    /**
     * 更新状态栏显示
     */
    private fun updateStatusBarWidget() {
        ApplicationManager.getApplication().invokeLater {
            val statusBar = com.intellij.openapi.wm.WindowManager.getInstance().getStatusBar(project)
            val widget = statusBar?.getWidget(SyncStatusBarWidget.ID) as? SyncStatusBarWidget
            widget?.updateUI()
        }
    }


    /**
     * 切换自动重连状态
     */
    fun toggleAutoReconnect() {
        webSocketManager.toggleAutoReconnect()
        updateStatusBarWidget()
    }

    // 公共接口方法（委托给各个模块）

    fun isConnected(): Boolean = webSocketManager.isConnected()
    fun isAutoReconnect(): Boolean = webSocketManager.isAutoReconnect()
    fun isConnecting(): Boolean = webSocketManager.isConnecting()
    fun isDisconnected(): Boolean = webSocketManager.isDisconnected()

    /**
     * 重启连接
     */
    fun restartConnection() {
        webSocketManager.restartConnection()
    }


    /**
     * 清理资源
     */
    override fun dispose() {
        log.info("开始清理同步服务资源（重构版）")

        // 按顺序清理各个组件
        operationQueueProcessor.dispose()
        webSocketManager.dispose()
        editorStateManager.dispose()
        eventListenerManager.dispose()

        log.info("同步服务资源清理完成")
    }
}
