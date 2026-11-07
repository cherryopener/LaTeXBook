// 바이트·base64·UTF-8 변환 (브라우저 기본 기능만 사용)

export function base64ToBytes(b64) {
  const bin = atob(b64); // GitHub의 줄바꿈 섞인 base64도 atob가 무시함
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Blob → base64 (큰 파일도 문자열 이어붙이기 없이 FileReader로) */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("파일을 읽지 못했습니다."));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.readAsDataURL(blob);
  });
}

export const bytesToText = (bytes) => new TextDecoder("utf-8").decode(bytes);
export const textToBlob = (text) => new Blob([new TextEncoder().encode(text)], { type: "text/plain;charset=utf-8" });
