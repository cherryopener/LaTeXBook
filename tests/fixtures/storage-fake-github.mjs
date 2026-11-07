// 가짜 GitHub REST API (메모리 속 저장소). 시험에서 Playwright의 context.route("https://api.github.com/**", fake.handle)에 연결한다.
// 실제 API의 경로·머리글·상태 코드·JSON 필드를 공식 문서대로 흉내 낸다:
//   GET  /repos/{o}/{r}/git/trees/{ref}[?recursive=1]
//   GET  /repos/{o}/{r}/git/blobs/{sha}                (기본 JSON+base64, Accept raw면 원문)
//   GET  /repos/{o}/{r}/contents/{path}?ref=           (기본 JSON, 1MB 초과는 403 too_large; object·raw 형식 지원)
//   PUT  /repos/{o}/{r}/contents/{path}                (sha 없이 새 파일 201, 있는 파일은 sha 필요, 어긋나면 409, sha 누락이면 422)
// 오류: 인증 없음 404(비공개 저장소), 잘못된 토큰 401, 한도 초과 403+x-ratelimit-*, 쓰기 권한 없음 403.
// 일부러 오류 본문에 받은 토큰을 되풀이해 넣는다 → 앱이 본문을 화면에 보이지 않는지 확인하기 위해.
import crypto from "node:crypto";

const sha1 = (...parts) => { const h = crypto.createHash("sha1"); for (const p of parts) h.update(p); return h.digest("hex"); };
/** git 방식 blob sha */
export const gitBlobSha = (buf) => { const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); return sha1(`blob ${b.length}\0`, b); };

const ALLOW_HEADERS = "Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, User-Agent, GraphQL-Features, X-GitHub-Api-Version";
const EXPOSE_HEADERS = "ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset";

export function createFakeGitHub({ owner = "cherryopener", repo = "textbooks", branch = "main", token = "github_pat_TEST_FAKE_0000000000000000000000" } = {}) {
  /** 경로 → Buffer */
  const files = new Map();
  const commits = [];
  const state = {
    requests: [],        // {method, url, headers, body}
    inflight: 0, maxInflight: 0,
    delayMs: 0,          // 응답마다 지연(동시 요청 수 시험용)
    offline: false,      // 연결 끊김 흉내
    rateLimitResetAt: null, // 에포크 초 → 모든 요청 403+한도 머리글
    readOnly: false,     // PUT 403 (Resource not accessible by personal access token)
    truncateRecursive: false, // recursive 트리를 truncated:true로
    objectUnsupported: false, // object 형식 contents 요청을 403으로(대체 경로 시험)
    putConflictOnce: 0,  // 다음 N번의 PUT을 "브랜치가 겹침" 409로(파일은 그대로)
    serverError: 0,      // 다음 N번의 요청을 503으로
  };

  const setFile = (path, content) => { files.set(path, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8")); };
  const shaOf = (path) => (files.has(path) ? gitBlobSha(files.get(path)) : null);

  /** prefix("" 또는 "books/") 아래의 한 단계 트리 */
  function buildTree(prefix) {
    const entries = new Map();
    for (const [p, buf] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf("/");
      if (i < 0) entries.set(rest, { path: rest, mode: "100644", type: "blob", sha: gitBlobSha(buf), size: buf.length });
      else if (!entries.has(rest.slice(0, i))) {
        const sub = buildTree(`${prefix}${rest.slice(0, i)}/`);
        entries.set(rest.slice(0, i), { path: rest.slice(0, i), mode: "040000", type: "tree", sha: sub.sha });
      }
    }
    const list = [...entries.values()];
    return { sha: sha1("tree ", list.map((e) => `${e.mode} ${e.path} ${e.sha}`).join("\n")), entries: list };
  }
  function allDirs(prefix = "", out = new Map()) {
    const t = buildTree(prefix);
    out.set(t.sha, prefix);
    for (const e of t.entries) if (e.type === "tree") allDirs(`${prefix}${e.path}/`, out);
    return out;
  }
  function flatten(prefix, outPrefix = "") {
    const out = [];
    for (const e of buildTree(prefix).entries) {
      out.push({ ...e, path: outPrefix + e.path });
      if (e.type === "tree") out.push(...flatten(`${prefix}${e.path}/`, `${outPrefix}${e.path}/`));
    }
    return out;
  }

  const rateHeaders = () => ({
    "x-ratelimit-limit": "5000", "x-ratelimit-remaining": state.rateLimitResetAt ? "0" : "4990",
    "x-ratelimit-used": state.rateLimitResetAt ? "5000" : "10", "x-ratelimit-resource": "core",
    "x-ratelimit-reset": String(state.rateLimitResetAt ?? Math.floor(Date.now() / 1000) + 3600),
  });
  const baseHeaders = (extra = {}) => ({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": EXPOSE_HEADERS,
    "cache-control": "private, max-age=60, s-maxage=60",
    "x-github-request-id": "FAKE:0000:0000:00000000:00000000",
    ...rateHeaders(),
    ...extra,
  });
  const json = (status, obj, extra = {}) => ({ status, headers: baseHeaders({ "content-type": "application/json; charset=utf-8", ...extra }), body: JSON.stringify(obj) });
  const err = (status, message, extra = {}) =>
    json(status, { message, documentation_url: "https://docs.github.com/rest", status: String(status) }, extra);

  /** base64를 GitHub처럼 60칸마다 줄바꿈 */
  const b64lines = (buf) => buf.toString("base64").replace(/(.{60})/g, "$1\n").replace(/\n$/, "") + (buf.length ? "\n" : "");

  function fileObject(path, buf, withContent) {
    const sha = gitBlobSha(buf);
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const o = {
      type: "file", encoding: "base64", size: buf.length, name: path.split("/").pop(), path, sha,
      url: `${base}/contents/${path}?ref=${branch}`, git_url: `${base}/git/blobs/${sha}`,
      html_url: `https://github.com/${owner}/${repo}/blob/${branch}/${path}`,
      download_url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?token=FAKE_DOWNLOAD_TOKEN`,
      _links: { self: `${base}/contents/${path}?ref=${branch}`, git: `${base}/git/blobs/${sha}`, html: `https://github.com/${owner}/${repo}/blob/${branch}/${path}` },
    };
    if (withContent) o.content = b64lines(buf);
    else { o.content = ""; o.encoding = "none"; }
    return o;
  }

  async function respond(req) {
    const url = new URL(req.url());
    const method = req.method();
    const h = req.headers();
    if (method === "OPTIONS") {
      return { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE", "access-control-allow-headers": ALLOW_HEADERS, "access-control-max-age": "86400" }, body: "" };
    }
    // 인증
    const auth = h["authorization"];
    const given = auth ? auth.replace(/^(Bearer|token)\s+/i, "") : null;
    const m = new RegExp(`^/repos/([^/]+)/([^/]+)(/.*)?$`).exec(url.pathname);
    if (!m) return err(404, "Not Found");
    if (state.rateLimitResetAt) return err(403, "API rate limit exceeded for user ID 1234.");
    if (state.serverError > 0) { state.serverError--; return err(503, "Service Unavailable"); }
    if (!given) return err(404, "Not Found");                       // 비공개 저장소는 인증 없으면 404
    if (given !== token) return err(401, `Bad credentials (받은 값: ${given})`);
    if (m[1].toLowerCase() !== owner.toLowerCase() || m[2].toLowerCase() !== repo.toLowerCase()) return err(404, "Not Found");
    const rest = m[3] ?? "";

    let r;
    // 트리
    if ((r = /^\/git\/trees\/([^/]+)$/.exec(rest))) {
      const refName = decodeURIComponent(r[1]);
      const recursive = url.searchParams.get("recursive");
      let prefix;
      if (refName === branch) prefix = "";
      else { const dirs = allDirs(); if (!dirs.has(refName)) return err(404, "Not Found"); prefix = dirs.get(refName); }
      if (files.size === 0) return err(409, "Git Repository is empty.");
      const t = buildTree(prefix);
      const base = `https://api.github.com/repos/${owner}/${repo}/git`;
      const withUrl = (e) => ({ ...e, url: `${base}/${e.type === "tree" ? "trees" : "blobs"}/${e.sha}` });
      if (recursive) {
        if (state.truncateRecursive) return json(200, { sha: t.sha, url: `${base}/trees/${t.sha}`, tree: flatten(prefix).slice(0, 2).map(withUrl), truncated: true });
        return json(200, { sha: t.sha, url: `${base}/trees/${t.sha}`, tree: flatten(prefix).map(withUrl), truncated: false });
      }
      return json(200, { sha: t.sha, url: `${base}/trees/${t.sha}`, tree: t.entries.map(withUrl), truncated: false });
    }
    // blob
    if ((r = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      const hit = [...files.values()].find((b) => gitBlobSha(b) === r[1]);
      if (!hit) return err(404, "Not Found");
      if ((h["accept"] ?? "").includes("vnd.github.raw")) {
        return { status: 200, headers: baseHeaders({ "content-type": "application/vnd.github.raw; charset=utf-8" }), body: hit };
      }
      return json(200, { sha: r[1], node_id: "B_FAKE", size: hit.length, url: `https://api.github.com/repos/${owner}/${repo}/git/blobs/${r[1]}`, content: b64lines(hit), encoding: "base64" });
    }
    // contents
    if ((r = /^\/contents\/(.+)$/.exec(rest))) {
      const path = decodeURIComponent(r[1]);
      if (method === "GET") {
        const refQ = url.searchParams.get("ref");
        if (refQ && refQ !== branch) return err(404, "No commit found for the ref " + refQ);
        const accept = h["accept"] ?? "";
        const buf = files.get(path);
        if (!buf) {
          const kids = buildTree(path + "/").entries;
          if (kids.length === 0) return err(404, "Not Found");
          const list = kids.map((e) => ({ type: e.type === "tree" ? "dir" : "file", name: e.path, path: `${path}/${e.path}`, sha: e.sha, size: e.size ?? 0 }));
          return json(200, accept.includes("object") ? { type: "dir", entries: list, path } : list);
        }
        if (accept.includes("raw")) return { status: 200, headers: baseHeaders({ "content-type": "application/vnd.github.raw; charset=utf-8" }), body: buf };
        if (buf.length > 1_000_000) {
          if (accept.includes("object") && !state.objectUnsupported) return json(200, fileObject(path, buf, false));
          return json(403, { message: "This API returns blobs up to 1 MB in size. The requested blob is too large to fetch via the API, but you can use the Git Data API to request blobs up to 100 MB in size.", errors: [{ resource: "Blob", field: "data", code: "too_large" }] });
        }
        return json(200, fileObject(path, buf, true));
      }
      if (method === "PUT") {
        if (state.readOnly) return err(403, "Resource not accessible by personal access token");
        let body;
        try { body = JSON.parse(req.postData() ?? ""); } catch { return err(400, "Problems parsing JSON"); }
        if (typeof body.message !== "string" || !body.message) return err(422, "Invalid request.\n\n\"message\" wasn't supplied.");
        if (typeof body.content !== "string" || !/^[A-Za-z0-9+/=\s]*$/.test(body.content)) return err(422, "content is not valid Base64");
        if (body.branch && body.branch !== branch) return err(404, "Branch " + body.branch + " not found");
        if (state.putConflictOnce > 0) { state.putConflictOnce--; return err(409, `${branch} is at ${"0".repeat(40)} but expected ${"1".repeat(40)}`); }
        const existing = files.get(path);
        if (existing) {
          if (!body.sha) return err(422, "Invalid request.\n\n\"sha\" wasn't supplied.");
          if (body.sha !== gitBlobSha(existing)) return err(409, `${path} does not match ${body.sha}`);
        } else if (body.sha) {
          return err(422, "Invalid request.\n\n\"sha\" wasn't supplied correctly."); // 없는 파일에 sha를 준 경우
        }
        const buf = Buffer.from(body.content, "base64");
        files.set(path, buf);
        const commitSha = sha1("commit", String(commits.length), body.message);
        commits.push({ sha: commitSha, message: body.message, path, created: !existing });
        return json(existing ? 200 : 201, {
          content: { ...fileObject(path, buf, false), content: undefined, encoding: undefined },
          commit: { sha: commitSha, message: body.message, author: { name: "fake", email: "fake@example.invalid" }, html_url: `https://github.com/${owner}/${repo}/commit/${commitSha}` },
        });
      }
    }
    return err(404, "Not Found");
  }

  /** context.route("https://api.github.com/**", fake.handle) */
  async function handle(route) {
    const req = route.request();
    const isPreflight = req.method() === "OPTIONS";
    if (!isPreflight) state.requests.push({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() });
    if (state.offline) return route.abort("internetdisconnected");
    state.inflight++; state.maxInflight = Math.max(state.maxInflight, state.inflight);
    try {
      if (state.delayMs) await new Promise((ok) => setTimeout(ok, state.delayMs));
      const res = await respond(req);
      await route.fulfill(res);
    } finally { state.inflight--; }
  }

  return {
    token, owner, repo, branch, files, commits, state, handle, setFile, shaOf,
    /** 요청 기록 중 api 요청 수 (OPTIONS 제외) */
    count: (re) => state.requests.filter((q) => !re || re.test(q.method + " " + new URL(q.url).pathname)).length,
    resetLog: () => { state.requests.length = 0; state.maxInflight = 0; },
  };
}
