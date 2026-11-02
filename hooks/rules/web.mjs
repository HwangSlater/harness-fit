// 웹 가져오기(WebFetch) 규칙: GitHub 페이지는 긁지 말고 gh 로 읽는다(인증·속도 제한·정확도, 토큰도 덜 든다).
export const preferGh = {
  id: 'prefer-gh',
  on: 'fetch',
  check({ input, t }) {
    const url = String(input.tool_input?.url || '');
    return /^https?:\/\/(?:www\.)?github\.com\//i.test(url) ? t('web.preferGh', { url }) : null;
  },
};

export default [preferGh];
