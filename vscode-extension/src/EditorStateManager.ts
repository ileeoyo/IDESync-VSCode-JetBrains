import * as vscode from 'vscode';
import {ActionType, SourceType, EditorState, formatTimestamp} from './Type';
import {Logger} from "./Logger";

/**
 * 编辑器状态管理器
 * 负责状态缓存、防抖和去重
 */
export class EditorStateManager {
    private logger: Logger;
    // 按文件路径分组的防抖定时器
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    // 防抖延迟
    private readonly debounceDelayMs = 300;

    private stateChangeCallback: ((state: EditorState) => void) | null = null;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * 设置状态变化回调
     */
    setStateChangeCallback(callback: (state: EditorState) => void) {
        this.stateChangeCallback = callback;
    }

    /**
     * 创建编辑器状态
     */
    createEditorState(
        editor: vscode.TextEditor,
        action: ActionType,
        isActive: boolean
    ): EditorState {
        const position = editor.selection.active;

        return new EditorState(
            action,
            editor.document.uri.fsPath,
            position.line,
            position.character,
            SourceType.VSCODE,
            isActive,
            formatTimestamp()
        );
    }

    createCloseState(filePath: string, isActive: boolean): EditorState {
        return new EditorState(
            ActionType.CLOSE,
            filePath,
            0,
            0,
            SourceType.VSCODE,
            isActive,
            formatTimestamp()
        );
    }

    /**
     * 清理指定文件路径的防抖定时器
     */
    private clearDebounceTimer(filePath: string) {
        const timer = this.debounceTimers.get(filePath);
        if (timer) {
            clearTimeout(timer);
            this.debounceTimers.delete(filePath);
            this.logger.debug(`清理文件防抖定时器: ${filePath}`);
        }
    }

    /**
     * 防抖更新状态
     */
    debouncedUpdateState(state: EditorState) {
        const filePath = state.filePath;

        // 清除该文件之前的防抖定时器
        this.clearDebounceTimer(filePath);

        // 创建新的防抖定时器
        const timer = setTimeout(() => {
            try {
                this.updateState(state);
            } catch (error) {
                this.logger.warn(`更新状态时发生错误: ${error}`);
            } finally {
                // 无论是否发生异常，都要清理定时器，防止内存泄漏
                this.debounceTimers.delete(filePath);
            }
        }, this.debounceDelayMs);
        
        this.debounceTimers.set(filePath, timer);
    }

    /**
     * 立即更新状态
     */
    updateState(state: EditorState) {
        // 如果是文件关闭操作，立即清理防抖定时器并直接处理
        if (state.action === ActionType.CLOSE) {
            this.clearDebounceTimer(state.filePath);
        }
        // 通知状态变化
        this.stateChangeCallback?.(state);
    }

    /**
     * 发送当前状态
     * 获取当前活跃编辑器的状态并发送
     */
    sendCurrentState(isActive: boolean) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const state = this.createEditorState(
                activeEditor, ActionType.NAVIGATE, isActive
            );
            this.updateState(state);
            this.logger.info(`发送当前状态: ${activeEditor.document.uri.fsPath}`);
        }
    }

    /**
     * 清理资源
     */
    dispose() {
        this.logger.info("开始清理编辑器状态管理器资源")
        
        // 清理所有防抖定时器
        for (const [filePath, timer] of this.debounceTimers) {
            clearTimeout(timer);
            this.logger.debug(`清理防抖定时器: ${filePath}`);
        }
        this.debounceTimers.clear();
        
        this.logger.info("编辑器状态管理器资源清理完成")
    }
}
