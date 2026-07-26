// 안 읽은 글 표시.
//
// "내가 마지막으로 이 탭을 본 시각"만 브라우저 localStorage에 저장하고, 글의
// timestamp와 비교해 NEW를 붙인다. 읽음 상태를 서버에 저장하지 않으므로
// Firestore 읽기/쓰기가 전혀 늘지 않고, 기기 밖으로 나가는 정보도 없다.
//
// 기기 시계가 틀어져 있어도 최악의 경우 NEW가 조금 더 오래/짧게 보일 뿐이라
// clock.js의 서버 시각 보정까지 끌어올 필요는 없다.
import { on, EVENTS } from './bus.js';
import { getNotices } from './notice.js';
import { getEvents } from './event.js';
import { getFaqs } from './faq.js';

const STORAGE_PREFIX = 'dynamis:lastSeen:';
const KINDS = ['notice', 'event', 'faq'];

// 처음 방문한 사람에게 전체 글이 NEW로 도배되지 않도록, 저장된 기록이 없으면
// "최근 7일 안에 올라온 글만 새 글"로 본다.
const FIRST_VISIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// 탭을 열어둔 동안 방금 읽은 글이 눈앞에서 사라지면 혼란스러우므로,
// 화면에 그릴 때는 "이번 세션이 시작된 시점의 기준값"을 쓴다.
const sessionBaseline = new Map();

function storageKey(kind) {
    return STORAGE_PREFIX + kind;
}

function readLastSeen(kind) {
    try {
        const raw = localStorage.getItem(storageKey(kind));
        const parsed = raw ? Number(raw) : NaN;
        return Number.isFinite(parsed) ? parsed : Date.now() - FIRST_VISIT_WINDOW_MS;
    } catch {
        // 사생활 보호 모드 등으로 localStorage를 못 쓰면 NEW 표시를 조용히 포기한다.
        return Date.now();
    }
}

function baselineFor(kind) {
    if (!sessionBaseline.has(kind)) sessionBaseline.set(kind, readLastSeen(kind));
    return sessionBaseline.get(kind);
}

export function isUnread(kind, timestamp) {
    if (!Number.isFinite(timestamp)) return false;
    return timestamp > baselineFor(kind);
}

// 목록 행에 붙일 "NEW" 칩. 텍스트 노드만 쓰므로 사용자 입력이 섞일 여지가 없다.
export function createNewBadge() {
    const badge = document.createElement('span');
    badge.className = 'new-badge';
    badge.textContent = 'NEW';
    badge.title = '마지막 방문 이후 올라온 글입니다.';
    return badge;
}

function itemsFor(kind) {
    if (kind === 'notice') return getNotices();
    if (kind === 'event') return getEvents();
    if (kind === 'faq') return getFaqs();
    return [];
}

function unreadCount(kind) {
    const baseline = baselineFor(kind);
    return itemsFor(kind).filter((item) => Number.isFinite(item?.timestamp) && item.timestamp > baseline).length;
}

// 네비게이션 링크 옆의 숫자 뱃지를 갱신한다. 데스크톱/모바일 메뉴 둘 다 대상.
function renderNavBadge(kind) {
    const count = unreadCount(kind);
    ['nav-' + kind, 'mobile-nav-' + kind].forEach((id) => {
        const link = document.getElementById(id);
        if (!link) return;
        let badge = link.querySelector('.nav-unread-badge');
        if (count <= 0) {
            badge?.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'nav-unread-badge';
            link.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.title = `읽지 않은 항목 ${count}개`;
    });
}

export function refreshUnreadBadges() {
    KINDS.forEach(renderNavBadge);
}

// 해당 탭을 실제로 열어봤을 때 호출. 저장된 기준값만 현재 시각으로 올리고
// 세션 기준값(sessionBaseline)은 그대로 두어, 보고 있는 화면에서 NEW가
// 갑자기 사라지지 않게 한다. 다음 방문 때 반영된다.
export function markSectionSeen(kind) {
    if (!KINDS.includes(kind)) return;
    try {
        localStorage.setItem(storageKey(kind), String(Date.now()));
    } catch {
        /* localStorage 사용 불가 — 무시 */
    }
    renderNavBadge(kind);
}

export function initUnreadTracking() {
    KINDS.forEach(baselineFor);
    refreshUnreadBadges();

    on(EVENTS.NOTICES_CHANGED, () => renderNavBadge('notice'));
    on(EVENTS.EVENTS_CHANGED, () => renderNavBadge('event'));
    on(EVENTS.FAQS_CHANGED, () => renderNavBadge('faq'));
    on(EVENTS.ROUTE_CHANGED, (sectionId) => {
        if (KINDS.includes(sectionId)) markSectionSeen(sectionId);
    });
}
