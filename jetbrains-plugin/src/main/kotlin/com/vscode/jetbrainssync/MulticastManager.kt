package com.vscode.jetbrainssync

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.net.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.thread
import kotlin.jvm.java

// ==================== 内部数据类 ====================

/**
 * 消息包装器数据类
 */
private data class MessageWrapper(
    val messageId: String,
    val senderId: String,
    val timestamp: Long,
    val payload: String
)

/**
 * 组播管理器
 * 负责UDP组播消息的发送和接收，实现去中心化的编辑器同步
 */
class MulticastManager(
    private val project: Project,
    private val messageProcessor: MessageProcessor
) {
    private val log: Logger = Logger.getInstance(MulticastManager::class.java)

    // ==================== 配置常量 ====================
    private val multicastAddress = "224.0.0.1" // 本地链路组播地址，仅本机通信
    private var multicastPort: Int // 组播端口（从配置读取）
    private val maxMessageSize = 8192 // 最大消息大小（8KB）

    // ==================== 网络组件 ====================
    private var multicastSocket: MulticastSocket? = null
    private var networkInterface: NetworkInterface? = null
    private var group: InetSocketAddress? = null

    // ==================== 状态管理 ====================
    private val connectionState = AtomicReference(ConnectionState.DISCONNECTED)
    private val autoReconnect = AtomicBoolean(false)
    private var connectionCallback: ConnectionCallback? = null

    // ==================== 消息管理 ====================
    private val messageSequence = AtomicLong(0)
    private val receivedMessages = ConcurrentHashMap<String, Long>() // 消息去重
    private val maxReceivedMessagesSize = 500 // 最大缓存消息数量
    private val messageTimeoutMs = 15000L // 消息超时时间（30秒）

    // ==================== 线程管理 ====================
    private val executorService: ExecutorService = Executors.newCachedThreadPool { r ->
        val thread = Thread(r, "Multicast-Manager-Worker")
        thread.isDaemon = true
        thread
    }
    private val connectionLock = ReentrantLock()
    private val isShutdown = AtomicBoolean(false)
    private var receiverThread: Thread? = null

    // ==================== 本机标识 ====================
    private val localIdentifier = generateLocalIdentifier()

    init {
        // 从配置中读取组播端口（复用WebSocket端口配置）
        multicastPort = VSCodeJetBrainsSyncSettings.getInstance(project).state.port
        log.info("初始化组播管理器 - 地址: $multicastAddress:$multicastPort")
        // 清理过期消息的定时任务
        startMessageCleanupTask()
    }

    // ==================== 初始化相关方法 ====================

    /**
     * 生成本机唯一标识
     */
    private fun generateLocalIdentifier(): String {
        return try {
            val hostname = InetAddress.getLocalHost().hostName
            val pid = ProcessHandle.current().pid()
            val timestamp = System.currentTimeMillis()
            "$hostname-$pid-$timestamp"
        } catch (e: Exception) {
            "unknown-${System.currentTimeMillis()}-${(Math.random() * 10000).toInt()}"
        }
    }

    /**
     * 更新组播端口配置
     */
    fun updateMulticastPort() {
        val newPort = VSCodeJetBrainsSyncSettings.getInstance(project).state.port
        if (newPort != multicastPort) {
            log.info("组播端口配置变更: $multicastPort -> $newPort")

            // 更新端口
            multicastPort = newPort

            // 如果当前已启用自动重连，则重启连接
            if (this.autoReconnect.get()) {
                this.restartConnection();
            }
        }
    }

    /**
     * 启动消息清理定时任务
     */
    private fun startMessageCleanupTask() {
        executorService.submit {
            while (!isShutdown.get()) {
                try {
                    Thread.sleep(60000) // 每分钟清理一次
                    cleanupOldMessages()
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    log.warn("清理消息时发生错误: ${e.message}", e)
                }
            }
        }
    }

    // ==================== 公共接口方法 ====================

    /**
     * 设置连接状态回调
     */
    fun setConnectionCallback(callback: ConnectionCallback) {
        this.connectionCallback = callback
    }

    /**
     * 切换自动重连状态
     */
    fun toggleAutoReconnect() {
        connectionLock.lock()
        try {
            val currentState = autoReconnect.get()
            val newState = !currentState

            if (!autoReconnect.compareAndSet(currentState, newState)) {
                log.warn("自动重连状态已被其他线程修改，操作取消")
                return
            }

            log.info("组播同步状态切换为: ${if (newState) "开启" else "关闭"}")

            if (!newState) {
                disconnectAndCleanup()
                log.info("组播同步已关闭")
            } else {
                connectMulticast()
                log.info("组播同步已开启，开始连接...")
            }
        } finally {
            connectionLock.unlock()
        }
    }

    /**
     * 重启连接
     */
    fun restartConnection() {
        log.info("手动重启组播连接")
        disconnectAndCleanup()
        if (autoReconnect.get()) {
            connectMulticast()
        }
    }

    // ==================== 连接管理方法 ====================

    /**
     * 连接组播组
     */
    private fun connectMulticast() {
        if (isShutdown.get() || !autoReconnect.get() || connectionState.get() != ConnectionState.DISCONNECTED) {
            return
        }

        executorService.submit {
            try {
                if (!autoReconnect.get() || isShutdown.get()) {
                    return@submit
                }

                if (!connectionState.compareAndSet(ConnectionState.DISCONNECTED, ConnectionState.CONNECTING)) {
                    log.info("连接状态不是DISCONNECTED，跳过连接尝试")
                    return@submit
                }

                setConnectionState(ConnectionState.CONNECTING)
                log.info("正在连接组播组...")

                // 清理现有连接
                cleanUp()

                // 查找可用的网络接口
                networkInterface = findAvailableNetworkInterface()
                if (networkInterface == null) {
                    throw RuntimeException("未找到可用的网络接口")
                }

                log.info("使用网络接口: ${networkInterface!!.displayName}")

                // 创建组播套接字
                multicastSocket = MulticastSocket(multicastPort)
                multicastSocket!!.reuseAddress = true
                multicastSocket!!.networkInterface = networkInterface

                // 加入组播组
                group = InetSocketAddress(InetAddress.getByName(multicastAddress), multicastPort)
                multicastSocket!!.joinGroup(group, networkInterface)

                setConnectionState(ConnectionState.CONNECTED)
                log.info("成功加入组播组: $multicastAddress:$multicastPort")

                // 启动消息接收线程
                startMessageReceiver()

            } catch (e: Exception) {
                log.warn("连接组播组失败: ${e.message}", e)
                handleConnectionError()
            }
        }
    }

    /**
     * 查找可用的网络接口
     */
    private fun findAvailableNetworkInterface(): NetworkInterface? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()

            // 优先使用回环接口，确保仅本机通信
            for (netInterface in interfaces) {
                if (netInterface.isLoopback &&
                    netInterface.isUp &&
                    netInterface.supportsMulticast()
                ) {
                    log.info("使用回环网络接口: ${netInterface.displayName}")
                    return netInterface
                }
            }

            // 如果回环接口不可用，尝试使用本地链路接口作为备选
            log.warn("回环接口不可用，尝试使用本地链路接口")
            for (netInterface in interfaces) {
                if (!netInterface.isLoopback &&
                    netInterface.isUp &&
                    netInterface.supportsMulticast() &&
                    netInterface.inetAddresses.hasMoreElements()
                ) {
                    // 检查是否为本地链路地址
                    val addresses = netInterface.inetAddresses
                    while (addresses.hasMoreElements()) {
                        val address = addresses.nextElement()
                        if (address.isSiteLocalAddress || address.isLinkLocalAddress) {
                            log.info("使用本地链路网络接口: ${netInterface.displayName}")
                            return netInterface
                        }
                    }
                }
            }

            log.error("未找到可用的网络接口")
            return null

        } catch (e: Exception) {
            log.warn("查找网络接口时发生错误: ${e.message}", e)
            return null
        }
    }

    /**
     * 启动消息接收线程
     */
    private fun startMessageReceiver() {
        receiverThread = thread(name = "Multicast-Message-Receiver") {
            val buffer = ByteArray(maxMessageSize)

            while (!isShutdown.get() && isConnected()) {
                try {
                    val packet = DatagramPacket(buffer, buffer.size)
                    multicastSocket?.receive(packet)

                    if (packet.length > 0) {
                        val message = String(packet.data, 0, packet.length, Charsets.UTF_8)
                        handleReceivedMessage(message)
                    }

                } catch (e: SocketTimeoutException) {
                    // 超时是正常的，继续循环
                    continue
                } catch (e: Exception) {
                    if (!isShutdown.get()) {
                        log.warn("接收组播消息时发生错误: ${e.message}", e)
                        handleConnectionError()
                        break
                    }
                }
            }

            log.info("消息接收线程已退出")
        }
    }

    // ==================== 消息处理方法 ====================

    /**
     * 处理接收到的消息
     */
    private fun handleReceivedMessage(message: String) {
        try {
            val messageData = parseMessageData(message)
            if (messageData == null) return

            // 检查是否是自己发送的消息
            if (isOwnMessage(messageData)) {
                log.debug("忽略自己发送的消息")
                return
            }
            log.info("收到组播消息: $message")

            // 检查消息去重
            if (isDuplicateMessage(messageData)) {
                log.debug("忽略重复消息: ${messageData.messageId}")
                return
            }

            // 记录消息并处理
            recordMessage(messageData)
            processMessage(messageData)

        } catch (e: Exception) {
            log.warn("处理接收到的消息时发生错误: ${e.message}", e)
        }
    }

    /**
     * 检查是否是自己发送的消息
     */
    private fun isOwnMessage(messageData: MessageWrapper): Boolean {
        return messageData.senderId == localIdentifier
    }

    /**
     * 检查是否是重复消息
     */
    private fun isDuplicateMessage(messageData: MessageWrapper): Boolean {
        return receivedMessages.containsKey(messageData.messageId)
    }

    /**
     * 记录消息ID
     */
    private fun recordMessage(messageData: MessageWrapper) {
        val currentTime = System.currentTimeMillis()
        receivedMessages[messageData.messageId] = currentTime

        if (receivedMessages.size > maxReceivedMessagesSize) {
            cleanupOldMessages()
        }
    }

    /**
     * 处理消息内容
     */
    private fun processMessage(messageData: MessageWrapper) {
        if (messageData.payload.isNotEmpty()) {
            messageProcessor.handleIncomingMessage(messageData.payload)
        }
    }

    /**
     * 发送消息到组播组
     */
    fun sendMessage(message: String): Boolean {
        if (!isConnected() || !autoReconnect.get()) {
            log.warn("当前未连接，丢弃消息: $message")
            return false
        }

        return try {
            val messageId = generateMessageId()
            val wrappedMessage = wrapMessage(message, messageId)
            val messageBytes = wrappedMessage.toByteArray(Charsets.UTF_8)

            if (messageBytes.size > maxMessageSize) {
                log.warn("消息过大，无法发送: ${messageBytes.size} bytes")
                return false
            }

            val packet = DatagramPacket(
                messageBytes,
                messageBytes.size,
                InetAddress.getByName(multicastAddress),
                multicastPort
            )

            multicastSocket?.send(packet)
            log.info("✅ 发送组播消息: $message")
            true

        } catch (e: Exception) {
            log.warn("发送组播消息失败: ${e.message}", e)
            handleConnectionError()
            false
        }
    }

    /**
     * 生成消息ID
     */
    private fun generateMessageId(): String {
        val sequence = messageSequence.incrementAndGet()
        val timestamp = System.currentTimeMillis()
        return "$localIdentifier-$sequence-$timestamp"
    }

    /**
     * 包装消息
     */
    private fun wrapMessage(payload: String, messageId: String): String {
        val wrapper = mapOf(
            "messageId" to messageId,
            "senderId" to localIdentifier,
            "timestamp" to System.currentTimeMillis(),
            "payload" to payload
        )
        return com.google.gson.Gson().toJson(wrapper)
    }

    /**
     * 解析消息数据
     */
    private fun parseMessageData(message: String): MessageWrapper? {
        return try {
            val gson = com.google.gson.Gson()
            gson.fromJson(message, MessageWrapper::class.java)
        } catch (e: Exception) {
            log.warn("解析消息包装器失败: ${e.message}")
            null
        }
    }

    /**
     * 清理过期消息
     */
    private fun cleanupOldMessages() {
        val currentTime = System.currentTimeMillis()
        val iterator = receivedMessages.entries.iterator()

        while (iterator.hasNext()) {
            val entry = iterator.next()
            if (currentTime - entry.value > messageTimeoutMs) {
                iterator.remove()
            }
        }

        log.debug("清理过期消息，当前缓存消息数: ${receivedMessages.size}")
    }

    // ==================== 状态管理方法 ====================

    /**
     * 处理连接错误
     */
    private fun handleConnectionError() {
        setConnectionState(ConnectionState.DISCONNECTED)

        if (autoReconnect.get() && !isShutdown.get()) {
            executorService.submit {
                try {
                    Thread.sleep(5000) // 等待5秒后重连
                    if (autoReconnect.get() && !isShutdown.get()) {
                        connectMulticast()
                    }
                } catch (e: InterruptedException) {
                    // 线程被中断，退出
                }
            }
        }
    }

    /**
     * 设置连接状态并触发回调
     */
    private fun setConnectionState(state: ConnectionState) {
        if (connectionState.get() == state) {
            return
        }

        connectionState.set(state)

        when (state) {
            ConnectionState.CONNECTED -> connectionCallback?.onConnected()
            ConnectionState.CONNECTING -> connectionCallback?.onReconnecting()
            ConnectionState.DISCONNECTED -> connectionCallback?.onDisconnected()
        }
    }

    // ==================== 资源清理方法 ====================

    /**
     * 断开连接并清理资源
     */
    fun disconnectAndCleanup() {
        cleanUp()
        setConnectionState(ConnectionState.DISCONNECTED)
    }

    /**
     * 清理资源
     */
    private fun cleanUp() {
        connectionLock.lock()
        try {
            // 停止接收线程
            receiverThread?.interrupt()
            receiverThread = null

            // 离开组播组
            if (multicastSocket != null && group != null && networkInterface != null) {
                try {
                    multicastSocket!!.leaveGroup(group, networkInterface)
                    log.info("已离开组播组")
                } catch (e: Exception) {
                    log.warn("离开组播组时发生错误: ${e.message}")
                }
            }

            // 关闭套接字
            multicastSocket?.close()
            multicastSocket = null
            group = null
            networkInterface = null

        } finally {
            connectionLock.unlock()
        }
    }

    /**
     * 清理资源
     */
    fun dispose() {
        log.info("开始清理组播管理器资源")

        isShutdown.set(true)
        autoReconnect.set(false)

        // 清理连接
        disconnectAndCleanup()

        // 关闭线程池
        executorService.shutdown()
        try {
            if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                executorService.shutdownNow()
            }
        } catch (e: InterruptedException) {
            executorService.shutdownNow()
        }

        // 清理消息缓存
        receivedMessages.clear()

        log.info("组播管理器资源清理完成")
    }

    // ==================== 状态查询方法 ====================

    fun isConnected(): Boolean = connectionState.get() == ConnectionState.CONNECTED
    fun isAutoReconnect(): Boolean = autoReconnect.get()
    fun isConnecting(): Boolean = connectionState.get() == ConnectionState.CONNECTING
    fun isDisconnected(): Boolean = connectionState.get() == ConnectionState.DISCONNECTED
    fun getConnectionState(): ConnectionState = connectionState.get()

} 