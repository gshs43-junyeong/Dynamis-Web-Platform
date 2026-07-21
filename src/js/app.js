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
import { addFaqQuestion, addFaqAnswer, closeFaq, changeFaqPage, listenFaqs } from './faq.js';
import { listenMembersSection } from './members.js';
import { listenAdminUserConsole, commitRoleChange, warnUser, deleteUserByAdmin } from './admin.js';
import { openPuzzle } from './puzzle.js';

window.navigateTo = navigateTo;
window.openPuzzle = openPuzzle;
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

window.addEvent = addEvent;
window.addEventComment = addEventComment;
window.closeEvent = closeEvent;
window.deleteCurrentEvent = deleteCurrentEvent;
window.changeEventPage = changeEventPage;

window.addFaqQuestion = addFaqQuestion;
window.addFaqAnswer = addFaqAnswer;
window.closeFaq = closeFaq;
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
    listenMembersSection();
    listenAdminUserConsole();
    renderRoute();
}

auth.initializeAuthCallbacks(applyUserSessionUI);
initSystemConfiguration();
