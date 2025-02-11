import { App, MomentFormatComponent, Notice, PluginSettingTab, Setting, TextAreaComponent } from "obsidian";
import AttachmentManagementPlugin from "../main";
import {
    SETTINGS_ROOT_OBSFOLDER,
    SETTINGS_VARIABLES_NOTEPATH,
    SETTINGS_VARIABLES_NOTENAME,
    SETTINGS_VARIABLES_NOTEPARENT,
    SETTINGS_VARIABLES_DATES,
    SETTINGS_ROOT_INFOLDER,
    SETTINGS_ROOT_NEXTTONOTE,
    SETTINGS_VARIABLES_ORIGINALNAME,
} from "../lib/constant";
import { debugLog } from "src/log";
import { OverrideExtensionModal } from "src/model/extensionOverride";
import { validateExtensionEntry, generateErrorExtensionMessage } from "src/utils";

export enum SETTINGS_TYPES {
    GLOBAL = "GLOBAL",
    FOLDER = "FOLDER",
    FILE = "FILE",
}

export interface AttachmentPathSettings {
    // Attachment root path
    attachmentRoot: string;
    // How to save attachment, in fixed folder, current folder or subfolder in current folder
    saveAttE: string;
    // Attachment path
    attachmentPath: string;
    // How to renamed the attachment file
    attachFormat: string;
    // Override type
    type: SETTINGS_TYPES;
    //extension override
    extensionOverride?: ExtensionOverrideSettings[];
}

export interface ExtensionOverrideSettings {
    // Extension
    extension: string;
    // Attachment root path
    attachmentRoot: string;
    // How to save attachment, in fixed folder, current folder or subfolder in current folder
    saveAttE: string;
    // Attachment path
    attachmentPath: string;
    // How to renamed the attachment file
    attachFormat: string;
}

export interface AttachmentManagementPluginSettings {
    // Path
    attachPath: AttachmentPathSettings;
    // Date format
    dateFormat: string;
    // Exclude extension not to rename
    excludeExtensionPattern: string;
    // Auto-rename attachment folder or filename and update the link
    autoRenameAttachment: boolean;
    // Exclude path not to rename
    excludedPaths: string;
    // Exclude path array
    excludePathsArray: string[];
    // Exclude subpath also
    excludeSubpaths: boolean;
    // Path of notes that override global configuration
    overridePath: Record<string, AttachmentPathSettings>;
}

export const DEFAULT_SETTINGS: AttachmentManagementPluginSettings = {
    attachPath: {
        attachmentRoot: "",
        saveAttE: `${SETTINGS_ROOT_INFOLDER}`,
        attachmentPath: 'themes/pure/source/images',
        attachFormat: '../../images/${notename}_${date}',
        type: SETTINGS_TYPES.GLOBAL,
    },
    dateFormat: "ssSSS",
    excludeExtensionPattern: "",
    autoRenameAttachment: true,
    excludedPaths: "",
    excludePathsArray: [],
    excludeSubpaths: false,
    overridePath: {},
};

export class SettingTab extends PluginSettingTab {
    plugin: AttachmentManagementPlugin;

    constructor(app: App, plugin: AttachmentManagementPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    displaySw(cont: HTMLElement): void {
        cont.findAll(".setting-item").forEach((el: HTMLElement) => {
            if (el.getAttr("class")?.includes("root_folder_set")) {
                if (this.plugin.settings.attachPath.saveAttE === "obsFolder") {
                    el.hide();
                } else {
                    el.show();
                }
            }
        });
    }

    splitPath(path: string): { splittedPaths: string[] } {
        const splitted = path.split(";");
        const rets = [];
        for (const s of splitted) {
            rets.push(s.trim());
        }
        return { splittedPaths: rets };
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName("Root path to save new attachments")
            .setDesc("Select root path for all new attachments")
            .addDropdown((text) =>
                text
                    .addOption(`${SETTINGS_ROOT_OBSFOLDER}`, "Copy Obsidian settings")
                    .addOption(`${SETTINGS_ROOT_INFOLDER}`, "In the folder specified below")
                    .addOption(`${SETTINGS_ROOT_NEXTTONOTE}`, "Next to note in folder specified below")
                    .setValue(this.plugin.settings.attachPath.saveAttE)
                    .onChange(async (value) => {
                        this.plugin.settings.attachPath.saveAttE = value;
                        this.displaySw(containerEl);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Root folder")
            .setDesc("Root folder of new attachment")
            .setClass("root_folder_set")
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentRoot)
                    .setValue(this.plugin.settings.attachPath.attachmentRoot)
                    .onChange(async (value) => {
                        debugLog("setting - attachment root:" + value);
                        this.plugin.settings.attachPath.attachmentRoot = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Attachment path")
            .setDesc(
                `Path of new attachment in root folder, available variables ${SETTINGS_VARIABLES_NOTEPATH}, ${SETTINGS_VARIABLES_NOTENAME}, ${SETTINGS_VARIABLES_NOTEPARENT}`
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachmentPath)
                    .setValue(this.plugin.settings.attachPath.attachmentPath)
                    .onChange(async (value) => {
                        debugLog("setting - attachment path:" + value);
                        this.plugin.settings.attachPath.attachmentPath = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Attachment format")
            .setDesc(
                `Define how to name the attachment file, available variables ${SETTINGS_VARIABLES_DATES}, ${SETTINGS_VARIABLES_NOTENAME} and ${SETTINGS_VARIABLES_ORIGINALNAME}.`
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SETTINGS.attachPath.attachFormat)
                    .setValue(this.plugin.settings.attachPath.attachFormat)
                    .onChange(async (value: string) => {
                        debugLog("setting - attachment format:" + value);
                        this.plugin.settings.attachPath.attachFormat = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Date format")
            .setDesc(
                createFragment((frag) => {
                    frag.appendText("Moment date format to use ");
                    frag.createEl("a", {
                        href: "https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format",
                        text: "Moment format options",
                    });
                })
            )
            .addMomentFormat((component: MomentFormatComponent) => {
                component
                    .setPlaceholder(DEFAULT_SETTINGS.dateFormat)
                    .setValue(this.plugin.settings.dateFormat)
                    .onChange(async (value) => {
                        debugLog("setting - date format:" + value);
                        this.plugin.settings.dateFormat = value;
                        await this.plugin.saveSettings();
                    });
            });

        // new Setting(containerEl)
        //   .setName("Handle all attachments")
        //   .setDesc(
        //     "By default, only auto-rename the image file, if enable this option, all created file (except 'md' or 'canvas') will be renamed automatically"
        //   )
        //   .addToggle((toggle) =>
        //     toggle.setValue(this.plugin.settings.handleAll).onChange(async (value) => {
        //       debugLog("setting - handle all attachment:" + value);
        //       this.plugin.settings.handleAll = value;
        //       this.displaySw(containerEl);
        //       await this.plugin.saveSettings();
        //     })
        //   );
        new Setting(containerEl)
            .setName("Automatically rename attachment")
            .setDesc(
                "Automatically rename the attachment folder/filename when you rename the folder/filename where the corresponding md/canvas file be placed."
            )
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.autoRenameAttachment).onChange(async (value) => {
                    debugLog("setting - automatically rename attachment folder:" + value);
                    this.plugin.settings.autoRenameAttachment = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).addButton((btn) => {
            btn.setButtonText("Add extension overrides").onClick(async () => {
                if (this.plugin.settings.attachPath.extensionOverride === undefined) {
                    this.plugin.settings.attachPath.extensionOverride = [];
                }
                this.plugin.settings.attachPath.extensionOverride.push({
                    extension: "",
                    attachmentRoot: this.plugin.settings.attachPath.attachmentRoot,
                    saveAttE: this.plugin.settings.attachPath.saveAttE,
                    attachmentPath: this.plugin.settings.attachPath.attachmentPath,
                    attachFormat: this.plugin.settings.attachPath.attachFormat,
                });
                await this.plugin.saveSettings();
                this.display();
            });
        });

        if (this.plugin.settings.attachPath.extensionOverride !== undefined) {
            this.plugin.settings.attachPath.extensionOverride.forEach((ext) => {
                new Setting(containerEl)
                    .setName("Extension")
                    .setDesc("Extension to override")
                    .setClass("override_extension_set")
                    .addText((text) =>
                        text
                            .setPlaceholder("pdf")
                            .setValue(ext.extension)
                            .onChange(async (value) => {
                                ext.extension = value;
                            })
                    )
                    .addButton((btn) => {
                        btn.setIcon("trash")
                            .setTooltip("Remove extension override")
                            .onClick(async () => {
                                //get index of extension
                                const index = this.plugin.settings.attachPath.extensionOverride?.indexOf(ext) ?? -1;
                                //remove extension from array
                                this.plugin.settings.attachPath.extensionOverride?.splice(index, 1);
                                await this.plugin.saveSettings();
                                this.display();
                            });
                    })
                    .addButton((btn) => {
                        btn.setIcon("pencil")
                            .setTooltip("Edit extension override")
                            .onClick(async () => {
                                new OverrideExtensionModal(this.plugin, ext, (result) => {
                                    ext = result;
                                }).open();
                            });
                    })
                    .addButton((btn) => {
                        btn.setIcon("check")
                            .setTooltip("Save extension override")
                            .onClick(async () => {
                                const wrongIndex = validateExtensionEntry(this.plugin.settings.attachPath, this.plugin.settings);
                                if (wrongIndex.length > 0) {
                                    for (const i of wrongIndex) {
                                        const resIndex = i.index < 0 ? 0 : i.index;
                                        const wrongSetting = containerEl.getElementsByClassName("override_extension_set")[resIndex];
                                        wrongSetting.getElementsByTagName("input")[0].style.border = "1px solid var(--color-red)";
                                        generateErrorExtensionMessage(i.type);
                                    }
                                    return;
                                }
                                await this.plugin.saveSettings();
                                this.display();
                                new Notice("Saved extension override");
                            });
                    });
            });
        }

        new Setting(containerEl)
            .setName("Exclude extension pattern")
            .setDesc(`Regex pattern to exclude certain extensions from being handled.`)
            .addText((text) =>
                text
                    .setPlaceholder("pdf|docx?|xlsx?|pptx?|zip|rar")
                    .setValue(this.plugin.settings.excludeExtensionPattern)
                    .onChange(async (value) => {
                        this.plugin.settings.excludeExtensionPattern = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Excluded paths")
            .setDesc(
                `Provide the full path of the folder names (case sensitive and without leading slash '/') divided by semicolon (;) to be excluded from renaming.`
            )
            .addTextArea((component: TextAreaComponent) => {
                component.setValue(this.plugin.settings.excludedPaths).onChange(async (value) => {
                    this.plugin.settings.excludedPaths = value;
                    const { splittedPaths } = this.splitPath(value);
                    this.plugin.settings.excludePathsArray = splittedPaths;
                    debugLog("setting - excluded paths:" + value, splittedPaths);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName("Exclude subpaths")
            .setDesc("Turn on this option if you want to also exclude all subfolders of the folder paths provided above.")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.excludeSubpaths).onChange(async (value) => {
                    debugLog("setting - excluded subpaths:" + value);
                    this.plugin.settings.excludeSubpaths = value;
                    await this.plugin.saveSettings();
                })
            );

        this.displaySw(containerEl);
    }
}
