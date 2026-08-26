// Firebase Admin SDK 초기화 (서버리스 함수 전용).
//
// [왜 필요한가]
// 지금까지의 DDoS 진단에서 확인된 가장 큰 구멍은 "브라우저가 Firestore에 직결되어
// 있어 방문자 수만큼 읽기가 과금된다"는 것이었다. 이 모듈은 그 직결을 끊기 위한
// 서버 쪽 절반이다 — Vercel 서버리스 함수가 대신 Firestore를 읽고, 그 결과를
// Redis에 캐싱해 두면(cache.js), 같은 창 안의 방문자 수백 명이 몰려도 Firestore에는
// 캐시가 비었을 때 딱 한 번만 요청이 간다.
//
// Admin SDK는 보안 규칙을 완전히 우회하므로, 이 모듈을 쓰는 쪽(list-*.js)에서
// "원래 공개 읽기(allow read: if true)였던 컬렉션만" 정확히 그 필드만 내보내야
// 한다. 여기서 실수하면 firebase.rules가 막아 온 것을 그대로 무력화하게 된다.
//
// [Blaze 불필요]
// Admin SDK로 서버에서 Firestore를 호출하는 것은 일반 Firestore API 호출과
// 동일하게 과금되며 무료(Spark) 티어 한도 안에서 그대로 동작한다. Blaze가 필요한
// 것은 Cloud Functions의 아웃바운드 네트워킹 같은 별개 기능이다.
//
// [자격 증명]
// Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성"으로 받은
// JSON에서 project_id / client_email / private_key 세 값을 Vercel 환경 변수로
// 등록해야 한다:
//   FIREBASE_ADMIN_PROJECT_ID
//   FIREBASE_ADMIN_CLIENT_EMAIL
//   FIREBASE_ADMIN_PRIVATE_KEY   (줄바꿈은 리터럴 "\n" 문자열로 이스케이프해서 저장)
//
// 클라이언트 코드(src/js/firebase-config.js)의 공개 설정과는 완전히 다른,
// 비공개 자격 증명이다 — 절대 src/ 아래나 클라이언트 번들에 넣지 말 것.

// firebase-admin v13+ 는 네임스페이스 API(admin.apps, admin.credential.cert,
// admin.firestore(app))를 걷어내고 모듈형 API로 바뀌었다. 'firebase-admin'
// 최상위 모듈이 아니라 'firebase-admin/app', 'firebase-admin/firestore'에서
// 각각 가져와야 한다.
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let app = null;

/** 이미 초기화된 Admin 앱이 있으면 재사용한다 (서버리스 함수 콜드/웜 스타트 공용). */
function getAdminApp() {
    if (app) return app;
    if (getApps().length > 0) {
        app = getApp();
        return app;
    }

    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    // Vercel 환경 변수는 개행을 그대로 담지 못하는 UI가 많아, 저장할 때 "\n" 리터럴
    // 문자열로 이스케이프해 두는 것이 관례다. 여기서 실제 개행으로 되돌린다.
    const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
            'Firebase Admin 자격 증명이 설정되지 않았습니다. ' +
            'FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY를 ' +
            'Vercel 환경 변수에 등록하세요.'
        );
    }

    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    return app;
}

function getAdminDb() {
    return getFirestore(getAdminApp());
}

module.exports = { getAdminApp, getAdminDb };
