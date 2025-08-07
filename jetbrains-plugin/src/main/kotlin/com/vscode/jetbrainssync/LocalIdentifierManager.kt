package com.vscode.jetbrainssync

import com.intellij.openapi.project.Project
import java.net.InetAddress
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicLong

/**
 * 本机标识管理器
 * 负责生成和管理本机唯一标识，供各个组件使用
 * 支持多项目实例，通过项目路径区分不同的IDEA项目窗口
 * 支持VSCode多版本，通过PID区分同一项目的不同进程
 */
class LocalIdentifierManager(private val project: Project) {

    /**
     * 本机唯一标识
     * 在首次访问时生成，格式: hostname-projectHash-pid
     */
    val identifier: String by lazy { generateLocalIdentifier() }

    /**
     * 项目专属的消息序列号生成器
     * 解决多项目实例共享全局序列号的问题
     */
    private val messageSequence = AtomicLong(0)

    /**
     * 生成本机唯一标识
     * 格式: hostname-projectHash-pid
     * - projectHash: 解决IDEA多项目窗口PID相同的问题
     * - pid: 解决VSCode多版本同项目PID不同的问题
     */
    private fun generateLocalIdentifier(): String {
        return try {
            val hostname = InetAddress.getLocalHost().hostName
            val projectHash = generateProjectHash()
            val pid = ProcessHandle.current().pid()
            "$hostname-$projectHash-$pid"
        } catch (e: Exception) {
            "unknown-${System.currentTimeMillis()}-${(Math.random() * 10000).toInt()}"
        }
    }

    /**
     * 生成项目哈希值
     * 基于项目路径生成短哈希，用于区分不同项目实例
     */
    private fun generateProjectHash(): String {
        return try {
            val path = project.basePath ?: "unknown-project"
            val md = MessageDigest.getInstance("MD5")
            val hashBytes = md.digest(path.toByteArray())
            // 取前3字节（6位十六进制字符）作为项目哈希
            hashBytes.take(3).joinToString("") { "%02x".format(it) }
        } catch (e: Exception) {
            // 如果哈希生成失败，使用时间戳后6位作为后备方案
            System.currentTimeMillis().toString().takeLast(6)
        }
    }

    /**
     * 生成项目专属的消息ID
     * 格式: {localIdentifier}-{sequence}-{timestamp}
     * 每个项目实例都有独立的序列号，避免多实例冲突
     */
    fun generateMessageId(): String {
        val sequence = messageSequence.incrementAndGet()
        val timestamp = System.currentTimeMillis()
        return "$identifier-$sequence-$timestamp"
    }

}