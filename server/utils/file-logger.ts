import fs from "fs";
import path from "path";
import util from "util";

const logDir = process.env.LOG_DIR || (process.env.LOG_PATH ? path.dirname(process.env.LOG_PATH) : undefined);

let initialized = false;
let currentDate: string | undefined;
let stream: fs.WriteStream | undefined;

type LogFn = (...args: any[]) => void;

function getKoreanDateStamp(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));

  const year = String(koreanTime.getUTCFullYear()).slice(-2);
  const month = String(koreanTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(koreanTime.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

function openStreamForDate(date: string): fs.WriteStream | undefined {
  if (!logDir) {
    return undefined;
  }

  try {
    fs.mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, `${date}.log`);
    return fs.createWriteStream(filePath, { flags: "a" });
  } catch {
    return undefined;
  }
}

function rotateIfNeeded(): void {
  const date = getKoreanDateStamp();
  if (currentDate === date) {
    return;
  }

  currentDate = date;

  if (stream) {
    try {
      stream.end();
    } catch {
      // Best-effort shutdown only.
    }
  }

  stream = openStreamForDate(date);
}

export function initFileLogger(): void {
  if (initialized || !logDir) {
    return;
  }

  initialized = true;

  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  const writeLine = (line: string) => {
    rotateIfNeeded();
    if (!stream) {
      return;
    }

    try {
      stream.write(`${line}\n`);
    } catch {
      // Ignore logging failures to avoid crashing the app.
    }
  };

  const wrap = (original: LogFn) => (...args: any[]) => {
    writeLine(util.format(...args));
    original(...args);
  };

  console.log = wrap(originalLog);
  console.info = wrap(originalInfo);
  console.warn = wrap(originalWarn);
  console.error = wrap(originalError);

  const closeStream = () => {
    if (!stream) {
      return;
    }

    try {
      stream.end();
    } catch {
      // Best-effort shutdown only.
    }
  };

  process.on("beforeExit", closeStream);
  process.on("SIGINT", closeStream);
  process.on("SIGTERM", closeStream);
}
