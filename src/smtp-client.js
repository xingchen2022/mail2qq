import { connectTls } from "./net/line-socket.js";

export async function sendSmtpMail(target, message, networkTimeoutMs, heloName) {
  const socket = await connectTls({
    host: target.smtpHost,
    port: target.smtpPort,
    timeoutMs: networkTimeoutMs,
    rejectUnauthorized: target.tlsRejectUnauthorized,
  });
  const smtp = new SmtpSession(socket);

  try {
    await smtp.expect([220]);
    await smtp.command(`EHLO ${heloName}`, [250]);
    await smtp.command("AUTH LOGIN", [334]);
    await smtp.command(toBase64(target.username), [334]);
    await smtp.command(toBase64(target.password), [235]);
    await smtp.command(`MAIL FROM:<${extractEmailAddress(target.username)}>`, [250]);
    await smtp.command(`RCPT TO:<${extractEmailAddress(target.to)}>`, [250, 251]);
    await smtp.command("DATA", [354]);
    await smtp.writeData(renderEmailData(message, target));
    const response = await smtp.expect([250]);
    await smtp.command("QUIT", [221]).catch(() => undefined);
    return { ok: true, status: response.code };
  } finally {
    socket.destroy();
  }
}

export function buildForwardedMessage(email, config) {
  const body = email.body?.trim() || "(无正文)";
  const subject = `${config.forward.subjectPrefix} ${email.subject}`;

  return {
    subject,
    replyTo: extractEmailAddress(email.from),
    messageId: makeMessageId(email),
    text: [
      "这是一封由 mail2qq 自动转发的校园邮箱邮件。",
      "",
      `原发件人：${email.from}`,
      `原时间：${email.date}`,
      `原 Message-ID：${email.messageId}`,
      "",
      body,
    ].join("\n"),
  };
}

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
  }

  async command(command, expectedCodes) {
    await this.socket.writeLine(command);
    return this.expect(expectedCodes);
  }

  async expect(expectedCodes) {
    const response = await this.readResponse();
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP ${response.code}: ${response.lines.join("\n")}`);
    }
    return response;
  }

  async writeData(data) {
    const normalized = data
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => (line.startsWith(".") ? `.${line}` : line))
      .join("\r\n");
    await this.socket.write(`${normalized}\r\n.\r\n`);
  }

  async readResponse() {
    const first = await this.socket.readLine();
    const code = Number.parseInt(first.slice(0, 3), 10);
    if (!Number.isFinite(code)) throw new Error(`SMTP 响应格式无效：${first}`);

    const lines = [first];
    if (!first.startsWith(`${code}-`)) return { code, lines };

    for (;;) {
      const line = await this.socket.readLine();
      lines.push(line);
      if (line.startsWith(`${code} `)) return { code, lines };
    }
  }
}

function renderEmailData(message, target) {
  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${sanitizeHeaderValue(message.messageId)}`,
    `From: ${formatAddress(target.fromName, target.username)}`,
    `To: ${formatAddress("", target.to)}`,
    message.replyTo ? `Reply-To: ${formatAddress("", message.replyTo)}` : undefined,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Mail2QQ-Forwarded: yes",
  ].filter(Boolean);

  return `${headers.join("\r\n")}\r\n\r\n${wrapBase64(toBase64(message.text))}`;
}

function formatAddress(displayName, address) {
  const email = extractEmailAddress(address);
  return displayName ? `${encodeMimeHeader(displayName)} <${email}>` : `<${email}>`;
}

function extractEmailAddress(value) {
  const wrapped = value.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (wrapped) return sanitizeEmailAddress(wrapped[1]);

  const plain = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (plain) return sanitizeEmailAddress(plain[0]);

  return sanitizeEmailAddress(value);
}

function sanitizeEmailAddress(value) {
  return value.replace(/[\r\n<>]/g, "").trim();
}

function sanitizeHeaderValue(value) {
  return value.replace(/[\r\n]/g, " ").trim();
}

function encodeMimeHeader(value) {
  const safe = sanitizeHeaderValue(value).slice(0, 180);
  if (/^[\x20-\x7e]+$/.test(safe) && !/[=?_]/.test(safe)) return safe;
  return `=?UTF-8?B?${toBase64(safe)}?=`;
}

function toBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function wrapBase64(value) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function makeMessageId(email) {
  const raw = `${email.uid}:${email.messageId}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `<mail2qq-${hash.toString(16)}@local>`;
}
