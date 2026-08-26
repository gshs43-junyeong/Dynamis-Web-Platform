// 캐싱된 목록 API를 주기적으로 폴링하는 공용 헬퍼.
//
// 예전에는 notices/events/faqs/memberProfiles 네 컬렉션을 onSnapshot으로 직접
// 구독했다. 방문자 수만큼 Firestore 읽기가 그대로 과금되는 구조라, 계정/토큰
// 하나만 있으면 짧은 시간에 하루 읽기 한도(무료 티어 50,000건)를 소진시킬 수
// 있었다(DDoS 진단 참고).
//
// 이제는 /api/list-*(Vercel 서버리스 함수, Upstash Redis로 캐싱)를 폴링한다.
// 캐시 TTL 안에서는 방문자가 몇 명이든 Firestore에는 한 번만 요청이 가므로,
// 총 origin 요청 수에 실질적인 상한이 생긴다. 대신 실시간성을 최대 TTL만큼
// (기본 30초) 포기한다 — 공지판 성격상 감수할 만한 트레이드오프로 판단했다.
//
// initSystemConfiguration()이 라우트와 무관하게 앱 부팅 시 네 구독을 전부 열기
// 때문에(대시보드/검색/안읽음 배지가 항상 최신 데이터를 필요로 함), 여기서도
// 폴링은 라우트와 무관하게 계속 돈다 — 다만 그 비용은 이제 방문자 수와 무관한
// 상수(캐시 히트)로 바뀌었으므로 문제가 되지 않는다.

const DEFAULT_INTERVAL_MS = 30000;

/**
 * url을 주기적으로 GET하고 결과를 onData로 넘긴다.
 * @param {string} url
 * @param {(data: any) => void} onData
 * @param {(err: Error) => void} onError
 * @param {number} intervalMs
 * @returns {() => void} 폴링을 멈추는 함수
 */
export function pollCachedList(url, onData, onError, intervalMs = DEFAULT_INTERVAL_MS) {
    let stopped = false;
    let timer = null;

    async function tick() {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            if (!stopped) onData(data);
        } catch (err) {
            if (!stopped) onError(err);
        } finally {
            if (!stopped) timer = setTimeout(tick, intervalMs);
        }
    }

    tick();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
