import * as vscode from 'vscode';

/**
 * 日志管理器
 * 提供统一的日志记录功能
 */
export class Logger {
    private outputChannel: vscode.OutputChannel;

    constructor(channelName: string) {
        this.outputChannel = vscode.window.createOutputChannel(channelName);
    }

    private formatMessage(level: string, message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    info(message: string) {
        const formattedMessage = this.formatMessage('信息', message);
        this.outputChannel.appendLine(formattedMessage);
    }

    warn(message: string, error?: Error) {
        const formattedMessage = this.formatMessage('警告', message);
        this.outputChannel.appendLine(formattedMessage);
        if (error) {
            this.outputChannel.appendLine(this.formatMessage('错误', `堆栈: ${error.stack}`));
        }
    }

    error(message: string, error?: Error) {
        const formattedMessage = this.formatMessage('错误', message);
        this.outputChannel.appendLine(formattedMessage);
        if (error) {
            this.outputChannel.appendLine(this.formatMessage('错误', `堆栈: ${error.stack}`));
        }
    }

    debug(message: string) {
        const formattedMessage = this.formatMessage('调试', message);
        this.outputChannel.appendLine(formattedMessage);
    }

    dispose() {
        this.outputChannel.dispose();
    }
} 