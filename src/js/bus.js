// 아주 작은 발행/구독 버스.
//
// 공지·이벤트·FAQ·부원 데이터는 각 모듈이 onSnapshot으로 이미 구독하고 있다.
// 홈 대시보드나 통합 검색처럼 "그 데이터를 읽기만 하는" 새 기능이 Firestore를
// 다시 구독하면 읽기 횟수(=과금)가 그대로 배로 늘기 때문에, 기존 구독이 갱신될 때
// 여기로 알려주고 소비자들은 그 신호만 받아 다시 그린다. 네트워크 요청은 0이다.
const listeners = new Map();

export function on(eventName, handler) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(handler);
    return () => listeners.get(eventName)?.delete(handler);
}

export function emit(eventName, payload) {
    listeners.get(eventName)?.forEach((handler) => {
        try {
            handler(payload);
        } catch (err) {
            console.warn(`[bus] "${eventName}" 처리 중 오류:`, err?.message || err);
        }
    });
}

export const EVENTS = {
    NOTICES_CHANGED: 'notices:changed',
    EVENTS_CHANGED: 'events:changed',
    FAQS_CHANGED: 'faqs:changed',
    MEMBERS_CHANGED: 'members:changed',
    ROUTE_CHANGED: 'route:changed'
};
