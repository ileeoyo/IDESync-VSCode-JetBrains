import {EditorState, MessageWrapper, parseTimestamp} from './Type';
import {Logger} from './Logger';
import {FileOperationHandler} from './FileOperationHandler';
import {LocalIdentifierManager} from './LocalIdentifierManager';

/**
 * 消息处理器
 * 负责消息的序列化和反序列化
 */
export class MessageProcessor {
    private logger: Logger;
    private fileOperationHandler: FileOperationHandler;
    private readonly messageTimeoutMs = 5000;

    // 组播消息去重相关
    private receivedMessages = new Map<string, number>();
    private readonly maxReceivedMessagesSize = 1000;
    private readonly messageCleanupIntervalMs = 300000; // 5分钟

    // 定时清理相关
    private isShutdown = false;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(logger: Logger, fileOperationHandler: FileOperationHandler) {
        this.logger = logger;
        this.fileOperationHandler = fileOperationHandler;
        this.startMessageCleanupTask();
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
     * 停止消息清理定时任务
     */
    public stopMessageCleanupTask(): void {
        this.isShutdown = true;
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * 处理组播消息
     * 包含消息解析、去重检查、自己消息过滤等逻辑
     */
    handleMessage(message: string): boolean {
        try {
            const messageData = this.parseMessageData(message);
            if (!messageData) return false;

            // 获取本地标识符
            const localIdentifier = LocalIdentifierManager.getInstance().identifier;

            // 检查是否是自己发送的消息
            if (messageData.isOwnMessage(localIdentifier)) {
                this.logger.debug('忽略自己发送的消息');
                return false;
            }
            this.logger.info(`收到组播消息: ${message}`);

            // 检查消息去重
            if (this.isDuplicateMessage(messageData)) {
                this.logger.debug(`忽略重复消息: ${messageData.messageId}`);
                return false;
            }

            // 记录消息并处理
            this.recordMessage(messageData);
            // 处理消息内容
            this.handleIncomingState(messageData.payload);
            return true;
        } catch (error) {
            this.logger.warn('处理组播消息时发生错误:', error as Error);
            return false;
        }
    }

    /**
     * 解析消息数据
     */
    private parseMessageData(message: string): MessageWrapper | null {
        return MessageWrapper.fromJsonString(message);
    }

    /**
     * 检查是否是重复消息
     */
    private isDuplicateMessage(messageData: MessageWrapper): boolean {
        return this.receivedMessages.has(messageData.messageId);
    }

    /**
     * 记录消息ID
     */
    private recordMessage(messageData: MessageWrapper): void {
        this.receivedMessages.set(messageData.messageId, Date.now());

        if (this.receivedMessages.size > this.maxReceivedMessagesSize) {
            this.cleanupOldMessages();
        }
    }


    /**
     * 清理过期的消息记录
     */
    private cleanupOldMessages(): void {
        const currentTime = Date.now();
        const expireTime = currentTime - this.messageCleanupIntervalMs;

        for (const [messageId, timestamp] of this.receivedMessages.entries()) {
            if (timestamp < expireTime) {
                this.receivedMessages.delete(messageId);
            }
        }

        this.logger.debug(`清理过期消息记录，剩余: ${this.receivedMessages.size}`);
    }

    /**
     * 处理接收到的消息（兼容旧接口）
     */
    async handleIncomingMessage(message: string): Promise<void> {
        try {
            this.logger.info(`收到消息: ${message}`);
            const rawData = JSON.parse(message);
            const state = this.deserializeEditorState(rawData);
            this.logger.info(`🍕解析消息: ${state.action} ${state.filePath}，${state.getCursorLog()}，${state.getSelectionLog()}`)

            // 验证消息有效性
            if (!this.isValidMessage(state)) {
                return;
            }

            // 路由到文件操作处理器
            await this.fileOperationHandler.handleIncomingState(state)

        } catch (error) {
            this.logger.warn(`解析消息失败: `, error as Error);
        }
    }

    /**
     * 处理接收到的状态（新接口）
     */
    private async handleIncomingState(state: EditorState): Promise<void> {
        try {
            this.logger.info(`🍕解析消息: ${state.action} ${state.filePath}，${state.getCursorLog()}，${state.getSelectionLog()}`)

            // 验证消息有效性
            if (!this.isValidMessage(state)) {
                return;
            }

            // 路由到文件操作处理器
            await this.fileOperationHandler.handleIncomingState(state)

        } catch (error) {
            this.logger.warn(`处理状态失败: `, error as Error);
        }
    }

    /**
     * 将JSON对象反序列化为EditorState实例
     */
    private deserializeEditorState(rawData: any): EditorState {
        return new EditorState(
            rawData.action,
            rawData.filePath,
            rawData.line,
            rawData.column,
            rawData.source,
            rawData.isActive,
            rawData.timestamp,
            rawData.openedFiles,
            rawData.selectionStartLine,
            rawData.selectionStartColumn,
            rawData.selectionEndLine,
            rawData.selectionEndColumn
        );
    }

    /**
     * 验证消息有效性
     */
    private isValidMessage(state: EditorState): boolean {
        // // 忽略来自自己的消息
        // if (state.source === SourceType.VSCODE) {
        //     return false;
        // }

        // 只处理来自活跃IDE的消息
        if (!state.isActive) {
            this.logger.info('忽略来自非活跃JetBrains IDE的消息');
            return false;
        }

        // 检查消息时效性
        const messageTime = parseTimestamp(state.timestamp);
        const currentTime = Date.now();
        if (currentTime - messageTime > this.messageTimeoutMs) { // 5秒过期
            this.logger.info(`忽略过期消息，时间差: ${currentTime - messageTime}ms`);
            return false;
        }

        return true;
    }
}
