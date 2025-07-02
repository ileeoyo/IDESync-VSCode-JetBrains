import * as vscode from 'vscode';
import {EditorState, ConnectionCallback, ConnectionState} from './Type';
import {Logger} from './Logger';
import {EditorStateManager} from './EditorStateManager';
import {FileOperationHandler} from './FileOperationHandler';
import {EventListenerManager} from './EventListenerManager';
import {MessageProcessor} from './MessageProcessor';
import {WebSocketServerManager} from './WebSocketServerManager';
import {OperationQueueProcessor} from './OperationQueueProcessor';

/**
 * VSCode与JetBrains同步类（重构版）
 *
 * 采用模块化设计，主要组件：
 * - WebSocket服务器管理器：负责服务器管理和客户端连接
 * - 编辑器状态管理器：管理状态缓存、防抖和去重
 * - 文件操作处理器：处理文件的打开、关闭和导航
 * - 事件监听管理器：统一管理各种事件监听器
 * - 消息处理器：处理消息的序列化和反序列化
 * - 操作队列处理器：确保操作的原子性和顺序性
 */
export class VSCodeJetBrainsSync {
    // 核心组件
    private logger: Logger;
    private editorStateManager!: EditorStateManager;
    private fileOperationHandler!: FileOperationHandler;
    private messageProcessor!: MessageProcessor;
    private webSocketManager!: WebSocketServerManager;
    private eventListenerManager!: EventListenerManager;
    private operationQueueProcessor!: OperationQueueProcessor;

    // UI组件
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.logger = new Logger('IDE 同步');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'vscode-jetbrains-sync.toggleAutoReconnect';

        this.initializeComponents();
        this.setupComponentCallbacks();
        this.eventListenerManager.setupEditorListeners();
        this.eventListenerManager.setupWindowListeners();

        this.updateStatusBarWidget();
        this.statusBarItem.show();

        this.logger.info('VSCode-JetBrains同步服务初始化完成');
    }

    /**
     * 初始化各个组件
     */
    private initializeComponents() {
        this.editorStateManager = new EditorStateManager(this.logger);
        this.fileOperationHandler = new FileOperationHandler(this.logger);
        this.messageProcessor = new MessageProcessor(this.logger, this.fileOperationHandler);
        this.webSocketManager = new WebSocketServerManager(this.logger, this.messageProcessor);
        this.eventListenerManager = new EventListenerManager(this.logger, this.editorStateManager);
        this.operationQueueProcessor = new OperationQueueProcessor(
            this.messageProcessor, this.logger, this.webSocketManager
        );
    }

    /**
     * 设置组件间的回调关系
     */
    private setupComponentCallbacks() {
        // 连接状态变化回调
        const connectionCallback: ConnectionCallback = {
            onConnected: () => {
                this.logger.info('连接状态变更: 已连接');
                this.updateStatusBarWidget();
                this.editorStateManager.sendCurrentState(this.eventListenerManager.isActiveWindow());
            },
            onDisconnected: () => {
                this.logger.info('连接状态变更: 已断开');
                this.updateStatusBarWidget();
            },
            onReconnecting: () => {
                this.logger.info('连接状态变更: 重连中');
                this.updateStatusBarWidget();
            }
        };

        this.webSocketManager.setConnectionCallback(connectionCallback);

        // 状态变化回调
        this.editorStateManager.setStateChangeCallback((state: EditorState) => {
            if (this.eventListenerManager.isActiveWindow()) {
                this.operationQueueProcessor.addOperation(state);
            }
        });
    }


    /**
     * 更新状态栏显示
     */
    private updateStatusBarWidget() {
        const autoReconnect = this.webSocketManager.isAutoReconnect();
        const connectionState = this.webSocketManager.getConnectionState()

        // 参考Kotlin实现的图标状态逻辑
        const icon = (() => {
            if (connectionState === ConnectionState.CONNECTED) {
                return '$(check)';
            } else if ((connectionState === ConnectionState.CONNECTING || connectionState === ConnectionState.DISCONNECTED) && autoReconnect) {
                return '$(sync~spin)';
            } else {
                return '$(circle-outline)';
            }
        })();

        // 参考Kotlin实现的文本状态逻辑
        const statusText = autoReconnect ? 'IDE Sync On' : 'Turn IDE Sync On';

        // 参考Kotlin实现的工具提示逻辑
        const tooltip = (() => {
            let tip = '';
            if (connectionState === ConnectionState.CONNECTED) {
                tip += 'Connected to JetBrains IDE\n';
            }
            tip += `Click to turn sync ${autoReconnect ? 'off' : 'on'}`;
            return tip;
        })();

        this.statusBarItem.text = `${icon} ${statusText}`;
        this.statusBarItem.tooltip = tooltip;
    }


    /**
     * 切换自动重连状态
     */
    public toggleAutoReconnect() {
        this.webSocketManager.toggleAutoReconnect();
        this.updateStatusBarWidget();
    }


    /**
     * 清理资源
     */
    public dispose() {
        this.logger.info('开始清理VSCode同步服务资源（重构版）');

        this.operationQueueProcessor.dispose();
        this.webSocketManager.dispose();
        this.eventListenerManager.dispose();
        this.editorStateManager.dispose();
        this.statusBarItem.dispose();
        this.logger.dispose();

        this.logger.info('VSCode同步服务资源清理完成');
    }
}

// 导出激活和停用函数
let syncInstance: VSCodeJetBrainsSync | null = null;

export function activate(context: vscode.ExtensionContext) {
    syncInstance = new VSCodeJetBrainsSync();

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-jetbrains-sync.toggleAutoReconnect', () => {
            syncInstance?.toggleAutoReconnect();
        })
    );

    context.subscriptions.push({
        dispose: () => syncInstance?.dispose()
    });
}

export function deactivate() {
    syncInstance?.dispose();
}
