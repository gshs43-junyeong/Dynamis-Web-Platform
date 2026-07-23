export const ITEMS_PER_PAGE = 15;

export function escapeHTML(str) {
    if (!str) return "";
    return str.toString().replace(/[&<>'"]/g, function (tag) {
        const charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return charsToReplace[tag] || tag;
    });
}

export function getRoleLabel(role) {
    if (role === 'admin') return '관리자';
    if (role === 'member') return '부원';
    if (role === 'honored') return '명예부원';
    return '등급 없음';
}

export function formatAuthorLabel(author) {
    const name = author?.authorName || '알수없음';
    const batch = author?.authorBatch || '';
    const role = getRoleLabel(author?.authorRole);
    if (batch && name) return `${batch} ${name} (${role})`;
    if (name) return `${name} (${role})`;
    return `사용자 (${role})`;
}

export function formatUserIdentityLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    if (batch && displayName) return `${batch} ${displayName}`;
    if (displayName) return displayName;
    return '사용자';
}

export function formatUserDisplayLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    const role = getRoleLabel(user.role);
    if (batch && displayName) return `${batch} ${displayName} (${role})`;
    if (displayName) return `${displayName} (${role})`;
    return role;
}

export function getByteLength(str) {
    return new TextEncoder().encode(str).length;
}

export const NOTICE_TAGS = ['학술 자료', '이벤트 안내', '설문 조사', '기타'];

// URL은 http(s):// 또는 www.로 시작하는 형태만 인식한다 (javascript: 등 다른 스킴은
// 애초에 매치되지 않으므로 XSS 벡터가 되지 않음). 문장 부호가 URL 끝에 붙어 쓰인 경우
// (마침표, 쉼표, 괄호 등)는 링크에서 제외하고 원래 텍스트로 남긴다.
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_PUNCT_REGEX = /[.,:;!?'")\]]+$/;

// 공지/이벤트 본문에서 URL을 자동으로 클릭 가능한 링크로 바꾼다.
// escapeHTML을 먼저 적용해 원본 텍스트에 있던 HTML 특수문자를 전부 무력화한 뒤,
// 그 이스케이프된 문자열 위에서만 URL을 찾아 <a> 태그로 감싸므로 안전하다.
export function linkifyText(str) {
    const escaped = escapeHTML(str);
    return escaped.replace(URL_REGEX, (match) => {
        const trailingMatch = match.match(TRAILING_PUNCT_REGEX);
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const url = trailing ? match.slice(0, match.length - trailing.length) : match;
        if (!url) return match;
        const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow" class="content-link">${url}</a>${trailing}`;
    });
}
