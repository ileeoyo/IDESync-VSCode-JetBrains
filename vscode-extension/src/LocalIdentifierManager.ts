import * as os from 'os';

/**
 * 本机标识管理器
 * 负责生成和管理本机唯一标识，供各个组件使用
 */
export class LocalIdentifierManager {
    private static _instance: LocalIdentifierManager | null = null;
    private readonly _identifier: string;

    private constructor() {
        this._identifier = this.generateLocalIdentifier();
    }

    /**
     * 获取单例实例
     */
    static getInstance(): LocalIdentifierManager {
        if (!LocalIdentifierManager._instance) {
            LocalIdentifierManager._instance = new LocalIdentifierManager();
        }
        return LocalIdentifierManager._instance;
    }

    /**
     * 获取本机唯一标识
     */
    get identifier(): string {
        return this._identifier;
    }

    /**
     * 生成本机唯一标识
     * 格式: hostname-pid-timestamp
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
}