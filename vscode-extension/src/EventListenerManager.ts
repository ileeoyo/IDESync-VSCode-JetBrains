import * as vscode from 'vscode';
import {ActionType} from './Type';
import {Logger} from './Logger';
import {EditorStateManager} from './EditorStateManager';
import {FileUtils} from './FileUtils';

/**
 * 事件监听管理器
 * 统一管理VSCode的各种事件监听器
 */
export class EventListenerManager {
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    private editorStateManager: EditorStateManager;
    // 活跃状态
    private isActive = true;

    constructor(
        logger: Logger,
        editorStateManager: EditorStateManager,
    ) {
        this.logger = logger;
        this.editorStateManager = editorStateManager;
    }

    /**
     * 检查文件是否在其他TAB中仍然打开
     */
    private isFileOpenInOtherTabs(filePath: string): boolean {
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                if (FileUtils.isRegularFileTab(tab)) {
                    const uri = (tab.input as vscode.TabInputText).uri;
                    if (uri.fsPath === filePath) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 设置编辑器监听器
     */
    setupEditorListeners() {
        this.logger.info('设置编辑器监听器');
        // 监听活跃编辑器变化
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (!editor) {
                    return;
                }
                if (!FileUtils.isRegularFileUri(editor.document.uri)) {
                    return;
                }
                this.logger.info(`事件-文件打开: ${editor.document.uri.fsPath}`);
                const state = this.editorStateManager.createEditorState(
                    editor, ActionType.OPEN, this.isActive
                );
                this.logger.info(`准备发送打开消息: ${state.filePath}`);
                this.editorStateManager.updateState(state);

            })
        );

        // 监听TAB关闭
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs((event) => {
                event.closed.forEach((tab, index) => {
                    // 检测tab类型为常规文件，其他类型则忽略
                    if (FileUtils.isRegularFileTab(tab)) {
                        const uri = (tab.input as vscode.TabInputText).uri;
                        this.logger.info(`事件-文件关闭：${uri.fsPath}`);
                        const filePath = uri.fsPath;

                        // 检查文件是否在其他TAB中仍然打开
                        const isStillOpen = this.isFileOpenInOtherTabs(filePath);
                        if (isStillOpen) {
                            this.logger.info(`文件在其他TAB中仍然打开，跳过关闭消息: ${filePath}`);
                            return;
                        }

                        this.logger.info(`文件已完全关闭，发送关闭消息: ${filePath}`);
                        const state = this.editorStateManager.createCloseState(
                            filePath,
                            this.isActive
                        );
                        this.logger.info(`准备发送关闭消息: ${state.filePath}`);
                        this.editorStateManager.updateState(state)
                    } else {
                        this.logger.info(`关闭TAB ${index}: 非常规文件类型，已忽略`);
                    }
                });
            })
        )

        // 监听光标位置变化
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (!FileUtils.isRegularFileUri(event.textEditor.document.uri)) {
                    return;
                }
                this.logger.info(`事件-文件改变: ${event.textEditor.document.uri.fsPath}`);
                if (event.textEditor === vscode.window.activeTextEditor) {
                    const state = this.editorStateManager.createEditorState(
                        event.textEditor, ActionType.NAVIGATE, this.isActive
                    );
                    this.logger.info(`准备发送导航消息: ${state.filePath}`);
                    this.editorStateManager.debouncedUpdateState(state);
                }
            })
        );

        this.logger.info('编辑器监听器设置完成');
    }

    /**
     * 设置窗口监听器
     */
    setupWindowListeners() {
        this.logger.info('设置窗口监听器');
        this.disposables.push(
            vscode.window.onDidChangeWindowState((e) => {
                this.isActive = e.focused;
                if (e.focused) {
                    this.logger.info("VSCode窗口获得焦点")
                } else {
                    this.logger.info("VSCode窗口失去焦点")
                    // 窗口失焦时发送工作区同步状态
                    const workspaceSyncState = this.editorStateManager.createWorkspaceSyncState(true);
                    this.logger.info(`发送工作区同步状态，包含${workspaceSyncState.openedFiles?.length || 0}个打开的文件`);
                    this.editorStateManager.updateState(workspaceSyncState);
                }
            })
        );

        this.logger.info('窗口监听器设置完成');
    }


    /**
     * 获取当前活跃状态
     */
    isActiveWindow(): boolean {
        return this.isActive;
    }


    /**
     * 清理资源
     */
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
