// GitHub 저장 — 담당: E. 약속: docs/INTERFACES.md 9절. 원고 문법: docs/FORMAT.md
// 공개 함수의 이름과 인자는 약속이다. 덧붙인 것은 아래 "덧붙임" 표시.
export { ConflictError, StorageError } from "./errors.js";
export { createGitHubStore } from "./github.js";
export { saveToken, loadToken, clearToken } from "./token.js";
export { saveDraft, loadDraft, clearDraft } from "./drafts.js";
// 덧붙임
export { listDrafts } from "./drafts.js";
export { resolveRepoPath, isRepoPath } from "./paths.js";
