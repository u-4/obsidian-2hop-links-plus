import { TwohopPluginSettings } from "./TwohopSettingTab";
import TwohopLinksPlugin from "../main";
import { isSortOrder } from "./sortOptions";

export const DEFAULT_SETTINGS: TwohopPluginSettings = {
  autoLoadTwoHopLinks: true,
  showForwardConnectedLinks: true,
  showBackwardConnectedLinks: true,
  showTwohopLinks: true,
  showNewLinks: true,
  showTagsLinks: true,
  showPropertiesLinks: true,
  showImage: true,
  excludePaths: [],
  initialBoxCount: 10,
  initialSectionCount: 20,
  enableDuplicateRemoval: true,
  sortOrder: "random",
  showTwoHopLinksInSeparatePane: false,
  excludeTags: [],
  panePositionIsRight: false,
  createFilesForMultiLinked: false,
  showFullPathInLinkCards: false,
  includeBodyInCardSearch: true,
  refreshDebounceMs: 200,
  frontmatterPropertyKeyAsTitle: "",
  frontmatterKeys: [],
};

export async function loadSettings(
  plugin: TwohopLinksPlugin
): Promise<TwohopPluginSettings> {
  const data = await plugin.loadData();
  const settings = Object.assign({}, DEFAULT_SETTINGS, data);
  if (!isSortOrder(data?.sortOrder)) {
    settings.sortOrder = DEFAULT_SETTINGS.sortOrder;
  }
  if (
    !Number.isFinite(settings.refreshDebounceMs) ||
    settings.refreshDebounceMs < 0
  ) {
    settings.refreshDebounceMs = DEFAULT_SETTINGS.refreshDebounceMs;
  } else {
    settings.refreshDebounceMs = Math.min(2000, settings.refreshDebounceMs);
  }
  return settings;
}

export async function saveSettings(plugin: TwohopLinksPlugin): Promise<void> {
  return plugin.saveData(plugin.settings);
}
