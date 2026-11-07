// GitHub 저장 — 담당: E. 약속: docs/INTERFACES.md 9절. 원고 문법: docs/FORMAT.md
// 아래 함수의 이름과 인자는 약속이므로 바꾸지 않는다(바꿀 것이 있으면 보고서에 제안).
const todo = (n) => { throw new Error(`storage.${n}: 아직 만들지 않음`); };
export class ConflictError extends Error { constructor(message, remote) { super(message); this.name = "ConflictError"; this.remote = remote; } }
export function createGitHubStore(opts) { todo("createGitHubStore"); }
export function saveToken(token, remember) { todo("saveToken"); }
export function loadToken() { todo("loadToken"); }
export function clearToken() { todo("clearToken"); }
export async function saveDraft(path, text) { todo("saveDraft"); }
export async function loadDraft(path) { todo("loadDraft"); }
export async function clearDraft(path) { todo("clearDraft"); }
