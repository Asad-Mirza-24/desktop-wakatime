import { ipcRenderer, contextBridge } from "electron";
import {
  GET_SETTINGS_IPC_KEY,
  GET_APP_VERSION_IPC_KEY,
  GET_INSTALLED_APPS_IPC_KEY,
  SET_SETTINGS_IPC_KEY,
} from "./keys";

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args;
    return ipcRenderer.on(channel, (event, ...args) =>
      listener(event, ...args),
    );
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args;
    return ipcRenderer.off(channel, ...omit);
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },
  settings: {
    get() {
      return ipcRenderer.sendSync(GET_SETTINGS_IPC_KEY);
    },
    set(settings: string) {
      ipcRenderer.send(SET_SETTINGS_IPC_KEY, settings);
    },
  },
  getInstalledApps() {
    return ipcRenderer.sendSync(GET_INSTALLED_APPS_IPC_KEY);
  },
  getAppVersion() {
    return ipcRenderer.sendSync(GET_APP_VERSION_IPC_KEY);
  },
});
