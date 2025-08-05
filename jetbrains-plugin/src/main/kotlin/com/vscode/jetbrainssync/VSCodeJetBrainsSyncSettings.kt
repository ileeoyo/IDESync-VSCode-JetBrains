package com.vscode.jetbrainssync

import com.intellij.openapi.components.*
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
@State(
    name = "VSCodeJetBrainsSyncSettings",
    storages = [Storage("vscode-jetbrains-sync.xml")]
)
class VSCodeJetBrainsSyncSettings : PersistentStateComponent<VSCodeJetBrainsSyncSettings.State> {
    data class State(
        var port: Int = 3000,
        var autoStartSync: Boolean = false
    )

    private var myState = State()

    override fun getState(): State = myState

    override fun loadState(state: State) {
        myState = state
    }

    companion object {
        fun getInstance(project: Project): VSCodeJetBrainsSyncSettings =
            project.service<VSCodeJetBrainsSyncSettings>()
    }
} 