// 웹 가져오기(WebFetch) 규칙: GitHub 페이지는 gh 로 읽으면 낫다고 Claude 에게 알린다(인증·속도 제한·정확도, 토큰도 덜 든다).
// 막지 않는다(notice): gh 가 없거나 로그인하지 않은 PC 에서 막으면 GitHub 를 아예 못 읽는다(2026-11-09 사용자 결정).
export const preferGh = {
  id: 'prefer-gh',
  notice: true,
  on: 'fetch',
  check({ input, t }) {
    const url = String(input.tool_input?.url || '');
    return /^https?:\/\/(?:www\.)?github\.com(?:[/?#:]|$)/i.test(url.trim()) ? t('web.preferGh', { url }) : null;
  },
};

export default [preferGh];
