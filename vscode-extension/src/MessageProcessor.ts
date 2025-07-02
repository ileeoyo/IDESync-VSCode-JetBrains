import * as vscode from 'vscode';
import {ActionType, SourceType, EditorState, parseTimestamp} from './Type';
import {Logger} from './Logger';
import {FileOperationHandler} from './FileOperationHandler';

/**
 * 消息处理器
 * 负责消息的序列化和反序列化
 */
export class MessageProcessor {
    private logger: Logger;
    private fileOperationHandler: FileOperationHandler;
    private readonly messageTimeoutMs = 5000;

    constructor(logger: Logger, fileOperationHandler: FileOperationHandler) {
        this.logger = logger;
        this.fileOperationHandler = fileOperationHandler;
    }

    /**
     * 处理接收到的消息
     */
    async handleIncomingMessage(message: string): Promise<void> {
        try {
            this.logger.info(`收到消息: ${message}`);
            const rawData = JSON.parse(message);
            const state = this.deserializeEditorState(rawData);
            this.logger.info(`🍕解析消息: ${state.action} ${this.serializeState(state)}`)

            // 验证消息有效性
            if (!this.isValidMessage(state)) {
                return;
            }

            // 路由到文件操作处理器
            this.fileOperationHandler.handleIncomingState(state)

        } catch (error) {
            this.logger.warn(`解析消息失败: `, error as Error);
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
            rawData.timestamp
        );
    }

    /**
     * 验证消息有效性
     */
    private isValidMessage(state: EditorState): boolean {
        // 忽略来自自己的消息
        if (state.source === SourceType.VSCODE) {
            return false;
        }

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


    /**
     * 序列化状态为消息
     */
    serializeState(state: EditorState): string {
        return JSON.stringify(state);
    }
}
