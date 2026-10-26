import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
        else entry.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
    ws.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Browser connection closed'));
      }
      this.pending.clear();
    });
  }
  static async connect(endpoint) {
    if (!endpoint) {
      const activePort = process.env.BRAVE_DEVTOOLS_FILE || path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware/Brave-Browser/User Data/DevToolsActivePort');
      const [port, browserPath] = (await fs.readFile(activePort, 'utf8')).trim().split(/\r?\n/);
      endpoint = `ws://127.0.0.1:${port}${browserPath}`;
    }
    const ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.close(); reject(new Error('CDP connection timed out')); }, 10000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', event => { clearTimeout(timer); reject(new Error(event.message || 'CDP connection failed')); }, { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; verify browser state before retrying`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async targets() { return (await this.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page'); }
  async attach(targetId) { return (await this.send('Target.attachToTarget', { targetId, flatten: true })).sessionId; }
  async evaluate(sessionId, expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId, 45000);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cdp = await CDP.connect(process.env.BRAVE_CDP_ENDPOINT);
  try {
    const targets = await cdp.targets();
    if (!process.argv[2]) console.log(JSON.stringify(targets.map(({ targetId, title, url }) => ({ targetId, title, url })), null, 2));
    else {
      const matches = targets.filter(t => t.targetId === process.argv[2] || t.url.includes(process.argv[2]));
      if (matches.length !== 1) throw new Error(`Expected one matching tab; found ${matches.length}`);
      const session = await cdp.attach(matches[0].targetId);
      const expression = await fs.readFile(process.argv[3], 'utf8');
      const result = await cdp.evaluate(session, expression);
      if (process.argv[4]) await fs.writeFile(process.argv[4], JSON.stringify(result, null, 2));
      else console.log(JSON.stringify(result, null, 2));
    }
  } finally { cdp.close(); }
}
