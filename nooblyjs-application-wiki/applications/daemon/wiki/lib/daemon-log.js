/**
 * DaemonLog — a console-compatible logger that fans each line out to three
 * sinks at once:
 *
 *   1. the terminal (console.*), preserving the daemon's existing CLI output
 *   2. the digital-technologies-core logger (structured file logs on disk)
 *   3. the live activity Monitor (so the dashboard feed updates in real time)
 *
 * It is a drop-in for `console`: components call `log.info(...)` /
 * `log.warn(...)` / `log.error(...)` exactly as they called `console.log` etc.
 *
 * The dashboard scope (the badge shown per feed row) is parsed for free from
 * the leading "[Scope]" tag the daemon already prefixes onto every message
 * (e.g. "[Upload] Done: x" -> scope "Upload"), so call sites stay unchanged.
 */
const SCOPE_RE = /^\s*\[([^\]]+)\]\s?/;

function toText(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  if (arg === undefined) return 'undefined';
  if (arg === null) return 'null';
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

class DaemonLog {
  /**
   * @param {object|null} core    core logger from serviceRegistry.logger(...)
   * @param {object|null} monitor activity Monitor (or null)
   * @param {object} [opts]
   * @param {boolean} [opts.echo=true] also write to the terminal
   */
  constructor(core, monitor, { echo = true } = {}) {
    this.core = core || null;
    this.monitor = monitor || null;
    this.echo = echo;
  }

  _emit(level, args) {
    const message = args.map(toText).join(' ');

    if (this.echo) {
      const fn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : console.log;
      fn(...args);
    }

    // Fire-and-forget to the structured file logger; never let a logging
    // failure bubble into the sync path.
    if (this.core && typeof this.core[level] === 'function') {
      Promise.resolve()
        .then(() => this.core[level](message))
        .catch(() => {});
    }

    if (this.monitor) {
      const m = SCOPE_RE.exec(message);
      this.monitor.push({
        level,
        scope: m ? m[1] : 'Daemon',
        message: m ? message.slice(m[0].length) : message,
      });
    }
  }

  info(...args) { this._emit('info', args); }
  warn(...args) { this._emit('warn', args); }
  error(...args) { this._emit('error', args); }
  debug(...args) { this._emit('debug', args); }
  // console.log alias for any stray callers
  log(...args) { this._emit('info', args); }
}

module.exports = DaemonLog;
