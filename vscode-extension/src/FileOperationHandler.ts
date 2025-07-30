import * as vscode from 'vscode';
import * as path from 'path';
import {ActionType, EditorState, SourceType} from './Type';
import {Logger} from './Logger';
import {FileUtils} from './FileUtils';
import {EditorStateManager} from './EditorStateManager';
import {WindowStateManager} from './WindowStateManager';

/**
 * 文件操作处理器
 * 负责文件的打开、关闭和导航操作
 */
export class FileOperationHandler {
    private logger: Logger;
    private editorStateManager: EditorStateManager;
    private windowStateManager: WindowStateManager;

    constructor(logger: Logger, editorStateManager: EditorStateManager, windowStateManager: WindowStateManager) {
        this.logger = logger;
        this.editorStateManager = editorStateManager;
        this.windowStateManager = windowStateManager;
    }


    async handleIncomingState(state: EditorState): Promise<void> {
        try {
            if (state.action === ActionType.CLOSE) {
                return this.handleFileClose(state);
            } else if (state.action === ActionType.WORKSPACE_SYNC) {
                return this.handleWorkspaceSync(state);
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
        this.logger.info(`进行文件关闭操作: ${state.filePath}`);
        const compatiblePath = state.getCompatiblePath();
        await this.closeFileByPath(compatiblePath);
    }

    /**
     * 处理工作区同步操作
     */
    async handleWorkspaceSync(state: EditorState): Promise<void> {
        this.logger.info(`进行工作区同步操作：目标文件数量: ${state.openedFiles?.length || 0}`);

        if (!state.openedFiles || state.openedFiles.length === 0) {
            this.logger.info('工作区同步消息中没有打开的文件，跳过处理');
            return;
        }

        try {
            // 获取当前编辑器活跃状态
            let currentActiveState = await this.isCurrentEditorActive();
            this.logger.info(`当前编辑器活跃状态: ${currentActiveState}`);
            // 如果当前编辑器活跃，保存当前编辑器状态
            let savedActiveEditorState: EditorState | null = this.getCurrentActiveEditorState();
            this.logger.info(`保存当前的活跃编辑器状态: ${savedActiveEditorState?.filePath}`);

            // 获取当前所有打开的文件
            const currentOpenedFiles = this.getCurrentOpenedFiles();
            const targetFiles = state.openedFiles.map(filePath => {
                // 创建临时EditorState以使用路径转换逻辑
                const tempState = new EditorState(ActionType.OPEN, filePath, 0, 0);
                return tempState.getCompatiblePath();
            });

            this.logger.info(`当前打开文件: ${currentOpenedFiles.length}个`);
            this.logger.info(`目标文件: ${targetFiles.length}个`);
            this.logger.info(`当前打开的常规文件列表: ${currentOpenedFiles.map(f => path.basename(f)).join(', ')}`);

            // 关闭多余的文件（当前打开但目标中不存在的文件）
            const filesToClose = currentOpenedFiles.filter((file: string) => !targetFiles.includes(file));
            for (const fileToClose of filesToClose) {
                await this.closeFileByPath(fileToClose);
            }

            // 打开缺失的文件（目标中存在但当前未打开的文件）
            const filesToOpen = targetFiles.filter((file: string) => !currentOpenedFiles.includes(file));
            for (const fileToOpen of filesToOpen) {
                await this.openFileByPath(fileToOpen);
            }

            // 再次获取当前编辑器活跃状态（防止状态延迟变更）
            currentActiveState = await this.isCurrentEditorActive();
            if (currentActiveState && savedActiveEditorState) {
                this.logger.info(`恢复之前保存的活跃编辑器状态: ${savedActiveEditorState.filePath}`);
                await this.handleFileOpenOrNavigate(savedActiveEditorState);

                // 恢复活跃编辑器状态后，发送当前光标位置给其他编辑器
                this.editorStateManager.sendCurrentState(true);
                this.logger.info('已发送当前活跃编辑器状态给其他编辑器');
            } else {
                await this.handleFileOpenOrNavigate(state);
            }

            this.logger.info(`✅ 工作区同步完成`);
        } catch (error) {
            this.logger.warn('工作区同步失败:', error as Error);
        }
    }


    /**
     * 处理文件打开和导航操作
     */
    async handleFileOpenOrNavigate(state: EditorState): Promise<void> {
        this.logger.info(`进行文件导航操作: ${state.filePath}, 行${state.line}, 列${state.column}`)
        try {
            const editor = await this.openFileByPath(state.getCompatiblePath());
            if (editor) {
                this.navigateToPosition(editor, state.line, state.column);
                this.logger.info(`✅ 成功同步到文件: ${state.filePath}, 行${state.line}, 列${state.column}`);
            }
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
     * 获取当前所有打开的文件路径
     * 只返回常规文件标签，过滤掉特殊标签窗口
     */
    private getCurrentOpenedFiles(): string[] {
        const openedFiles: string[] = [];

        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // 只处理常规文本文件标签，过滤掉所有特殊标签类型
                if (FileUtils.isRegularFileTab(tab)) {
                    const tabInput = tab.input as vscode.TabInputText;
                    const uri = tabInput.uri;

                    // 文件协议已在 FileUtils.isRegularFileTab 中验证，直接添加
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
    private async closeFileByPath(filePath: string): Promise<void> {
        try {
            this.logger.info(`准备关闭文件: ${filePath}`);
            const documents = vscode.workspace.textDocuments;

            // 首先尝试精确路径匹配
            let editorToClose = documents.find(doc => doc.uri.fsPath === filePath);

            if (editorToClose) {
                await vscode.window.showTextDocument(editorToClose);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                this.logger.info(`✅ 成功关闭文件: ${filePath}`);
                return;
            }

            // 如果精确匹配失败，尝试通过文件名匹配
            this.logger.warn(`❌ 精确路径匹配失败: ${filePath}`);
            const fileName = path.basename(filePath);
            this.logger.info(`🔍 尝试通过文件名查找: ${fileName}`);

            editorToClose = documents.find(doc => {
                const docFileName = path.basename(doc.uri.fsPath);
                return docFileName === fileName;
            });

            if (editorToClose) {
                this.logger.info(`🎯 找到匹配的文件: ${editorToClose.uri.fsPath}`);
                await vscode.window.showTextDocument(editorToClose);
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                this.logger.info(`✅ 通过文件名匹配成功关闭文件: ${editorToClose.uri.fsPath}`);
            } else {
                this.logger.warn(`❌ 未找到匹配的文件: ${fileName}`);
            }
        } catch (error) {
            this.logger.warn(`关闭文件失败: ${filePath}`, error as Error);
        }
    }

    /**
     * 获取当前活跃编辑器的状态
     */
    private getCurrentActiveEditorState(): EditorState | null {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return null;
            }

            const position = activeEditor.selection.active;
            return new EditorState(
                ActionType.NAVIGATE,
                activeEditor.document.uri.fsPath,
                position.line,
                position.character,
                SourceType.VSCODE,
                true
            );
        } catch (error) {
            this.logger.warn('获取当前活跃编辑器状态失败:', error as Error);
            return null;
        }
    }

    /**
     * 根据文件路径打开文件
     * @param filePath 文件路径
     * @returns 返回打开的TextEditor，如果失败返回null
     */
    private async openFileByPath(filePath: string): Promise<vscode.TextEditor | null> {
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
     * 检查当前编辑器是否处于活跃状态
     * 对于关键的编辑器状态检查，使用重试机制确保准确性
     */
    private async isCurrentEditorActive(): Promise<boolean> {
        let attempts = 0;
        const maxAttempts = 5;
        const delay = 100; // 每次尝试之间的延迟

        while (attempts < maxAttempts) {
            // 对于关键的编辑器状态检查，使用强制实时查询确保准确性
            const isActive = this.windowStateManager.isWindowActive(true);
            if (isActive) {
                return true;
            }
            this.logger.warn(`检查活跃编辑器状态失败，尝试 ${attempts + 1}/${maxAttempts}...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempts++;
        }
        return false;
    }
}
