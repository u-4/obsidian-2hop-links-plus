import { TwohopPluginSettings } from "./TwohopSettingTab";
import TwohopLinksPlugin from "../main";
import { DEFAULT_SORT_ORDER, migrateSortOrder } from "./sortOptions";

export const DEFAULT_SETTINGS: TwohopPluginSettings = {
  autoLoadTwoHopLinks: true,
  showForwardConnectedLinks: true,
  showBackwardConnectedLinks: true,
  showTwohopLinks: true,
  showNewLinks: true,
  showTagsLinks: true,
  showImage: true,
  excludePaths: [],
  initialBoxCount: 10,
  initialSectionCount: 20,
  enableDuplicateRemoval: true,
  sortOrder: DEFAULT_SORT_ORDER,
  showTwoHopLinksInSeparatePane: false,
  excludeTags: [],
  panePositionIsRight: false,
  showFullPathInLinkCards: false,
  includeBodyInCardSearch: true,
  refreshDebounceMs: 200,
  frontmatterPropertyKeyAsTitle: "",
};

export async function loadSettings(
  plugin: TwohopLinksPlugin
): Promise<TwohopPluginSettings> {
  const data = await plugin.loadData();
  const settings: TwohopPluginSettings = Object.assign(
    {},
    DEFAULT_SETTINGS,
    data
  );
  for (const removedKey of REMOVED_SETTING_KEYS) {
    delete settings[removedKey];
  }
  settings.sortOrder = migrateSortOrder(data?.sortOrder);
  if (
    !Number.isFinite(settings.refreshDebounceMs) ||
    settings.refreshDebounceMs < 0
  ) {
    settings.refreshDebounceMs = DEFAULT_SETTINGS.refreshDebounceMs;
  } else {
    settings.refreshDebounceMs = Math.min(2000, settings.refreshDebounceMs);
  }
  if (data && needsMigration(data, settings)) {
    await plugin.saveData(settings);
  }
  return settings;
}

// Settings removed in 0.44.0 together with the Properties section, automatic
// file creation and the PageRank-style sort orders.
const REMOVED_SETTING_KEYS = [
  "showPropertiesLinks",
  "frontmatterKeys",
  "createFilesForMultiLinked",
];

function needsMigration(
  data: Record<string, unknown>,
  settings: TwohopPluginSettings
): boolean {
  return (
    data.sortOrder !== settings.sortOrder ||
    REMOVED_SETTING_KEYS.some((key) => key in data)
  );
}

export async function saveSettings(plugin: TwohopLinksPlugin): Promise<void> {
  return plugin.saveData(plugin.settings);
}
