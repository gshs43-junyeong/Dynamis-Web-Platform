// 통합 검색 (커맨드 팔레트).
//
// 공지·이벤트·FAQ·부원·페이지를 한 곳에서 찾는다. 검색 대상은 각 모듈이 이미
// onSnapshot으로 들고 있는 메모리 상의 배열이므로, 타이핑할 때마다 Firestore로
// 나가는 요청은 없다. 즉 검색 때문에 늘어나는 읽기 비용은 0이다.
//
// 열기:  ⌘K / Ctrl+K, 또는 입력창 밖에서 "/" , 헤더의 검색 버튼
// 조작:  ↑ ↓ 이동, Enter 열기, Esc 닫기
import { getNotices, openNoticeById } from './notice.js';
import { getEvents, openEventById } from './event.js';
import { getFaqs, openFaqById } from './faq.js';
import { getMembers } from './members.js';
import { navigateTo } from './router.js';
import { formatAuthorBatchName, formatUserIdentityLabel, getRoleLabel } from './utils.js';
import { serverNow } from './clock.js';

const MAX_PER_GROUP = 5;
const SNIPPET_RADIUS = 40;

let results = [];
let activeIndex = 0;
let isOpen = false;
// 팔레트를 열기 직전에 포커스가 있던 요소. 닫을 때 되돌려 준다(접근성).
let lastFocusedEl = null;

const PAGES = [
    { title: '홈', subtitle: '동아리 소개와 현황', path: '/home' },
    { title: '공지사항', subtitle: '공지 목록', path: '/notice' },
    { title: '이벤트', subtitle: '행사 안내와 마감 타이머', path: '/event' },
    { title: 'FAQ', subtitle: '자주 묻는 질문과 질의응답', path: '/faq' },
    { title: '부원 목록', subtitle: '등급별 부원 소개', path: '/members' },
    { title: '개인정보 처리방침', subtitle: '법적 고지', path: '/privacy' },
    { title: '커뮤니티 이용 가이드라인', subtitle: '이용 규칙', path: '/guidelines' }
];

function normalize(str) {
    return (str || '').toString().toLowerCase();
}

// 본문에서 검색어 주변만 잘라 미리보기로 보여준다.
function buildSnippet(text, term) {
    const raw = (text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return '';
    const idx = normalize(raw).indexOf(term);
    if (idx < 0) return raw.slice(0, SNIPPET_RADIUS * 2);
    const start = Math.max(0, idx - SNIPPET_RADIUS);
    const end = Math.min(raw.length, idx + term.length + SNIPPET_RADIUS);
    return `${start > 0 ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}`;
}

function collectResults(term) {
    if (!term) return [];
    const found = [];

    PAGES.filter((p) => normalize(p.title).includes(term) || normalize(p.subtitle).includes(term))
        .slice(0, MAX_PER_GROUP)
        .forEach((p) => found.push({
            group: '바로가기',
            title: p.title,
            subtitle: p.subtitle,
            open: () => navigateTo(p.path)
        }));

    getNotices()
        .filter((n) => normalize(n.title).includes(term) || normalize(n.content).includes(term) || normalize(n.tag).includes(term))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, MAX_PER_GROUP)
        .forEach((n) => found.push({
            group: '공지사항',
            title: n.title || '(제목 없음)',
            subtitle: buildSnippet(n.content, term),
            meta: [n.tag, n.date].filter(Boolean).join(' · '),
            open: () => { navigateTo('/notice'); openNoticeById(n.docId); }
        }));

    const now = serverNow();
    getEvents()
        .filter((ev) => normalize(ev.title).includes(term) || normalize(ev.content).includes(term))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, MAX_PER_GROUP)
        .forEach((ev) => found.push({
            group: '이벤트',
            title: ev.title || '(제목 없음)',
            // 마감된 이벤트의 본문은 작성자/관리자만 열람할 수 있으므로 미리보기도 감춘다.
            subtitle: (ev.deadline || 0) > now ? buildSnippet(ev.content, term) : '마감된 이벤트',
            meta: ev.date || '',
            open: () => { navigateTo('/event'); openEventById(ev.docId); }
        }));

    getFaqs()
        .filter((f) => normalize(f.title).includes(term) || normalize(f.content).includes(term) || normalize(f.question).includes(term))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, MAX_PER_GROUP)
        .forEach((f) => found.push({
            group: 'FAQ',
            title: f.title || f.question || '(제목 없음)',
            subtitle: buildSnippet(f.content || f.question, term),
            meta: [formatAuthorBatchName(f), f.date].filter(Boolean).join(' · '),
            open: () => { navigateTo('/faq'); openFaqById(f.docId); }
        }));

    // 부원 공개 프로필(memberProfiles)은 비로그인도 읽을 수 있어 로그인 없이 검색된다.
    getMembers()
        .filter((u) => normalize(formatUserIdentityLabel(u)).includes(term) || normalize(u.name).includes(term) || normalize(u.batch).includes(term))
        .slice(0, MAX_PER_GROUP)
        .forEach((u) => found.push({
            group: '부원',
            title: formatUserIdentityLabel(u),
            subtitle: getRoleLabel(u.role),
            open: () => navigateTo('/members')
        }));

    return found;
}

// 검색어와 일치하는 구간만 <mark>로 강조한다. 사용자 문자열은 전부 텍스트 노드로
// 넣으므로 HTML이 해석될 여지가 없다.
function appendHighlighted(parent, text, term) {
    const source = text || '';
    if (!term) {
        parent.appendChild(document.createTextNode(source));
        return;
    }
    const lower = normalize(source);
    let cursor = 0;
    let idx = lower.indexOf(term);
    while (idx >= 0) {
        if (idx > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = source.slice(idx, idx + term.length);
        parent.appendChild(mark);
        cursor = idx + term.length;
        idx = lower.indexOf(term, cursor);
    }
    if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
}

function renderResults(term) {
    const list = document.getElementById('search-results');
    const hint = document.getElementById('search-empty');
    if (!list) return;
    list.innerHTML = '';

    if (!term) {
        if (hint) {
            hint.textContent = '공지, 이벤트, FAQ, 부원, 페이지를 한 번에 찾을 수 있습니다.';
            hint.style.display = 'block';
        }
        return;
    }
    if (!results.length) {
        if (hint) {
            hint.textContent = `"${term}"에 대한 검색 결과가 없습니다.`;
            hint.style.display = 'block';
        }
        return;
    }
    if (hint) hint.style.display = 'none';

    let lastGroup = null;
    results.forEach((item, index) => {
        if (item.group !== lastGroup) {
            const heading = document.createElement('div');
            heading.className = 'search-group';
            heading.textContent = item.group;
            list.appendChild(heading);
            lastGroup = item.group;
        }

        const row = document.createElement('div');
        row.className = 'search-item' + (index === activeIndex ? ' active' : '');
        row.dataset.index = String(index);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');

        const title = document.createElement('div');
        title.className = 'search-item-title';
        appendHighlighted(title, item.title, term);
        row.appendChild(title);

        if (item.subtitle) {
            const sub = document.createElement('div');
            sub.className = 'search-item-sub';
            appendHighlighted(sub, item.subtitle, term);
            row.appendChild(sub);
        }
        if (item.meta) {
            const meta = document.createElement('div');
            meta.className = 'search-item-meta';
            meta.textContent = item.meta;
            row.appendChild(meta);
        }

        row.addEventListener('click', () => activate(index));
        row.addEventListener('mousemove', () => setActive(index));
        list.appendChild(row);
    });
}

function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    const list = document.getElementById('search-results');
    list?.querySelectorAll('.search-item').forEach((el) => {
        const isActive = Number(el.dataset.index) === activeIndex;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) el.scrollIntoView({ block: 'nearest' });
    });
}

function activate(index) {
    const item = results[index];
    if (!item) return;
    closeSearch();
    item.open();
}

function handleInput() {
    const input = document.getElementById('search-input');
    const term = normalize(input?.value.trim());
    results = collectResults(term);
    activeIndex = 0;
    renderResults(term);
}

export function openSearch() {
    const modal = document.getElementById('search-modal');
    const input = document.getElementById('search-input');
    if (!modal) return;
    lastFocusedEl = document.activeElement;
    isOpen = true;
    modal.style.display = 'flex';
    document.body.classList.add('search-open');
    if (input) {
        input.value = '';
        input.focus();
    }
    results = [];
    activeIndex = 0;
    renderResults('');
}

export function closeSearch() {
    const modal = document.getElementById('search-modal');
    if (!modal) return;
    isOpen = false;
    modal.style.display = 'none';
    document.body.classList.remove('search-open');
    if (lastFocusedEl instanceof HTMLElement) lastFocusedEl.focus();
    lastFocusedEl = null;
}

function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function initSearch() {
    const modal = document.getElementById('search-modal');
    const input = document.getElementById('search-input');
    if (!modal || !input) return;

    input.addEventListener('input', handleInput);

    // 배경(오버레이)을 눌렀을 때만 닫는다. 패널 안쪽 클릭은 무시.
    modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) closeSearch();
    });

    document.addEventListener('keydown', (e) => {
        const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
        if (cmdK) {
            e.preventDefault();
            isOpen ? closeSearch() : openSearch();
            return;
        }
        // "/"는 글을 쓰는 중이 아닐 때만 검색 단축키로 쓴다.
        if (!isOpen && e.key === '/' && !isTypingTarget(document.activeElement)) {
            e.preventDefault();
            openSearch();
            return;
        }
        if (!isOpen) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (results.length) setActive((activeIndex + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length) setActive((activeIndex - 1 + results.length) % results.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            activate(activeIndex);
        }
    });

    // macOS에서는 ⌘K, 그 외에는 Ctrl K로 안내한다.
    const hintKey = document.getElementById('search-trigger-key');
    if (hintKey) {
        const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
        hintKey.textContent = isMac ? '⌘K' : 'Ctrl K';
    }
}
