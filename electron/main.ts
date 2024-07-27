import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from "electron";

import { AppsManager } from "./helpers/apps-manager";
import { ConfigFile } from "./helpers/config-file";
import { Dependencies } from "./helpers/dependencies";
import { MonitoringManager } from "./helpers/monitoring-manager";
import { PropertiesManager } from "./helpers/properties-manager";
import { getLogFilePath } from "./utils";
import { DomainPreferenceType, FilterType, IpcKeys } from "./utils/constants";
import { Logging } from "./utils/logging";
import { Wakatime } from "./watchers/wakatime";
import { Watcher } from "./watchers/watcher";

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, "../public");
process.env.ELECTRON_DIR = app.isPackaged
  ? __dirname
  : path.join(__dirname, "../electron");

const isMacOS = process.platform === "darwin";

let settingsWindow: BrowserWindow | null = null;
let monitoredAppsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let watcher: Watcher | null = null;
let wakatime: Wakatime | null = null;
let dependencies: Dependencies | null = null;

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

function getWindowIcon() {
  return nativeImage.createFromPath(
    path.join(process.env.VITE_PUBLIC, "app-icon.png"),
  );
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    title: "Settings",
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    resizable: false,
    width: 512,
    height: MonitoringManager.isBrowserMonitored() ? 768 : 320,
    show: false,
    autoHideMenuBar: true,
  });

  // Test active push message to Renderer-process.
  // settingsWindow.webContents.on("did-finish-load", () => {
  //   const appSettings = getAppSettings();
  //   settingsWindow?.webContents.send("app-settings", appSettings);
  // });

  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(VITE_DEV_SERVER_URL + "settings");
  } else {
    // win.loadFile('dist/index.html')
    settingsWindow.loadFile(path.join(process.env.DIST!, "index.html"));
  }

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
  });
}

function createMonitoredAppsWindow() {
  monitoredAppsWindow = new BrowserWindow({
    title: "Monitored Apps",
    icon: getWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
    skipTaskbar: true,
    minimizable: false,
    fullscreenable: false,
    width: 444,
    height: 620,
    minWidth: 320,
    minHeight: 320,
    autoHideMenuBar: true,
  });

  // Test active push message to Renderer-process.
  // monitoredAppsWindow.webContents.on("did-finish-load", async () => {
  //   const apps = await getAvailableApps();
  //   const appSettings = getAppSettings();
  // });

  if (VITE_DEV_SERVER_URL) {
    monitoredAppsWindow.loadURL(VITE_DEV_SERVER_URL + "monitored-apps");
  } else {
    // win.loadFile('dist/index.html')
    monitoredAppsWindow.loadFile(path.join(process.env.DIST!, "index.html"));
  }

  monitoredAppsWindow.on("closed", () => {
    monitoredAppsWindow = null;
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(
    path.join(process.env.VITE_PUBLIC!, "trayIconTemplate.png"),
  );
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Dashboard",
      type: "normal",
      click: () => {
        shell.openExternal("https://wakatime.com/dashboard");
      },
    },
    {
      label: "Settings",
      type: "normal",
      click: () => {
        if (settingsWindow) {
          settingsWindow.focus();
        } else {
          createSettingsWindow();
        }
      },
    },
    {
      label: "Monitored Apps",
      type: "normal",
      click: () => {
        if (monitoredAppsWindow) {
          monitoredAppsWindow.focus();
        } else {
          createMonitoredAppsWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Check for Updates",
      type: "normal",
      click: () => {
        const notification = new Notification({
          title: "Not implemented yet!",
        });
        notification.show();
      },
    },
    { type: "separator" },
    {
      label: isMacOS ? "Quit" : "Exit",
      type: "normal",
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Wakatime");
  tray.setContextMenu(contextMenu);
  tray.addListener("click", () => {
    tray?.popUpContextMenu();
  });
}

// Hide app from macOS doc
if (isMacOS) {
  app.dock.hide();
}

app.on("window-all-closed", () => {});

app.on("activate", () => {});

app.whenReady().then(async () => {
  // TODO: Check if properties if we should activate logging to file or not
  if (PropertiesManager.shouldLogToFile) {
    Logging.instance().activateLoggingToFile();
  }

  Logging.instance().log("Starting Wakatime");

  dependencies = new Dependencies();
  wakatime = new Wakatime();
  watcher = new Watcher(wakatime);

  // TODO: Move them to a background task
  await dependencies.installDependencies();
  await AppsManager.load();

  createTray();

  watcher.start();
});

app.on("quit", () => {
  Logging.instance().log("WakaTime will terminate");
  watcher?.stop();
});

ipcMain.on(
  IpcKeys.getSetting,
  (event, section: string, key: string, internal: boolean = false) => {
    event.returnValue = ConfigFile.getSetting(section, key, internal);
  },
);

ipcMain.on(
  IpcKeys.setSetting,
  (
    _,
    section: string,
    key: string,
    value: string,
    internal: boolean = false,
  ) => {
    ConfigFile.setSetting(section, key, value, internal);
  },
);

ipcMain.on(IpcKeys.getApps, (event) => {
  event.returnValue = AppsManager.getApps();
});

ipcMain.on(IpcKeys.getAppVersion, (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on(IpcKeys.isMonitored, (event, path) => {
  event.returnValue = MonitoringManager.isMonitored(path);
});

ipcMain.on(IpcKeys.setMonitored, (_, path: string, monitor: boolean) => {
  MonitoringManager.set(path, monitor);
});

ipcMain.on(IpcKeys.shouldLogToFile, (event) => {
  event.returnValue = PropertiesManager.shouldLogToFile;
});
ipcMain.on(IpcKeys.setShouldLogToFile, (_, value) => {
  PropertiesManager.shouldLogToFile = value;
});

ipcMain.on(IpcKeys.shouldLaunchOnLogin, (event) => {
  event.returnValue = PropertiesManager.shouldLaunchOnLogin;
});
ipcMain.on(IpcKeys.setShouldLaunchOnLogin, (_, value) => {
  PropertiesManager.shouldLaunchOnLogin = value;
});

ipcMain.on(IpcKeys.logFilePath, (event) => {
  event.returnValue = getLogFilePath();
});

ipcMain.on(IpcKeys.isBrowserMonitored, (event) => {
  event.returnValue = MonitoringManager.isBrowserMonitored();
});

ipcMain.on(IpcKeys.getDomainPreference, (event) => {
  event.returnValue = PropertiesManager.domainPreference;
});
ipcMain.on(IpcKeys.setDomainPreference, (_, value: DomainPreferenceType) => {
  PropertiesManager.domainPreference = value;
});

ipcMain.on(IpcKeys.getFilterType, (event) => {
  event.returnValue = PropertiesManager.filterType;
});
ipcMain.on(IpcKeys.setFilterType, (_, value: FilterType) => {
  PropertiesManager.filterType = value;
});

ipcMain.on(IpcKeys.getDenylist, (event) => {
  event.returnValue = PropertiesManager.denylist;
});
ipcMain.on(IpcKeys.setDenylist, (_, value: string) => {
  PropertiesManager.denylist = value;
});

ipcMain.on(IpcKeys.getAllowlist, (event) => {
  event.returnValue = PropertiesManager.allowlist;
});
ipcMain.on(IpcKeys.setAllowlist, (_, value: string) => {
  PropertiesManager.allowlist = value;
});
