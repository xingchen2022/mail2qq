import { loadConfig } from "./config.js";
import { runOnce } from "./forwarder.js";

const args = parseArgs(process.argv.slice(2));
const config = await loadConfig(args.configPath);
const intervalMs = config.pollIntervalSeconds * 1000;

let stopped = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopped = true;
    console.log(`【${formatShanghai()}｜上海时间】服务已停止：${signal}`);
    process.exit(0);
  });
}

if (!args.once) {
  console.log(
    [
      `【${formatShanghai()}｜上海时间】服务已启动`,
      `  配置文件：${args.configPath}`,
      `  检查间隔：${formatSeconds(config.pollIntervalSeconds)}`,
      "  输出策略：每次检查都显示邮箱统计和发送情况",
    ].join("\n"),
  );
}

do {
  const startedAt = Date.now();
  try {
    const summary = await runOnce(config);
    printSummary(summary);
  } catch (error) {
    console.error(`【${formatShanghai()}｜上海时间】运行出错\n  原因：${error.message}`);
    if (args.once) process.exitCode = 1;
  }

  if (args.once) break;

  const elapsedMs = Date.now() - startedAt;
  await sleep(Math.max(0, intervalMs - elapsedMs));
} while (!stopped);

function printSummary(summary) {
  const timestamp = formatShanghai();
  const pending = Math.max(0, summary.totalNew - summary.fetched);
  const status = summary.mode === "checkpoint"
    ? "首次初始化完成"
    : summary.failed > 0
      ? "检查完成，有邮件转发失败"
      : summary.forwarded > 0
        ? "检查完成，已转发新邮件"
        : "检查完成，暂无新邮件";

  const lines = [
    `【${timestamp}｜上海时间】${status}`,
    `  邮箱统计：总数 ${summary.stats.total} 封｜未读 ${summary.stats.unread} 封｜已读 ${summary.stats.read} 封`,
    `  新邮件：${summary.totalNew} 封｜本轮读取 ${summary.fetched} 封｜剩余待处理 ${pending} 封`,
    `  本次发送：成功 ${summary.forwarded} 封｜失败 ${summary.failed} 封`,
    `  当前游标：UID ${summary.lastUid}`,
  ];

  if (summary.mode === "checkpoint") {
    lines.push("  处理方式：本次不转发历史邮件，只转发之后的新邮件");
  }

  if (summary.forwardedItems.length > 0) {
    lines.push("  已发送邮件：");
    for (const item of summary.forwardedItems.slice(0, 3)) {
      lines.push(`    - UID ${item.uid}：${item.subject}`);
    }
  }

  const output = lines.join("\n");
  if (summary.failed > 0) {
    console.error(output);
    console.error("  失败详情：");
    for (const failure of summary.failures.slice(0, 3)) {
      console.error(`    - UID ${failure.uid}：${failure.error}`);
    }
    return;
  }

  console.log(output);
}

function formatShanghai(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds % 60 === 0 && seconds < 3600) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function parseArgs(argv) {
  const out = {
    configPath: "config.json",
    once: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") out.once = true;
    if (arg === "--config") {
      out.configPath = argv[i + 1] ?? out.configPath;
      i += 1;
    }
  }

  return out;
}
