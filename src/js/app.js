// 진입점: 각 기능 모듈을 초기화하고 index.html의 인라인 핸들러가 쓰는
// 전역(window) 바인딩만 담당한다. 기능 로직은 각 모듈 참고:
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
//   hero3d.js    - 홈 히어로 3D 무대 시차 및 카드 기울기
import * as auth from './auth.js';
import { navigateTo, handleAuthNavClick, renderRoute, toggleMobileMenu, closeMobileMenu } from './router.js';
import { applyUserSessionUI } from './session.js';
import {
    addNotice,
    togglePin,
    viewNotice,
    addComment,
    closeNotice,
    deleteCurrentNotice,
    changePage,
    changeNoticeTagFilter,
    listenNotices
} from './notice.js';
import {
    addEvent,
    addEventComment,
    closeEvent,
    deleteCurrentEvent,
    changeEventPage,
    listenEvents
} from './event.js';
import { addFaqQuestion, addFaqAnswer, closeFaq, deleteCurrentFaq, changeFaqPage, listenFaqs } from './faq.js';
import { syncMembersSection } from './members.js';
import { syncAdminUserConsole, commitRoleChange, warnUser, deleteUserByAdmin } from './admin.js';
import { openPuzzle } from './puzzle.js';
import { initScrollReveal } from './reveal.js';
import { initHero3D } from './hero3d.js';
import { initDashboard } from './dashboard.js';
import { initSearch, openSearch, closeSearch } from './search.js';
import { initUnreadTracking } from './unread.js';
import { initScrollUI } from './scrollui.js';

window.navigateTo = navigateTo;
window.openPuzzle = openPuzzle;
window.openSearch = openSearch;
window.closeSearch = closeSearch;
window.handleAuthNavClick = handleAuthNavClick;
window.toggleMobileMenu = toggleMobileMenu;
window.closeMobileMenu = closeMobileMenu;

window.addNotice = addNotice;
window.togglePin = togglePin;
window.viewNotice = viewNotice;
window.addComment = addComment;
window.closeNotice = closeNotice;
window.deleteCurrentNotice = deleteCurrentNotice;
window.changePage = changePage;
window.changeNoticeTagFilter = changeNoticeTagFilter;

window.addEvent = addEvent;
window.addEventComment = addEventComment;
window.closeEvent = closeEvent;
window.deleteCurrentEvent = deleteCurrentEvent;
window.changeEventPage = changeEventPage;

window.addFaqQuestion = addFaqQuestion;
window.addFaqAnswer = addFaqAnswer;
window.closeFaq = closeFaq;
window.deleteCurrentFaq = deleteCurrentFaq;
window.changeFaqPage = changeFaqPage;

window.commitRoleChange = commitRoleChange;
window.warnUser = warnUser;
window.deleteUserByAdmin = deleteUserByAdmin;

window.handleLoginWithGoogle = auth.handleLoginWithGoogle;
window.handleLoginWithGitHub = auth.handleLoginWithGitHub;
window.handleSignupWithGoogle = auth.handleSignupWithGoogle;
window.handleSignupWithGitHub = auth.handleSignupWithGitHub;
window.handleSignup = auth.handleSignupWithGoogle;
window.handleLogout = auth.handleLogout;
window.handleDeleteAccount = auth.handleDeleteAccount;

function initSystemConfiguration() {
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
