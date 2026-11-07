# 0단계 기술 검증 (spike)

본 개발 전에 핵심 기술이 되는지 확인한 시험 코드입니다. 결과는 [../docs/DECISIONS.md](../docs/DECISIONS.md)에 있습니다.

```bash
cd spike
npm install
PHYSIKLAR=/path/to/physiklar node build.mjs   # out/ 에 인쇄용 HTML 생성 (Physiklar 원고를 읽기만 함)
node pdf.mjs book-a4 book-bleed book-marks      # out/*.pdf (A4, A4+도련 216×303, 재단선)
node live-test.mjs                              # 브라우저 안 변환·조판 시간 측정
```

- `out/`은 커밋하지 않습니다. 비공개 Physiklar 원고가 들어 있기 때문입니다.
- Playwright는 전역 설치본을 씁니다.
