import { FileSystemAdapter, ListedFiles, normalizePath, Notice, Plugin, TAbstractFile, TextFileView, TFile, TFolder } from "obsidian";
import { AttachmentManagementPluginSettings, AttachmentPathSettings, DEFAULT_SETTINGS, SETTINGS_TYPE_FILE, SETTINGS_TYPE_FOLDER, SettingTab } from "./settings";
import * as path from "path";
import {
  ATTACHMENT_RENAME_TYPE,
  attachRenameType,
  debugLog,
  getOverrideSetting,
  isAttachment,
  isCanvasFile,
  isImage,
  isMarkdownFile,
  isPastedImage,
  stripPaths,
  testExcludeExtension,
  updateOverrideSetting,
} from "./utils";
import {
  RENAME_EVENT_TYPE_FILE,
  RENAME_EVENT_TYPE_FOLDER,
  RenameEventType,
  SETTINGS_ROOT_INFOLDER,
  SETTINGS_ROOT_NEXTTONOTE,
  SETTINGS_VARIABLES_DATES,
  SETTINGS_VARIABLES_NOTENAME,
  SETTINGS_VARIABLES_NOTEPATH,
} from "./constant";
import { OverrideModal } from "./override";

export default class AttachmentManagementPlugin extends Plugin {
  settings: AttachmentManagementPluginSettings;
  adapter: FileSystemAdapter;
  originalObsAttachPath: string;

  async onload() {
    await this.loadSettings();

    console.log(`Plugin loading: ${this.manifest.name} v.${this.manifest.version}`);
    this.adapter = this.app.vault.adapter as FileSystemAdapter;
    // this.backupConfigs();

    // this.addCommand({
    //   id: "attachment-management-rearrange-links",
    //   name: "Rearrange Linked Attachments",
    //   callback: () => this.rearrangeAttachment("links"),
    // });

    // this.addCommand({
    //   id: "obsidian-attachment-rearrange-all",
    //   name: "Rearrange All Attachments",
    //   callback: () => this.rearrangeAttachment("all"),
    // });

    this.addCommand({
      id: "attachment-management-override-setting",
      name: "Override Setting",
      checkCallback: (checking:boolean) => {
        const file = this.getActiveFile();
        if (file) {
          if (!checking) {
            const {setting} = getOverrideSetting(this.settings, file);
            const fileSetting = Object.assign({}, setting);
            this.overrideConfiguration(file, fileSetting);
          }
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "attachment-management-reset-override-setting",
      name: "Reset Override Setting",
      checkCallback: (checking: boolean) => {
        const file = this.getActiveFile();
        if (file) {
          if (!checking) {
            delete this.settings.overridePath[file.path];
            this.saveSettings();
            new Notice(`Reset attachment setting of ${file.path}`);
          }
          return true;
        }
        return false;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        menu.addItem((item) => {
          item
            .setTitle("Override attachment setting")
            .setIcon("image-plus")
            .onClick(async () => {
              const { setting } = getOverrideSetting(this.settings, file);
              const fileSetting = Object.assign({}, setting);
              await this.overrideConfiguration(file, fileSetting);
            });
        });
      })
    );

    this.registerEvent(
      // not working while drop file to text view
      this.app.vault.on("create", (file: TAbstractFile) => {
        debugLog("On Create Event - File:", file.path);
        // only processing create of file, ignore folder creation
        if (!(file instanceof TFile)) {
          return;
        }
        // https://github.com/reorx/obsidian-paste-image-rename/blob/master/src/main.ts#LL81C23-L81C23
        // if the file is created more than 1 second ago, the event is most likely be fired on vault initialization when starting Obsidian app, ignore it
        const timeGapMs = new Date().getTime() - file.stat.ctime;
        if (timeGapMs > 1000) {
          return;
        }
        // ignore markdown and canvas file.
        if (isMarkdownFile(file.extension) || isCanvasFile(file.extension)) {
          return;
        }
        if (isImage(file.extension) || isPastedImage(file)) {
          this.processAttach(file);
        } else {
          if (this.settings.handleAll) {
            debugLog("handleAll for file", file);
            if (testExcludeExtension(file.extension, this.settings.excludeExtensionPattern)) {
              debugLog("Excluded File by Extension", file);
              return;
            }
            this.processAttach(file);
          }
        }
      })
    );

    this.registerEvent(
      // while trigger rename event on rename a folder, for each file/folder in this renamed folder (include itself) will trigger this event
      this.app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
        debugLog("On Rename Event - New Path and Old Path:", file.path, oldPath);
        // using oldPath here
        const { setting } = getOverrideSetting(this.settings, file, oldPath);
        // TODO: update overriding setting path
        if (setting.type === SETTINGS_TYPE_FOLDER || setting.type === SETTINGS_TYPE_FILE) {
          updateOverrideSetting(this.settings, file, oldPath);
          await this.saveSettings();
          await this.loadSettings();
        }

        if (!this.settings.autoRenameAttachment) {
          debugLog("No enable auto rename", this.settings.autoRenameAttachment);
          return;
        }

        const type = attachRenameType(setting);
        if (type === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_NULL) {
          debugLog("No variable use, skipped");
          return;
        }

        if (file instanceof TFile) {
          // if the renamed file was a attachment, skip
          const flag = await isAttachment(this.settings, oldPath);
          if (flag) {
            debugLog("Not Processing Rename on An Attachment, Skipped:", file.path);
            return;
          }

          let eventType: RenameEventType;
          if (path.posix.basename(oldPath, path.posix.extname(oldPath)) === path.posix.basename(file.path, path.posix.extname(file.path))) {
            // rename event of folder
            eventType = RENAME_EVENT_TYPE_FOLDER;
            debugLog("RenameEventType:", RENAME_EVENT_TYPE_FOLDER);
          } else {
            // rename event of file
            eventType = RENAME_EVENT_TYPE_FILE;
            debugLog("RenameEventType:", RENAME_EVENT_TYPE_FILE);
          }

          await this.onRename(file, oldPath, eventType, type, setting);
        } else if (file instanceof TFolder) {
          // ignore rename event of folder
          debugLog("Ignore Rename Folder Event:", file.name, oldPath);
          return;
        }
      })
    );

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new SettingTab(this.app, this));
  }

  async overrideConfiguration(file: TAbstractFile, setting: AttachmentPathSettings) {
    new OverrideModal(this, file, setting).open();
    await this.loadSettings();
  }

  // async rearrangeAttachment(type: "all" | "links") {
  //   debugLog("On Rearrange Command");

  //   if (!this.settings.autoRenameAttachment) {
  //     debugLog("No Variable Use, Skip");
  //     return;
  //   }

  //   // only rearrange attachment that linked by markdown or canvas
  //   const attachments = await getAttachmentsInVault(this.settings, this.app, type);
  //   debugLog("Attachments:", Object.keys(attachments).length, Object.entries(attachments));
  //   for (const obsFile of Object.keys(attachments)) {
  //     const innerFile = this.app.vault.getAbstractFileByPath(obsFile);
  //     if (innerFile === null) {
  //       debugLog(`${obsFile} not exists, skipped`);
  //       continue;
  //     }
  //     const { setting } = getOverrideSetting(this.settings, innerFile);

  //     const type = attachRenameType(setting);
  //     if (type === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_NULL) {
  //       debugLog("No variable use, skipped");
  //       return;
  //     }

  //     for (let link of attachments[obsFile]) {
  //       try {
  //         link = decodeURI(link);
  //       } catch (err) {
  //         // new Notice(`Invalid link: ${link}, err: ${err}`);
  //         console.log(`Invalid link: ${link}, err: ${err}`);
  //         continue;
  //       }
  //       debugLog(`Article: ${obsFile} Links: ${link}`);
  //       const noteExt = path.posix.extname(obsFile);
  //       const noteName = path.posix.basename(obsFile, noteExt);
  //       const notePath = path.posix.dirname(obsFile);

  //       const attachPath = this.getAttachmentPath(noteName, notePath, setting);
  //       const attachName = this.getPastedImageFileName(noteName, setting);
  //       const dest = path.posix.join(attachPath, attachName + path.posix.extname(link));

  //       // check if the link was already satisfy the attachment name config
  //       if (!needToRename(setting, attachPath, attachName, noteName, link)) {
  //         debugLog("No need to rename:", link);
  //         continue;
  //       }
  //       const linkFile = this.app.vault.getAbstractFileByPath(link);
  //       if (linkFile === null) {
  //         debugLog(`${link} not exists, skipped`);
  //         continue;
  //       }

  //       if (!(await this.adapter.exists(attachPath))) {
  //         this.adapter.mkdir(attachPath);
  //       }

  //       // TODO: check if the file already exists
  //       if (await this.adapter.exists(dest)) {
  //         new Notice(`${dest} already exists, skipped`);
  //         console.log(`${dest} already exists, skipped`);
  //         continue;
  //       }

  //       await this.app.fileManager.renameFile(linkFile, dest);
  //     }
  //   }
  // }

  async onRename(
    file: TAbstractFile,
    oldPath: string,
    eventType: RenameEventType,
    attachRenameType: ATTACHMENT_RENAME_TYPE = ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_NULL,
    setting: AttachmentPathSettings
  ) {
    const rf = file as TFile;

    // generate old note path and name
    const oldNotePath = path.posix.dirname(oldPath);
    const oldNoteExtension = path.posix.extname(oldPath);
    const oldNoteName = path.posix.basename(oldPath, oldNoteExtension);

    debugLog("Old Note Path:", oldNotePath);
    debugLog("Old Note Name:", oldNoteName);

    // generate old attachment path
    const oldAttachPath = this.getAttachmentPath(oldNoteName, oldNotePath, setting);
    const newAttachPath = this.getAttachmentPath(rf.basename, rf.parent?.path as string, setting);

    debugLog("Old Attachment Path:", oldAttachPath);
    debugLog("New Attachment Path:", newAttachPath);

    // if the old attachment folder does not exist, skip
    const exitsAttachPath = await this.adapter.exists(oldAttachPath);
    if (!exitsAttachPath) {
      debugLog("Attachment path does not exist:", oldAttachPath);
      return;
    }

    if (attachRenameType === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_FOLDER || attachRenameType === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_BOTH) {
      // rename attachment folder first
      const strip = stripPaths(oldAttachPath, newAttachPath);
      // if (strip === undefined) {
      //   new Notice(`Error rename path ${oldAttachPath} to ${newAttachPath}`);
      //   console.log(`Error rename path ${oldAttachPath} to ${newAttachPath}`);
      //   return;
      // }

      const stripedOldAttachPath = strip.nsrc;
      const stripedNewAttachPath = strip.ndst;

      debugLog("Striped Source:", stripedOldAttachPath);
      debugLog("Striped Destination:", stripedNewAttachPath);

      if (stripedOldAttachPath === stripedNewAttachPath) {
        debugLog("Same Striped Path");
        return;
      }

      const exitsDst = await this.adapter.exists(stripedNewAttachPath);
      if (exitsDst) {
        // if the file exists in the vault
        if (eventType === RENAME_EVENT_TYPE_FILE) {
          new Notice(`Same file name exists: ${stripedNewAttachPath}`);
          return;
        } else if (eventType === RENAME_EVENT_TYPE_FOLDER) {
          // for most case, this should not be happen, just notice it.
          new Notice(`Folder already exists: ${stripedNewAttachPath}`);
          return;
        }
      } else {
        const cfile = this.app.vault.getAbstractFileByPath(stripedOldAttachPath);
        if (cfile === null) {
          return;
        }
        await this.app.fileManager.renameFile(cfile, stripedNewAttachPath);
      }
    }

    // rename attachment filename as needed
    if (
      (attachRenameType === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_FILE || attachRenameType === ATTACHMENT_RENAME_TYPE.ATTACHMENT_RENAME_TYPE_BOTH) &&
      eventType === RENAME_EVENT_TYPE_FILE
    ) {
      // suppose the attachment folder already renamed
      // rename all attachment files that the filename content the ${notename} in attachment path
      const attachmentFiles: ListedFiles = await this.adapter.list(newAttachPath);
      for (const filePath of attachmentFiles.files) {
        debugLog("Listing File:", filePath);
        let fileName = path.posix.basename(filePath);
        const fileExtension = fileName.substring(fileName.lastIndexOf(".") + 1);
        if ((this.settings.handleAll && testExcludeExtension(fileExtension, this.settings.excludeExtensionPattern)) || !isImage(fileExtension)) {
          debugLog("No Handle Extension:", fileExtension);
          continue;
        }
        fileName = fileName.replace(oldNoteName, rf.basename);

        const newFilePath = normalizePath(path.posix.join(newAttachPath, fileName));
        debugLog("New File Path:", newFilePath);
        const tfile = this.app.vault.getAbstractFileByPath(filePath);
        if (tfile === null) continue;
        await this.app.fileManager.renameFile(tfile, newFilePath);
      }
    }
  }

  /**
   * Post-processing of created attachment file (for paste and drop event).
   * @param file - the file to process
   * @returns - none
   */
  async processAttach(file: TFile) {
    const activeFile = this.getActiveFile();
    if (activeFile === undefined) {
      new Notice("Error: no active file found.");
      return;
    }
    const { setting } = getOverrideSetting(this.settings, activeFile);
    const ext = activeFile.extension;

    debugLog("Active File Path", activeFile.path);

    // TODO: what if activeFile.parent was undefined
    const attachPath = this.getAttachmentPath(activeFile.basename, activeFile.parent?.path as string, setting);
    const attachName = this.getPastedImageFileName(activeFile.basename, setting) + "." + file.extension;

    debugLog("New Path of File:", path.posix.join(attachPath, attachName));

    this.renameFile(file, attachPath, attachName, activeFile.path, ext, true);
  }

  /**
   * Rename the file specified by `@param file`, and update the link of the file if specified updateLink
   * @param file - file to rename
   * @param attachPath - where to the renamed file will be move to
   * @param attachName - name of the renamed file
   * @param sourcePath - path of the associated active file
   * @param extension - extension of associated active file
   * @param updateLink - whether to replace the link of renamed file
   * @returns - none
   */
  async renameFile(file: TFile, attachPath: string, attachName: string, sourcePath: string, extension: string, updateLink?: boolean) {
    // Make sure the path was created
    if (!(await this.adapter.exists(attachPath))) {
      await this.adapter.mkdir(attachPath);
    }

    debugLog("Source Path of Rename:", file.path);

    const dest = normalizePath(path.posix.join(attachPath, attachName));

    debugLog("Destination Path of Rename:", dest);

    const oldLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath);
    const oldPath = file.path;
    const oldName = file.name;

    try {
      // this api will not update the link automatically on `create` event
      await this.app.fileManager.renameFile(file, dest);
      new Notice(`Renamed ${oldName} to ${attachName}`);
    } catch (err) {
      new Notice(`Failed to rename ${file.path} to ${dest}`);
      throw err;
    }

    if (!updateLink) {
      return;
    }

    // in case fileManager.renameFile may not update the internal link in the active file,
    // we manually replace the current line by manipulating the editor
    const newLinkText = this.app.fileManager.generateMarkdownLink(file, sourcePath);
    debugLog("replace text", oldLinkText, newLinkText);

    const view = this.getActiveView();
    if (view === null) {
      new Notice(`Failed to update link in ${sourcePath}: no active view`);
      return;
    }
    const content = view.getViewData();
    let val = "";
    switch (extension) {
      case "md":
        val = content.replace(oldLinkText, newLinkText);
        break;
      case "canvas":
        val = content.replace(`/(file\s*\:\s*\")${oldPath}(\")/g`, `$1${dest}$2`);
        break;
    }

    view.setViewData(val, false);
    new Notice(`Updated 1 link in ${sourcePath}`);
  }

  /**
   * Return the active text file, `md` or `canvas`
   * @returns - the active file or undefined if no active file
   */
  getActiveFile(): TFile | undefined {
    const view = this.getActiveView();
    return view?.file;
  }

  /**
   * Return the active view of text file
   * @returns - the active view of text file
   */
  getActiveView(): TextFileView | null {
    return this.app.workspace.getActiveViewOfType(TextFileView);
  }

  /**
   * Generate the attachment path with specified variables
   * @param noteName - basename (without extension) of note
   * @param notePath - path of note
   * @param setting
   * @returns attachment path
   */
  getAttachmentPath(noteName: string, notePath: string, setting: AttachmentPathSettings = this.settings.attachPath): string {
    const root = this.getRootPath(notePath, setting);
    const attachPath = path.join(
      root,
      setting.attachmentPath.replace(`${SETTINGS_VARIABLES_NOTEPATH}`, notePath).replace(`${SETTINGS_VARIABLES_NOTENAME}`, noteName)
    );
    return normalizePath(attachPath);
  }

  /**
   * Get root path to save attachment file
   * @param notePath - path of note
   * @param setting
   * @returns root path to save attachment file
   */
  getRootPath(notePath: string, setting: AttachmentPathSettings = this.settings.attachPath): string {
    let root: string;

    //@ts-ignore
    const obsmediadir = app.vault.getConfig("attachmentFolderPath");
    // debugLog("obsmediadir", obsmediadir);
    switch (setting.saveAttE) {
      case `${SETTINGS_ROOT_INFOLDER}`:
        root = path.posix.join(setting.attachmentRoot);
        break;
      case `${SETTINGS_ROOT_NEXTTONOTE}`:
        root = path.posix.join(notePath, setting.attachmentRoot.replace("./", ""));
        break;
      default:
        if (obsmediadir === "/") {
          // in vault root folder case
          root = obsmediadir;
        } else if (obsmediadir === "./") {
          // in current folder case
          root = path.posix.join(notePath);
        } else if (obsmediadir.match(/\.\/.+/g) !== null) {
          // in subfolder case
          root = path.posix.join(notePath, obsmediadir.replace("./", ""));
        } else {
          // in specified folder case
          root = obsmediadir;
        }
    }

    return root === "/" ? root : normalizePath(root);
  }

  /**
   * Generate the image file name with specified variable
   * @param noteName - basename (without extension) of note
   * @param setting
   * @returns image file name
   */
  getPastedImageFileName(noteName: string, setting: AttachmentPathSettings = this.settings.attachPath): string {
    const dateTime = window.moment().format(this.settings.dateFormat);
    return setting.attachFormat.replace(`${SETTINGS_VARIABLES_DATES}`, dateTime).replace(`${SETTINGS_VARIABLES_NOTENAME}`, noteName);
  }

  backupConfigs() {
    //@ts-ignore
    this.originalObsAttachPath = this.app.vault.getConfig("attachmentFolderPath");
  }

  restoreConfigs() {
    //@ts-ignore
    this.app.vault.setConfig("attachmentFolderPath", this.originalObsAttachPath);
  }
  updateAttachmentFolderConfig(path: string) {
    //@ts-ignore
    this.app.vault.setConfig("attachmentFolderPath", path);
  }

  onunload() {
    // this.restoreConfigs();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
