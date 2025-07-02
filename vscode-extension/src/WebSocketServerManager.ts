import * as vscode from 'vscode';
import WebSocket, {WebSocketServer, RawData} from 'ws';
import {ActionType, EditorState, ConnectionCallback, ConnectionState} from './Type';
import {Logger} from './Logger';
import {MessageProcessor} from './MessageProcessor';

/**
 * WebSocket服务器管理器
 * 负责WebSocket服务器的管理和客户端连接
 */
export class WebSocketServerManager {
    private wss: WebSocketServer | null = null;
    private webSocket: WebSocket | null = null;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private autoReconnect = false;
    private logger: Logger;
    private messageProcessor: MessageProcessor;
    private connectionCallback: ConnectionCallback | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;

    // 提取常量
    private readonly reconnectDelayMs = 5000;
    private readonly defaultPort = 3000;
    private readonly jetbrainsClientPath = 'jetbrains';

    constructor(logger: Logger, messageProcessor: MessageProcessor) {
        this.logger = logger;
        this.messageProcessor = messageProcessor;
    }

    /**
     * 获取自动重连状态
     */
    isAutoReconnect(): boolean {
        return this.autoReconnect;
    }

    /**
     * 检查是否已断开连接
     */
    isDisconnected(): boolean {
        return this.connectionState === ConnectionState.DISCONNECTED;
    }

    /**
     * 检查是否正在连接
     */
    isConnecting(): boolean {
        return this.connectionState === ConnectionState.CONNECTING;
    }

    /**
     * 检查是否已连接
     */
    isConnected(): boolean {
        return this.connectionState === ConnectionState.CONNECTED;
    }

    /**
     * 获取当前连接状态
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /**
     * 设置连接状态回调
     */
    setConnectionCallback(callback: ConnectionCallback) {
        this.connectionCallback = callback;
    }

    /**
     * 切换自动重连状态
     */
    toggleAutoReconnect(): void {
        this.autoReconnect = !this.autoReconnect;
        this.logger.info(`自动重连状态切换为: ${this.autoReconnect ? '开启' : '关闭'}`);

        if (!this.autoReconnect) {
            this.logger.info("同步已关闭，连接已断开");
            this.disconnectAndCleanup();
        } else {
            this.logger.info("同步已开启，开始连接...");
            this.setConnectionState(ConnectionState.CONNECTING);
            this.disconnectAndCleanup();
            this.connectWebSocket();
        }
    }

    /**
     * 建立WebSocket连接
     */
    connectWebSocket(): void {
        if (!this.autoReconnect) {
            this.setConnectionState(ConnectionState.DISCONNECTED);
            this.logger.info('自动重连已禁用，停止连接尝试');
            return;
        }

        this.setConnectionState(ConnectionState.CONNECTING);

        // 关闭现有资源
        this.cleanUp();

        const port = vscode.workspace.getConfiguration('vscode-jetbrains-sync').get('port', this.defaultPort);

        try {
            this.wss = new WebSocketServer({port});
            this.logger.info(`在端口${port}启动WebSocket服务器...`);

            this.wss.on('connection', (ws: WebSocket, request) => {
                this.handleConnection(ws, request);
            });

            this.wss.on('listening', () => {
                this.logger.info(`WebSocket服务器正在监听端口${port}`);
                // 服务器监听成功，保持CONNECTING状态，等待客户端连接
            });

            this.wss.on('error', (error: Error) => {
                this.logger.warn('WebSocket服务器错误:', error);
                this.handleConnectionError();
            });
        } catch (error) {
            this.logger.warn('启动WebSocket服务器失败:', error as Error);
            this.handleConnectionError();
        }
    }

    /**
     * 处理新连接
     */
    private handleConnection(ws: WebSocket, request: any): void {
        const clientType = request.url?.slice(1);

        if (clientType !== this.jetbrainsClientPath) {
            this.logger.warn(`拒绝未知客户端连接: ${clientType}`);
            ws.close();
            return;
        }

        // 关闭现有连接
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            this.logger.info('关闭现有JetBrains连接，接受新连接');
            this.webSocket.close();
        }

        this.webSocket = ws;
        this.setConnectionState(ConnectionState.CONNECTED);
        this.logger.info('JetBrains IDE客户端已连接');
        vscode.window.showInformationMessage('已连接到JetBrains IDEA');

        this.setupWebSocketEventHandlers(ws);
    }

    /**
     * 设置WebSocket事件处理器
     */
    private setupWebSocketEventHandlers(ws: WebSocket): void {
        ws.on('message', (data: RawData) => {
            try {
                if (data) {
                    this.messageProcessor.handleIncomingMessage(data.toString());
                }
            } catch (error) {
                this.logger.warn('处理消息时发生错误:', error as Error);
            }
        });

        ws.on('close', (code: number, reason: Buffer) => {
            this.logger.warn(`JetBrains IDE客户端连接断开 - 代码: ${code}, 原因: ${reason.toString()}`);
            if (this.webSocket === ws) {
                this.webSocket = null;
                this.setConnectionState(ConnectionState.DISCONNECTED);
                vscode.window.showWarningMessage('JetBrains IDE连接断开');
                this.scheduleReconnect();
            }
        });

        ws.on('error', (error: Error) => {
            this.logger.warn('WebSocket连接错误:', error);
            if (this.webSocket === ws) {
                this.handleConnectionError();
            }
        });
    }

    /**
     * 发送消息
     */
    sendMessage(message: string): boolean {
        if (!this.isConnected() || !this.isAutoReconnect()) {
            this.logger.warn(`当前未连接，丢弃消息: ${message}`);
            return false;
        }

        if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
            this.logger.warn('WebSocket未连接，无法发送消息');
            this.scheduleReconnect();
            return false;
        }

        try {
            this.webSocket.send(message);
            return true;
        } catch (error) {
            this.logger.warn('发送消息失败:', error as Error);
            this.handleConnectionError();
            return false;
        }
    }

    /**
     * 处理连接错误
     */
    private handleConnectionError(): void {
        this.setConnectionState(ConnectionState.DISCONNECTED);
        this.scheduleReconnect();
    }

    /**
     * 安排重连
     */
    private scheduleReconnect(): void {
        if (!this.autoReconnect) {
            this.logger.info('自动重连已禁用，停止重连尝试');
            return;
        }

        if (this.isConnecting()) {
            this.logger.info('重连已在进行中，跳过此次重连请求');
            return;
        }

        // 清除现有的重连定时器
        this.clearReconnectTimer();

        this.logger.info(`将在${this.reconnectDelayMs}ms后尝试重新启动服务器...`);

        this.reconnectTimer = setTimeout(() => {
            this.logger.info('执行服务器重启尝试...');
            if (this.autoReconnect) {
                this.connectWebSocket();
            }
        }, this.reconnectDelayMs);
    }

    /**
     * 重启连接
     */
    restartConnection(): void {
        this.logger.info("手动重启连接");
        this.disconnectAndCleanup();
        if (this.autoReconnect) {
            this.connectWebSocket();
        }
    }

    /**
     * 断开连接并清理资源
     */
    private disconnectAndCleanup(): void {
        this.cleanUp();
        this.setConnectionState(ConnectionState.DISCONNECTED);
    }

    /**
     * 设置连接状态并触发回调
     */
    private setConnectionState(state: ConnectionState): void {
        if (this.connectionState === state) {
            return; // 避免重复设置相同状态
        }

        this.connectionState = state;

        switch (state) {
            case ConnectionState.CONNECTED:
                this.connectionCallback?.onConnected();
                break;
            case ConnectionState.CONNECTING:
                this.connectionCallback?.onReconnecting();
                break;
            case ConnectionState.DISCONNECTED:
                this.connectionCallback?.onDisconnected();
                break;
        }
    }

    /**
     * 清除重连定时器
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * 清理资源
     */
    private cleanUp(): void {
        this.clearReconnectTimer();

        // 关闭WebSocket连接
        if (this.webSocket) {
            if (this.webSocket.readyState === WebSocket.OPEN) {
                this.webSocket.close();
            }
            this.webSocket = null;
        }

        // 关闭WebSocket服务器
        if (this.wss) {
            this.wss.close(() => {
                this.logger.info('WebSocket服务器已关闭');
            });
            this.wss = null;
        }
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this.logger.info("开始清理WebSocket服务器管理器资源");

        // 停止自动重连
        this.autoReconnect = false;

        // 清理所有资源
        this.disconnectAndCleanup();

        this.logger.info("WebSocket服务器管理器资源清理完成");
    }
}
