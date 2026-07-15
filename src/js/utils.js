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
