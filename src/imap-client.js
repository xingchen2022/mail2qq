import { connectTls } from "./net/line-socket.js";
import { parseEmail } from "./mail-parser.js";

const MAX_RAW_BYTES = 1_000_000;

export async function fetchNewImapEmails(source, lastUid, networkTimeoutMs) {
  const socket = await connectTls({
    host: source.host,
    port: source.port,
    timeoutMs: networkTimeoutMs,
    rejectUnauthorized: source.tlsRejectUnauthorized,
  });
  const imap = new ImapSession(socket);

  try {
    await imap.readGreeting();
    await imap.login(source.username, source.password);
    const selected = await imap.select(source.mailbox);
    const unread = await imap.countUnread();
    const stats = {
      total: selected.total,
      unread,
      read: Math.max(0, selected.total - unread),
    };

    const uids = await imap.searchNewUids(lastUid);
    const maxUid = uids.length > 0 ? Math.max(...uids) : lastUid;
    const limited = uids.slice(0, source.maxFetchPerRun);
    const fetchedMaxUid = limited.length > 0 ? Math.max(...limited) : lastUid;
    const emails = [];

    for (const uid of limited) {
      const raw = await imap.fetchRaw(uid);
      if (raw) emails.push(parseEmail(uid, raw, source.maxBodyChars));
    }

    await imap.logout();
    return { emails, maxUid, fetchedMaxUid, totalNew: uids.length, stats };
  } finally {
    socket.destroy();
  }
}

class ImapSession {
  constructor(socket) {
    this.socket = socket;
    this.counter = 0;
  }

  readGreeting() {
    return this.socket.readLine();
  }

  async login(username, password) {
    await this.runCommand(`LOGIN "${escapeImap(username)}" "${escapeImap(password)}"`);
  }

  async select(mailbox) {
    const lines = await this.runCommand(`SELECT "${escapeImap(mailbox)}"`);
    return {
      total: parseExistsCount(lines),
    };
  }

  async searchNewUids(lastUid) {
    const query = lastUid > 0 ? `UID ${lastUid + 1}:*` : "ALL";
    const lines = await this.runCommand(`UID SEARCH ${query}`);
    const searchLine = lines.find((line) => line.startsWith("* SEARCH"));
    if (!searchLine) return [];

    return searchLine
      .replace(/^\* SEARCH\s*/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((uid) => Number.isFinite(uid) && uid > lastUid)
      .sort((a, b) => a - b);
  }

  async countUnread() {
    const lines = await this.runCommand("UID SEARCH UNSEEN");
    const searchLine = lines.find((line) => line.startsWith("* SEARCH"));
    if (!searchLine) return 0;

    return searchLine
      .replace(/^\* SEARCH\s*/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  async fetchRaw(uid) {
    const tag = this.nextTag();
    await this.socket.writeLine(`${tag} UID FETCH ${uid} (BODY.PEEK[])`);
    let body = null;

    for (;;) {
      const line = await this.socket.readLine();
      if (line.startsWith(`${tag} OK`)) break;
      if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
        throw new Error(`IMAP FETCH 失败 uid=${uid}: ${line}`);
      }

      const literal = line.match(/\{(\d+)\}$/);
      if (!literal) continue;

      const byteLength = Number.parseInt(literal[1], 10);
      const bytes = await this.socket.readExact(byteLength);
      if (byteLength <= MAX_RAW_BYTES) body = bytes.toString("utf8");
      await this.socket.readLine();
    }

    return body;
  }

  async logout() {
    const tag = this.nextTag();
    await this.socket.writeLine(`${tag} LOGOUT`).catch(() => undefined);
  }

  async runCommand(command) {
    const tag = this.nextTag();
    await this.socket.writeLine(`${tag} ${command}`);
    const lines = [];

    for (;;) {
      const line = await this.socket.readLine();
      if (line.startsWith(`${tag} OK`)) return lines;
      if (line.startsWith(`${tag} NO`) || line.startsWith(`${tag} BAD`)) {
        throw new Error(`IMAP 命令失败 ${command.split(" ")[0]}: ${line}`);
      }

      const literal = line.match(/\{(\d+)\}$/);
      if (literal) {
        const bytes = await this.socket.readExact(Number.parseInt(literal[1], 10));
        lines.push(line, bytes.toString("utf8"));
      } else {
        lines.push(line);
      }
    }
  }

  nextTag() {
    this.counter += 1;
    return `M${String(this.counter).padStart(3, "0")}`;
  }
}

function escapeImap(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseExistsCount(lines) {
  for (const line of lines) {
    const match = line.match(/^\* (\d+) EXISTS$/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}
