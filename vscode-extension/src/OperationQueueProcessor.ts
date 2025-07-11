import {ActionType, EditorState} from './Type';
import {Logger} from './Logger';
import {WebSocketServerManager} from './WebSocketServerManager';
import {MessageProcessor} from "./MessageProcessor";

/**
 * 操作队列处理器
 * 确保操作的原子性和顺序性
 * 包含队列容量管理和操作添加逻辑
 */
export class OperationQueueProcessor {
    private messageProcessor: MessageProcessor;
    private logger: Logger;
    private webSocketManager: WebSocketServerManager;
    private processingInterval: NodeJS.Timeout | null = null;

    // 内部队列管理
    private operationQueue: EditorState[] = [];
    private maxQueueSize = 100;

    // 处理状态
    private isShutdown: boolean = false;

    constructor(
        messageProcessor: MessageProcessor,
        logger: Logger,
        webSocketManager: WebSocketServerManager,
    ) {
        this.messageProcessor = messageProcessor;
        this.logger = logger;
        this.webSocketManager = webSocketManager;

        // 在构造函数中自动启动队列处理器
        this.start();
    }

    /**
     * 添加操作到队列
     * 包含队列容量管理逻辑
     */
    addOperation(state: EditorState) {
        if (this.operationQueue.length >= this.maxQueueSize) {
            this.operationQueue.shift();
            this.logger.warn('操作队列已满，移除最旧的操作');
        }

        this.operationQueue.push(state);
        this.logger.info(`操作已推入队列：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}`)
    }

    /**
     * 启动队列处理器
     */
    start() {
        if (!this.isShutdown) {
            this.logger.info('启动VSCode队列处理器');
            this.processingInterval = setInterval(() => {
                this.processQueue();
            }, 100); // 每100ms检查一次队列
        }
    }

    /**
     * 处理操作队列
     */
    async processQueue() {
        if (this.isShutdown) {
            return;
        }

        while (this.operationQueue.length > 0 && !this.isShutdown) {
            try {
                const state = this.operationQueue.shift();
                if (!state) {
                    continue;
                }
                await this.processOperation(state);

                // 避免过于频繁的操作
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                this.logger.warn(`队列处理器发生错误：`, error as Error);
            }
        }
    }

    /**
     * 处理单个操作
     */
    private async processOperation(state: EditorState) {
        try {
            this.sendStateUpdate(state);
        } catch (error) {
            this.logger.warn('处理操作失败:', error as Error);
        }
    }

    /**
     * 发送状态更新
     */
    private sendStateUpdate(state: EditorState) {
        const message = this.messageProcessor.serializeState(state);
        if (!message) {
            return;
        }
        const success = this.webSocketManager.sendMessage(message);
        if (success) {
            this.logger.info(`✅ 发送消息Idea：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}`)
        } else {
            this.logger.info(`❌ 发送消息Idea：${state.action} ${state.filePath}, 行${state.line}, 列${state.column}`)
        }
    }


    /**
     * 停止队列处理器
     */
    dispose() {
        this.logger.info('开始关闭VSCode队列处理器');

        this.isShutdown = true;

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }

        // 清理队列
        this.operationQueue.length = 0;

        this.logger.info('VSCode队列处理器已关闭');
    }
}
