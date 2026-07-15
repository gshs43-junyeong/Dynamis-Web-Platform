// 로그인 세션 상태. loggedInUser는 live binding이라 다른 모듈에서 import하면
// setLoggedInUser로 갱신된 값이 그대로 반영된다.
export let loggedInUser = null;

export function setLoggedInUser(user) {
    loggedInUser = user;
    window.loggedInUser = user;
}

export function ensureAdminAction() {
    if (!loggedInUser || loggedInUser.role !== 'admin') {
        alert('관리자 전용 기능입니다. 권한이 없는 사용자입니다.');
        return false;
    }
    return true;
}
