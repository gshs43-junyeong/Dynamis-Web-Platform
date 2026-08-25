// 컴퓨터 시계와 서버 시계의 차이를 측정한다.
// 이벤트 마감 타이머의 신뢰성을 위해, 오차가 크면 사용자에게 경고하고
// 이벤트 작성을 막는다. (마감 후 열람 차단 자체는 서버 규칙이 request.time으로
// 판정하므로 시계 조작으로 우회할 수 없다. 이 검사는 UX 보조 + 쓰기 방어용.)
//
// [왜 Firestore 쓰기를 안 쓰는가]
// 예전에는 serverTimeCheck/{uid} 문서에 serverTimestamp()를 써 넣고 되읽어서
// 서버 시각을 얻었다. 그런데 그 쓰기에는 일일 한도가 걸려 있지 않아서, 로그인한
// 계정 하나만 있으면 같은 문서를 무한히 덮어써 무료 티어의 하루 쓰기 할당량
// (20,000건)을 통째로 소진시킬 수 있었다 — 그러면 사이트 전체의 글쓰기·댓글·가입이
// 다음 날까지 마비된다(에뮬레이터로 60/60 성공 실측).
//
// 서버 시각을 알아내는 데 쓰기가 필요할 이유가 없다. 모든 HTTP 응답에는 Date
// 헤더가 붙어 있으므로, 같은 오리진에 HEAD 요청 하나만 보내면 된다. 덤으로:
//   - Firestore 읽기/쓰기 할당량을 전혀 쓰지 않는다
//   - 로그인하지 않은 방문자도 측정된다 (홈 대시보드의 "진행 중 이벤트" 집계가
//     serverNow()를 쓰는데, 예전에는 비로그인 시 기기 시계를 그대로 썼다)
// Date 헤더는 초 단위라 정밀도가 1초지만, 임계값이 20분이라 문제가 되지 않는다.

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

// 같은 오리진에 HEAD 요청을 보내 응답의 Date 헤더로 서버 시각을 얻는다.
export async function verifyClock() {
    try {
        const localAtRequest = Date.now();
        // cache: 'no-store' — 캐시된 응답의 오래된 Date를 읽으면 측정이 무의미해진다.
        const res = await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
        const dateHeader = res.headers.get('date');
        if (!dateHeader) {
            offsetKnown = false;
            return;
        }
        const serverMs = Date.parse(dateHeader);
        if (Number.isNaN(serverMs)) {
            offsetKnown = false;
            return;
        }
        // 왕복 지연의 절반 정도를 로컬 기준으로 보정 (수십 ms 수준이라 20분 임계값엔 무의미).
        const localAtResponse = Date.now();
        const localMid = (localAtRequest + localAtResponse) / 2;
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
