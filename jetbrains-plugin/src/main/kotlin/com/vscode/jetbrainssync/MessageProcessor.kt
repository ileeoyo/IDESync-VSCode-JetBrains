package com.vscode.jetbrainssync

import com.google.gson.Gson
import com.intellij.openapi.diagnostic.Logger

/**
 * 消息处理器
 * 负责WebSocket消息的序列化、反序列化和路由处理
 */
class MessageProcessor(
    private val fileOperationHandler: FileOperationHandler
) {
    private val log: Logger = Logger.getInstance(MessageProcessor::class.java)
    private val gson = Gson()

    private val messageTimeOutMs = 5000;

    /**
     * 处理接收到的消息
     */
    fun handleIncomingMessage(message: String) {
        try {
            log.info("收到消息: $message")
            val state = gson.fromJson(message, EditorState::class.java)
            log.info("\uD83C\uDF55解析消息: ${state.action} ${serializeState(state)}")

            // 验证消息有效性
            if (!isValidMessage(state)) {
                return
            }

            // 路由到文件操作处理器
            fileOperationHandler.handleIncomingState(state)

        } catch (e: Exception) {
            log.warn("解析消息失败: ${e.message}", e)
        }
    }


    /**
     * 验证消息有效性
     */
    private fun isValidMessage(state: EditorState): Boolean {
        // 忽略来自自己的消息
        if (state.source == SourceType.JETBRAINS) {
            return false
        }

        // 只处理来自活跃IDE的消息
        if (!state.isActive) {
            log.info("忽略来自非活跃VSCode的消息")
            return false
        }

        // 检查消息时效性
        val messageTime = parseTimestamp(state.timestamp)
        val currentTime = System.currentTimeMillis()
        if (currentTime - messageTime > messageTimeOutMs) { // 5秒过期
            log.info("忽略过期消息，时间差: ${currentTime - messageTime}ms")
            return false
        }

        return true
    }


    /**
     * 序列化状态为消息
     */
    fun serializeState(state: EditorState): String {
        return try {
            gson.toJson(state)
        } catch (e: Exception) {
            log.warn("序列化状态失败: ${e.message}", e)
            ""
        }
    }
}
