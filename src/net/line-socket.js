import tls from "node:tls";

export function connectTls({ host, port, timeoutMs, rejectUnauthorized = true }) {
  const socket = tls.connect({
    host,
    port,
    servername: host,
    rejectUnauthorized,
  });

  socket.setTimeout(timeoutMs, () => {
    socket.destroy(new Error(`连接超时：${host}:${port}`));
  });

  return new Promise((resolve, reject) => {
    socket.once("secureConnect", () => resolve(new LineSocket(socket)));
    socket.once("error", reject);
  });
}

export class LineSocket {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.error = null;
    this.ended = false;
    this.waiters = [];

    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    socket.on("error", (error) => {
      this.error = error;
      this.wake();
    });
    socket.on("end", () => {
      this.ended = true;
      this.wake();
    });
    socket.on("close", () => {
      this.ended = true;
      this.wake();
    });
  }

  async readLine() {
    for (;;) {
      const index = this.buffer.indexOf("\r\n");
      if (index >= 0) {
        const line = this.buffer.subarray(0, index).toString("utf8");
        this.buffer = this.buffer.subarray(index + 2);
        return line;
      }
      await this.waitForData();
    }
  }

  async readExact(byteLength) {
    while (this.buffer.length < byteLength) {
      await this.waitForData();
    }
    const chunk = this.buffer.subarray(0, byteLength);
    this.buffer = this.buffer.subarray(byteLength);
    return chunk;
  }

  write(data) {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  writeLine(line) {
    return this.write(`${line}\r\n`);
  }

  close() {
    this.socket.end();
  }

  destroy() {
    this.socket.destroy();
  }

  async waitForData() {
    if (this.error) throw this.error;
    if (this.ended) throw new Error("连接已关闭");
    await new Promise((resolve) => this.waiters.push(resolve));
    if (this.error) throw this.error;
    if (this.ended && this.buffer.length === 0) throw new Error("连接已关闭");
  }

  wake() {
    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
