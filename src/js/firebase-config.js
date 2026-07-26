import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    initializeAppCheck,
    ReCaptchaV3Provider,
    ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyC31TiRfm5yMKfMGDc8eLAUJXLS2BoldCQ",
    authDomain: "dynamis-web-platform-server.firebaseapp.com",
    projectId: "dynamis-web-platform-server",
    storageBucket: "dynamis-web-platform-server.firebasestorage.app",
    messagingSenderId: "337456639728",
    appId: "1:337456639728:web:cff8a4f7f54ba4700d5c35"
};

export const app = initializeApp(firebaseConfig);

// ─────────────────────────────────────────────────────────────────────────────
// App Check
//
// [로그인 시 auth/internal-error 가 나던 원인]
// Firebase Authentication에 App Check 적용(enforce)이 켜져 있으면 로그인 요청에
// 유효한 App Check 토큰이 함께 실려야 한다. 토큰이 없거나 유효하지 않은 요청은
// 서버가 거절하고, Auth SDK는 그 응답을 해석하지 못해 뭉뚱그린
// 'auth/internal-error'로 던진다. 즉 이 에러 코드는 "로그인 로직이 틀렸다"는
// 뜻이 아니라 대부분 App Check 문제다.
//
// 여기서 고친 것 두 가지:
//
//  1) 초기화 순서. 예전에는 getAuth(app)를 먼저 부르고 그다음에 App Check를
//     초기화했다. 그러면 App Check가 준비되기 전에 나가는 인증 요청에는 토큰이
//     붙지 않는다. Firebase 문서대로 initializeApp 직후, 다른 서비스보다 먼저
//     초기화하도록 옮겼다.
//
//  2) 프로바이더 종류. README와 개인정보 처리방침에는 이 프로젝트가 reCAPTCHA
//     "Enterprise"를 쓴다고 적혀 있는데, 코드는 ReCaptchaV3Provider를 쓰고 있었다.
//     Enterprise 키를 v3 프로바이더에 넘기면 토큰 발급 자체가 실패한다.
//     콘솔에 등록된 키가 실제로는 reCAPTCHA v3라면 아래 상수만 'v3'로 되돌리면 된다.
const APP_CHECK_SITE_KEY = "6LfYjjEtAAAAAKG2hFqqY0hazDsV8QoA8xmG_iYL";
const APP_CHECK_PROVIDER_TYPE = 'enterprise'; // 'enterprise' | 'v3'

// localhost에서는 reCAPTCHA가 실제 토큰을 내주지 않아 개발 중에는 로그인이 항상
// 막힌다. 디버그 토큰을 켜두면 브라우저 콘솔에 출력되는 토큰을
// Firebase 콘솔 > App Check > 앱 > "디버그 토큰 관리"에 등록해 로컬에서도
// 로그인할 수 있다. (배포 도메인은 이 분기를 타지 않으므로 보안 영향이 없다.)
const isLocalhost = ['localhost', '127.0.0.1', '::1', ''].includes(window.location.hostname);
if (isLocalhost) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// App Check 초기화가 예외를 던지면 이 모듈의 평가 자체가 중단되어 아래 auth/db
// export가 아예 만들어지지 않는다. 그러면 로그인은 물론 사이트 전체가 죽으므로,
// 실패해도 앱은 뜨도록 감싼다.
export let appCheckInitialized = false;
try {
    initializeAppCheck(app, {
        provider: APP_CHECK_PROVIDER_TYPE === 'enterprise'
            ? new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY)
            : new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });
    appCheckInitialized = true;
} catch (err) {
    console.error(
        '[App Check] 초기화 실패 — App Check 적용이 켜져 있다면 로그인이 auth/internal-error로 실패합니다.\n' +
        `현재 설정: provider=${APP_CHECK_PROVIDER_TYPE}, hostname=${window.location.hostname}\n` +
        '확인할 것: (1) 사이트 키 종류가 위 provider 설정과 일치하는지 ' +
        '(2) 현재 도메인이 reCAPTCHA 키에 등록되어 있는지',
        err
    );
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

export const db = getFirestore(app);
