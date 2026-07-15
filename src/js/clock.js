import { db, auth as firebaseAuth } from './firebase-config.js';
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 컴퓨터 시계와 서버 시계의 차이를 측정한다.
// 이벤트 마감 타이머의 신뢰성을 위해, 오차가 크면 사용자에게 경고하고
// 이벤트 작성을 막는다. (마감 후 열람 차단 자체는 서버 규칙이 request.time으로
// 판정하므로 시계 조작으로 우회할 수 없다. 이 검사는 UX 보조 + 쓰기 방어용.)

const MAX_OFFSET_MS = 20 * 60 * 1000; // 20분

// offsetMs = 서버시각 - 로컬시각. null이면 아직 측정 전/측정 불가.
let offsetMs = null;
let offsetKnown = false;

export function isClockOutOfSync() {
    return offsetKnown && Math.abs(offsetMs) > MAX_OFFSET_MS;
}

export function getClockOffsetMs() {
    return offsetMs;
}

// 서버 시각 기준 현재 시각(추정치). 측정 전이면 로컬 시각.
export function serverNow() {
    return Date.now() + (offsetKnown ? offsetMs : 0);
}

function showClockBanner() {
    const banner = document.getElementById('clock-warning-banner');
    if (!banner) return;
    const minutes = Math.round(Math.abs(offsetMs) / 60000);
    banner.textContent = `⚠️ 기기 시계가 실제 시각과 약 ${minutes}분 차이납니다. 이벤트 마감 타이머가 정확하지 않을 수 있어 이벤트 작성이 제한됩니다. 기기의 날짜/시간을 자동 설정으로 맞춰 주세요.`;
    banner.style.display = 'block';
}

function hideClockBanner() {
    const banner = document.getElementById('clock-warning-banner');
    if (banner) banner.style.display = 'none';
}

// 로그인한 사용자에 대해 serverTimestamp를 왕복시켜 오차를 측정한다.
export async function verifyClock() {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
        // 비로그인 상태에서는 쓰기가 불가하므로 검사 생략.
        offsetKnown = false;
        hideClockBanner();
        return;
    }
    try {
        const ref = doc(db, 'serverTimeCheck', uid);
        const localAtWrite = Date.now();
        await setDoc(ref, { t: serverTimestamp() });
        const snap = await getDoc(ref);
        const serverTs = snap.data()?.t;
        if (!serverTs || typeof serverTs.toMillis !== 'function') {
            offsetKnown = false;
            return;
        }
        const serverMs = serverTs.toMillis();
        // 왕복 지연의 절반 정도를 로컬 기준으로 보정 (수십 ms 수준이라 20분 임계값엔 무의미).
        const localAtRead = Date.now();
        const localMid = (localAtWrite + localAtRead) / 2;
        offsetMs = serverMs - localMid;
        offsetKnown = true;
        if (isClockOutOfSync()) {
            showClockBanner();
        } else {
            hideClockBanner();
        }
    } catch (err) {
        // 측정 실패는 치명적이지 않다. 서버 규칙이 최종 방어선.
        console.warn('[Clock] 서버 시각 확인 실패:', err?.message || err);
        offsetKnown = false;
    }
}
