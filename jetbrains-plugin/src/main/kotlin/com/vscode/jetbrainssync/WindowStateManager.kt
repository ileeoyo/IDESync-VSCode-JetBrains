package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.awt.Frame
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.Timer

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

    // Frame获取重试配置
    private val maxRetryCount = 10  // 最大重试次数
    private val retryDelayMs = 500  // 重试间隔（毫秒）
    private var currentRetryCount = 0
    private var retryTimer: Timer? = null

    // 标记监听器是否已成功设置
    private var isListenerSetup = false

    /**
     * 获取项目名称
     */
    private fun getWorkspaceName(): String {
        return try {
            project.name
        } catch (e: Exception) {
            "unknown-project"
        }
    }

    /**
     * 初始化窗口状态监听
     */
    fun initialize() {
        val workspaceName = getWorkspaceName()
        log.info("初始化窗口状态管理器: $workspaceName")

        // 延迟初始化Frame监听器，确保窗口已完全创建
        ApplicationManager.getApplication().invokeLater {
            setupWindowFocusListenerWithRetry()
        }

        // 初始化时获取真实状态
        isActiveCache.set(getRealTimeWindowState())
        log.info("窗口状态管理器初始化完成: $workspaceName，当前状态: ${isActiveCache.get()}")
    }

    /**
     * 带重试机制的窗口焦点监听器设置
     */
    private fun setupWindowFocusListenerWithRetry() {
        val workspaceName = getWorkspaceName()
        if (isListenerSetup) {
            log.info("窗口焦点监听器已经设置完成，跳过重复设置: $workspaceName")
            return
        }

        val frame = WindowManager.getInstance().getFrame(project)
        if (frame != null) {
            log.info("成功获取到窗口Frame，设置焦点监听器: $workspaceName")
            setupWindowFocusListener(frame)
            isListenerSetup = true
            currentRetryCount = 0

            // 停止重试定时器
            retryTimer?.stop()
            retryTimer = null
        } else {
            currentRetryCount++
            log.warn("无法获取窗口Frame: $workspaceName，重试次数: $currentRetryCount/$maxRetryCount")

            if (currentRetryCount < maxRetryCount) {
                // 设置定时器重试
                retryTimer = Timer(retryDelayMs) {
                    setupWindowFocusListenerWithRetry()
                }
                retryTimer?.isRepeats = false
                retryTimer?.start()
                log.info("将在${retryDelayMs}ms后重试获取Frame: $workspaceName")
            } else {
                log.error("达到最大重试次数，放弃设置窗口焦点监听器: $workspaceName")
            }
        }
    }

    /**
     * 设置窗口焦点监听器（实际设置逻辑）
     */
    private fun setupWindowFocusListener(frame: Frame) {
        val workspaceName = getWorkspaceName()
        log.info("正在为项目设置窗口焦点监听器: $workspaceName")

        frame.addWindowFocusListener(object : java.awt.event.WindowFocusListener {
            override fun windowGainedFocus(e: java.awt.event.WindowEvent?) {
                if (frame.isVisible && frame.state != Frame.ICONIFIED && frame.isFocused) {
                    updateWindowState(true)
                    log.info("Jetbrains窗口获得焦点: $workspaceName")
                }
            }

            override fun windowLostFocus(e: java.awt.event.WindowEvent?) {
                updateWindowState(false)
                log.info("Jetbrains窗口失去焦点: $workspaceName")
            }
        })

        log.info("窗口焦点监听器设置成功: $workspaceName")
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
            val frame = WindowManager.getInstance().getFrame(project)
            frame?.isFocused == true && frame.isVisible && frame.state != Frame.ICONIFIED
        } catch (e: Exception) {
            log.warn("获取实时窗口状态失败: ${e.message}")
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

    /**
     * 清理资源
     */
    fun dispose() {
        val workspaceName = getWorkspaceName()
        log.info("开始清理窗口状态管理器资源: $workspaceName")

        // 停止重试定时器
        retryTimer?.stop()
        retryTimer = null

        // 清理回调
        onWindowStateChange = null

        // 重置状态
        isListenerSetup = false
        currentRetryCount = 0

        log.info("窗口状态管理器资源清理完成: $workspaceName")
    }

}