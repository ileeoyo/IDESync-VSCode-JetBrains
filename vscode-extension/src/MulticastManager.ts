import * as dgram from 'dgram';
import * as os from 'os';
import * as vscode from 'vscode';
import {ConnectionCallback, ConnectionState, EditorState, MessageWrapper} from './Type';
import {Logger} from './Logger';
import {MessageProcessor} from './MessageProcessor';
import {LocalIdentifierManager} from './LocalIdentifierManager';


/**
 * 组播管理器
 * 负责UDP组播消息的发送和接收，实现去中心化的编辑器同步
 */
export class MulticastManager {
    // === 核心依赖 ===
    private readonly logger: Logger;
    private readonly messageProcessor: MessageProcessor;

    // === 网络配置 ===
    private readonly multicastAddress = '224.0.0.1'; // 本地链路组播地址，仅本机通信
    private multicastPort: number; // 组播端口（从配置读取）
    private readonly maxMessageSize = 8192; // 最大消息大小（8KB）

    // === 连接状态 ===
    private socket: dgram.Socket | null = null;
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private autoReconnect = false;
    private connectionCallback: ConnectionCallback | null = null;
    private isShutdown = false;

    // === 定时器 ===
    private reconnectTimer: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(logger: Logger, messageProcessor: MessageProcessor) {
        this.logger = logger;
        this.messageProcessor = messageProcessor;
        this.multicastPort = vscode.workspace.getConfiguration('vscode-jetbrains-sync').get('port', 3000);

        this.logger.info(`初始化组播管理器 - 地址: ${this.multicastAddress}:${this.multicastPort}`);

        this.setupConfigurationListener();
    }

    // ==================== 初始化相关方法 ====================

    /**
     * 设置配置监听器
     */
    private setupConfigurationListener(): void {
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-jetbrains-sync.port')) {
                this.updateMulticastPort();
            }
        });
    }

    /**
     * 处理配置变更
     */
    private updateMulticastPort(): void {
        const newPort = vscode.workspace.getConfiguration('vscode-jetbrains-sync').get('port', 3000);
        if (newPort !== this.multicastPort) {
            this.logger.info(`组播端口配置变更: ${this.multicastPort} -> ${newPort}`);
            this.multicastPort = newPort;

            if (this.autoReconnect) {
                this.restartConnection();
            }
        }
    }

    // ==================== 公共接口方法 ====================

    /**
     * 设置连接状态回调
     */
    setConnectionCallback(callback: ConnectionCallback): void {
        this.connectionCallback = callback;
    }

    /**
     * 切换自动重连状态
     */
    toggleAutoReconnect(): void {
        this.autoReconnect = !this.autoReconnect;
        this.logger.info(`组播同步状态切换为: ${this.autoReconnect ? '开启' : '关闭'}`);

        if (!this.autoReconnect) {
            this.disconnectAndCleanup();
            this.logger.info('组播同步已关闭');
        } else {
            this.connectMulticast();
            this.logger.info('组播同步已开启，开始连接...');
        }
    }

    /**
     * 重启连接
     */
    restartConnection(): void {
        this.logger.info('手动重启组播连接');
        this.disconnectAndCleanup();
        if (this.autoReconnect) {
            this.connectMulticast();
        }
    }

    // ==================== 连接管理方法 ====================

    /**
     * 连接组播组
     */
    private connectMulticast(): void {
        if (this.isShutdown || !this.autoReconnect || this.connectionState !== ConnectionState.DISCONNECTED) {
            if (this.connectionState !== ConnectionState.DISCONNECTED) {
                this.logger.info('连接状态不是DISCONNECTED，跳过连接尝试');
            }
            return;
        }

        this.setConnectionState(ConnectionState.CONNECTING);
        this.logger.info('正在连接组播组...');

        try {
            this.cleanUp();
            this.createSocket();
            this.bindSocket();
        } catch (error) {
            this.logger.warn('创建组播连接失败:', error as Error);
            this.handleConnectionError();
        }
    }

    /**
     * 创建UDP套接字
     */
    private createSocket(): void {
        this.socket = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true
        });

        this.setupSocketEventHandlers();
    }

    /**
     * 设置套接字事件处理器
     */
    private setupSocketEventHandlers(): void {
        if (!this.socket) return;

        this.socket.on('error', (error: Error) => {
            this.logger.warn('组播套接字错误:', error);
            this.handleConnectionError();
        });

        this.socket.on('message', (message: Buffer, rinfo: dgram.RemoteInfo) => {
            this.handleReceivedMessage(message.toString('utf8'));
        });

        this.socket.on('listening', () => {
            this.handleSocketListening();
        });
    }

    /**
     * 处理套接字监听事件
     */
    private handleSocketListening(): void {
        if (!this.socket) return;

        const address = this.socket.address();
        const isLoopback = address.address === '127.0.0.1' || address.address === '::1';
        const addressType = isLoopback ? '回环地址' : '非回环地址';
        this.logger.info(`组播套接字正在监听 ${addressType} ${address.address}:${address.port}`);

        this.joinMulticastGroup();
    }

    /**
     * 加入组播组
     */
    private joinMulticastGroup(): void {
        if (!this.socket) return;

        try {
            // 优先使用回环接口
            this.socket.addMembership(this.multicastAddress, '127.0.0.1');
            this.setConnectionState(ConnectionState.CONNECTED);
            this.logger.info(`成功加入组播组（回环接口）: ${this.multicastAddress}:${this.multicastPort}`);
        } catch (error) {
            this.logger.warn('加入组播组（回环接口）失败，尝试不指定接口:', error as Error);
            this.tryJoinWithDefaultInterface();
        }
    }

    /**
     * 尝试使用默认接口加入组播组
     */
    private tryJoinWithDefaultInterface(): void {
        if (!this.socket) return;

        try {
            this.socket.addMembership(this.multicastAddress);
            this.setConnectionState(ConnectionState.CONNECTED);
            this.logger.info(`成功加入组播组（默认接口）: ${this.multicastAddress}:${this.multicastPort}`);
        } catch (error) {
            this.logger.warn('加入组播组完全失败:', error as Error);
            this.handleConnectionError();
        }
    }

    /**
     * 绑定套接字到端口
     */
    private bindSocket(): void {
        if (!this.socket) return;

        try {
            // 优先绑定到回环地址
            this.socket.bind(this.multicastPort, '127.0.0.1', () => {
                this.logger.info(`绑定到回环地址端口: 127.0.0.1:${this.multicastPort}`);
            });
        } catch (bindError) {
            this.logger.warn('绑定到回环地址失败，尝试绑定到默认地址:', bindError as Error);
            this.tryBindToDefaultAddress();
        }
    }

    /**
     * 尝试绑定到默认地址
     */
    private tryBindToDefaultAddress(): void {
        if (!this.socket) return;

        try {
            this.socket.bind(this.multicastPort, () => {
                this.logger.info(`绑定到默认地址端口: ${this.multicastPort}`);
            });
        } catch (error) {
            this.logger.warn('绑定端口完全失败:', error as Error);
            this.handleConnectionError();
        }
    }

    // ==================== 消息处理方法 ====================

    /**
     * 处理接收到的消息
     */
    private handleReceivedMessage(message: string): void {
        try {
            this.messageProcessor.handleMessage(message, LocalIdentifierManager.getInstance().identifier);
        } catch (error) {
            this.logger.warn('处理接收到的消息时发生错误:', error as Error);
        }
    }


    /**
     * 发送消息到组播组
     */
    sendMessage(messageWrapper: MessageWrapper): boolean {
        if (!this.isConnected() || !this.autoReconnect) {
            this.logger.warn(`当前未连接，丢弃消息: ${messageWrapper.toJsonString()}`);
            return false;
        }

        try {
            const messageString = messageWrapper.toJsonString();
            const messageBuffer = Buffer.from(messageString, 'utf8');

            if (messageBuffer.length > this.maxMessageSize) {
                this.logger.warn(`消息过大，无法发送: ${messageBuffer.length} bytes`);
                return false;
            }

            this.socket!.send(
                messageBuffer,
                0,
                messageBuffer.length,
                this.multicastPort,
                this.multicastAddress,
                (error: Error | null) => {
                    if (error) {
                        this.logger.warn('发送组播消息失败:', error);
                        this.handleConnectionError();
                    } else {
                        this.logger.info(`✅ 发送组播消息: ${messageString}`);
                    }
                }
            );

            return true;

        } catch (error) {
            this.logger.warn('发送组播消息失败:', error as Error);
            this.handleConnectionError();
            return false;
        }
    }

    // ==================== 状态管理方法 ====================

    /**
     * 处理连接错误
     */
    private handleConnectionError(): void {
        this.setConnectionState(ConnectionState.DISCONNECTED);

        if (this.autoReconnect && !this.isShutdown) {
            this.scheduleReconnect();
        }
    }

    /**
     * 安排重连
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.logger.info('将在5秒后尝试重新连接组播组...');

        this.reconnectTimer = setTimeout(() => {
            if (this.autoReconnect && !this.isShutdown) {
                this.connectMulticast();
            }
        }, 5000);
    }

    /**
     * 设置连接状态并触发回调
     */
    private setConnectionState(state: ConnectionState): void {
        if (this.connectionState === state) {
            return;
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

    // ==================== 资源清理方法 ====================

    /**
     * 断开连接并清理资源
     */
    disconnectAndCleanup(): void {
        this.cleanUp();
        this.setConnectionState(ConnectionState.DISCONNECTED);
    }

    /**
     * 清理资源
     */
    private cleanUp(): void {
        // 清除定时器
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // 关闭套接字
        if (this.socket) {
            try {
                this.socket.dropMembership(this.multicastAddress);
                this.logger.info('已离开组播组');
            } catch (error) {
                this.logger.warn('离开组播组时发生错误:', error as Error);
            }

            this.socket.close(() => {
                this.logger.info('组播套接字已关闭');
            });
            this.socket = null;
        }
    }

    /**
     * 清理资源
     */
    dispose(): void {
        this.logger.info('开始清理组播管理器资源');

        this.isShutdown = true;
        this.autoReconnect = false;

        // 清理连接
        this.disconnectAndCleanup();

        // 清除清理定时器
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        this.logger.info('组播管理器资源清理完成');
    }

    // ==================== 状态查询方法 ====================

    isConnected(): boolean {
        return this.connectionState === ConnectionState.CONNECTED;
    }

    isAutoReconnect(): boolean {
        return this.autoReconnect;
    }

    isConnecting(): boolean {
        return this.connectionState === ConnectionState.CONNECTING;
    }

    isDisconnected(): boolean {
        return this.connectionState === ConnectionState.DISCONNECTED;
    }

    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    getLocalIdentifier(): string {
        return LocalIdentifierManager.getInstance().identifier;
    }
} 