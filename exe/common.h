// What 渲染站.exe (station.c) and its installer (setup.c) share: the names Windows knows the station
// by, having a running station quit, and removing a folder with all in it.
#define TRAY_CLASS L"RenderStation"
#define TRAY_MUTEX L"Local\\render-station-tray"
#define RUN_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Run"
#define RUN_NAME L"渲染站"
#define UNINSTALL_KEY L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\render-station"
#define LINK_NAME L"渲染站.lnk"
// the tray menu's 退出渲染站, as both stations number it
#define TRAY_QUIT 6

/** whether a station runs (one running as administrator lets this see it is
 *  there, but no more) */
static inline int stationRunning(void) {
  HANDLE m = OpenMutexW(SYNCHRONIZE, FALSE, TRAY_MUTEX);
  if (m) {
    CloseHandle(m);
    return 1;
  }
  return GetLastError() == ERROR_ACCESS_DENIED;
}
/** the running station asked to quit, as its tray menu would (it asks first if a job is running):
 *  1 once none runs, within 20 s */
static inline int stopStation(void) {
  HWND w = FindWindowW(TRAY_CLASS, NULL);
  if (w) PostMessageW(w, WM_COMMAND, TRAY_QUIT, 0);
  for (int t = 0; t < 200; t++) {
    if (!stationRunning()) {
      // what it ran, node and ssh, ends with it a moment later
      Sleep(1000);
      return 1;
    }
    Sleep(100);
  }
  return 0;
}
/** a folder and all in it, gone */
static inline int removeTree(const wchar_t *path) {
  // the list of one the shell takes: ended by two NULs
  wchar_t from[MAX_PATH + 2] = { 0 };
  lstrcpynW(from, path, MAX_PATH);
  SHFILEOPSTRUCTW op = { 0 };
  op.wFunc = FO_DELETE;
  op.pFrom = from;
  op.fFlags = FOF_NO_UI;
  return SHFileOperationW(&op) == 0;
}
