import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadConfig(configPath = "config.json") {
  const resolvedPath = path.resolve(configPath);
  const raw = await readFile(resolvedPath, "utf8");
  const config = JSON.parse(raw);

  const normalized = {
    pollIntervalSeconds: numberOr(config.pollIntervalSeconds, 300),
    stateFile: stringOr(config.stateFile, "data/state.json"),
    networkTimeoutMs: numberOr(config.networkTimeoutMs, 30_000),
    source: {
      host: hostName(config.source?.host, "source.host"),
      port: numberOr(config.source?.port, 993),
      username: requiredString(config.source?.username, "source.username"),
      password: requiredString(config.source?.password, "source.password"),
      mailbox: stringOr(config.source?.mailbox, "INBOX"),
      maxFetchPerRun: numberOr(config.source?.maxFetchPerRun, 10),
      maxBodyChars: numberOr(config.source?.maxBodyChars, 20_000),
      tlsRejectUnauthorized: booleanOr(config.source?.tlsRejectUnauthorized, true),
    },
    target: {
      smtpHost: hostName(config.target?.smtpHost, "target.smtpHost"),
      smtpPort: numberOr(config.target?.smtpPort, 465),
      username: requiredString(config.target?.username, "target.username"),
      password: requiredString(config.target?.password, "target.password"),
      to: requiredString(config.target?.to, "target.to"),
      fromName: stringOr(config.target?.fromName, "Campus Mail Forwarder"),
      tlsRejectUnauthorized: booleanOr(config.target?.tlsRejectUnauthorized, true),
    },
    forward: {
      subjectPrefix: stringOr(config.forward?.subjectPrefix, "[校园邮箱转发]"),
      firstRunMode: stringOr(config.forward?.firstRunMode, "checkpoint"),
      heloName: stringOr(config.forward?.heloName, "mail2qq.local"),
    },
  };

  if (!["checkpoint", "forward"].includes(normalized.forward.firstRunMode)) {
    throw new Error("forward.firstRunMode 只能是 checkpoint 或 forward");
  }

  return normalized;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`缺少必填配置：${name}`);
  }
  return value.trim();
}

function hostName(value, name) {
  const raw = requiredString(value, name);
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
      return new URL(raw).hostname;
    }
  } catch {
    throw new Error(`${name} 不是有效地址：${raw}`);
  }

  const normalized = raw.replace(/^\/+|\/+$/g, "");
  if (normalized.includes("/")) {
    throw new Error(`${name} 只能填写主机名，不要包含路径或协议：${raw}`);
  }
  return normalized;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function numberOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
