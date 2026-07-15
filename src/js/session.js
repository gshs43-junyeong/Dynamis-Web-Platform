import { setLoggedInUser } from './state.js';
import { formatUserIdentityLabel, formatUserDisplayLabel } from './utils.js';
import { BASE_PATH, renderRoute, navigateTo } from './router.js';
import { renderNotices } from './notice.js';
import { renderAdminUserConsole } from './admin.js';
import { verifyClock } from './clock.js';

// 로그인 상태 변화(auth 콜백)에 따라 화면 전체의 세션 의존 UI를 갱신한다.
export function applyUserSessionUI(user) {
    const normalizedUser = user && user.isAnonymous ? null : user;
    setLoggedInUser(normalizedUser);
    renderAdminUserConsole();

    const welcomeUser = document.getElementById('welcome-user');
    const userRoleDisplay = document.getElementById('user-role-display');
    const navLogin = document.getElementById('nav-login');
    const mobileNavLogin = document.getElementById('mobile-nav-login');
    const displayName = formatUserIdentityLabel(normalizedUser);
    const headerLabel = normalizedUser ? formatUserDisplayLabel(normalizedUser) : 'Login';
    if (welcomeUser) welcomeUser.innerText = normalizedUser ? `${displayName}님` : '로그인이 필요합니다.';
    if (userRoleDisplay) {
        userRoleDisplay.innerText = normalizedUser ? '' : '로그인 필요';
        userRoleDisplay.style.display = normalizedUser ? 'none' : 'block';
    }
    if (navLogin) navLogin.innerText = headerLabel;
    if (mobileNavLogin) mobileNavLogin.innerText = normalizedUser ? displayName : 'Login';

    const noticeWriteBox = document.getElementById('notice-write-box');
    const fileUploadContainer = document.getElementById('file-upload-container');
    const eventWriteBox = document.getElementById('event-write-box');
    const eventFileUploadContainer = document.getElementById('event-file-upload-container');
    const faqWriteBox = document.getElementById('faq-write-box');
    const faqWriteGuestMessage = document.getElementById('faq-write-guest-message');
    const faqWriteForm = document.getElementById('faq-write-form');
    if (noticeWriteBox) {
        noticeWriteBox.style.display = ['admin', 'member', 'honored'].includes(normalizedUser?.role) ? 'block' : 'none';
    }
    if (fileUploadContainer) {
        fileUploadContainer.style.display = normalizedUser?.role === 'honored' ? 'none' : 'block';
    }
    if (eventWriteBox) {
        eventWriteBox.style.display = ['admin', 'member', 'honored'].includes(normalizedUser?.role) ? 'block' : 'none';
    }
    if (eventFileUploadContainer) {
        eventFileUploadContainer.style.display = normalizedUser?.role === 'honored' ? 'none' : 'block';
    }
    if (faqWriteBox) {
        faqWriteBox.style.display = 'block';
    }
    if (faqWriteGuestMessage) {
        faqWriteGuestMessage.style.display = normalizedUser ? 'none' : 'block';
    }
    if (faqWriteForm) {
        faqWriteForm.style.display = normalizedUser ? 'block' : 'none';
    }

    const adminMenu = document.getElementById('admin-menu');
    const mobileAdminMenu = document.getElementById('mobile-admin-menu');
    const pinHeader = document.getElementById('th-pin-header');
    if (adminMenu) adminMenu.style.display = normalizedUser?.role === 'admin' ? 'block' : 'none';
    if (mobileAdminMenu) mobileAdminMenu.style.display = normalizedUser?.role === 'admin' ? 'block' : 'none';
    if (pinHeader) pinHeader.style.display = normalizedUser?.role === 'admin' ? 'table-cell' : 'none';

    renderNotices();

    const currentPath = location.pathname;
    if (currentPath === BASE_PATH + '/login' || currentPath === BASE_PATH + '/signup') {
        navigateTo('/mypage');
    } else {
        renderRoute();
    }

    // 로그인 상태가 바뀔 때마다 기기 시계 오차를 확인 (이벤트 타이머 신뢰성용).
    verifyClock();
}
