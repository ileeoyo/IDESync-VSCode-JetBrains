import * as vscode from 'vscode';
import * as path from 'path';
import {Logger} from './Logger';

/**
 * 文件工具类
 * 提供文件操作相关的工具方法
 */
export class FileUtils {

    /**
     * 检查文件是否在其他TAB中仍然打开
     */
    static isFileOpenInOtherTabs(filePath: string): boolean {
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                if (FileUtils.isRegularFileTab(tab)) {
                    const uri = (tab.input as vscode.TabInputText).uri;
                    if (uri.fsPath === filePath) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

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

    /**
     * 根据文件路径关闭文件
     * 如果直接路径匹配失败，会尝试通过文件名匹配
     */
    static async closeFileByPath(filePath: string, logger: Logger): Promise<void> {
        try {
            logger.info(`准备关闭文件: ${filePath}`);
            const documents = vscode.workspace.textDocuments;

            // 首先尝试精确路径匹配
            let editorToClose = documents.find(doc => doc.uri.fsPath === filePath);

            if (editorToClose) {
                await vscode.window.showTextDocument(editorToClose);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                logger.info(`✅ 成功关闭文件: ${filePath}`);
                return;
            }

            // 如果精确匹配失败，尝试通过文件名匹配
            logger.warn(`❌ 精确路径匹配失败: ${filePath}`);
            const fileName = path.basename(filePath);
            logger.info(`🔍 尝试通过文件名查找: ${fileName}`);

            editorToClose = documents.find(doc => {
                const docFileName = path.basename(doc.uri.fsPath);
                return docFileName === fileName;
            });

            if (editorToClose) {
                logger.info(`🎯 找到匹配的文件: ${editorToClose.uri.fsPath}`);
                await vscode.window.showTextDocument(editorToClose);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                logger.info(`✅ 通过文件名匹配成功关闭文件: ${editorToClose.uri.fsPath}`);
            } else {
                logger.warn(`❌ 未找到匹配的文件: ${fileName}`);
            }
        } catch (error) {
            logger.warn(`关闭文件失败: ${filePath}`, error as Error);
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @param logger 日志记录器
     * @returns 返回打开的TextEditor，如果失败返回null
     */
    static async openFileByPath(filePath: string, logger: Logger): Promise<vscode.TextEditor | null> {
        try {
            logger.info(`准备打开文件: ${filePath}`);
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, {preview: false});
            logger.info(`✅ 成功打开文件: ${filePath}`);
            return editor;
        } catch (error) {
            logger.warn(`打开文件失败: ${filePath}`, error as Error);
            return null;
        }
    }

    /**
     * 导航到指定位置
     * @param editor 文本编辑器
     * @param line 行号
     * @param column 列号
     * @param logger 日志记录器
     */
    static navigateToPosition(editor: vscode.TextEditor, line: number, column: number, logger: Logger): void {
        const position = new vscode.Position(line, column);
        editor.selection = new vscode.Selection(position, position);

        // 智能滚动：只在光标不可见时才滚动
        const visibleRange = editor.visibleRanges[0];
        if (!visibleRange || !visibleRange.contains(position)) {
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            logger.info(`光标位置不可见，执行滚动到: 行${line}, 列${column}`);
        }
    }
} 