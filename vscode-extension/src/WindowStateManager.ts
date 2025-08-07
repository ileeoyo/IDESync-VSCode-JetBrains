import * as vscode from 'vscode';
import {Logger} from './Logger';

/**
 * 窗口状态管理器
 * 统一管理窗口活跃状态，提供高效且准确的状态查询
 * 结合事件监听的高性能和实时查询的准确性优势
 */
export class WindowStateManager {
    private logger: Logger;

    // 事件监听维护的状态缓存（高性能查询）
    private isActiveCache: boolean = true;

    // 状态变化回调
    private onWindowStateChange?: (isActive: boolean) => void;

    // 事件监听器的清理函数
    private disposable?: vscode.Disposable;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 获取工作区名称
     */
    private getWorkspaceName(): string {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return workspaceFolders[0].name;
            }
            return 'unknown-workspace';
        } catch (error) {
            return 'unknown-workspace';
        }
    }

    /**
     * 初始化窗口状态监听
     */
    initialize(): void {
        const workspaceName = this.getWorkspaceName();
        this.logger.info(`初始化窗口状态管理器: ${workspaceName}`);
        this.setupWindowFocusListener();
        // 初始化时获取真实状态
        this.isActiveCache = this.getRealTimeWindowState();
        this.logger.info(`窗口状态管理器初始化完成: ${workspaceName}，当前状态: ${this.isActiveCache}`);
    }

    /**
     * 设置窗口焦点监听器
     */
    private setupWindowFocusListener(): void {
        const workspaceName = this.getWorkspaceName();
        this.disposable = vscode.window.onDidChangeWindowState((e) => {
            this.updateWindowState(e.focused);
            if (e.focused) {
                this.logger.info(`VSCode窗口获得焦点: ${workspaceName}`);
            } else {
                this.logger.info(`VSCode窗口失去焦点: ${workspaceName}`);
            }
        });
    }

    /**
     * 更新窗口状态并触发回调
     */
    private updateWindowState(isActive: boolean): void {
        const previousState = this.isActiveCache;
        this.isActiveCache = isActive;

        // 状态发生变化时触发回调
        if (previousState !== isActive) {
            this.onWindowStateChange?.(isActive);
        }
    }

    /**
     * 获取窗口活跃状态（高性能版本）
     * 大多数情况下使用事件监听维护的缓存状态
     * @param forceRealTime 是否强制实时查询，默认false
     * @return 窗口是否活跃
     */
    isWindowActive(forceRealTime: boolean = false): boolean {
        if (forceRealTime) {
            // 强制实时查询，用于关键操作或状态验证
            const realTimeState = this.getRealTimeWindowState();

            // 如果发现缓存状态与实时状态不一致，更新缓存
            const cachedState = this.isActiveCache;
            if (cachedState !== realTimeState) {
                this.logger.warn(`检测到状态不一致，缓存: ${cachedState}, 实时: ${realTimeState}，正在同步`);
                this.updateWindowState(realTimeState);
            }

            return realTimeState;
        } else {
            // 使用高性能的缓存状态
            return this.isActiveCache;
        }
    }

    /**
     * 实时获取窗口状态
     * 直接从VSCode API获取，确保状态准确性
     */
    private getRealTimeWindowState(): boolean {
        try {
            return vscode.window.state.focused;
        } catch (error) {
            this.logger.warn('获取实时窗口状态失败:', error as Error);
            // 获取失败时返回缓存状态
            return this.isActiveCache;
        }
    }

    /**
     * 设置窗口状态变化回调
     * @param callback 状态变化时的回调函数，参数为新的活跃状态
     */
    setOnWindowStateChangeCallback(callback: (isActive: boolean) => void): void {
        this.onWindowStateChange = callback;
    }

    /**
     * 清理资源
     */
    dispose(): void {
        const workspaceName = this.getWorkspaceName()
        this.logger.info(`开始清理窗口状态管理器资源: ${workspaceName}`);

        this.disposable?.dispose();
        this.logger.info(`同步服务资源清理完成`);
    }
}