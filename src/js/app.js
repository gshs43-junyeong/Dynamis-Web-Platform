// 진입점: 각 기능 모듈을 초기화하고, 마크업의 data-action을 실제 함수에 연결한다.
// (예전에는 인라인 onclick이 쓸 수 있도록 함수를 window에 올렸는데, CSP에서
//  'unsafe-inline'을 걷어내면서 인라인 핸들러와 함께 전역 노출도 전부 없앴다.)
// 기능 로직은 각 모듈 참고:
//   router.js  - 라우팅/네비게이션, 모바일 메뉴
//   session.js - 로그인 상태에 따른 UI 갱신
//   notice.js  - 공지사항, 댓글, 파일 다운로드
//   event.js   - 이벤트(행사 안내), 마감 타이머, 댓글
//   faq.js     - FAQ 질문/답변
//   members.js - 부원 소개
//   admin.js   - 관리자 콘솔
//   likes.js   - 좋아요(하트) 위젯
//   clock.js   - 기기/서버 시계 오차 검사
//   dashboard.js - 홈 라이브 대시보드(현황 통계 + 최근 글 미리보기)
//   search.js    - 통합 검색 커맨드 팔레트 (⌘K / Ctrl+K)
//   unread.js    - 마지막 방문 이후 올라온 글 NEW 표시
//   scrollui.js  - 읽기 진행 바 및 맨 위로 버튼
//   actions.js   - data-action 이벤트 위임 디스패처
//   hero3d.js    - 홈 히어로 3D 무대 시차 및 카드 기울기
import * as auth from './auth.js';
import { navigateTo, handleAuthNavClick, renderRoute, toggleMobileMenu, closeMobileMenu } from './router.js';
import { applyUserSessionUI } from './session.js';
import {
    addNotice,
    addComment,
    closeNotice,
    deleteCurrentNotice,
    changeNoticeTagFilter,
    listenNotices
} from './notice.js';
import {
    addEvent,
    addEventComment,
    closeEvent,
    deleteCurrentEvent,
    listenEvents
} from './event.js';
import { addFaqQuestion, addFaqAnswer, closeFaq, deleteCurrentFaq, listenFaqs } from './faq.js';
import { syncMembersSection } from './members.js';
import { syncAdminUserConsole } from './admin.js';
import { openPuzzle } from './puzzle.js';
import { initScrollReveal } from './reveal.js';
import { initHero3D } from './hero3d.js';
import { initDashboard } from './dashboard.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initUnreadTracking } from './unread.js';
import { initScrollUI } from './scrollui.js';
import { registerActions, initActions } from './actions.js';

// 마크업의 data-action을 실제 함수에 연결한다.
// 예전에는 이 자리에서 함수 35개를 window에 올렸다 — 인라인 onclick이 전역에서만
// 함수를 찾을 수 있었기 때문이다. 인라인 핸들러를 전부 걷어낸 지금은 전역 오염
// 없이 이 표 하나로 끝난다(actions.js 주석 참고).
registerActions({
    // 내비게이션. data-nav에 경로가 들어온다.
    // 모바일 메뉴는 열려 있든 아니든 닫는다 — closeMobileMenu는 멱등이라
    // 데스크톱에서 불러도 아무 일도 일어나지 않는다.
    'nav': (el) => { navigateTo(el.dataset.nav); closeMobileMenu(); },
    'auth-nav': () => { handleAuthNavClick(); closeMobileMenu(); },
    'menu-toggle': () => toggleMobileMenu(),
    'search-open': () => { closeMobileMenu(); openSearch(); },
    'search-close': () => closeSearch(),
    'puzzle': () => openPuzzle(),

    'notice-add': () => addNotice(),
    'notice-close': () => closeNotice(),
    'notice-delete': () => deleteCurrentNotice(),
    'notice-tag': (el) => changeNoticeTagFilter(el.dataset.tag),
    'comment-add': () => addComment(),

    'event-add': () => addEvent(),
    'event-close': () => closeEvent(),
    'event-delete': () => deleteCurrentEvent(),
    'event-comment-add': () => addEventComment(),

    'faq-add': () => addFaqQuestion(),
    'faq-answer-add': () => addFaqAnswer(),
    'faq-close': () => closeFaq(),
    'faq-delete': () => deleteCurrentFaq(),

    'login-google': () => auth.handleLoginWithGoogle(),
    'login-github': () => auth.handleLoginWithGitHub(),
    'signup-google': () => auth.handleSignupWithGoogle(),
    'signup-github': () => auth.handleSignupWithGitHub(),
    'logout': () => auth.handleLogout(),
    'account-delete': () => auth.handleDeleteAccount(),

    'signup-preview-close': () => auth.closeSignupPreview(),
    'signup-preview-google': () => auth.proceedSignupWithGoogle(),
    'signup-preview-github': () => auth.proceedSignupWithGitHub(),
});

function initSystemConfiguration() {
    initActions();

    listenNotices();
    listenEvents();
    listenFaqs();
    syncMembersSection();
    syncAdminUserConsole();

    // 아래 4개는 위 구독들이 bus로 흘려보내는 데이터를 재사용하기만 한다
    // (Firestore 추가 구독 없음). 그래서 반드시 listen* 다음에 초기화한다.
    initDashboard();
    initSearch();
    initUnreadTracking();
    initScrollUI();

    renderRoute();
    initScrollReveal();
    // initScrollReveal 다음에 둔다 — 카드에 .card3d를 붙일 때 이미 .scroll-reveal이
    // 올라가 있어야 등장 위치(--reveal-y)가 처음부터 올바르게 잡힌다.
    initHero3D();
}

auth.initializeAuthCallbacks(applyUserSessionUI);
initSystemConfiguration();
