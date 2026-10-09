const REPORT_REASONS = new Set([
  "inappropriate",
  "spam",
  "harassment",
  "underage",
  "other",
]);

const STRIKE_LIMIT = Number(process.env.REPORT_STRIKE_LIMIT) || 3;
const WINDOW_MS = Number(process.env.REPORT_WINDOW_MS) || 24 * 60 * 60 * 1000;
const BAN_MS = Number(process.env.REPORT_BAN_MS) || 24 * 60 * 60 * 1000;
const REPORT_COOLDOWN_MS = 10_000;

/** @type {Array<{ at: number, reason: string, reporterId: string, reportedId: string, reportedIp: string, mode: string }>} */
const reports = [];

/** @type {Map<string, number[]>} */
const strikesByIp = new Map();

/** @type {Map<string, number>} */
const bannedUntilByIp = new Map();

/** @type {Map<string, number>} */
const lastReportAtByReporter = new Map();

/** @type {Map<string, Set<string>>} reporterId -> set of reported partner ids this session */
const reportedPartnersByReporter = new Map();

function normalizeIp(ip) {
  return (ip || "").replace("::ffff:", "") || "unknown";
}

function pruneStrikes(ip, now = Date.now()) {
  const key = normalizeIp(ip);
  const list = (strikesByIp.get(key) || []).filter((t) => now - t <= WINDOW_MS);
  if (list.length) strikesByIp.set(key, list);
  else strikesByIp.delete(key);
  return list;
}

function isBanned(ip, now = Date.now()) {
  const key = normalizeIp(ip);
  const until = bannedUntilByIp.get(key);
  if (!until) return false;
  if (until <= now) {
    bannedUntilByIp.delete(key);
    return false;
  }
  return true;
}

function banRemainingMs(ip, now = Date.now()) {
  const key = normalizeIp(ip);
  const until = bannedUntilByIp.get(key);
  if (!until || until <= now) return 0;
  return until - now;
}

function normalizeReason(reason) {
  const r = typeof reason === "string" ? reason.trim().toLowerCase() : "";
  return REPORT_REASONS.has(r) ? r : "other";
}

/**
 * @returns {{ ok: true, banned: boolean, strikes: number } | { ok: false, error: string }}
 */
function recordReport({
  reason,
  reporterId,
  reportedId,
  reportedIp,
  mode,
  now = Date.now(),
}) {
  if (!reporterId || !reportedId) {
    return { ok: false, error: "no-partner" };
  }

  const lastAt = lastReportAtByReporter.get(reporterId) || 0;
  if (now - lastAt < REPORT_COOLDOWN_MS) {
    return { ok: false, error: "cooldown" };
  }

  let reportedSet = reportedPartnersByReporter.get(reporterId);
  if (!reportedSet) {
    reportedSet = new Set();
    reportedPartnersByReporter.set(reporterId, reportedSet);
  }
  if (reportedSet.has(reportedId)) {
    return { ok: false, error: "already-reported" };
  }

  const ip = normalizeIp(reportedIp);
  const cleanReason = normalizeReason(reason);

  reports.push({
    at: now,
    reason: cleanReason,
    reporterId,
    reportedId,
    reportedIp: ip,
    mode: mode || "video",
  });
  // Keep memory bounded
  if (reports.length > 500) reports.splice(0, reports.length - 500);

  reportedSet.add(reportedId);
  lastReportAtByReporter.set(reporterId, now);

  const strikes = pruneStrikes(ip, now);
  strikes.push(now);
  strikesByIp.set(ip, strikes);

  let banned = false;
  if (strikes.length >= STRIKE_LIMIT) {
    bannedUntilByIp.set(ip, now + BAN_MS);
    banned = true;
  }

  return { ok: true, banned, strikes: strikes.length };
}

function clearReporterSession(reporterId) {
  reportedPartnersByReporter.delete(reporterId);
  lastReportAtByReporter.delete(reporterId);
}

module.exports = {
  REPORT_REASONS,
  isBanned,
  banRemainingMs,
  recordReport,
  clearReporterSession,
  normalizeReason,
};
