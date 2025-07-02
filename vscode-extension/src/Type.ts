/**
 * 操作类型枚举
 * 定义编辑器同步过程中的各种操作类型
 * 使用字符串枚举确保JSON序列化兼容性
 */
export enum ActionType {
    CLOSE = "CLOSE",        // 关闭文件
    OPEN = "OPEN",          // 打开文件
    NAVIGATE = "NAVIGATE"   // 光标导航
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

    // 平台兼容路径缓存
    private _compatiblePath?: string;

    constructor(
        action: ActionType,
        filePath: string,
        line: number,
        column: number,
        source: SourceType = SourceType.VSCODE,
        isActive: boolean = false,
        timestamp: string = formatTimestamp()
    ) {
        this.action = action;
        this.filePath = filePath;
        this.line = line;
        this.column = column;
        this.source = source;
        this.isActive = isActive;
        this.timestamp = timestamp;
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
     * IDEA格式: C:/Users/LEE/Documents/...
     * VSCode格式: c:\Users\LEE\Documents\...
     */
    private convertToVSCodeFormat(path: string): string {
        let vscodePath = path;

        // 将正斜杠替换为反斜杠
        vscodePath = vscodePath.replace(/\//g, '\\');

        // 处理盘符：将大写盘符转为小写
        // 匹配 C:\ 或 C: 格式的盘符
        if (/^[A-Z]:\\/.test(vscodePath) || /^[A-Z]:/.test(vscodePath)) {
            vscodePath = vscodePath[0].toLowerCase() + vscodePath.substring(1);
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
