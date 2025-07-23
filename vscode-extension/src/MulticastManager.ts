import * as dgram from 'dgram';
import * as os from 'os';
import * as vscode from 'vscode';
import {ConnectionCallback, ConnectionState} from './Type';
import {Logger} from './Logger';
import {MessageProcessor} from './MessageProcessor';

/**
 * 组播管理器
 * 负责UDP组播消息的发送和接收，实现去中心化的编辑器同步
 */
export class MulticastManager {
    private logger: Logger;
    private messageProcessor: MessageProcessor;

    // 组播配置
    private readonly multicastAddress = '224.0.0.100'; // 组播地址
    private multicastPort: number; // 组播端口（从配置读取）
    private readonly maxMessageSize = 8192; // 最大消息大小（8KB）

    // 网络组件
    private socket: dgram.Socket | null = null;

    // 状态管理
    private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
    private autoReconnect = false;
    private connectionCallback: ConnectionCallback | null = null;

    // 消息管理
    private messageSequence = 0;
    private receivedMessages = new Map<string, number>(); // 消息去重
    private readonly maxReceivedMessagesSize = 1000; // 最大缓存消息数量
    private readonly messageTimeoutMs = 30000; // 消息超时时间（30秒）

    // 定时器管理
    private reconnectTimer: NodeJS.Timeout | null = null;
    private cleanupTimer: NodeJS.Timeout | null = null;

    // 本机标识
    private readonly localIdentifier: string;

    // 状态标志
    private isShutdown = false;

    constructor(logger: Logger, messageProcessor: MessageProcessor) {
        this.logger = logger;
        this.messageProcessor = messageProcessor;
        this.localIdentifier = this.generateLocalIdentifier();

        // 从配置中读取组播端口（复用WebSocket端口配置）
        this.multicastPort = vscode.workspace.getConfiguration('vscode-jetbrains-sync').get('port', 3000);

        this.logger.info(`初始化组播管理器 - 地址: ${this.multicastAddress}:${this.multicastPort}`);

        // 监听配置变更
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-jetbrains-sync.port')) {
                this.updateMulticastPort();
            }
        });

        // 启动消息清理定时任务
        this.startMessageCleanupTask();
    }

    /**
     * 生成本机唯一标识
     */
    private generateLocalIdentifier(): string {
        try {
            const hostname = os.hostname();
            const pid = process.pid;
            const timestamp = Date.now();
            return `${hostname}-${pid}-${timestamp}`;
        } catch (e) {
            return `unknown-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        }
    }

    /**
     * 处理配置变更
     */
    private updateMulticastPort(): void {
        const newPort = vscode.workspace.getConfiguration('vscode-jetbrains-sync').get('port', 3000);
        if (newPort !== this.multicastPort) {
            this.logger.info(`组播端口配置变更: ${this.multicastPort} -> ${newPort}`);
            this.multicastPort = newPort;

            // 如果当前已启用自动重连，则重启连接
            if (this.autoReconnect) {
                this.restartConnection();
            }
        }
    }

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
     * 连接组播组
     */
    private connectMulticast(): void {
        if (this.isShutdown) {
            return;
        }

        if (this.connectionState !== ConnectionState.DISCONNECTED) {
            this.logger.info('连接状态不是DISCONNECTED，跳过连接尝试');
            return;
        }

        this.setConnectionState(ConnectionState.CONNECTING);
        this.logger.info('正在连接组播组...');

        try {
            // 清理现有连接
            this.cleanUp();

            // 创建UDP套接字
            this.socket = dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            });

            // 设置套接字选项
            this.socket.on('error', (error: Error) => {
                this.logger.warn('组播套接字错误:', error);
                this.handleConnectionError();
            });

            this.socket.on('message', (message: Buffer, rinfo: dgram.RemoteInfo) => {
                this.handleReceivedMessage(message.toString('utf8'));
            });

            this.socket.on('listening', () => {
                const address = this.socket!.address();
                this.logger.info(`组播套接字正在监听 ${address.address}:${address.port}`);

                try {
                    // 加入组播组
                    this.socket!.addMembership(this.multicastAddress);
                    this.setConnectionState(ConnectionState.CONNECTED);
                    this.logger.info(`成功加入组播组: ${this.multicastAddress}:${this.multicastPort}`);
                } catch (error) {
                    this.logger.warn('加入组播组失败:', error as Error);
                    this.handleConnectionError();
                }
            });

            // 绑定到组播端口
            this.socket.bind(this.multicastPort, () => {
                this.logger.info(`绑定到端口 ${this.multicastPort}`);
            });

        } catch (error) {
            this.logger.warn('创建组播连接失败:', error as Error);
            this.handleConnectionError();
        }
    }

    /**
     * 处理接收到的消息
     */
    private handleReceivedMessage(message: string): void {
        try {
            this.logger.info(`收到组播消息: ${message}`);

            // 解析消息以检查发送者
            const messageData = this.parseMessageData(message);

            // 检查是否是自己发送的消息
            if (messageData?.senderId === this.localIdentifier) {
                this.logger.debug('忽略自己发送的消息');
                return;
            }

            // 检查消息是否已经处理过（去重）
            const messageId = messageData?.messageId;
            if (messageId) {
                const currentTime = Date.now();
                if (this.receivedMessages.has(messageId)) {
                    this.logger.debug(`忽略重复消息: ${messageId}`);
                    return;
                }

                // 记录消息ID
                this.receivedMessages.set(messageId, currentTime);

                // 限制缓存大小
                if (this.receivedMessages.size > this.maxReceivedMessagesSize) {
                    this.cleanupOldMessages();
                }
            }

            // 提取实际的编辑器状态消息
            const editorStateMessage = messageData?.payload;
            if (editorStateMessage) {
                this.messageProcessor.handleIncomingMessage(editorStateMessage);
            }

        } catch (error) {
            this.logger.warn('处理接收到的消息时发生错误:', error as Error);
        }
    }

    /**
     * 发送消息到组播组
     */
    sendMessage(message: string): boolean {
        if (!this.isConnected() || !this.autoReconnect) {
            this.logger.warn(`当前未连接，丢弃消息: ${message}`);
            return false;
        }

        try {
            const messageId = this.generateMessageId();
            const wrappedMessage = this.wrapMessage(message, messageId);
            const messageBuffer = Buffer.from(wrappedMessage, 'utf8');

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
                        this.logger.info(`✅ 发送组播消息: ${message}`);
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

    /**
     * 生成消息ID
     */
    private generateMessageId(): string {
        this.messageSequence++;
        const timestamp = Date.now();
        return `${this.localIdentifier}-${this.messageSequence}-${timestamp}`;
    }

    /**
     * 包装消息
     */
    private wrapMessage(payload: string, messageId: string): string {
        const wrapper = {
            messageId,
            senderId: this.localIdentifier,
            timestamp: Date.now(),
            payload
        };
        return JSON.stringify(wrapper);
    }

    /**
     * 解析消息数据
     */
    private parseMessageData(message: string): MessageWrapper | null {
        try {
            return JSON.parse(message) as MessageWrapper;
        } catch (error) {
            this.logger.warn('解析消息包装器失败:', error as Error);
            return null;
        }
    }

    /**
     * 清理过期消息
     */
    private cleanupOldMessages(): void {
        const currentTime = Date.now();

        for (const [messageId, timestamp] of this.receivedMessages.entries()) {
            if (currentTime - timestamp > this.messageTimeoutMs) {
                this.receivedMessages.delete(messageId);
            }
        }

        this.logger.debug(`清理过期消息，当前缓存消息数: ${this.receivedMessages.size}`);
    }

    /**
     * 启动消息清理定时任务
     */
    private startMessageCleanupTask(): void {
        this.cleanupTimer = setInterval(() => {
            if (!this.isShutdown) {
                this.cleanupOldMessages();
            }
        }, 60000); // 每分钟清理一次
    }

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
     * 重启连接
     */
    restartConnection(): void {
        this.logger.info('手动重启组播连接');
        this.disconnectAndCleanup();
        if (this.autoReconnect) {
            this.connectMulticast();
        }
    }

    // 状态查询方法
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

        // 清理消息缓存
        this.receivedMessages.clear();

        this.logger.info('组播管理器资源清理完成');
    }
}

/**
 * 消息包装器接口
 */
interface MessageWrapper {
    messageId: string;
    senderId: string;
    timestamp: number;
    payload: string;
} 