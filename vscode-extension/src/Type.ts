/**
 * 操作类型枚举
 * 定义编辑器同步过程中的各种操作类型
 * 使用字符串枚举确保JSON序列化兼容性
 */
export enum ActionType {
    CLOSE = "CLOSE",        // 关闭文件
    OPEN = "OPEN",          // 打开文件
    NAVIGATE = "NAVIGATE",  // 光标导航
    WORKSPACE_SYNC = "WORKSPACE_SYNC"  // 工作区状态同步
}

/**
 * 消息来源枚举
 * 定义消息的发送方
 */
export enum SourceType {
    VSCODE = "VSCODE",       // VSCode编辑器
    JETBRAINS = "JETBRAINS"  // JetBrains IDE
}

/**
 * 连接状态枚举
 * 定义WebSocket连接的各种状态
 */
export enum ConnectionState {
    DISCONNECTED = "DISCONNECTED",  // 已断开连接
    CONNECTING = "CONNECTING",      // 正在连接
    CONNECTED = "CONNECTED"         // 已连接
}

/**
 * 编辑器状态类
 * 用于在VSCode和JetBrains之间传递编辑器状态
 */
export class EditorState {
    public action: ActionType;        // 操作类型枚举（必填）
    public filePath: string;          // 文件路径
    public line: number;              // 行号（从0开始）
    public column: number;            // 列号（从0开始）
    public source: SourceType;        // 消息来源枚举
    public isActive: boolean;         // IDE是否处于活跃状态
    public timestamp: string;         // 时间戳 (yyyy-MM-dd HH:mm:ss.SSS)
    public openedFiles?: string[];    // 工作区所有打开的文件（仅WORKSPACE_SYNC类型使用）

    // 平台兼容路径缓存
    private _compatiblePath?: string;

    constructor(
        action: ActionType,
        filePath: string,
        line: number,
        column: number,
        source: SourceType = SourceType.VSCODE,
        isActive: boolean = false,
        timestamp: string = formatTimestamp(),
        openedFiles?: string[]
    ) {
        this.action = action;
        this.filePath = filePath;
        this.line = line;
        this.column = column;
        this.source = source;
        this.isActive = isActive;
        this.timestamp = timestamp;
        this.openedFiles = openedFiles;
    }

    /**
     * 获取平台兼容的文件路径
     * 首次调用时会清理和转换原始路径，并缓存结果
     * 后续调用直接返回缓存的路径
     */
    getCompatiblePath(): string {
        // 如果已经缓存，直接返回
        if (this._compatiblePath) {
            return this._compatiblePath;
        }

        // 首次调用，进行路径清理和转换
        const cleaned = this.cleanFilePath(this.filePath);
        const converted = this.convertToVSCodeFormat(cleaned);
        this._compatiblePath = converted;

        // 输出日志（如果路径发生了变化）
        if (converted !== this.filePath) {
            console.log(`EditorState: 路径已转换 ${this.filePath} -> ${converted}`);
        }

        return converted;
    }

    /**
     * 清理文件路径，移除异常后缀
     * 参考FileOperationHandler中的cleanFilePath方法
     */
    private cleanFilePath(path: string): string {
        let cleaned = path;

        // 移除异常的.git后缀
        if (cleaned.endsWith('.git')) {
            cleaned = cleaned.slice(0, -4);
        }

        // 移除其他可能的异常后缀
        const abnormalSuffixes = ['.tmp', '.bak', '.swp'];
        for (const suffix of abnormalSuffixes) {
            if (cleaned.endsWith(suffix)) {
                cleaned = cleaned.slice(0, -suffix.length);
                break;
            }
        }

        return cleaned;
    }

    /**
     * 转换路径为VSCode格式
     * 处理跨平台路径兼容性
     */
    private convertToVSCodeFormat(path: string): string {
        let vscodePath = path;

        // 检测操作系统平台
        const isWindows = process.platform === 'win32';
        const isMacOS = process.platform === 'darwin';
        const isLinux = process.platform === 'linux';

        if (isWindows) {
            // Windows: 将正斜杠替换为反斜杠，盘符转小写
            vscodePath = vscodePath.replace(/\//g, '\\');
            if (/^[A-Z]:\\/.test(vscodePath) || /^[A-Z]:/.test(vscodePath)) {
                vscodePath = vscodePath[0].toLowerCase() + vscodePath.substring(1);
            }
        } else if (isMacOS || isLinux) {
            // macOS/Linux: 确保使用正斜杠，移除Windows盘符格式
            vscodePath = vscodePath.replace(/\\/g, '/');
            
            // 移除Windows盘符（如果存在）并转换为Unix路径
            if (/^[A-Za-z]:[\/\\]/.test(vscodePath)) {
                // 例如: C:/Users/... -> /Users/... 或 c:\Users\... -> /Users/...
                vscodePath = vscodePath.substring(2).replace(/\\/g, '/');
            }
            
            // 确保路径以 / 开头
            if (!vscodePath.startsWith('/')) {
                vscodePath = '/' + vscodePath;
            }
            
            // 清理重复的斜杠
            vscodePath = vscodePath.replace(/\/+/g, '/');
        }

        return vscodePath;
    }
}


/**
 * 格式化时间戳为标准格式
 * @param timestamp 时间戳（毫秒）
 * @returns 格式化的时间字符串 (yyyy-MM-dd HH:mm:ss.SSS)
 */
export function formatTimestamp(timestamp?: number): string {
    const date = new Date(timestamp || Date.now());
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * 解析时间戳字符串为毫秒数
 * @param timestampStr 时间戳字符串
 * @returns 毫秒数
 */
export function parseTimestamp(timestampStr: string): number {
    return new Date(timestampStr).getTime();
}


/**
 * 连接状态回调接口
 * 参考Kotlin版本的ConnectionCallback接口
 */
export interface ConnectionCallback {
    onConnected(): void;

    onDisconnected(): void;

    onReconnecting(): void;
}

/**
 * 消息包装器类
 * 用于组播消息的统一包装和处理
 */
export class MessageWrapper {
    private static messageSequence = 0;

    public messageId: string;
    public senderId: string;
    public timestamp: number;
    public payload: EditorState;

    constructor(messageId: string, senderId: string, timestamp: number, payload: EditorState) {
        this.messageId = messageId;
        this.senderId = senderId;
        this.timestamp = timestamp;
        this.payload = payload;
    }

    /**
     * 生成消息ID
     * 格式: {localIdentifier}-{sequence}-{timestamp}
     */
    static generateMessageId(localIdentifier: string): string {
        MessageWrapper.messageSequence++;
        const timestamp = Date.now();
        return `${localIdentifier}-${MessageWrapper.messageSequence}-${timestamp}`;
    }

    /**
     * 创建消息包装器
     */
    static create(localIdentifier: string, payload: EditorState): MessageWrapper {
        return new MessageWrapper(
            MessageWrapper.generateMessageId(localIdentifier),
            localIdentifier,
            Date.now(),
            payload
        );
    }

    /**
     * 转换为JSON字符串
     */
    toJsonString(): string {
        return JSON.stringify(this);
    }

    /**
     * 从JSON字符串解析MessageWrapper
     */
    static fromJsonString(jsonString: string): MessageWrapper | null {
        try {
            const data = JSON.parse(jsonString);
            const editorState = new EditorState(
                data.payload.action,
                data.payload.filePath,
                data.payload.line,
                data.payload.column,
                data.payload.source,
                data.payload.isActive,
                data.payload.timestamp,
                data.payload.openedFiles
            );
            
            return new MessageWrapper(
                data.messageId,
                data.senderId,
                data.timestamp,
                editorState
            );
        } catch (error) {
            return null;
        }
    }

    /**
     * 检查是否是自己发送的消息
     */
    isOwnMessage(localIdentifier: string): boolean {
        return this.senderId === localIdentifier;
    }
}
