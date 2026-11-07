// 저장 모듈의 오류. 사용자에게 보일 문장은 모두 한국어이며, GitHub 응답 본문은 싣지 않는다(토큰 반사 방지).

/** 일반 저장 오류. status: HTTP 상태(없을 수 있음), kind: auth|forbidden|ratelimit|notfound|network|server|path|toolarge|other */
export class StorageError extends Error {
  constructor(message, { status, kind = "other" } = {}) {
    super(message);
    this.name = "StorageError";
    this.status = status;
    this.kind = kind;
  }
}

/** 원격 파일이 먼저 바뀌어 저장할 수 없음. remote: 지금 원격에 있는 내용 */
export class ConflictError extends Error {
  constructor(message, remote) {
    super(message);
    this.name = "ConflictError";
    this.remote = remote;
  }
}

export function networkError(timedOut = false) {
  return new StorageError(
    timedOut
      ? "GitHub 응답이 너무 늦습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
      : "GitHub에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    { kind: "network" },
  );
}

/** 기다려야 할 시간을 사람이 읽는 말로 */
function waitText(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "잠시 뒤";
  if (sec < 90) return `약 ${Math.ceil(sec)}초 뒤`;
  return `약 ${Math.ceil(sec / 60)}분 뒤`;
}

/** HTTP 상태와 한도 머리글만 보고 한국어 오류를 만든다. 응답 본문은 읽지 않는다. what: 대상(경로 등) */
export function httpError(status, headers, what) {
  const h = (k) => (headers && typeof headers.get === "function" ? headers.get(k) : null);
  const target = what ? `(${what}) ` : "";
  if (status === 401) {
    return new StorageError("GitHub 토큰이 올바르지 않거나 만료되었습니다. 토큰을 다시 입력해 주세요.", { status, kind: "auth" });
  }
  const remaining = h("x-ratelimit-remaining");
  const retryAfter = h("retry-after");
  if (status === 429 || (status === 403 && (remaining === "0" || retryAfter))) {
    let sec = NaN;
    if (retryAfter && Number.isFinite(Number(retryAfter))) sec = Number(retryAfter);
    else if (h("x-ratelimit-reset") && Number.isFinite(Number(h("x-ratelimit-reset")))) sec = Number(h("x-ratelimit-reset")) - Date.now() / 1000;
    return new StorageError(`GitHub 요청 한도를 넘었습니다. ${waitText(sec)}에 다시 시도해 주세요.`, { status, kind: "ratelimit" });
  }
  if (status === 403) {
    return new StorageError(
      `${target}이 저장소에 접근할 권한이 없습니다. 토큰이 이 저장소의 Contents 읽기·쓰기 권한을 가지고 있는지 확인해 주세요.`,
      { status, kind: "forbidden" },
    );
  }
  if (status === 404) {
    return new StorageError(
      `${target}저장소나 파일을 찾을 수 없습니다. 저장소 이름, 브랜치, 파일 경로를 확인하고 토큰이 이 저장소에 접근할 수 있는지 확인해 주세요.`,
      { status, kind: "notfound" },
    );
  }
  if (status === 409) {
    return new StorageError("GitHub에서 요청이 서로 부딪혔습니다. 잠시 뒤에 다시 시도해 주세요.", { status, kind: "other" });
  }
  if (status === 413) {
    return new StorageError("파일이 너무 커서 GitHub가 받지 않습니다.", { status, kind: "toolarge" });
  }
  if (status === 422) {
    return new StorageError("GitHub가 이 요청을 받아들이지 않았습니다(내용이나 경로가 올바르지 않습니다).", { status, kind: "other" });
  }
  if (status >= 500) {
    return new StorageError(`GitHub 서버에 문제가 있습니다(상태 ${status}). 잠시 뒤에 다시 시도해 주세요.`, { status, kind: "server" });
  }
  return new StorageError(`GitHub 요청이 실패했습니다(상태 ${status}).`, { status, kind: "other" });
}
