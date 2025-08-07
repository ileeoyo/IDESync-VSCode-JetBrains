import * as os from 'os';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

/**
 * 本机标识管理器
 * 负责生成和管理本机唯一标识，供各个组件使用
 * 支持多项目实例，通过项目路径区分不同的IDEA项目窗口
 * 支持VSCode多版本，通过PID区分同一项目的不同进程
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
     * 格式: hostname-projectHash-pid
     * - projectHash: 解决IDEA多项目窗口PID相同的问题
     * - pid: 解决VSCode多版本同项目PID不同的问题
     */
    private generateLocalIdentifier(): string {
        try {
            const hostname = os.hostname();
            const projectHash = this.generateProjectHash();
            const pid = process.pid;
            return `${hostname}-${projectHash}-${pid}`;
        } catch (e) {
            return `unknown-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        }
    }

    /**
     * 生成项目哈希值
     * 基于项目路径生成短哈希，用于区分不同项目实例
     */
    private generateProjectHash(): string {
        try {
            // 获取VSCode工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const projectPath = workspaceFolders && workspaceFolders.length > 0
                ? workspaceFolders[0].uri.fsPath
                : 'unknown-project';

            // 生成MD5哈希
            const hash = crypto.createHash('md5');
            hash.update(projectPath);
            const hashBytes = hash.digest();

            // 取前3字节（6位十六进制字符）作为项目哈希
            return hashBytes.subarray(0, 3).toString('hex');
        } catch (e) {
            // 如果哈希生成失败，使用时间戳后6位作为后备方案
            return Date.now().toString().slice(-6);
        }
    }
}