## Next.js
- 비밀값은 서버 코드(`server-only` 모듈·route handler·server action)에서만 읽는다. 브라우저에 가는 환경 변수는 `NEXT_PUBLIC_*` 뿐이다. {{judge}}
- 비밀값이나 그것으로 만든 값을 클라이언트 컴포넌트(`"use client"`)에 props 로 넘기지 않는다. {{judge}}
- 로그인·주인 검사는 middleware 에만 두지 않고 route handler·server action 안에서도 한다. {{judge}} {{kind:backend|auth}}
- `dangerouslySetInnerHTML` 은 저장소에 하나 둔 정화 함수(DOMPurify 등)를 거쳐서만 쓴다. {{judge}}
