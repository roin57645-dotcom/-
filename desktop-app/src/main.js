const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('node:path');
const fs = require('node:fs');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getBackendExe() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'DialogueAnalyzer.exe');
  }
  // Development mode: app.getAppPath() → desktop-app/, backend/ is a sibling
  return path.join(app.getAppPath(), '..', 'backend', 'dist', 'DialogueAnalyzer', 'DialogueAnalyzer.exe');
}

function getStoragePath() {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'storage');
  }
  // Development: use backend/storage/ directly so existing data is visible
  return null;
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

let backendProcess = null;

function startBackend() {
  return new Promise((resolve, reject) => {
    const exePath = getBackendExe();

    if (!fs.existsSync(exePath)) {
      reject(new Error(
        `后端文件不存在:\n${exePath}\n\n请先在 backend/ 目录运行 PyInstaller 打包。`
      ));
      return;
    }

    const storagePath = getStoragePath();
    const args = [];
    if (storagePath) {
      fs.mkdirSync(storagePath, { recursive: true });
      args.push('--storage-path', storagePath);
    }

    const proc = spawn(exePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(exePath),
    });

    backendProcess = proc;

    let portFound = false;
    const timeout = setTimeout(() => {
      if (!portFound) {
        reject(new Error('后端启动超时（15秒），请检查程序完整性'));
      }
    }, 15000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/\[SYS_PORT\]:(\d+)/);
      if (match && !portFound) {
        portFound = true;
        clearTimeout(timeout);
        resolve(parseInt(match[1], 10));
      }
    });

    proc.stderr.on('data', (data) => {
      process.stdout.write('[backend] ' + data.toString());
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动后端进程: ${err.message}`));
    });

    proc.on('exit', (code) => {
      backendProcess = null;
      if (!portFound) {
        clearTimeout(timeout);
        reject(new Error(`后端进程异常退出，退出码: ${code}`));
      }
    });
  });
}

function killBackend() {
  if (!backendProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], {
        stdio: 'ignore',
      });
    } else {
      backendProcess.kill('SIGKILL');
    }
  } catch {
    // best-effort
  }
  backendProcess = null;
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '对话动力学复盘助手',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

async function boot() {
  try {
    process.stdout.write('正在启动后端服务...\n');
    const port = await startBackend();
    process.stdout.write(`后端就绪，端口: ${port}\n`);
    createWindow(port);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    dialog.showErrorBox('启动失败', err.message);
    app.quit();
  }
}

function setupKillHooks() {
  app.on('window-all-closed', () => {
    killBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    killBackend();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      boot();
    }
  });

  process.on('exit', () => {
    killBackend();
  });
}

// This method will be called when Electron has finished initialization.
app.whenReady().then(() => {
  setupKillHooks();
  boot();
});

app.on('will-quit', () => {
  killBackend();
});
