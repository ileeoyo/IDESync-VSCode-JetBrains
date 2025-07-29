package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 窗口状态管理器
 * 统一管理窗口活跃状态，提供高效且准确的状态查询
 * 结合事件监听的高性能和实时查询的准确性优势
 */
class WindowStateManager(private val project: Project) {
    private val log: Logger = Logger.getInstance(WindowStateManager::class.java)

    // 事件监听维护的状态缓存（高性能查询）
    private val isActiveCache = AtomicBoolean(true)

    // 状态变化回调
    private var onWindowStateChange: ((Boolean) -> Unit)? = null

    /**
     * 初始化窗口状态监听
     */
    fun initialize() {
        log.info("初始化窗口状态管理器")
        setupWindowFocusListener()
        // 初始化时获取真实状态
        isActiveCache.set(getRealTimeWindowState())
        log.info("窗口状态管理器初始化完成，当前状态: ${isActiveCache.get()}")
    }

    /**
     * 设置窗口焦点监听器
     */
    private fun setupWindowFocusListener() {
        val frame = WindowManager.getInstance().getFrame(project)
        frame?.addWindowFocusListener(object : java.awt.event.WindowFocusListener {
            override fun windowGainedFocus(e: java.awt.event.WindowEvent?) {
                if (frame.isVisible && frame.state != java.awt.Frame.ICONIFIED && frame.isFocused) {
                    updateWindowState(true)
                    log.info("窗口获得焦点")
                }
            }

            override fun windowLostFocus(e: java.awt.event.WindowEvent?) {
                updateWindowState(false)
                log.info("窗口失去焦点")
            }
        })
    }

    /**
     * 更新窗口状态并触发回调
     */
    private fun updateWindowState(isActive: Boolean) {
        val previousState = isActiveCache.get()
        isActiveCache.set(isActive)

        // 状态发生变化时触发回调
        if (previousState != isActive) {
            onWindowStateChange?.invoke(isActive)
        }
    }

    /**
     * 获取窗口活跃状态（高性能版本）
     * 大多数情况下使用事件监听维护的缓存状态
     * @param forceRealTime 是否强制实时查询，默认false
     * @return 窗口是否活跃
     */
    fun isWindowActive(forceRealTime: Boolean = false): Boolean {
        return if (forceRealTime) {
            // 强制实时查询，用于关键操作或状态验证
            val realTimeState = getRealTimeWindowState()

            // 如果发现缓存状态与实时状态不一致，更新缓存
            val cachedState = isActiveCache.get()
            if (cachedState != realTimeState) {
                log.warn("检测到状态不一致，缓存: $cachedState, 实时: $realTimeState，正在同步")
                updateWindowState(realTimeState)
            }

            realTimeState
        } else {
            // 使用高性能的缓存状态
            isActiveCache.get()
        }
    }

    /**
     * 实时获取窗口状态
     * 直接从系统API获取，确保状态准确性
     */
    private fun getRealTimeWindowState(): Boolean {
        return try {
            ApplicationManager.getApplication().isActive
        } catch (e: Exception) {
            log.warn("获取实时窗口状态失败: ${e.message}")
            // 获取失败时返回缓存状态
            isActiveCache.get()
        }
    }

    /**
     * 设置窗口状态变化回调
     * @param callback 状态变化时的回调函数，参数为新的活跃状态
     */
    fun setOnWindowStateChangeCallback(callback: (Boolean) -> Unit) {
        this.onWindowStateChange = callback
    }

}