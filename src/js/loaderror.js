// 목록 구독이 실패했을 때 사용자에게 알리는 공용 배너.
//
// [왜 필요한가]
// 공지·이벤트·FAQ·부원 목록은 onSnapshot으로 실시간 구독하는데, 네 곳 모두
// 오류 콜백이 없었다. onSnapshot은 두 번째 인자로 오류 콜백을 받고, 없으면
// 실패가 조용히 삼켜진다. 그래서 구독이 거부되면 목록이 그냥 빈 화면이 되고,
// 사용자는 물론 관리자도 "글이 하나도 없는 것"과 "불러오지 못한 것"을 구분할
// 방법이 없었다.
//
// 특히 무료 티어의 하루 읽기 할당량(50,000건)이 소진되면 이 경로로 조용히
// 실패한다. 원인을 모르면 대응이 불가능하므로, 최소한 무엇이 일어났는지는
// 화면에 남긴다.

const BANNER_ID = 'data-error-banner';

// 이미 알린 대상은 다시 알리지 않는다. 네 컬렉션이 동시에 실패하면 같은 문구가
// 네 번 덮어써지는데, 사용자에게는 한 번만 보이면 충분하다.
const reported = new Set();

function messageFor(code) {
    if (code === 'resource-exhausted') {
        return '오늘 데이터 사용량 한도에 도달해 목록을 불러오지 못했습니다. 잠시 후(한국 시간 기준 오후 4~5시경 초기화) 다시 시도해 주세요.';
    }
    if (code === 'permission-denied') {
        return '목록을 불러올 권한이 없습니다. 보안 규칙이 최신 상태로 배포되었는지 확인이 필요합니다.';
    }
    if (code === 'unavailable') {
        return '서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.';
    }
    return '목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

/**
 * 목록 구독 실패를 사용자에게 알리고 콘솔에 상세를 남긴다.
 * @param {string} label 사람이 읽는 대상 이름 (예: '공지사항')
 * @param {*} err Firestore 오류 객체
 */
export function reportListLoadError(label, err) {
    const code = err?.code || '';
    // 상세(코드/원문)는 콘솔에만 남긴다 — 사용자에게는 일반화된 문구만 보여준다.
    console.warn(`[${label}] 목록 구독 실패:`, code || '', err?.message || err);

    if (reported.has(label)) return;
    reported.add(label);

    const banner = document.getElementById(BANNER_ID);
    if (!banner) return;
    banner.textContent = messageFor(code);
    banner.style.display = 'block';
}
