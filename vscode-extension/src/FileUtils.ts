import * as vscode from 'vscode';

/**
 * 文件工具类
 * 提供文件操作相关的工具方法
 */
export class FileUtils {

    /**
     * 判断是否为常规文件标签（只允许常规文件协议）
     */
    static isRegularFileTab(tab: vscode.Tab): boolean {
        const input = tab.input;

        // 只接受 TabInputText 类型，排除其他所有类型
        if (!(input instanceof vscode.TabInputText)) {
            return false;
        }

        const uri = input.uri;

        // 复用 isRegularFileUri 的逻辑
        return this.isRegularFileUri(uri);
    }

    /**
     * 判断是否为常规文件URI（只允许常规文件协议）
     */
    static isRegularFileUri(uri: vscode.Uri): boolean {
        // 白名单机制：只允许常规文件协议
        const allowedSchemes = [
            'file'              // 本地文件系统
        ];

        return allowedSchemes.includes(uri.scheme);
    }

    /**
     * 获取当前所有打开的文件路径
     * 只返回常规文件标签，过滤掉特殊标签窗口
     */
    static getAllOpenedFiles(): string[] {
        const openedFiles: string[] = [];

        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // 只处理常规文本文件标签，过滤掉所有特殊标签类型
                if (this.isRegularFileTab(tab)) {
                    const tabInput = tab.input as vscode.TabInputText;
                    const uri = tabInput.uri;

                    // 文件协议已在 isRegularFileTab 中验证，直接添加
                    openedFiles.push(uri.fsPath);
                }
            }
        }

        return openedFiles;
    }
} 