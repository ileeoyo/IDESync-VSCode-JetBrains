import * as vscode from 'vscode';
import {ActionType, LogFormatter} from './Type';
import {Logger} from './Logger';
import {EditorStateManager} from './EditorStateManager';
import {FileUtils} from './FileUtils';
import {WindowStateManager} from './WindowStateManager';

/**
 * 待确认的TAB打开事件
 */
interface PendingTabEvent {
    uri: vscode.Uri;
    tab: vscode.Tab;
    timeout: NodeJS.Timeout;
}

/**
 * 事件监听管理器
 * 统一管理VSCode的各种编辑器事件监听器
 */
export class EventListenerManager {
    private disposables: vscode.Disposable[] = [];
    private logger: Logger;
    private editorStateManager: EditorStateManager;
    private windowStateManager: WindowStateManager;

    // 待确认的TAB事件队列，用于区分前台/后台打开
    private pendingTabEvents: Map<string, PendingTabEvent> = new Map();

    // 延迟确认时间（毫秒）
    private readonly CONFIRMATION_DELAY = 150;

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

                const filePath = editor.document.uri.fsPath;

                // 检查是否有对应的待确认TAB事件
                const pendingEvent = this.pendingTabEvents.get(filePath);
                if (pendingEvent) {
                    // 取消待确认的TAB事件，因为这是前台打开
                    clearTimeout(pendingEvent.timeout);
                    this.pendingTabEvents.delete(filePath);
                    this.logger.info(`取消待确认TAB事件，确认为前台打开: ${filePath}`);
                }

                this.logger.info(`事件-文件前台打开: ${filePath}`);
                const state = this.editorStateManager.createEditorState(
                    editor, ActionType.OPEN, this.windowStateManager.isWindowActive()
                );
                this.logger.info(`准备发送前台打开消息: ${state.filePath}`);
                this.editorStateManager.updateState(state);
            })
        );

        // 监听TAB关闭
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabs((event) => {
                // 处理新打开的TAB
                event.opened.forEach((tab, index) => {
                    // 检测tab类型为常规文件，其他类型则忽略
                    if (!FileUtils.isRegularFileTab(tab)) {
                        this.logger.info(`打开TAB ${index}: 非常规文件类型，已忽略`);
                        return
                    }

                    const uri = (tab.input as vscode.TabInputText).uri;
                    const filePath = uri.fsPath;

                    this.logger.info(`事件-文件TAB打开: ${filePath}`);

                    // 创建延迟确认的超时处理
                    const timeout = setTimeout(() => {
                        // 超时后确认为后台打开
                        this.pendingTabEvents.delete(filePath);
                        this.handleBackgroundOpen(uri);
                    }, this.CONFIRMATION_DELAY);

                    // 添加到待确认队列
                    this.pendingTabEvents.set(filePath, {
                        uri,
                        tab,
                        timeout
                    });

                    this.logger.info(`TAB事件加入待确认队列: ${filePath}`);
                });

                event.closed.forEach((tab, index) => {
                    // 检测tab类型为常规文件，其他类型则忽略
                    if (!FileUtils.isRegularFileTab(tab)) {
                        this.logger.info(`关闭TAB ${index}: 非常规文件类型，已忽略`);
                        return;
                    }
                    const uri = (tab.input as vscode.TabInputText).uri;
                    this.logger.info(`事件-文件关闭：${uri.fsPath}`);
                    const filePath = uri.fsPath;

                    // 检查文件是否在其他TAB中仍然打开
                    const isStillOpen = FileUtils.isFileOpenInOtherTabs(filePath);
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
                });
            })
        )

        // 监听光标位置和选中变化
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection((event) => {
                if (!FileUtils.isRegularFileUri(event.textEditor.document.uri)) {
                    return;
                }

                const hasSelection = !event.textEditor.selection.isEmpty;
                const selection = event.textEditor.selection;
                const cursorPosition = selection.active;
                const filePath = event.textEditor.document.uri.fsPath;

                let logMessage = `事件-选中改变: ${filePath}，${LogFormatter.cursorLog(cursorPosition.line, cursorPosition.character)}`;

                if (hasSelection) {
                    logMessage += `，${LogFormatter.selectionLog(selection.start.line, selection.start.character, selection.end.line, selection.end.character)}`;
                } else {
                    logMessage += `，${LogFormatter.selectionLog()}`;
                }
                this.logger.info(logMessage);

                if (event.textEditor === FileUtils.getCurrentActiveEditor()) {
                    const state = this.editorStateManager.createEditorState(
                        event.textEditor, ActionType.NAVIGATE, this.windowStateManager.isWindowActive()
                    );
                    this.logger.info(`准备发送导航消息: ${state.action} ${state.filePath}，${state.getSelectionLog()}，${state.getSelectionLog()}`);
                    this.editorStateManager.debouncedUpdateState(state);
                }
            })
        );

        this.logger.info('编辑器监听器设置完成');
    }


    /**
     * 处理后台文件打开
     */
    private handleBackgroundOpen(uri: vscode.Uri) {
        const filePath = uri.fsPath;

        this.logger.info(`事件-文件后台打开: ${filePath}`);

        // 发送文件打开事件
        const openState = this.editorStateManager.createEditorStateFromPath(
            filePath, ActionType.OPEN, this.windowStateManager.isWindowActive()
        );
        this.logger.info(`准备发送后台打开消息: ${openState.filePath}`);
        this.editorStateManager.updateState(openState);


        const navigateState = this.editorStateManager.getCurrentActiveEditorState(this.windowStateManager.isWindowActive());
        if (navigateState) {
            this.logger.info(`准备发送当前活跃编辑器导航消息: ${navigateState.filePath}`);
            this.editorStateManager.debouncedUpdateState(navigateState);
        }
    }


    /**
     * 清理资源
     */
    dispose() {
        // 清理所有待确认的TAB事件
        this.pendingTabEvents.forEach((pendingEvent) => {
            clearTimeout(pendingEvent.timeout);
        });
        this.pendingTabEvents.clear();

        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
