// 홈 화면 라이브 대시보드.
//
// 지금까지 홈은 정적인 소개 글만 있어서, 실제로 동아리가 돌아가고 있다는 신호가
// 화면에 전혀 없었다. 여기서는 이미 다른 모듈이 구독 중인 공지/이벤트/FAQ/부원
// 데이터를 bus로 넘겨받아 요약해 보여준다 — Firestore 읽기는 1건도 늘지 않는다.
import { on, EVENTS } from './bus.js';
import { getNotices, openNoticeById } from './notice.js';
import { getEvents, openEventById } from './event.js';
import { getFaqs, openFaqById } from './faq.js';
import { getMembers } from './members.js';
import { serverNow } from './clock.js';
import { navigateTo } from './router.js';
import { loggedInUser } from './state.js';

const PREVIEW_COUNT = 3;
const COUNT_UP_MS = 900;

const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// 마감 타이머를 매초 갱신하기 위한 셀 목록.
let dashTimerCells = [];
let dashTimerInterval = null;

function formatCountdown(ms) {
    if (ms <= 0) return '마감';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `D-${d}`;
    if (h > 0) return `${h}시간 ${m}분`;
    if (m > 0) return `${m}분 ${s}초`;
    return `${s}초`;
}

function updateDashTimers() {
    const now = serverNow();
    dashTimerCells.forEach(({ el, deadline }) => {
        const remaining = deadline - now;
        el.textContent = formatCountdown(remaining);
        el.classList.toggle('is-urgent', remaining > 0 && remaining <= 24 * 60 * 60 * 1000);
        el.classList.toggle('is-expired', remaining <= 0);
    });
}

// 0 → target 카운트업. 숫자가 올라가는 동안 자릿수가 흔들리지 않게
// tabular-nums를 CSS에서 지정해 둔다.
function countUp(el, target) {
    if (!el) return;
    if (prefersReducedMotion() || target <= 0) {
        el.textContent = String(target);
        return;
    }
    const start = performance.now();
    function step(now) {
        const progress = Math.min((now - start) / COUNT_UP_MS, 1);
        // easeOutCubic — 처음엔 빠르게, 끝에서 부드럽게 멈춘다.
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = String(Math.round(target * eased));
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function renderStats() {
    const now = serverNow();
    const notices = getNotices();
    const events = getEvents();
    const faqs = getFaqs();
    const members = getMembers();

    const openEvents = events.filter((ev) => (ev.deadline || 0) > now).length;

    const stats = [
        {
            id: 'members',
            label: '부원',
            // users 컬렉션은 로그인해야 읽을 수 있다(보안 규칙). 비로그인 상태에서
            // 0명이라고 표시하면 거짓말이 되므로 값 자체를 감춘다.
            value: loggedInUser ? members.length : null,
            hint: loggedInUser ? null : '로그인 후 표시'
        },
        { id: 'notices', label: '누적 공지', value: notices.length },
        { id: 'events', label: '진행 중 이벤트', value: openEvents },
        { id: 'faqs', label: '등록된 질문', value: faqs.length }
    ];

    const grid = document.getElementById('dash-stat-grid');
    if (!grid) return;
    grid.innerHTML = '';

    stats.forEach((stat) => {
        const item = document.createElement('div');
        item.className = 'dash-stat';

        const value = document.createElement('div');
        value.className = 'dash-stat-value';
        if (stat.value === null) {
            value.textContent = '—';
            value.classList.add('is-hidden-value');
        } else {
            value.textContent = '0';
        }
        item.appendChild(value);

        const label = document.createElement('div');
        label.className = 'dash-stat-label';
        label.textContent = stat.hint ? `${stat.label} · ${stat.hint}` : stat.label;
        item.appendChild(label);

        grid.appendChild(item);
        if (stat.value !== null) countUp(value, stat.value);
    });
}

function emptyRow(message) {
    const empty = document.createElement('p');
    empty.className = 'dash-empty';
    empty.textContent = message;
    return empty;
}

// 목록 한 줄. 모든 텍스트는 textContent로만 넣어 저장형 XSS 여지를 남기지 않는다.
function createDashRow({ badgeText, badgeClass, title, meta, onOpen }) {
    const row = document.createElement('div');
    row.className = 'dash-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const main = document.createElement('div');
    main.className = 'dash-row-main';

    if (badgeText) {
        const badge = document.createElement('span');
        badge.className = `dash-row-badge ${badgeClass || ''}`.trim();
        badge.textContent = badgeText;
        main.appendChild(badge);
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'dash-row-title';
    titleEl.textContent = title || '(제목 없음)';
    main.appendChild(titleEl);

    row.appendChild(main);

    const metaEl = document.createElement('span');
    metaEl.className = 'dash-row-meta';
    metaEl.textContent = meta || '';
    row.appendChild(metaEl);

    row.addEventListener('click', onOpen);
    row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
        }
    });
    return { row, metaEl };
}

const TAG_SLUG_MAP = {
    '학술 자료': 'academic',
    '이벤트 안내': 'event',
    '설문 조사': 'survey',
    '기타': 'etc'
};

function renderRecentNotices() {
    const container = document.getElementById('dash-recent-notices');
    if (!container) return;
    container.innerHTML = '';

    const recent = getNotices()
        .slice()
        .sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return (b.timestamp || 0) - (a.timestamp || 0);
        })
        .slice(0, PREVIEW_COUNT);

    if (!recent.length) {
        container.appendChild(emptyRow('아직 등록된 공지가 없습니다.'));
        return;
    }

    recent.forEach((n) => {
        const { row } = createDashRow({
            badgeText: n.tag || null,
            badgeClass: `notice-tag-${TAG_SLUG_MAP[n.tag] || 'etc'}`,
            title: `${n.pinned ? '📌 ' : ''}${n.title || ''}`,
            meta: n.date || '',
            onOpen: () => {
                navigateTo('/notice');
                openNoticeById(n.docId);
            }
        });
        container.appendChild(row);
    });
}

function renderUpcomingEvents() {
    const container = document.getElementById('dash-upcoming-events');
    if (!container) return;
    container.innerHTML = '';
    dashTimerCells = [];

    const now = serverNow();
    const upcoming = getEvents()
        .filter((ev) => (ev.deadline || 0) > now)
        .sort((a, b) => (a.deadline || 0) - (b.deadline || 0))
        .slice(0, PREVIEW_COUNT);

    if (!upcoming.length) {
        container.appendChild(emptyRow('마감을 앞둔 이벤트가 없습니다.'));
        return;
    }

    upcoming.forEach((ev) => {
        const { row, metaEl } = createDashRow({
            title: ev.title || '',
            meta: formatCountdown((ev.deadline || 0) - now),
            onOpen: () => {
                navigateTo('/event');
                openEventById(ev.docId);
            }
        });
        metaEl.classList.add('dash-countdown');
        dashTimerCells.push({ el: metaEl, deadline: ev.deadline || 0 });
        container.appendChild(row);
    });
    updateDashTimers();
}

function renderLatestQuestions() {
    const container = document.getElementById('dash-latest-faqs');
    if (!container) return;
    container.innerHTML = '';

    const latest = getFaqs()
        .slice()
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, PREVIEW_COUNT);

    if (!latest.length) {
        container.appendChild(emptyRow('아직 등록된 질문이 없습니다.'));
        return;
    }

    latest.forEach((faq) => {
        const { row } = createDashRow({
            title: faq.title || faq.question || '',
            meta: faq.date || '',
            onOpen: () => {
                navigateTo('/faq');
                openFaqById(faq.docId);
            }
        });
        container.appendChild(row);
    });
}

function renderDashboard() {
    renderStats();
    renderRecentNotices();
    renderUpcomingEvents();
    renderLatestQuestions();
}

export function initDashboard() {
    if (!document.getElementById('home-dashboard')) return;

    renderDashboard();

    on(EVENTS.NOTICES_CHANGED, () => {
        renderStats();
        renderRecentNotices();
    });
    on(EVENTS.EVENTS_CHANGED, () => {
        renderStats();
        renderUpcomingEvents();
    });
    on(EVENTS.FAQS_CHANGED, () => {
        renderStats();
        renderLatestQuestions();
    });
    on(EVENTS.MEMBERS_CHANGED, renderStats);

    if (!dashTimerInterval) dashTimerInterval = setInterval(updateDashTimers, 1000);
}
