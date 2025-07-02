package com.vscode.jetbrainssync

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.net.URI
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock
import javax.swing.Timer
import kotlin.concurrent.thread

/**
 * WebSocket连接管理器
 * 负责WebSocket连接的建立、维护、重连和状态管理
 */
class WebSocketConnectionManager(
    private val project: Project,
    private val messageProcessor: MessageProcessor
) {
    private val log: Logger = Logger.getInstance(WebSocketConnectionManager::class.java)

    private var webSocket: WebSocketClient? = null
    private val connectionState = AtomicReference(ConnectionState.DISCONNECTED)
    private val autoReconnect = AtomicBoolean(false)
    private var connectionCallback: ConnectionCallback? = null

    // 同步锁，保护关键操作的线程安全
    private val connectionLock = ReentrantLock()

    // 循环线程池和定时器
    private val scheduleExecutorService: ExecutorService = Executors.newSingleThreadExecutor { r ->
        val thread = Thread(r, "WebSocket-Schedule-Connection-Worker")
        thread.isDaemon = true
        thread
    }

    // 线程池和定时器
    private val executorService: ExecutorService = Executors.newSingleThreadExecutor { r ->
        val thread = Thread(r, "WebSocket-Connection-Worker")
        thread.isDaemon = true
        thread
    }


    // 配置参数
    private val reconnectDelayMs = 5000L


    fun setConnectionCallback(callback: ConnectionCallback) {
        this.connectionCallback = callback
    }


    init {
        loopConnectWebSocket()
    }

    /**
     * 切换自动重连状态
     * 使用锁保护状态切换的原子性，避免竞态条件
     */
    fun toggleAutoReconnect() {
        connectionLock.lock()
        try {
            val currentState = autoReconnect.get()
            val newState = !currentState

            // 使用 compareAndSet 确保状态变更的原子性
            if (!autoReconnect.compareAndSet(currentState, newState)) {
                log.warn("自动重连状态已被其他线程修改，操作取消")
                return
            }

            log.info("自动重连状态切换为: ${if (newState) "开启" else "关闭"}")

            if (!newState) {
                disconnectAndCleanup()
                log.info("同步已关闭，连接已断开")
            } else {
                connectWebSocket()
                log.info("同步已开启，开始连接...")
            }
        } finally {
            connectionLock.unlock()
        }
    }


    /**
     * 循环创建WebSocket客户端并尝试连接
     */
    private fun loopConnectWebSocket() {
        scheduleExecutorService.submit {
            while (true) {
                if (autoReconnect.get().not()) {
                    Thread.sleep(reconnectDelayMs)
                    continue;
                }
                connectWebSocket()
                Thread.sleep(reconnectDelayMs)
            }
        }
    }


    /**
     */
    private fun connectWebSocket() {
        executorService.submit {
            try {
                if (autoReconnect.get().not()) {
                    return@submit
                }
                if (!connectionState.compareAndSet(ConnectionState.DISCONNECTED, ConnectionState.CONNECTING)) {
                    return@submit
                }
                // 断开并清理
                cleanUp()

                ApplicationManager.getApplication().invokeLater { connectionCallback?.onReconnecting() }
                val port = VSCodeJetBrainsSyncSettings.getInstance(project).state.port
                log.info("尝试连接到VSCode，端口: $port")

                webSocket = createWebSocketClient(port)
                webSocket?.connectionLostTimeout = 0

                val connectResult = webSocket?.connectBlocking()
                if (connectResult != true) {
                    handleConnectionError()
                }
            } catch (e: InterruptedException) {
                log.warn("线程被中断")
                return@submit
            } catch (e: Exception) {
                try {
                    log.warn("WebSocket服务器错误: ${e.message}", e)
                    handleConnectionError()
                } catch (e: Exception) {

                }
            }
        }
    }

    /**
     * 创建WebSocket客户端
     */
    private fun createWebSocketClient(port: Int): WebSocketClient {
        return object : WebSocketClient(URI("ws://localhost:${port}/jetbrains")) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                log.info("成功连接到VSCode，端口: $port")
                connectionState.set(ConnectionState.CONNECTED)
                ApplicationManager.getApplication().invokeLater {
                    connectionCallback?.onConnected()
                    log.info("JetBrains IDE客户端已连接")
                    showNotification("已连接到VSCode", NotificationType.INFORMATION)
                }
            }

            override fun onMessage(message: String?) {
                message?.let { messageProcessor.handleIncomingMessage(it) }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                log.info("与VSCode连接断开 - 代码: $code, 原因: $reason, 远程断开: $remote")
                showNotification("与VSCode连接断开", NotificationType.WARNING)
                handleConnectionError()
            }

            override fun onError(ex: Exception?) {
                log.warn("WebSocket连接错误: ${ex?.message}")
                handleConnectionError()
            }
        }
    }

    /**
     * 发送消息
     */
    fun sendMessage(message: String): Boolean {
        if (isConnected().not() || isAutoReconnect().not()) {
            log.warn("当前未连接，丢弃消息: $message")
            return false
        }
        return webSocket?.let { client ->
            if (client.isOpen) {
                try {
                    if (!isConnected()) {
                        log.info("当前未连接，丢弃消息: $message")
                    }
                    client.send(message)
                    true
                } catch (e: Exception) {
                    log.warn("发送消息失败: ${e.message}", e)
                    false
                }
            } else {
                log.warn("WebSocket未连接，状态: ${client.readyState}")
                if (connectionState.get() != ConnectionState.CONNECTING) {
                    connectWebSocket()
                }
                false
            }
        } ?: run {
            log.warn("WebSocket客户端为空，尝试重连...")
            connectWebSocket()
            false
        }
    }

    /**
     * 处理连接错误
     * 使用锁保护状态变更，确保错误处理的原子性
     */
    private fun handleConnectionError() {
        connectionState.set(ConnectionState.DISCONNECTED)
        ApplicationManager.getApplication().invokeLater {
            connectionCallback?.onDisconnected()
        }
        Thread.sleep(reconnectDelayMs)
        // 尝试重新连接
        connectWebSocket()
    }


    /**
     * 断开连接并清理资源
     * 使用锁保护清理操作的原子性
     */
    fun disconnectAndCleanup() {
        cleanUp()
        connectionState.set(ConnectionState.DISCONNECTED)
        ApplicationManager.getApplication().invokeLater {
            connectionCallback?.onDisconnected()
        }
    }


    fun cleanUp() {
        connectionLock.lock()
        try {
            webSocket?.let { client ->
                if (client.isOpen) {
                    client.close()
                    log.info("WebSocket连接已关闭")
                }
                webSocket = null
            }
        } finally {
            connectionLock.unlock()
        }
    }

    /**
     * 重启连接
     * 通过调用线程安全的方法来实现重启
     */
    fun restartConnection() {
        log.info("手动重启连接")
        connectWebSocket()
    }

    /**
     * 显示通知
     */
    private fun showNotification(message: String, type: NotificationType) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("VSCode JetBrains Sync")
            .createNotification(message, type)
            .notify(project)
    }

    // 状态查询方法
    fun isConnected(): Boolean = connectionState.get() == ConnectionState.CONNECTED
    fun isAutoReconnect(): Boolean = autoReconnect.get()
    fun isConnecting(): Boolean = connectionState.get() == ConnectionState.CONNECTING
    fun isDisconnected(): Boolean = connectionState.get() == ConnectionState.DISCONNECTED
    fun getConnectionState(): ConnectionState = connectionState.get()

    /**
     * 清理资源
     */
    fun dispose() {
        log.info("开始清理WebSocket连接管理器资源")

        autoReconnect.set(false)
        executorService.shutdown()
        try {
            if (!executorService.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)) {
                executorService.shutdownNow()
            }
        } catch (e: InterruptedException) {
            executorService.shutdownNow()
        }
        scheduleExecutorService.shutdown()
        try {
            if (!scheduleExecutorService.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)) {
                scheduleExecutorService.shutdownNow()
            }
        } catch (e: InterruptedException) {
            scheduleExecutorService.shutdownNow()
        }

        disconnectAndCleanup()
        log.info("WebSocket连接管理器资源清理完成")
    }
}
