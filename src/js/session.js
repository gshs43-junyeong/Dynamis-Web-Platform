import { setLoggedInUser } from './state.js';
import { formatUserIdentityLabel, formatUserDisplayLabel } from './utils.js';
import { BASE_PATH, renderRoute, navigateTo } from './router.js';
import { renderNotices } from './notice.js';
import { syncAdminUserConsole } from './admin.js';
import { syncMembersSection } from './members.js';
import { verifyClock } from './clock.js';

// 로그인 상태 변화(auth 콜백)에 따라 화면 전체의 세션 의존 UI를 갱신한다.
export function applyUserSessionUI(user) {
    const normalizedUser = user && user.isAnonymous ? null : user;
    setLoggedInUser(normalizedUser);
    syncAdminUserConsole();
    syncMembersSection();

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
    // nav-login/mobile-nav-login은 이제 아이콘 + 텍스트 두 자식을 갖는다.
    // innerText로 통째로 덮으면 아이콘까지 지워지므로, 텍스트 담당 span만 갱신한다.
    // (아이콘 추가 이전 마크업으로 남아 있는 경우를 대비해 span이 없으면 그대로 폴백한다.)
    const navLoginLabel = navLogin?.querySelector('.nav-label');
    if (navLoginLabel) navLoginLabel.textContent = headerLabel;
    else if (navLogin) navLogin.innerText = headerLabel;

    const mobileNavLoginLabel = mobileNavLogin?.querySelector('.nav-label');
    const mobileLoginText = normalizedUser ? displayName : 'Login';
    if (mobileNavLoginLabel) mobileNavLoginLabel.textContent = mobileLoginText;
    else if (mobileNavLogin) mobileNavLogin.innerText = mobileLoginText;

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
    // mobile-nav a는 .mobile-nav a 규칙(display: flex)으로 아이콘·라벨을
    // 세로 중앙 정렬한다. 여기서 'block'을 주면 인라인 스타일이 그 규칙을 덮어써
    // 플렉스 정렬이 깨지고 아이콘과 글자가 기준선 정렬로 툭 붙어 보인다.
    if (mobileAdminMenu) mobileAdminMenu.style.display = normalizedUser?.role === 'admin' ? 'flex' : 'none';
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
