// 브랜치 전략 카드의 그림(GitHub 네트워크 그래프처럼 채운 점 + 굵은 선).
// 색은 갈래 이름 → CSS 토큰(tokens.css 의 --branch-*, 칠은 layout.css 의 .pic .k-*). 글자는 textContent 로만 들어간다.
import { s } from './dom.js';

// 그림 한 장: lines [갈래, 경로] · dots [갈래, x, y, 반지름?] · labels [갈래, x, y, 글, 맞춤?]
// 글이 '@merge' 면 화면 문구(flowPicMerge)로 바꾼다. 브랜치 이름(main·develop…)은 git 이름이라 번역하지 않는다.
const R = 4.5;
const ART = {
  'github-flow': {
    lines: [['main', 'M8 46H208'], ['feat', 'M40 46C52 46 52 20 66 20H128C142 20 142 46 154 46']],
    dots: [['main', 20, 46], ['main', 40, 46], ['main', 154, 46, 6], ['main', 196, 46], ['feat', 80, 20], ['feat', 112, 20]],
    labels: [['main', 8, 62, 'main'], ['feat', 78, 12, 'feature'], ['none', 154, 62, '@merge', 'middle']],
  },
  // main · release · develop · feature 네 줄. release 는 develop 에서 나와 main(v1.0)과 develop 으로 한 점에서 갈라져 들어간다.
  'git-flow': {
    lines: [
      ['main', 'M8 14H208'], ['dev', 'M8 40H208'],
      ['feat', 'M52 40C60 40 60 55 68 55H92C100 55 100 40 108 40'],
      ['rel', 'M124 40C132 40 132 27 140 27H156'], ['rel', 'M156 27C164 27 164 14 172 14'], ['rel', 'M156 27C168 27 168 40 180 40'],
    ],
    dots: [
      ['main', 20, 14], ['main', 172, 14, 6], ['main', 202, 14],
      ['dev', 30, 40], ['dev', 108, 40], ['dev', 124, 40], ['dev', 180, 40], ['dev', 202, 40],
      ['feat', 80, 55, 4], ['rel', 146, 27, 4],
    ],
    labels: [
      ['main', 8, 9, 'main'], ['main', 172, 7, 'v1.0', 'middle'], ['rel', 108, 24, 'release'],
      ['dev', 8, 53, 'develop'], ['feat', 80, 66, 'feature', 'middle'],
    ],
  },
  // main 에서 짧게 나왔다 바로 들어가는 기능 브랜치 세 개
  trunk: {
    lines: [
      ['main', 'M8 44H208'],
      ['feat', 'M30 44C38 44 38 24 46 24C54 24 54 44 62 44'],
      ['feat', 'M92 44C100 44 100 24 108 24C116 24 116 44 124 44'],
      ['feat', 'M150 44C158 44 158 24 166 24C174 24 174 44 182 44'],
    ],
    dots: [
      ['main', 16, 44], ['main', 62, 44], ['main', 78, 44], ['main', 124, 44], ['main', 138, 44], ['main', 182, 44], ['main', 200, 44],
      ['feat', 46, 24, 4], ['feat', 108, 24, 4], ['feat', 166, 24, 4],
    ],
    labels: [['main', 8, 62, 'main'], ['feat', 46, 15, 'feature', 'middle']],
  },
  none: {
    lines: [['none', 'M8 36H208']],
    dots: [24, 60, 96, 132, 168, 200].map((x) => ['none', x, 36]),
    labels: [['none', 8, 56, 'main']],
  },
};

export const flowArt = (id, t) => {
  const a = ART[id] || ART.none;
  return s('svg', { class: 'pic', viewBox: '0 0 216 68', 'aria-hidden': 'true' },
    a.lines.map(([k, d]) => s(`path.k-${k}`, { d })),
    a.dots.map(([k, cx, cy, r = R]) => s(`circle.k-${k}`, { cx, cy, r })),
    a.labels.map(([k, x, y, text, anchor]) => s(`text.k-${k}`, { x, y, 'text-anchor': anchor }, text === '@merge' ? t('flowPicMerge') : text)));
};
