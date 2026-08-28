const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net  = require('net');
const fs   = require('fs');
const zlib = require('zlib');
const WebSocket = require('ws');

// ── Programmatic tray icon (circle PNG, no external files needed) ─────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function u32(n) { return Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]); }
function chunk(type, data) {
  const t = Buffer.from(type);
  const c = u32(crc32(Buffer.concat([t, data])));
  return Buffer.concat([u32(data.length), t, data, c]);
}
function makeCirclePNG(r, g, b, size = 22) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2, cy = size / 2, rad = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size*4+1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5, d = Math.sqrt(dx*dx + dy*dy);
      const a = d <= rad ? 255 : d <= rad+1.2 ? Math.round(255 * (rad+1.2-d) / 1.2) : 0;
      const i = y*(size*4+1)+1+x*4;
      raw[i]=r; raw[i+1]=g; raw[i+2]=b; raw[i+3]=a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4);
  ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const IMG_GREEN  = nativeImage.createFromBuffer(makeCirclePNG(52,  211, 153));
const IMG_RED    = nativeImage.createFromBuffer(makeCirclePNG(248, 113, 113));
const IMG_YELLOW = nativeImage.createFromBuffer(makeCirclePNG(251, 191,  36));

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'bridge-config.json');
let config = null;
function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { config = null; }
  return config;
}
function saveConfig(c) {
  config = c;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

// ── Bridge state ──────────────────────────────────────────────────────────────
let tray, setupWin, ws;
let connected = false;
let reconnectTimer = null;

function updateTray() {
  if (!tray) return;
  tray.setImage(connected ? IMG_GREEN : IMG_RED);
  tray.setToolTip(connected ? 'Print Bridge · เชื่อมต่อแล้ว' : 'Print Bridge · ไม่ได้เชื่อมต่อ');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: connected ? '● เชื่อมต่อแล้ว' : '● ไม่ได้เชื่อมต่อ', enabled: false },
    { type: 'separator' },
    { label: 'ตั้งค่า...', click: showSetup },
    { label: 'เชื่อมต่อใหม่', click: reconnect, enabled: !!config },
    { type: 'separator' },
    { label: 'ออกจากโปรแกรม', click: () => { cleanup(); app.exit(0); } },
  ]));
}

// ── TCP send ──────────────────────────────────────────────────────────────────
function sendTCP(ip, port, data) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 5000);
    sock.connect(port, ip, () => {
      sock.write(data, () => {
        setTimeout(() => { sock.destroy(); clearTimeout(timer); resolve(true); }, 800);
      });
    });
    sock.on('error', () => { clearTimeout(timer); sock.destroy(); resolve(false); });
  });
}

// ── WebSocket bridge ──────────────────────────────────────────────────────────
function connect() {
  if (!config?.apiUrl || !config?.token) return;
  clearTimeout(reconnectTimer);

  const url = `${config.apiUrl}/v1/print-bridge/ws?token=${encodeURIComponent(config.token)}`;
  try { ws = new WebSocket(url); } catch { scheduleReconnect(); return; }

  ws.on('open', () => {
    connected = true;
    updateTray();
  });

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'job') {
      const buf = Buffer.from(msg.data, 'base64');
      const ok  = await sendTCP(msg.ip, msg.port, buf);
      ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok }));
    }
  });

  ws.on('close', () => {
    connected = false;
    updateTray();
    scheduleReconnect();
  });

  ws.on('error', () => {});
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 5000);
}

function reconnect() {
  ws?.terminate();
  connected = false;
  updateTray();
  connect();
}

function cleanup() {
  clearTimeout(reconnectTimer);
  ws?.terminate();
}

// ── Setup window ──────────────────────────────────────────────────────────────
function showSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    width: 500,
    height: 480,
    resizable: false,
    title: 'Print Bridge — ตั้งค่า',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWin.loadFile(path.join(__dirname, 'renderer', 'setup.html'));
  setupWin.setMenu(null);
  setupWin.on('closed', () => { setupWin = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
ipcMain.handle('get-config',  () => config);
ipcMain.handle('get-status',  () => connected);
ipcMain.handle('save-config', (_, c) => {
  saveConfig(c);
  reconnect();
  setupWin?.close();
  return true;
});

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Auto-start on Windows login (hidden — no window on startup)
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

  loadConfig();

  tray = new Tray(IMG_YELLOW);
  tray.setToolTip('Print Bridge · กำลังเริ่มต้น...');
  tray.on('double-click', showSetup);
  updateTray();

  if (!config) {
    showSetup();
  } else {
    connect();
  }
});

// Keep alive in tray even when all windows closed
app.on('window-all-closed', e => e.preventDefault());
