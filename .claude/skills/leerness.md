---
name: leerness
description: Leerness harness commands - handoff, audit, scan secrets, encoding check, lazy detect, session close, update. Use when the user asks to load project context, verify work quality, scan secrets, check encoding, or end a session.
---

# leerness skill

## When to use
- 사용자가 프로젝트 컨텍스트를 로드해달라고 할 때
- 완료 선언 전 자기 검증을 요청할 때
- 세션을 종료하거나 인수인계를 요청할 때
- 시크릿/한글 인코딩 점검을 요청할 때
- 새 leerness 버전 적용을 요청할 때

## Commands

```bash
leerness handoff .             # 컨텍스트 로드
leerness check .               # pre-action 체크
leerness audit .               # 일관성/계획 정렬 감사
leerness scan secrets .        # 시크릿 패턴 스캔
leerness encoding check .      # UTF-8/BOM/NUL
leerness lazy detect .         # 게으름 평가
leerness memory search "key"   # 결정/이력 검색
leerness session close .       # 종료 보고 + handoff 자동 생성
leerness update --yes          # 자동 업데이트
```
