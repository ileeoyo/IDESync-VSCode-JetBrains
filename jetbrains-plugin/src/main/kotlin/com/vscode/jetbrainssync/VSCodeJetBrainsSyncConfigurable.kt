package com.vscode.jetbrainssync

import com.intellij.openapi.components.service
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.Project
import java.awt.BorderLayout
import java.awt.Component
import java.awt.FlowLayout
import javax.swing.*

class VSCodeJetBrainsSyncConfigurable(private val project: Project) : Configurable {
    private var portSpinner: JSpinner? = null
    private var autoStartCheckBox: JCheckBox? = null
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

        // Create auto start checkbox
        autoStartCheckBox = JCheckBox("Automatically start sync when IDE opens (default: disabled, sync must be manually enabled).")

        val panel = JPanel(BorderLayout())

        // Create content panel with all components
        val contentPanel = JPanel()
        contentPanel.layout = BoxLayout(contentPanel, BoxLayout.Y_AXIS)

        // Add description label
        val descriptionLabel = JLabel("Configure the port for synchronization with VSCode (use different ports to create separate sync groups).")
        descriptionLabel.alignmentX = Component.LEFT_ALIGNMENT
        contentPanel.add(descriptionLabel)
        contentPanel.add(Box.createVerticalStrut(10))

        // Add port input panel
        val portPanel = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0))
        portPanel.alignmentX = Component.LEFT_ALIGNMENT
        portPanel.add(JLabel("Port: "))
        portPanel.add(Box.createHorizontalStrut(10))
        portPanel.add(portSpinner)
        contentPanel.add(portPanel)
        contentPanel.add(Box.createVerticalStrut(8))

        // Add auto start checkbox immediately after port
        autoStartCheckBox?.alignmentX = Component.LEFT_ALIGNMENT
        contentPanel.add(autoStartCheckBox)

        // Add content panel to the top of BorderLayout
        panel.add(contentPanel, BorderLayout.NORTH)

        reset()
        return panel
    }

    override fun isModified(): Boolean {
        return try {
            val portChanged = portSpinner?.value as? Int != settings.state.port
            val autoStartChanged = autoStartCheckBox?.isSelected != settings.state.autoStartSync
            portChanged || autoStartChanged
        } catch (e: NumberFormatException) {
            true
        }
    }

    override fun apply() {
        settings.state.port = portSpinner?.value as? Int ?: 3000
        settings.state.autoStartSync = autoStartCheckBox?.isSelected ?: false
        project.service<VSCodeJetBrainsSyncService>().updateMulticastPort()
    }

    override fun reset() {
        portSpinner?.value = settings.state.port
        autoStartCheckBox?.isSelected = settings.state.autoStartSync
    }
} 