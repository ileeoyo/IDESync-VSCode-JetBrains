package com.vscode.jetbrainssync

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBar
import java.awt.Cursor
import java.awt.event.MouseEvent
import java.util.*
import javax.swing.JComponent
import javax.swing.JLabel

class SyncStatusBarWidget(
    private val project: Project,
    private val syncService: VSCodeJetBrainsSyncService
) : CustomStatusBarWidget {
    companion object {
        const val ID = "VSCodeJetBrainsSync"
        private const val SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    }

    private var spinnerTimer: Timer? = null
    private var log: Logger = Logger.getInstance(SyncStatusBarWidget::class.java)

    // 项目专属的动画索引，避免多实例冲突
    private var spinnerIndex = 0

    private val component = JLabel().apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    init {
        // Start spinner animation timer
        spinnerTimer = Timer().apply {
            scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    if ((syncService.isConnecting() || syncService.isDisconnected()) && syncService.isAutoReconnect()) {
                        spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length
                        ApplicationManager.getApplication().invokeLater {
                            updateUI()
                        }
                    }
                }
            }, 0, 100) // Update every 100ms
        }

        component.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                log.info("Status bar widget clicked!")
                syncService.toggleAutoReconnect()
            }
        })
        updateUI()
    }

    fun updateUI() {
        ApplicationManager.getApplication().invokeLater {
            log.info("Updating status bar widget UI")
            val icon = when {
                syncService.isConnected() -> "✓"
                (syncService.isConnecting() || syncService.isDisconnected()) && syncService.isAutoReconnect() -> SPINNER_FRAMES[spinnerIndex].toString()
                else -> "○"
            }
            component.text = "$icon ${if (syncService.isAutoReconnect()) "IDE Sync On" else "Turn IDE Sync On"}"
            component.toolTipText = buildString {
                if (syncService.isConnected()) append("Connected to VSCode\n")
                append("Click to turn sync ${if (syncService.isAutoReconnect()) "off" else "on"}")
            }
            component.repaint()
        }
    }

    override fun ID() = ID

    override fun getComponent(): JComponent = component

    override fun install(statusBar: StatusBar) {
        updateUI()
    }

    override fun dispose() {
        println("Disposing status bar widget")
        spinnerTimer?.cancel()
        spinnerTimer = null
    }
} 