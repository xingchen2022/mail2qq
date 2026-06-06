export function parseEmail(uid, raw, maxBodyChars = 20_000) {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sep = text.indexOf("\n\n");
  const headerText = sep >= 0 ? text.slice(0, sep) : text;
  const bodyText = sep >= 0 ? text.slice(sep + 2) : "";
  const headers = parseHeaders(headerText);
  const contentType = headers["content-type"] ?? "text/plain";
  const transferEncoding = headers["content-transfer-encoding"] ?? "";
  const charset = getMimeParam(contentType, "charset") ?? "utf-8";

  let body = "";
  if (contentType.toLowerCase().includes("multipart/")) {
    body = extractMultipartText(bodyText, getMimeParam(contentType, "boundary") ?? "");
  } else {
    const decoded = decodeContent(bodyText, transferEncoding, charset);
    body = contentType.toLowerCase().startsWith("text/html") ? stripHtml(decoded) : decoded;
  }

  const trimmed = body.trim();
  return {
    uid,
    messageId: headers["message-id"] ?? `uid-${uid}`,
    from: decodeMimeWords(headers.from ?? ""),
    subject: decodeMimeWords(headers.subject ?? "(无主题)"),
    date: headers.date ?? "",
    body: trimmed.length > maxBodyChars ? `${trimmed.slice(0, maxBodyChars)}\n...(内容已截断)` : trimmed,
  };
}

export function parseHeaders(headerText) {
  const unfolded = headerText.replace(/\n([ \t])/g, " ");
  const headers = {};

  for (const line of unfolded.split("\n")) {
    const index = line.indexOf(":");
    if (index < 1) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (headers[key]) continue;
    headers[key] = line.slice(index + 1).trim();
  }

  return headers;
}

function getMimeParam(header, param) {
  const pattern = new RegExp(`(?:^|;)\\s*${param}\\s*=\\s*"?([^";\\s]+)"?`, "i");
  return header.match(pattern)?.[1];
}

function extractMultipartText(body, boundary) {
  if (!boundary) return "";

  const delimiter = `--${boundary}`;
  const parts = [];
  let current = null;

  for (const line of body.split("\n")) {
    const stripped = line.trimEnd();
    if (stripped === delimiter || stripped === `${delimiter}--`) {
      if (current) parts.push(current.join("\n"));
      current = stripped.endsWith("--") ? null : [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current?.length) parts.push(current.join("\n"));

  let htmlFallback = "";
  for (const part of parts) {
    const sep = part.indexOf("\n\n");
    if (sep < 0) continue;

    const headers = parseHeaders(part.slice(0, sep));
    const partBody = part.slice(sep + 2);
    const contentType = headers["content-type"] ?? "text/plain";
    const transferEncoding = headers["content-transfer-encoding"] ?? "";
    const charset = getMimeParam(contentType, "charset") ?? "utf-8";

    if (contentType.toLowerCase().startsWith("text/plain")) {
      const decoded = decodeContent(partBody, transferEncoding, charset).trim();
      if (decoded) return decoded;
    }

    if (contentType.toLowerCase().startsWith("text/html") && !htmlFallback) {
      htmlFallback = stripHtml(decodeContent(partBody, transferEncoding, charset));
    }

    if (contentType.toLowerCase().includes("multipart/")) {
      const innerBoundary = getMimeParam(contentType, "boundary");
      if (innerBoundary) {
        const inner = extractMultipartText(partBody, innerBoundary);
        if (inner) return inner;
      }
    }
  }

  return htmlFallback;
}

function decodeContent(content, encoding, charset) {
  const normalized = encoding.toLowerCase().trim();
  try {
    if (normalized === "base64") {
      return decodeBytes(Buffer.from(content.replace(/\s/g, ""), "base64"), charset);
    }
    if (normalized === "quoted-printable") {
      return decodeBytes(decodeQuotedPrintable(content), charset);
    }
  } catch {
    return content;
  }
  return content;
}

function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decodeQuotedPrintable(input) {
  const compact = input.replace(/=\r?\n/g, "");
  const bytes = [];

  for (let i = 0; i < compact.length; i++) {
    if (compact[i] === "=" && i + 2 < compact.length) {
      const value = Number.parseInt(compact.slice(i + 1, i + 3), 16);
      if (!Number.isNaN(value)) {
        bytes.push(value);
        i += 2;
        continue;
      }
    }
    bytes.push(compact.charCodeAt(i));
  }

  return Uint8Array.from(bytes);
}

function decodeMimeWords(input) {
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (original, charset, encoding, text) => {
    try {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : decodeQuotedPrintable(text.replace(/_/g, " "));
      return decodeBytes(bytes, charset);
    } catch {
      return original;
    }
  });
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(Number.parseInt(value, 10)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
