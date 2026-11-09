<div align="center">

# harness-fit

### Find the skills, hooks and rules your project actually needs.

Claude Code 를 처음 쓸 때, 뭘 깔아야 할지 고민하지 마세요.<br>
저장소를 읽고, 내 프로젝트에 맞는 스킬·훅·CLAUDE.md 지침을 단계별 화면에서 골라 설치해 줘요.<br>
<sub>하네스(harness) = Claude 가 일하는 틀이 되는 스킬·훅·지침 묶음. 그걸 내 프로젝트에 맞춰(fit) 줘요.</sub>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.139-d97757.svg)](#claude-code-에서-쓰기)
![Skills](https://img.shields.io/badge/skills-81%20from%2024%20repos%20%E2%98%85%E2%89%A51k-7b61ff.svg)
![Hooks](https://img.shields.io/badge/hooks-23-555.svg)
![Languages](https://img.shields.io/badge/UI-KO%20%C2%B7%20EN-555.svg)
[![Local first](https://img.shields.io/badge/runs-locally-555.svg)](#내-데이터는-내-컴퓨터에)

**한국어** · [English](README.en.md)

<img src="docs/images/overview-ko.png" alt="harness-fit 고르기 화면 — 1단계 조합·브랜치 전략" width="760">

</div>

---

저장소를 읽어서(스택·팀 규모·브랜치) 맞는 조합을 미리 골라 둬요. 「다음」만 눌러 확인 단계까지 가서 「이대로 적용」하면 끝이고, 바꾸고 싶은 것만 눌러서 바꾸면 돼요.

## 필요한 것

- **Claude Code v2.1.139 이상**(훅을 셸 없이 부르는 `args` 꼴이 이 버전부터 있어요). 2.1.318 에서 테스트했어요.
- Node 18 이상(훅과 고르기 화면이 Node 로 돌아요).

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

따로 설명하지 않아도 저장소(package.json, 커밋한 사람 수, 브랜치, CI 설정)를 읽고 권장 조합을 골라 둬요. 막 만든 빈 저장소처럼 읽을 게 없으면 기본 조합으로 갈지, 무엇을 만드는지(예: 「Next.js + Supabase, 3명」) 알려 줄지 먼저 물어봐요. 적용이 끝나면 Claude 가 결과를 정리하고 남은 일을 이어서 해 줘요.

| 명령 | 하는 일 |
| --- | --- |
| `/harness-fit:setup` | 고르기 화면 열기 |
| `/harness-fit:setup auto` | 화면 없이 권장 조합을 보고 적용(원격·SSH 환경) |
| `/harness-fit:setup undo` | 마지막 적용 되돌리기 |

플러그인 없이 둘러보기만 하려면 `npx github:HwangSlater/harness-fit` 를 실행하세요. 다만 훅은 플러그인으로만 돌아서, 이렇게 적용하면 설정 파일만 생기고 아무것도 막지 않아요.

## 화면에서 하는 일 (6단계)

<div align="center">
<img src="docs/images/journey-ko.png" alt="2단계 스킬 — 개발 단계별 묶음 표와 칩" width="760">
</div>

1. **얼마나 챙길까요?** 가볍게 · 혼자 빠르게 · 팀 협업 · 꼼꼼하게 중 하나와 브랜치 전략(GitHub Flow · Git Flow · 트렁크 기반 · 정하지 않음)을 골라요. 브랜치 전략마다 git 그래프 그림으로 보여 주고, 스택에 맞는 스킬은 자동으로 더해져요.
2. **어떤 스킬을 넣을까요?** 기획부터 배포까지 단계별 묶음에서 칩을 눌러 켜고 꺼요. 「자세히 보기」에서 스킬마다 무엇이 달라지는지 쉬운 한 줄과 「알아 둘 점」을 봐요.
3. **어떤 실수를 막을까요?** 훅 23개를 6개 묶음으로 보여 줘요. 「자세히 보기」에서 무엇을 차단하는지 봐요. 커밋 메시지 형식·브랜치 이름 규칙은 이 저장소 기록이 이미 그 꼴일 때만 기본으로 켜요.
4. **CLAUDE.md 에 어떤 지침을 넣을까요?** 실제로 써질 글을 미리 보여 줘요. 맨 위 「이 저장소 명령」은 저장소에서 읽은 테스트·코드 검사(lint)·빌드 명령이에요. 지침 줄을 누르면 넣을 줄 전체를 작은 창으로 봐요.
5. **더 바라는 게 있나요?** 「커밋 메시지는 한국어로 써 줘」처럼 적어 두면 적용 뒤 Claude 가 반영해요.
6. **이대로 적용할까요?** 무엇이 어디에 생기는지 보고 「이대로 적용」을 눌러요.

다시 열면 지난번 선택에서 시작해요. 단계별 자세한 설명은 [안내서 · 화면 6단계](docs/guide.ko.md#화면-6단계-자세히)에 있어요.

## 무엇이 어디에 들어가나요?

| 무엇 | 들어가는 곳 | 하는 일 |
| --- | --- | --- |
| 스킬 | `.claude/skills/<이름>/` | Claude 가 필요할 때만 꺼내 읽는 작업 방법. 원래 저장소에서 커밋 해시로 고정한 버전을 받아요. |
| 훅 | `.claude/harness.json` | 훅 프로그램은 이 플러그인이에요. 파일엔 어떤 훅을 켤지와 옵션, 지난번 선택만 적혀요. |
| 커밋 전 git 훅 | `.git/hooks/pre-commit` | 커밋하는 순간 실제로 들어가는 내용을 같은 훅으로 다시 봐요. |
| CLAUDE.md 지침 | `CLAUDE.md` 의 표시된 구역 | Claude 가 대화마다 읽어요. 원래 적힌 내용은 그대로 둬요. |
| 팀원 설치 안내 | `.claude/settings.json` | 팀원이 저장소를 열면 이 플러그인(버전 고정)을 깔라고 안내해요. |
| 요청 메모 | `.claude/harness-request.md` | 화면에 적은 요청. Claude 가 읽고 반영해요. |
| 백업 | `.claude/harness-backup/` | 바뀌는 파일의 원래 모습. 되돌릴 때 써요. |

이미 쓰는 훅·스킬·CLAUDE.md 와 겹치는 것은 넣지 않아요([어떻게 견주나요](docs/guide.ko.md#이미-있는-것과-겹칠-때)).

## 토큰은 얼마나 드나요?

스킬은 평소 이름과 한 줄 설명만, 쓸 때 본문을 읽어요. 훅은 걸렸을 때만 Claude 에게 한 줄 남짓(약 20~100 토큰)을 보내고, 늘 글을 넣는 훅은 「작업 체크리스트」 하나뿐인데 기본 꺼짐이에요([자세히](docs/guide.ko.md#훅이-쓰는-토큰)). 아래는 Next.js · TypeScript · Supabase · Vitest · GitHub Actions 예시 저장소(커밋한 사람 3명)에서 고르기 화면 오른쪽 「매 대화에 드는 양」을 그대로 옮긴 값이에요(스킬 한 줄 설명 + CLAUDE.md 지침, 한글 1자·영문 4자 = 1토큰 어림).

| 조합 | 스킬 · 훅 · 지침 | 매 대화에 드는 양 |
| --- | --- | --- |
| 가볍게 | 0 · 4 · 2 | 약 105 토큰 (0.1%) |
| 혼자 빠르게 | 9 · 7 · 4 | 약 976 토큰 (0.5%) |
| 팀 협업 (이 저장소의 권장) | 13 · 14 · 6 | 약 1,308 토큰 (0.7%) |
| 꼼꼼하게 | 16 · 16 · 6 | 약 1,529 토큰 (0.8%) |

괄호는 Claude 가 한 번에 기억하는 양(20만 토큰) 중 차지하는 비율이에요. 스킬이 너무 많으면 확인 단계에서 알려 줘요([스킬 목록 한도](docs/guide.ko.md#스킬-목록-한도)).

## 되돌리기

```
/harness-fit:setup undo
```

또는 `npx github:HwangSlater/harness-fit --undo`. 마지막 적용 전 상태로 돌아가요. 적용한 뒤 직접 고친 내용은 지우지 않고 백업 폴더에 따로 남겨요([자세히](docs/guide.ko.md#되돌리기-자세히)).

## 내 데이터는 내 컴퓨터에

고르기 화면은 내 컴퓨터(`127.0.0.1`)에서만 열리고, 데이터 요청마다 일회용 토큰을 확인해요. 밖으로 나가는 요청은 스킬 파일 받기와 새 저장소 찾기(GitHub), 그리고 origin 이 GitHub 이고 `gh` 에 로그인돼 있으면 화면을 열 때 저장소 설정 읽기(`gh api`, 읽기만)뿐이에요. 설정을 바꾸는 요청은 「GitHub 저장소 설정도 켜기」를 켰을 때만 보내요. 코드나 파일 내용은 어디에도 보내지 않아요.

## 자주 묻는 것

**내 프로젝트엔 어떤 스킬이 맞죠?**<br>
저장소를 읽어 조합을 골라 두고, 스택에 맞는 스킬(예: Next.js → React 성능 규칙, Supabase → Supabase DB 규칙)을 더해요. 나머지는 2단계 「전체 스킬 보기」에서 찾아 켤 수 있어요(훅과 같은 일을 하는 3개를 뺀 78개).

**많이 깔면 대화마다 토큰을 먹지 않나요?**<br>
매 대화에 드는 것은 스킬 이름·한 줄 설명과 CLAUDE.md 지침뿐이고, 고르는 동안 화면 오른쪽에 그 양이 보여요. 위 예시의 팀 협업은 약 1,308 토큰(0.7%)이에요.

**`git add .` 하지 마, main 에 바로 커밋하지 마… 매번 말해야 하나요?**<br>
아니요. 훅이 그 명령을 차단하고 이유를 한 줄로 알려요(git add 전체 차단·보호 브랜치). 훅이 막는 일은 CLAUDE.md 지침에 다시 적지 않아요.

## 더 알아보기

- [막아 주는 실수 — 훅 23개 표](docs/guide.ko.md#훅-23개)
- [훅 옵션 고르기](docs/guide.ko.md#훅-옵션)
- [git 커밋 전 훅(pre-commit)](docs/guide.ko.md#git-커밋-전-훅)
- [잘못 막힌 줄 하나만 넘기기(`lint:allow`)](docs/guide.ko.md#줄-하나만-넘기기)
- [훅이 오류로 멈추면](docs/guide.ko.md#훅이-오류로-멈추면)
- [팀원과 함께 쓰기](docs/guide.ko.md#팀원과-함께-쓰기)
- [GitHub 저장소 설정(원할 때만)](docs/guide.ko.md#github-저장소-설정)
- [스킬은 어디서 왔나요](docs/guide.ko.md#스킬은-어디서-왔나요)
- [이 저장소를 고칠 때(테스트 명령)](docs/guide.ko.md#이-저장소를-고칠-때)

## 라이선스

[MIT](LICENSE) © [HwangSlater](https://github.com/HwangSlater)
