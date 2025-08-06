import * as vscode from 'vscode';
import * as path from 'path';
import {Logger} from './Logger';

/**
 * 文件工具类
 * 提供文件操作相关的工具方法
 */
export class FileUtils {
    private static logger: Logger;

    /**
     * 初始化工具类
     * @param logger 日志记录器
     */
    static initialize(logger: Logger): void {
        this.logger = logger;
    }

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
     * 检查编辑器是否为有效的常规文件编辑器
     * @param editor 文本编辑器
     * @returns 是否为常规文件编辑器
     */
    static isRegularFileEditor(editor: vscode.TextEditor): boolean {
        return this.isRegularFileUri(editor.document.uri);
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
     * 从文件路径提取文件名
     * @param filePath 文件路径
     * @returns 文件名
     */
    static extractFileName(filePath: string): string {
        return path.basename(filePath);
    }

    /**
     * 获取编辑器的文件路径
     * @param editor 文本编辑器
     * @returns 文件路径
     */
    static getEditorFilePath(editor: vscode.TextEditor): string {
        return editor.document.uri.fsPath;
    }

    /**
     * 获取编辑器的光标位置
     * @param editor 文本编辑器
     * @returns 光标位置 {line: number, column: number}
     */
    static getEditorCursorPosition(editor: vscode.TextEditor): { line: number, column: number } {
        const position = editor.selection.active;
        return {
            line: position.line,
            column: position.character
        };
    }

    /**
     * 获取编辑器的选中范围坐标
     * @param editor 文本编辑器
     * @returns 选中范围坐标 {startLine, startColumn, endLine, endColumn}，如果没有选中则返回null
     */
    static getSelectionCoordinates(editor: vscode.TextEditor): { startLine: number, startColumn: number, endLine: number, endColumn: number } | null {
        const selection = editor.selection;
        const hasSelection = !selection.isEmpty;

        if (hasSelection) {
            return {
                startLine: selection.start.line,
                startColumn: selection.start.character,
                endLine: selection.end.line,
                endColumn: selection.end.character
            };
        } else {
            return null;
        }
    }

    /**
     * 获取当前活跃编辑器
     * @returns 返回当前活跃的TextEditor，如果没有则返回null
     */
    static getCurrentActiveEditor(): vscode.TextEditor | null {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return null;
        }

        // 只返回常规文件编辑器
        if (!this.isRegularFileEditor(activeEditor)) {
            return null;
        }

        return activeEditor;
    }

    /**
     * 根据文件路径关闭文件
     * 采用两阶段关闭策略：先尝试tab方式，失败后再用textDocument方式
     * 只使用路径精确匹配，不使用文件名匹配
     */
    static async closeFileByPath(filePath: string): Promise<void> {
        try {
            this.logger.info(`准备关闭文件: ${filePath}`);

            // 第一阶段：尝试通过tabGroups API关闭
            let targetTab: vscode.Tab | undefined;

            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (this.isRegularFileTab(tab)) {
                        const tabInput = tab.input as vscode.TabInputText;
                        if (tabInput.uri.fsPath === filePath) {
                            targetTab = tab;
                            break;
                        }
                    }
                }
                if (targetTab) break;
            }

            if (targetTab) {
                try {
                    await vscode.window.tabGroups.close(targetTab);
                    this.logger.info(`✅ 通过tab方式成功关闭文件: ${filePath}`);
                    return;
                } catch (tabCloseError) {
                    this.logger.warn(`tab方式关闭失败，尝试备用方案: ${filePath}`, tabCloseError as Error);
                }
            } else {
                this.logger.warn(`❌ 在tab中未找到文件: ${filePath}`);
            }

            // 第二阶段：备用方案 - 使用原有的textDocument方式关闭
            this.logger.info(`🔄 尝试通过textDocument方式关闭: ${filePath}`);
            const editorToClose = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);

            if (editorToClose) {
                await vscode.window.showTextDocument(editorToClose);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                this.logger.info(`✅ 通过textDocument方式成功关闭文件: ${filePath}`);
            } else {
                this.logger.warn(`❌ 在textDocument中也未找到文件: ${filePath}`);
            }
        } catch (error) {
            this.logger.warn(`关闭文件失败: ${filePath}`, error as Error);
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @returns 返回打开的TextEditor，如果失败返回null
     */
    static async openFileByPath(filePath: string): Promise<vscode.TextEditor | null> {
        try {
            this.logger.info(`准备打开文件: ${filePath}`);
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, {preview: false});
            this.logger.info(`✅ 成功打开文件: ${filePath}`);
            return editor;
        } catch (error) {
            this.logger.warn(`打开文件失败: ${filePath}`, error as Error);
            return null;
        }
    }


    /**
     * 统一处理选中和光标移动
     * 支持光标在任意位置，不受选中范围限制
     * @param editor 文本编辑器
     * @param line 光标行号
     * @param column 光标列号
     * @param startLine 选中开始行号（可选）
     * @param startColumn 选中开始列号（可选）
     * @param endLine 选中结束行号（可选）
     * @param endColumn 选中结束列号（可选）
     */
    static handleSelectionAndNavigate(
        editor: vscode.TextEditor,
        line: number,
        column: number,
        startLine?: number,
        startColumn?: number,
        endLine?: number,
        endColumn?: number
    ): void {
        try {
            this.logger.info(`准备处理选中和光标导航: 光标位置(${line}, ${column}), 选中范围(${startLine ?? '无'},${startColumn ?? '无'}-${endLine ?? '无'},${endColumn ?? '无'})`);

            const cursorPosition = new vscode.Position(line, column);

            // 检查是否有有效的选中范围参数
            const hasValidSelection = startLine !== undefined && startColumn !== undefined &&
                endLine !== undefined && endColumn !== undefined;

            // 判断是否为非零长度的有效选中
            const hasNonZeroSelection = hasValidSelection &&
                !(startLine === endLine && startColumn === endColumn);

            if (hasNonZeroSelection) {
                // 处理有效选中范围，需要正确设置光标位置
                const startPosition = new vscode.Position(startLine, startColumn);
                const endPosition = new vscode.Position(endLine, endColumn);

                // 通过距离判断选择方向：计算光标到选择开头和结尾的距离
                // 如果光标更接近开头，说明是从下往上选择（锚点在结尾）
                // 如果光标更接近结尾，说明是从上往下选择（锚点在开头）
                const distanceToStart = Math.abs((line - startLine) * 1000 + (column - startColumn));
                const distanceToEnd = Math.abs((line - endLine) * 1000 + (column - endColumn));
                
                if (distanceToStart < distanceToEnd) {
                    // 光标更接近开始位置，从下往上选择
                    // VSCode Selection构造函数：new Selection(anchor, active)
                    // anchor是选择的锚点，active是光标的实际位置
                    editor.selection = new vscode.Selection(endPosition, cursorPosition);
                    this.logger.info(`✅ 成功设置选中范围（从下往上）: (${startLine},${startColumn})-(${endLine},${endColumn})，光标位置: (${line},${column})`);
                } else {
                    // 光标更接近结束位置，从上往下选择
                    editor.selection = new vscode.Selection(startPosition, cursorPosition);
                    this.logger.info(`✅ 成功设置选中范围（从上往下）: (${startLine},${startColumn})-(${endLine},${endColumn})，光标位置: (${line},${column})`);
                }
            } else {
                // 清除选中状态，只设置光标位置
                editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
                this.logger.info(`✅ 成功清除选中状态，光标位置: (${line},${column})`);
            }

            // 确保光标位置在可视区域内
            const visibleRange = editor.visibleRanges[0];
            if (!visibleRange || !visibleRange.contains(cursorPosition)) {
                editor.revealRange(
                    new vscode.Range(cursorPosition, cursorPosition),
                    vscode.TextEditorRevealType.InCenter
                );
                this.logger.info(`✅ 光标位置不可见，已执行滚动到: 行${line}, 列${column}`);
            } else {
                this.logger.info(`光标位置已在可视区域内，无需滚动`);
            }

            this.logger.info(`✅ 选中和光标导航处理完成`);
        } catch (error) {
            this.logger.warn(`❌ 处理选中和光标导航失败: 光标位置(${line}, ${column})`, error as Error);
        }
    }

} 