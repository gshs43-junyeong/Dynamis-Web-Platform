import { next } from '@vercel/functions';

// 무료(Hobby) 플랜에는 Vercel Password Protection(엣지 단 비밀번호 보호)이 없어서,
// 대신 이 Edge Middleware로 직접 HTTP Basic Auth를 건다. 요청이 정적 파일에
// 도달하기도 전에 엣지에서 막히므로, 클라이언트 JS로 만들었던 이전 게이트와 달리
// 페이지 소스/네트워크 탭 어디에도 실제 콘텐츠가 내려가지 않는다.
//
// 아이디·비밀번호는 코드에 넣지 않고 Vercel 프로젝트의 환경 변수로만 관리한다:
// Vercel 대시보드 → Settings → Environment Variables 에서
//   SITE_AUTH_USER, SITE_AUTH_PASS
// 두 값을 설정해야 한다. 둘 중 하나라도 비어 있으면 안전하게 전체 차단 상태로
// 동작한다(fail closed) — 값을 깜빡 설정하지 않아도 사이트가 무방비로 열리지 않는다.

export const config = {
    matcher: '/:path*',
};

const REALM = 'Dynamis (development)';

export default function middleware(request) {
    const expectedUser = process.env.SITE_AUTH_USER;
    const expectedPass = process.env.SITE_AUTH_PASS;

    if (!expectedUser || !expectedPass) {
        return unauthorized();
    }

    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Basic ')) {
        let decoded = '';
        try {
            decoded = atob(authHeader.slice('Basic '.length));
        } catch (e) {
            return unauthorized();
        }
        const separatorIndex = decoded.indexOf(':');
        const user = decoded.slice(0, separatorIndex);
        const pass = decoded.slice(separatorIndex + 1);
        if (user === expectedUser && pass === expectedPass) {
            return next();
        }
    }

    return unauthorized();
}

function unauthorized() {
    return new Response('인증이 필요합니다. 이 사이트는 현재 개발 중입니다.', {
        status: 401,
        headers: {
            'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
        },
    });
}
