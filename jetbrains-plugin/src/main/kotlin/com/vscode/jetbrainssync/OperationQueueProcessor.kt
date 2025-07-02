package com.vscode.jetbrainssync

import com.intellij.openapi.diagnostic.Logger

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 操作队列处理器
 * 负责处理异步操作队列，确保文件操作的原子性和顺序性
 * 包含队列容量管理和操作添加逻辑
 */
class OperationQueueProcessor(
    private val messageProcessor: MessageProcessor,
    private val webSocketManager: WebSocketConnectionManager,
) {
    private val log: Logger = Logger.getInstance(OperationQueueProcessor::class.java)

    // 内部队列管理
    private val operationQueue = LinkedBlockingQueue<EditorState>()
    private val maxQueueSize = 100

    // 线程池
    private val executorService: ExecutorService = Executors.newSingleThreadExecutor { r ->
        val thread = Thread(r, "Operation-Queue-Processor")
        thread.isDaemon = true
        thread
    }

    // 处理状态
    private val isShutdown = AtomicBoolean(false)

    init {
        // 在构造函数中自动启动队列处理器
        start()
    }

    /**
     * 添加操作到队列
     * 包含队列容量管理逻辑
     */
    fun addOperation(state: EditorState) {
        if (operationQueue.size >= maxQueueSize) {
            operationQueue.poll()
            log.warn("操作队列已满，移除最旧的操作")
        }

        operationQueue.offer(state)
        log.info("状态已推入队列：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}")
    }

    /**
     * 启动队列处理器
     */
    fun start() {
        log.info("启动操作队列处理器")
        executorService.submit(this::processQueue)
    }

    /**
     * 队列处理主循环
     */
    private fun processQueue() {
        while (!isShutdown.get() && !Thread.currentThread().isInterrupted) {
            try {
                // 阻塞等待队列中的任务
                val state = operationQueue.take()
                processOperation(state)

                // 避免过于频繁的操作
                Thread.sleep(50)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            } catch (e: Exception) {
                log.warn("队列处理器发生错误: ${e.message}", e)
            }
        }
    }

    /**
     * 处理单个操作
     */
    private fun processOperation(state: EditorState) {
        try {
            sendStateUpdate(state)
        } catch (e: Exception) {
            log.warn("处理操作失败: ${e.message}", e)
        }
    }

    /**
     * 发送状态更新
     */
    private fun sendStateUpdate(state: EditorState) {
        val message = messageProcessor.serializeState(state)
        if (message.isEmpty()) {
            return
        }
        val success = webSocketManager.sendMessage(message)
        if (success) {
            log.info("✅ 发送消息VSCode：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}")
        } else {
            log.info("❌ 发送消息VSCode：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}")
        }
    }


    /**
     * 停止处理器
     */
    fun dispose() {
        log.info("开始关闭操作队列处理器")

        isShutdown.set(true)
        executorService.shutdown()

        try {
            if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                executorService.shutdownNow()
            }
        } catch (e: InterruptedException) {
            executorService.shutdownNow()
        }

        // 清理队列
        operationQueue.clear()

        log.info("操作队列处理器已关闭")
    }
}
