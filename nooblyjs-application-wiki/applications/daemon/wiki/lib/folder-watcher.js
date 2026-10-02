const chokidar = require('chokidar');
const path = require('node:path');

class FolderWatcher {
  constructor(watchFolder, fileSync, spaceId, ignorePatterns = [], { log = console } = {}) {
    this.watchFolder = watchFolder;
    this.fileSync = fileSync;
    this.spaceId = spaceId;
    this.ignorePatterns = ignorePatterns;
    this.log = log;
    this.watcher = null;
    this.ignoreNextChange = new Set(); // Track files to ignore on next change event
  }

  /**
   * Start watching the folder
   */
  async start() {
    this.log.info(`[Watcher] Starting folder watcher on: ${this.watchFolder}`);

    // Ensure watch folder exists
    await this.fileSync.ensureWatchFolder();

    // Build ignore function: dotfiles + configured patterns
    const ignorePatterns = this.ignorePatterns;
    const ignored = (filePath) => {
      const segments = filePath.split(/[/\\]/);
      // Ignore if any path segment matches a configured pattern
      if (ignorePatterns.some(pattern => segments.includes(pattern))) return true;
      return false;
    };

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.watchFolder, {
      ignored,
      persistent: true,
      ignoreInitial: true,      // don't trigger events for existing files on start
      awaitWriteFinish: {       // wait for file writes to complete
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    // Watch for file additions
    this.watcher.on('add', async (filePath) => {
      this.log.info(`[Watcher] File added: ${filePath}`);
      try {
        await this.fileSync.uploadFile(filePath);
      } catch (error) {
        this.log.error(`[Watcher] Error handling file add:`, error.message);
      }
    });

    // Watch for file changes
    this.watcher.on('change', async (filePath) => {
      // Check if we should ignore this change (file was just downloaded)
      if (this.ignoreNextChange.has(filePath)) {
        this.log.info(`[Watcher] Ignoring programmatic change: ${filePath}`);
        this.ignoreNextChange.delete(filePath);
        return;
      }

      this.log.info(`[Watcher] File changed: ${filePath}`);
      try {
        await this.fileSync.uploadFile(filePath);
      } catch (error) {
        this.log.error(`[Watcher] Error handling file change:`, error.message);
      }
    });

    // Watch for file deletions
    this.watcher.on('unlink', async (filePath) => {
      this.log.info(`[Watcher] File deleted: ${filePath}`);
      try {
        await this.fileSync.deleteRemoteFile(filePath);
      } catch (error) {
        this.log.error(`[Watcher] Error handling file deletion:`, error.message);
      }
    });

    // Watch for errors
    this.watcher.on('error', (error) => {
      this.log.error(`[Watcher] Watcher error:`, error);
    });

    this.log.info('[Watcher] Folder watcher started successfully');
  }

  /**
   * Stop watching the folder
   */
  async stop() {
    if (this.watcher) {
      this.log.info('[Watcher] Stopping folder watcher...');
      await this.watcher.close();
      this.watcher = null;
      this.log.info('[Watcher] Folder watcher stopped');
    }
  }

  /**
   * Check if file is a markdown file
   */
  isMarkdownFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  /**
   * Mark a file to be ignored on next change event
   */
  ignoreFile(filePath) {
    this.ignoreNextChange.add(filePath);
    // Auto-cleanup after 2 seconds in case the change event never fires
    setTimeout(() => {
      this.ignoreNextChange.delete(filePath);
    }, 2000);
  }
}

module.exports = FolderWatcher;
