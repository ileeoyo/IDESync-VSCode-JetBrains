import * as vscode from 'vscode';
import * as path from 'path';
import {ActionType, EditorState} from './Type';
import {Logger} from './Logger';

/**
 * 文件操作处理器
 * 负责文件的打开、关闭和导航操作
 */
export class FileOperationHandler {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }


    async handleIncomingState(state: EditorState): Promise<void> {
        try {
            if (state.action === ActionType.CLOSE) {
                return this.handleFileClose(state);
            } else {
                return this.handleFileOpenOrNavigate(state);
            }
        } catch (error) {
            this.logger.warn('处理消息操作失败:', error as Error);
        }
    }


    /**
     * 处理文件关闭操作
     */
    async handleFileClose(state: EditorState): Promise<void> {
        this.logger.info(`准备关闭文件: ${state.filePath}`);
        // 使用EditorState的平台兼容路径
        const compatiblePath = state.getCompatiblePath()
        try {
            const documents = vscode.workspace.textDocuments;
            const editorToClose = documents.find(doc => {
                return compatiblePath === doc.uri.fsPath;
            });

            if (editorToClose) {
                this.logger.info(`找到目标文件，准备关闭: ${editorToClose.uri.fsPath}`);

                await vscode.window.showTextDocument(editorToClose);
                this.logger.info(`激活目标文件: ${editorToClose.uri.fsPath}`);

                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                this.logger.info(`✅ 成功关闭文件: ${editorToClose.uri.fsPath}`);

            } else {
                this.logger.warn(`❌ 无法找到要关闭的文件: ${compatiblePath}`);
                // 尝试通过文件名匹配
                await this.findAndCloseFileByName(compatiblePath);
            }
        } catch (error) {
            this.logger.warn(`文档关闭失败: ${state.filePath}`, error as Error);
        }
    }


    /**
     * 处理文件打开和导航操作
     */
    async handleFileOpenOrNavigate(state: EditorState): Promise<void> {
        this.logger.info(`准备导航文件: ${state.filePath}, 行${state.line}, 列${state.column}`)
        try {
            const uri = vscode.Uri.file(state.getCompatiblePath());
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document, {preview: false});

            this.navigateToPosition(editor, state.line, state.column);
            this.logger.info(`✅ 成功同步到文件: ${state.filePath}, 行${state.line}, 列${state.column}`);
        } catch (error) {
            this.logger.warn('处理接收状态失败:', error as Error);
        }
    }

    /**
     * 导航到指定位置
     */
    private navigateToPosition(editor: vscode.TextEditor, line: number, column: number): void {
        const position = new vscode.Position(line, column);
        editor.selection = new vscode.Selection(position, position);

        // 智能滚动：只在光标不可见时才滚动
        const visibleRange = editor.visibleRanges[0];
        if (!visibleRange || !visibleRange.contains(position)) {
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenter
            );
            this.logger.info(`光标位置不可见，执行滚动到: 行${line}, 列${column}`);
        }
    }

    /**
     * 通过文件名在项目中查找并关闭文件
     */
    private async findAndCloseFileByName(filePath: string): Promise<void> {
        try {
            const fileName = path.basename(filePath);
            this.logger.info(`🔍 尝试通过文件名查找: ${fileName}`);

            const documents = vscode.workspace.textDocuments;

            // 查找匹配的文件名
            const matchingDocument = documents.find(doc => {
                const docFileName = path.basename(doc.uri.fsPath);
                return docFileName === fileName;
            });

            if (matchingDocument) {
                this.logger.info(`🎯 找到匹配的文件: ${matchingDocument.uri.fsPath}`);

                await vscode.window.showTextDocument(matchingDocument);
                this.logger.info(`激活匹配的文件: ${matchingDocument.uri.fsPath}`);

                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                this.logger.info(`✅ 通过文件名匹配成功关闭文件: ${matchingDocument.uri.fsPath}`);
            } else {
                this.logger.warn(`❌ 未找到匹配的文件名: ${fileName}`);
            }

        } catch (error) {
            this.logger.warn(`通过文件名查找失败: ${error instanceof Error ? error.message : String(error)}`, error as Error);
        }
    }
}
