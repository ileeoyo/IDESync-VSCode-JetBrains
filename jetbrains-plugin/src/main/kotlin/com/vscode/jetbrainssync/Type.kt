package com.vscode.jetbrainssync

import java.text.SimpleDateFormat
import java.util.*


/**
 * 操作类型枚举
 * 定义编辑器同步过程中的各种操作类型
 * 枚举名称直接对应JSON传输格式，无需自定义序列化
 */
enum class ActionType {
    CLOSE,      // 关闭文件
    OPEN,       // 打开文件
    NAVIGATE,   // 光标导航和代码选中
    WORKSPACE_SYNC  // 工作区状态同步
}

/**
 * 消息来源枚举
 * 定义消息的发送方
 */
enum class SourceType {
    VSCODE,     // VSCode编辑器
    JETBRAINS   // JetBrains IDE
}

/**
 * WebSocket连接状态枚举
 * 定义WebSocket连接的各种状态
 */
enum class ConnectionState {
    DISCONNECTED,   // 未连接
    CONNECTING,     // 连接中
    CONNECTED       // 已连接
}

/**
 * 编辑器状态数据类
 * 用于在VSCode和JetBrains之间同步编辑器状态
 */
data class EditorState(
    val action: ActionType,         // 操作类型枚举（必填）
    val filePath: String,           // 文件路径
    val line: Int,                  // 行号（从0开始）
    val column: Int,                // 列号（从0开始）
    val source: SourceType = SourceType.JETBRAINS, // 消息来源枚举
    val isActive: Boolean = false,  // IDE是否处于活跃状态
    val timestamp: String = formatTimestamp(), // 时间戳 (yyyy-MM-dd HH:mm:ss.SSS)
    val openedFiles: List<String>? = null,  // 工作区所有打开的文件（仅WORKSPACE_SYNC类型使用）
    // 选中范围相关字段（NAVIGATE类型使用）
    val selectionStartLine: Int? = null,    // 选中开始行号（从0开始）
    val selectionStartColumn: Int? = null,  // 选中开始列号（从0开始）
    val selectionEndLine: Int? = null,      // 选中结束行号（从0开始）
    val selectionEndColumn: Int? = null     // 选中结束列号（从0开始）
) {
    // 平台兼容路径缓存
    @Transient
    private var _compatiblePath: String? = null

    /**
     * 获取平台兼容的文件路径
     * 首次调用时会清理和转换原始路径，并缓存结果
     * 后续调用直接返回缓存的路径
     */
    fun getCompatiblePath(): String {
        // 如果已经缓存，直接返回
        _compatiblePath?.let {
            return it
        }

        // 首次调用，进行路径清理和转换
        val cleaned = cleanFilePath(filePath)
        val converted = convertToIdeaFormat(cleaned)
        _compatiblePath = converted

        // 输出日志
        if (converted != filePath) {
            // 使用系统日志输出路径转换信息
            System.out.println("EditorState: 路径已转换 $filePath -> $converted")
        }

        return converted
    }

    /**
     * 清理文件路径，移除异常后缀
     * 参考FileOperationHandler中的cleanFilePath方法
     */
    private fun cleanFilePath(path: String): String {
        var cleaned = path

        // 移除异常的.git后缀
        if (cleaned.endsWith(".git")) {
            cleaned = cleaned.removeSuffix(".git")
        }

        // 移除其他可能的异常后缀
        val abnormalSuffixes = listOf(".tmp", ".bak", ".swp")
        for (suffix in abnormalSuffixes) {
            if (cleaned.endsWith(suffix)) {
                cleaned = cleaned.removeSuffix(suffix)
                break
            }
        }

        return cleaned
    }

    /**
     * 转换路径为IDEA格式
     * 处理跨平台路径兼容性，确保路径格式统一
     */
    private fun convertToIdeaFormat(path: String): String {
        var ideaPath = path

        // 获取操作系统信息
        val osName = System.getProperty("os.name").lowercase()
        val isWindows = osName.contains("windows")
        val isMacOS = osName.contains("mac")
        val isLinux = osName.contains("linux") || osName.contains("unix")

        if (isWindows) {
            // Windows: 将反斜杠替换为正斜杠，处理盘符大小写
            ideaPath = ideaPath.replace('\\', '/')
            if (ideaPath.matches(Regex("^[a-z]:/.*")) || ideaPath.matches(Regex("^[a-z]:.*"))) {
                ideaPath = ideaPath[0].uppercaseChar() + ideaPath.substring(1)
            }
        } else if (isMacOS || isLinux) {
            // macOS/Linux: 确保使用正斜杠，保持Unix路径格式
            ideaPath = ideaPath.replace('\\', '/')

            // 确保路径以 / 开头（Unix绝对路径）
            if (!ideaPath.startsWith('/')) {
                ideaPath = "/$ideaPath"
            }

            // 清理重复的斜杠
            ideaPath = ideaPath.replace(Regex("/+"), "/")
        }

        return ideaPath
    }

    /**
     * 检查是否有选中范围
     * @return 如果有选中范围返回true，否则返回false
     */
    fun hasSelection(): Boolean {
        return selectionStartLine != null &&
                selectionEndLine != null &&
                selectionStartColumn != null &&
                selectionEndColumn != null
    }

    /**
     * 获取格式化的选中范围字符串
     * @return 如果有选中范围，返回格式化字符串；否则返回null
     */
    fun getSelectionInfo(): String? {
        if (!hasSelection()) {
            return null
        }

        return "${selectionStartLine!! + 1},${selectionStartColumn!! + 1}-${selectionEndLine!! + 1},${selectionEndColumn!! + 1}"
    }


    fun getSelectionInfoStr(): String? {
        return getSelectionInfo()?.let { "选中范围：$it" } ?: "无"
    }

    /**
     * 获取格式化的光标位置字符串
     * @return 格式化的光标位置字符串
     */
    fun getCursorInfo(): String {
        return "行${line + 1}, 列${column + 1}"
    }
}

/**
 * 格式化时间戳为标准格式
 * @param timestamp 时间戳（毫秒），默认为当前时间
 * @return 格式化的时间字符串 (yyyy-MM-dd HH:mm:ss.SSS)
 */
fun formatTimestamp(timestamp: Long = System.currentTimeMillis()): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS")
    return formatter.format(Date(timestamp))
}

/**
 * 解析时间戳字符串为毫秒数
 * @param timestampStr 时间戳字符串
 * @return 毫秒数
 */
fun parseTimestamp(timestampStr: String): Long {
    val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS")
    return formatter.parse(timestampStr).time
}


// 回调接口
interface ConnectionCallback {
    fun onConnected()

    fun onDisconnected()

    fun onReconnecting()
}

/**
 * 消息包装器数据类
 * 用于组播消息的统一包装和处理
 */
data class MessageWrapper(
    val messageId: String,
    val senderId: String,
    val timestamp: Long,
    val payload: EditorState
) {
    companion object {
        private var messageSequence = java.util.concurrent.atomic.AtomicLong(0)
        private val gson = com.google.gson.Gson()

        /**
         * 生成消息ID
         * 格式: {localIdentifier}-{sequence}-{timestamp}
         */
        fun generateMessageId(localIdentifier: String): String {
            val sequence = messageSequence.incrementAndGet()
            val timestamp = System.currentTimeMillis()
            return "$localIdentifier-$sequence-$timestamp"
        }

        /**
         * 创建消息包装器
         */
        fun create(localIdentifier: String, payload: EditorState): MessageWrapper {
            return MessageWrapper(
                messageId = generateMessageId(localIdentifier),
                senderId = localIdentifier,
                timestamp = System.currentTimeMillis(),
                payload = payload
            )
        }

        /**
         * 从JSON字符串解析MessageWrapper
         */
        fun fromJsonString(jsonString: String): MessageWrapper? {
            return try {
                gson.fromJson(jsonString, MessageWrapper::class.java)
            } catch (e: Exception) {
                null
            }
        }
    }

    /**
     * 转换为JSON字符串
     */
    fun toJsonString(): String {
        return MessageWrapper.gson.toJson(this)
    }

    /**
     * 检查是否是自己发送的消息
     */
    fun isOwnMessage(localIdentifier: String): Boolean {
        return senderId == localIdentifier
    }
}