package com.vscode.jetbrainssync

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.components.service
import javax.swing.*
import java.awt.FlowLayout
import javax.swing.Box
import javax.swing.BoxLayout
import java.awt.Component

class VSCodeJetBrainsSyncConfigurable(private val project: Project) : Configurable {
    private var portSpinner: JSpinner? = null
    private var settings: VSCodeJetBrainsSyncSettings = VSCodeJetBrainsSyncSettings.getInstance(project)

    override fun getDisplayName(): String = "IDE Sync - Connect to VSCode"

    override fun createComponent(): JComponent {
        val portModel = SpinnerNumberModel(settings.state.port, 1000, 65535, 1)
        portSpinner = JSpinner(portModel)
        
        // Configure spinner to not use thousand separators
        val editor = portSpinner?.editor as? JSpinner.NumberEditor
        editor?.let {
            val format = it.format
            format.isGroupingUsed = false
            it.textField.columns = 5
        }

        val panel = JPanel()
        panel.layout = BoxLayout(panel, BoxLayout.Y_AXIS)
        
        // Add description label
        val descriptionLabel = JLabel("Configure the port for synchronization with VSCode (use different ports to create separate sync groups).")
        descriptionLabel.alignmentX = Component.LEFT_ALIGNMENT
        panel.add(descriptionLabel)
        panel.add(Box.createVerticalStrut(10))
        
        // Add port input panel
        val portPanel = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0))
        portPanel.alignmentX = Component.LEFT_ALIGNMENT
        portPanel.add(JLabel("Port: "))
        portPanel.add(Box.createHorizontalStrut(10))
        portPanel.add(portSpinner)
        panel.add(portPanel)

        reset()
        return panel
    }

    override fun isModified(): Boolean {
        return try {
            portSpinner?.value as? Int != settings.state.port
        } catch (e: NumberFormatException) {
            true
        }
    }

    override fun apply() {
        settings.state.port = portSpinner?.value as? Int ?: 3000
        project.service<VSCodeJetBrainsSyncService>().updateMulticastPort()
    }

    override fun reset() {
        portSpinner?.value = settings.state.port
    }
} 