import * as vscode from 'vscode';
import {ActionType} from './Type';
import {Logger} from './Logger';
import {EditorStateManager} from './EditorStateManager';
import {FileUtils} from './FileUtils';
import {WindowStateManager} from './WindowStateManager';

/**
 * 事件监听管理器
 * 统一管理VSCode的各种编辑器事件监听器
 */
export class EventListenerManager {
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    private editorStateManager: EditorStateManager;
    private windowStateManager: WindowStateManager;

    constructor(
        logger: Logger,
        editorStateManager: EditorStateManager,
        windowStateManager: WindowStateManager
    ) {
        this.logger = logger;
        this.editorStateManager = editorStateManager;
        this.windowStateManager = windowStateManager;
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
                    editor, ActionType.OPEN, this.windowStateManager.isWindowActive()
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
                            this.windowStateManager.isWindowActive()
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
                        event.textEditor, ActionType.NAVIGATE, this.windowStateManager.isWindowActive()
                    );
                    this.logger.info(`准备发送导航消息: ${JSON.stringify(state)}`);
                    this.editorStateManager.debouncedUpdateState(state);
                }
            })
        );

        this.logger.info('编辑器监听器设置完成');
    }


    /**
     * 清理资源
     */
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
