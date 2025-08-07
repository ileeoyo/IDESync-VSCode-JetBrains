import {ActionType, EditorState} from './Type';
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
        await FileUtils.closeFileByPath(compatiblePath);
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
            let savedActiveEditorState: EditorState | null = this.editorStateManager.getCurrentActiveEditorState(this.windowStateManager.isWindowActive(true));
            this.logger.info(`保存当前的活跃编辑器状态: ${savedActiveEditorState?.filePath}`);

            // 获取当前所有打开的文件
            const currentOpenedFiles = FileUtils.getAllOpenedFiles();
            const targetFiles = state.openedFiles.map(filePath => {
                // 创建临时EditorState以使用路径转换逻辑
                const tempState = new EditorState(ActionType.OPEN, filePath, 0, 0);
                return tempState.getCompatiblePath();
            });

            this.logger.info(`当前打开文件: ${currentOpenedFiles.length}个`);
            this.logger.info(`目标文件: ${targetFiles.length}个`);
            this.logger.info(`当前打开的常规文件列表: ${currentOpenedFiles.map(f => FileUtils.extractFileName(f)).join(', ')}`);

            // 关闭多余的文件（当前打开但目标中不存在的文件）
            const filesToClose = currentOpenedFiles.filter((file: string) => !targetFiles.includes(file));
            for (const fileToClose of filesToClose) {
                await FileUtils.closeFileByPath(fileToClose);
            }

            // 打开缺失的文件（目标中存在但当前未打开的文件）
            const filesToOpen = targetFiles.filter((file: string) => !currentOpenedFiles.includes(file));
            for (const fileToOpen of filesToOpen) {
                await FileUtils.openFileByPath(fileToOpen);
            }

            // 再次获取当前编辑器活跃状态（防止状态延迟变更）
            currentActiveState = await this.isCurrentEditorActive();
            if (currentActiveState) {
                if (savedActiveEditorState) {
                    this.logger.info(`恢复之前保存的活跃编辑器状态: ${savedActiveEditorState.filePath}`);
                    await this.handleFileOpenOrNavigate(savedActiveEditorState);

                    // 恢复活跃编辑器状态后，发送当前光标位置给其他编辑器
                    this.editorStateManager.sendCurrentState(true);
                    this.logger.info('已发送当前活跃编辑器状态给其他编辑器');
                } else {
                    this.logger.info('没有保存的活跃编辑器状态，不进行恢复');
                }
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
        if (state.hasSelection()) {
            this.logger.info(`进行文件选中并导航操作: ${state.filePath}，导航到: ${state.getCursorInfo()} ${state.getSelectionInfoStr()}`);
        } else {
            this.logger.info(`进行文件导航操作: ${state.filePath}，导航到: ${state.getCursorInfo()}`);
        }

        try {
            const editor = await FileUtils.openFileByPath(state.getCompatiblePath());
            if (editor) {
                // 使用统一的选中和光标处理逻辑
                FileUtils.handleSelectionAndNavigate(
                    editor,
                    state.line,
                    state.column,
                    state.selectionStartLine,
                    state.selectionStartColumn,
                    state.selectionEndLine,
                    state.selectionEndColumn
                );
            } else {
                this.logger.warn(`无法打开文件进行导航: ${state.getCompatiblePath()}`);
            }
        } catch (error) {
            this.logger.warn('处理接收状态失败:', error as Error);
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
