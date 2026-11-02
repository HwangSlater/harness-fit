<div align="center">

# harness-fit

### Find the skills, hooks and rules your project actually needs.

Claude Code 를 처음 쓸 때, 뭘 깔아야 할지 고민하지 마세요.<br>
저장소를 읽고, 내 프로젝트에 맞는 스킬·훅·규칙을 한 화면에서 골라 설치해 줘요.<br>
<sub>하네스(harness) = Claude 가 일하는 틀이 되는 스킬·훅·규칙 묶음. 그걸 내 프로젝트에 맞춰(fit) 줘요.</sub>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](#claude-code-에서-쓰기)
![Skills](https://img.shields.io/badge/skills-81%20from%2033%20repos%20%E2%98%85%E2%89%A51k-7b61ff.svg)
![Languages](https://img.shields.io/badge/UI-KO%20%C2%B7%20EN-555.svg)
[![Local first](https://img.shields.io/badge/runs-locally-555.svg)](#내-데이터는-내-컴퓨터에)

**한국어** · [English](README.en.md)

<img src="docs/images/overview-ko.png" alt="harness-fit 고르기 화면" width="760">

</div>

---

## 스킬, 훅, CLAUDE.md… 뭘 깔아야 하죠?

Claude Code 를 깔고 나면 이런 말이 쏟아져요.

- GitHub 에 스킬 저장소가 수십 개인데, **내 프로젝트엔 뭐가 맞지?**
- 많이 깔면 좋을 줄 알았는데, **대화마다 토큰을 먹는다고?**
- `git add .` 하지 말라, main 에 바로 커밋하지 말라… **이걸 매번 말로 해야 해?**

**harness-fit** 은 저장소를 읽어서(스택·팀 규모·브랜치) 맞는 조합을 미리 골라 둬요. 그대로 「이대로 적용」 한 번이면 끝이고, 바꾸고 싶은 것만 눌러서 바꾸면 돼요.

## 바로 시작하기

```bash
npx github:HwangSlater/harness-fit
```

지금 폴더의 저장소를 읽고 브라우저에 고르기 화면이 열려요.

## Claude Code 에서 쓰기

한 번만 설치하세요.

```
/plugin marketplace add HwangSlater/harness-fit
/plugin install harness-fit@harness-fit
```

그다음 프로젝트에서

```
/harness-fit:setup
```

적용이 끝나면 Claude 가 결과를 정리하고, 남은 일(직접 설치할 스킬, 화면에 적어 둔 요청)을 이어서 해 줘요.

| 명령 | 하는 일 |
| --- | --- |
| `/harness-fit:setup` | 고르기 화면 열기 |
| `/harness-fit:setup auto` | 화면 없이 추천만 보고 적용(원격·SSH 환경) |
| `/harness-fit:setup undo` | 마지막 적용 되돌리기 |

## 화면에서 하는 일

<div align="center">
<img src="docs/images/journey-ko.png" alt="개발 단계별 스킬" width="760">
</div>

1. **얼마나 챙길까요?** 가볍게 · 혼자 빠르게 · 팀 협업 · 꼼꼼하게 중 하나. 스택에 맞는 스킬(React, Supabase, GitHub Actions…)은 자동으로 더해져요.
2. **개발하면서 이렇게 도와줘요.** 기획 → 설계 → 만들기 → 테스트 → 리뷰 → 배포, 단계마다 어떤 스킬이 붙는지 한눈에. 카드를 누르면 빠지고, 「+ 더하기」로 여러 개를 골라 넣어요.
3. **이런 실수를 막아요.** 「`git add .` 로 전부 올리면 → 바꾼 파일만 골라 올리게 해요」처럼, 무엇을 막는지 예시로 보여 줘요.
4. **브랜치는 어떻게 쓸까요?** GitHub Flow · Git Flow · 트렁크 기반 · 정하지 않음. 고르면 관련 검사도 같이 맞춰져요.
5. **CLAUDE.md 에 들어갈 약속.** 실제로 들어갈 문장을 미리 볼 수 있어요.
6. **더 바라는 게 있나요?** 「커밋 메시지는 한국어로 써 줘」처럼 적어 두면 적용 뒤 Claude 가 반영해요.
7. **적용하면 생기는 것.** 「이대로 적용」을 누르면 무엇이 어디에 들어가는지 마지막으로 보여 주고, 확인을 눌러야 진행해요.

<div align="center">
<img src="docs/images/confirm-ko.png" alt="적용 전 최종 확인" width="760">
</div>

## 무엇이 어디에 들어가나요?

| 무엇 | 들어가는 곳 | 하는 일 |
| --- | --- | --- |
| 스킬 | `.claude/skills/<이름>/` | Claude 가 필요할 때만 꺼내 읽는 작업 방법. 원래 저장소에서 고정된 버전을 받아요. |
| 자동 검사(훅) | `.claude/harness.json` | 검사 프로그램은 이 플러그인이에요. 파일엔 어떤 검사를 켤지만 적혀요. Claude 가 명령을 실행하거나 파일을 쓰기 직전에 검사해요. |
| 약속 | `CLAUDE.md` 의 표시된 구역 | Claude 가 대화마다 읽어요. 원래 적힌 내용은 그대로 둬요. |
| 팀원 설치 안내 | `.claude/settings.json` | 팀원이 저장소를 열면 이 플러그인(버전 고정)을 깔라고 안내해요. |
| 요청 메모 | `.claude/harness-request.md` | 화면에 적은 요청. Claude 가 읽고 반영해요. |
| 백업 | `.claude/harness-backup/` | 바뀌는 파일의 원래 모습. 되돌릴 때 써요. |

## 막아 주는 실수 (훅 11개)

판단이 필요 없는 규칙은 글이 아니라 검사로 막아요. 평소엔 토큰을 쓰지 않고, 어길 때만 한 줄 안내해요.

| 검사 | 이렇게 하면 → |
| --- | --- |
| 비밀값 차단 | API 키를 코드에 적거나 커밋하면 막아요 |
| .env·키 파일 보호 | `.env`·인증서·SSH 키 파일에 쓰지 않아요 |
| 위험 명령 차단 | `rm -rf ~`, `curl … \| sh`, 커밋 안 한 변경이 있을 때 `reset --hard` |
| 명령줄 비밀번호 금지 | `mysql -p비밀번호` 같은 명령 |
| git add 전체 금지 | `git add .` 대신 바꾼 파일만 |
| 보호 브랜치 | main 에 바로 커밋·강제 push |
| 커밋 메시지 형식 | `feat:` / `fix:` 형식, 제목 72자 이하 |
| 브랜치 이름 규칙 | `feature/…`·`fix/…` 로 시작 |
| 검사 건너뛰기 금지 | `--no-verify` |
| 큰 새 파일 막기 | 400줄 넘는 새 파일 |
| GitHub 은 gh 로 | GitHub 페이지를 통째로 긁지 않고 `gh` 로 필요한 것만 |

플러그인을 깔아도 `.claude/harness.json` 이 없는 프로젝트에서는 아무것도 막지 않아요.

## 토큰은 얼마나 드나요?

훅은 0 이에요. 스킬은 평소 이름과 한 줄 설명만, 쓸 때 본문을 읽어요. 아래는 Next.js · TypeScript · Supabase 예시 저장소에서 잰 값이에요.

| 조합 | 스킬 · 훅 | 매 대화에 드는 양 |
| --- | --- | --- |
| 가볍게 | 0 · 4 | 약 90 토큰 (0.0%) |
| 혼자 빠르게 | 9 · 5 | 약 930 토큰 (0.5%) |
| 팀 협업 | 13 · 10 | 약 1,400 토큰 (0.7%) |
| 꼼꼼하게 | 17 · 11 | 약 1,770 토큰 (0.9%) |

괄호는 Claude 가 한 번에 기억하는 양(20만 토큰) 중 차지하는 비율이에요.

## 스킬은 어디서 왔나요?

- GitHub star 1,000 이상, 최근 6개월 안에 업데이트된 저장소 33곳에서 고른 81개예요(`catalog/catalog.json`).
- 저장해 둔 목록은 금방 낡아요. 그래서 화면을 열 때마다 같은 검색어로 **목록 기준일 이후 새로 뜬 저장소**를 다시 찾아 따로 보여 줘요. 검증 전이라 바로 설치하지 않고, 고르면 적용 뒤 Claude 가 내용을 살펴봐요.
- 스킬마다 출처 · 라이선스 · 고정한 커밋 · 들어 있는 실행 파일을 「자세히」에서 보여 줘요.
- MIT · Apache-2.0 처럼 복사가 허용된 라이선스만 파일로 설치해요. 나머지는 원래 저장소의 설치 방법을 안내해요.

스킬은 각 저장소 작성자의 것이에요. 설치한 폴더의 `.harness-source.json` 에 출처를 남겨요.

## 되돌리기

```
/harness-fit:setup undo
```

또는 `npx github:HwangSlater/harness-fit --undo`. 마지막 적용 전 상태로 돌아가요.

## 내 데이터는 내 컴퓨터에

고르기 화면은 내 컴퓨터(`127.0.0.1`)에서만 열려요. 밖으로 나가는 요청은 스킬 파일 받기와 새 저장소 찾기(GitHub)뿐이에요. 코드나 파일 내용은 어디에도 보내지 않아요.

## 라이선스

[MIT](LICENSE) © [HwangSlater](https://github.com/HwangSlater)
