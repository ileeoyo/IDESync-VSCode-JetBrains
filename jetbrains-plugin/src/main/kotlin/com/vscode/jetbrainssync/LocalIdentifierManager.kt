package com.vscode.jetbrainssync

import java.net.InetAddress

/**
 * 本机标识管理器
 * 负责生成和管理本机唯一标识，供各个组件使用
 */
object LocalIdentifierManager {
    
    /**
     * 本机唯一标识
     * 在应用启动时生成，全局唯一
     */
    val identifier: String by lazy { generateLocalIdentifier() }
    
    /**
     * 生成本机唯一标识
     * 格式: hostname-pid-timestamp
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
}