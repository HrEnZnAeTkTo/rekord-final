/**
 * Cover Art Provider
 * MusicBrainz -> Cover Art Archive (front-500)
 *
 * Key fixes vs old version:
 * - search recordings using artistname: (not only artist:) to match multi-artist credits
 * - fallback strategies: drop status:official; try release search too
 * - duration is optional; only apply qdur when provided
 * - never read Response body twice
 * - keep CAA via HTTP front-500 (redirects to archive.org)
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns");

const logger = require("../../util/logger");
const { makeSafeFilename, cleanForSearch } = require("../../util/normalize");

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "http://coverartarchive.org";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

function escapeLucenePhrase(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeDurationMs(d) {
  const n = Number(d);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // if it's small, it's probably seconds
  return n < 10000 ? Math.round(n * 1000) : Math.round(n);
}

function qdur(durationMs) {
  // MusicBrainz: qdur = duration(ms)/2000 rounded
  return Math.round(durationMs / 2000);
}

function tokenizeForField(s) {
  // split into "words" (unicode letters/digits), drop short noise
  const parts = String(s)
    .split(/[^\p{L}\p{N}]+/gu)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length >= 2);
  return parts.slice(0, 6); // keep it sane
}

class CoverProvider {
  constructor(config) {
    this.coversDir = config.paths?.covers || "./data/covers";
    this.timeout = config.timeout || 8000;

    // MusicBrainz requires a meaningful UA string (with contact)
    this.userAgent =
      config.musicbrainz?.userAgent ||
      "rk-karaoke/0.0.2 (alpha) (yrkiy.evgeny@gmail.com)";

    // MB: <= 1 req / sec
    this._mbNextAt = 0;

    this._inFlight = new Map();
    this.retries = Number.isFinite(config.retries) ? config.retries : 3;
  }

  async init() {
    await fs.promises.mkdir(this.coversDir, { recursive: true });
  }

  async _fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      const cause = err?.cause;
      const causeMsg =
        cause?.code || cause?.message || (cause ? String(cause) : "no-cause");
      logger.warn(`Fetch failed: ${url} :: ${err.message} :: ${causeMsg}`);
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  async _fetchRetry(url, options = {}, tries = this.retries) {
    const transient = new Set([
      "ECONNRESET", 
      "ETIMEDOUT", 
      "EAI_AGAIN", 
      "ENOTFOUND",

      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ]);
    let lastErr;

    for (let i = 0; i < tries; i++) {
      try {
        return await this._fetchWithTimeout(url, options);
      } catch (e) {
        lastErr = e;
        const code = e?.cause?.code;
        const isTransient = code && transient.has(code);
        if (!isTransient || i === tries - 1) throw e;
        await sleep(250 * 2 ** i);
      }
    }
    throw lastErr;
  }

  async _mbFetch(url) {
    const now = Date.now();
    if (now < this._mbNextAt) await sleep(this._mbNextAt - now);
    this._mbNextAt = Date.now() + 1100;

    return this._fetchRetry(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
    });
  }

  async _mbSearch(type, query, { inc = "", limit = 10 } = {}) {
    const url = new URL(`${MB_BASE}/${type}/`);
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(limit));
    if (inc) url.searchParams.set("inc", inc);

    const res = await this._mbFetch(url.toString());

    let data;
    try {
      data = await res.json(); // read once
    } catch (e) {
      logger.warn(`MusicBrainz JSON parse failed type=${type} status=${res.status}: ${e.message}`);
      return null;
    }

    // log compactly (helps debugging without spamming huge JSON)
    const count =
      data?.count ??
      data?.["recording-count"] ??
      data?.["release-count"] ??
      data?.["release-group-count"] ??
      "?";
    logger.debug(`MusicBrainz type=${type} status=${res.status} count=${count}`);

    if (!res.ok) return null;
    return data;
  }

  async _fileExists(p, minBytes = 1024) {
    try {
      const st = await fs.promises.stat(p);
      return st.isFile() && st.size >= minBytes;
    } catch {
      return false;
    }
  }

  _caaFrontUrl(releaseMbid) {
    // In your environment HTTPS to CAA fails; HTTP redirects to archive.org and works
    return `${CAA_BASE}/release/${releaseMbid}/front-500`;
  }

  async getCover(artist, title, durationMs) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    const publicUrl = `/covers/${filename}`;

    if (await this._fileExists(filePath)) return publicUrl;
    if (this._inFlight.has(filename)) return await this._inFlight.get(filename);

    const task = (async () => {
      try {
        const releaseMbid = await this._findReleaseMbid(artist, title, durationMs);
        if (!releaseMbid) return null;

        const imageUrl = this._caaFrontUrl(releaseMbid);
        const ok = await this._downloadImageAtomic(imageUrl, filePath);
        return ok ? publicUrl : null;
      } catch (e) {
        logger.warn(`Cover error: ${e.message}`);
        return null;
      }
    })();

    this._inFlight.set(filename, task);
    try {
      return await task;
    } finally {
      this._inFlight.delete(filename);
    }
  }

  async _findReleaseMbid(artist, title, durationMs) {
    const durMs = normalizeDurationMs(durationMs);

    const attempts = [
      { a: artist, t: title, tag: "raw" },
      { a: cleanForSearch(artist), t: cleanForSearch(title), tag: "clean" },
    ];

    // title clauses: phrase first, then token-based (looser)
    const makeTitleClauses = (t) => {
      const tt = escapeLucenePhrase(t);
      const tokens = tokenizeForField(t).map(escapeLucenePhrase);
      const tokenClause =
        tokens.length >= 2
          ? `recording:(${tokens.join(" AND ")})`
          : tokens.length === 1
            ? `recording:${tokens[0]}`
            : null;

      return [
        { label: "phrase", clause: `recording:"${tt}"` },
        ...(tokenClause ? [{ label: "tokens", clause: tokenClause }] : []),
      ];
    };

    for (const { a, t, tag } of attempts) {
      const aa = escapeLucenePhrase(a);
      const titleClauses = makeTitleClauses(t);

      // Important: prefer artistname: (any artist), fallback to artist: (combined credit)
      const artistFields = ["artistname", "artist"];

      // status:official can be too strict for some entries -> try with and without
      const statusModes = [true, false];

      // 1) Recording search with inc=releases
      for (const af of artistFields) {
        for (const tm of titleClauses) {
          for (const withStatus of statusModes) {
            let query = `${af}:"${aa}" AND ${tm.clause}`;
            if (durMs) query += ` AND qdur:${qdur(durMs)}`;
            if (withStatus) query += ` AND status:official`;

            const data = await this._mbSearch("recording", query, { inc: "releases", limit: 10 });
            const recs = data?.recordings;
            logger.debug(
              `MB try recording tag=${tag} af=${af} title=${tm.label} status=${withStatus ? "on" : "off"} durMs=${durMs}`
            );

            if (!Array.isArray(recs) || recs.length === 0) continue;

            const bestRec =
              recs.slice().sort((x, y) => Number(y.score || 0) - Number(x.score || 0))[0] || null;

            const releases = bestRec?.releases;
            if (!Array.isArray(releases) || releases.length === 0) continue;

            const bestRelease =
              releases.find((r) => String(r.status).toLowerCase() === "official") || releases[0];

            if (bestRelease?.id) return bestRelease.id;
          }
        }
      }

      // 2) Release search (useful when single title == track title)
      for (const af of artistFields) {
        for (const withStatus of statusModes) {
          const tt = escapeLucenePhrase(t);
          let query = `${af}:"${aa}" AND release:"${tt}"`;
          if (withStatus) query += ` AND status:official`;

          const data = await this._mbSearch("release", query, { limit: 10 });
          const rels = data?.releases;
          logger.debug(
            `MB try release tag=${tag} af=${af} status=${withStatus ? "on" : "off"}`
          );

          if (!Array.isArray(rels) || rels.length === 0) continue;

          const bestRel =
            rels.slice().sort((x, y) => Number(y.score || 0) - Number(x.score || 0))[0] || null;

          if (bestRel?.id) return bestRel.id;
        }
      }
    }

    return null;
  }

  async _downloadImageAtomic(url, filePath) {
    const tmp = `${filePath}.tmp`;

    try {
      const res = await this._fetchRetry(url, {
        headers: { Accept: "image/*" },
        redirect: "follow",
      });

      if (!res.ok) return false;

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/") && ct !== "application/octet-stream") return false;

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) return false;

      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, filePath);
      return true;
    } catch (e) {
      fs.promises.unlink(tmp).catch(() => {});
      const cause = e?.cause;
      logger.warn(
        `Cover download failed: ${e.message}` +
          (cause ? ` :: ${cause.code || cause.message || String(cause)}` : "")
      );
      return false;
    }
  }

  async hasCover(artist, title) {
    const filename = `${makeSafeFilename(artist, title)}.jpg`;
    const filePath = path.join(this.coversDir, filename);
    return await this._fileExists(filePath);
  }
}

module.exports = CoverProvider;
