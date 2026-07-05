import { db } from './firebase-config.js';
import { verifyAndIncrementTraffic, checkTrafficAllowed, commitTrafficIncrement } from './traffic.js';
import * as auth from './auth.js';
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    onSnapshot,
    query,
    where,
    addDoc,
    updateDoc,
    deleteDoc,
    orderBy,
    getDocs,
    increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
let notices = [];
let displayNoticesGlobal = [];
let faqs = [];
let displayFaqsGlobal = [];
let loggedInUser = null;
let currentNoticeDocId = null;
let currentFaqDocId = null;
let commentsSnapshotListener = null;
let faqAnswersSnapshotListener = null;
let selectedMemberData = null;
const ITEMS_PER_PAGE = 15;
let currentPage = 1;
let currentFaqPage = 1;

function escapeHTML(str) {
    if (!str) return "";
    return str.toString().replace(/[&<>'"]/g, function (tag) {
        const charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return charsToReplace[tag] || tag;
    });
}

function getRoleLabel(role) {
    if (role === 'admin') return '관리자';
    if (role === 'member') return '부원';
    if (role === 'honored') return '명예부원';
    return '등급 없음';
}

function formatAuthorLabel(author) {
    const name = author?.authorName || '알수없음';
    const batch = author?.authorBatch || '';
    const role = getRoleLabel(author?.authorRole);
    if (batch && name) return `${batch} ${name} (${role})`;
    if (name) return `${name} (${role})`;
    return `사용자 (${role})`;
}

function formatUserIdentityLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    if (batch && displayName) return `${batch} ${displayName}`;
    if (displayName) return displayName;
    return '사용자';
}

function formatUserDisplayLabel(user) {
    if (!user) return '비로그인';
    const batch = user.batch ? `${user.batch}` : '';
    const rawName = user.name || user.displayName || user.email?.split('@')[0] || '';
    const displayName = rawName;
    const role = getRoleLabel(user.role);
    if (batch && displayName) return `${batch} ${displayName} (${role})`;
    if (displayName) return `${displayName} (${role})`;
    return role;
}

function getByteLength(str) {
    return new TextEncoder().encode(str).length;
}

function ensureAdminAction() {
    if (!loggedInUser || loggedInUser.role !== 'admin') {
        alert('관리자 전용 기능입니다. 권한이 없는 사용자입니다.');
        return false;
    }
    return true;
}

function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.mobile-nav a').forEach(a => a.classList.remove('active'));
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.add('active');
    const navId = {
        home: 'nav-home',
        notice: 'nav-notice',
        faq: 'nav-faq',
        members: 'nav-members',
        admin: 'nav-admin',
        login: 'nav-login',
        signup: 'nav-login',
        mypage: 'nav-login'
    }[id];
    const mobileNavId = {
        home: 'mobile-nav-home',
        notice: 'mobile-nav-notice',
        faq: 'mobile-nav-faq',
        members: 'mobile-nav-members',
        admin: 'mobile-nav-admin',
        login: 'mobile-nav-login',
        signup: 'mobile-nav-login',
        mypage: 'mobile-nav-login'
    }[id];
    if (navId && document.getElementById(navId)) document.getElementById(navId).classList.add('active');
    if (mobileNavId && document.getElementById(mobileNavId)) document.getElementById(mobileNavId).classList.add('active');
    window.scrollTo(0, 0);
}

const ROUTES = {
    '/home': { section: 'home' },
    '/notice': { section: 'notice' },
    '/faq': { section: 'faq' },
    '/members': { section: 'members' },
    '/login': { section: 'login', guestOnly: true },
    '/signup': { section: 'signup', guestOnly: true },
    '/mypage': { section: 'mypage', authRequired: true },
    '/admin': { section: 'admin', adminOnly: true },
    '/privacy': { section: 'privacy' },
    '/guidelines': { section: 'guidelines' }
};

function renderRoute() {
    let path = location.pathname;
    if (BASE_PATH && path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '') path = '/';
    if (path === '/') path = '/home';
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    const route = ROUTES[path];
    if (!route) {
        history.replaceState({}, '', '/home');
        return showSection('home');
    }
    const targetHome = BASE_PATH + '/home';
    const targetLogin = BASE_PATH + '/login';
    if (route.guestOnly && loggedInUser) {
        history.replaceState({}, '', targetHome);
        return showSection('home');
    }
    if (route.authRequired && !loggedInUser) {
        history.replaceState({}, '', targetLogin);
        return showSection('login');
    }
    if (route.adminOnly && (!loggedInUser || loggedInUser.role !== 'admin')) {
        history.replaceState({}, '', targetHome);
        return showSection('home');
    }
    showSection(route.section);
}

function navigateTo(path) {
    const target = BASE_PATH + path;
    if (location.pathname !== target) {
        history.pushState({}, '', target);
    }
    renderRoute();
}

function handleAuthNavClick() {
    navigateTo(loggedInUser ? '/mypage' : '/login');
}

window.addEventListener('popstate', renderRoute);

function applyUserSessionUI(user) {
    const normalizedUser = user && user.isAnonymous ? null : user;
    loggedInUser = normalizedUser;
    window.loggedInUser = normalizedUser;

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
    const faqWriteBox = document.getElementById('faq-write-box');
    const faqWriteGuestMessage = document.getElementById('faq-write-guest-message');
    const faqWriteForm = document.getElementById('faq-write-form');
    if (noticeWriteBox) {
        noticeWriteBox.style.display = ['admin', 'member', 'honored'].includes(normalizedUser?.role) ? 'block' : 'none';
    }
    if (fileUploadContainer) {
        fileUploadContainer.style.display = normalizedUser?.role === 'honored' ? 'none' : 'block';
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
}

async function addNotice() {
    const titleInput = document.getElementById('post-title');
    const contentInput = document.getElementById('post-content');
    const fileInput = document.getElementById('post-file');

    const title = titleInput?.value.trim();
    const content = contentInput?.value.trim();
    if (!title || !content) return alert('제목과 내용을 빠짐없이 기입해 주세요.');
    if (!loggedInUser) return alert('인증 세션이 만료되었습니다.');

    const needsNoticeTrafficCheck = loggedInUser.role !== 'admin';
    if (needsNoticeTrafficCheck) {
        const contentBytes = getByteLength(content);
        if (contentBytes > 2000) {
            alert(`❌ [바이트 초과] 공지사항 본문 크기가 2000바이트를 초과하여 게시할 수 없습니다. (현재: ${contentBytes}바이트)`);
            return;
        }

        const isNoticeAllowed = await checkTrafficAllowed(loggedInUser.uid, 'noticeCount', 1, 5);
        if (!isNoticeAllowed) {
            alert('❌ [작성 빈도 제한] 악성 트래픽 및 오뷰즈 방어 정책에 의해 하루 최대 공지사항 작성 한도(5회)를 초과하여 차단되었습니다.');
            return;
        }
    }

    const uploadedFilesArray = [];
    let totalNewSize = 0;
    const needsUploadTrafficCheck = fileInput?.files.length > 0 && loggedInUser.role !== 'admin';
    if (fileInput?.files.length > 0) {
        if (loggedInUser.role === 'honored') {
            alert('❌ 명예부원 등급은 파일 업로드가 절대 허용되지 않습니다.');
            return;
        }

        for (let i = 0; i < fileInput.files.length; i++) {
            totalNewSize += fileInput.files[i].size;
        }

        if (needsUploadTrafficCheck) {
            const uploadLimit = 2 * 1024 * 1024;
            const isUploadAllowed = await checkTrafficAllowed(loggedInUser.uid, 'uploadBytes', totalNewSize, uploadLimit);
            if (!isUploadAllowed) {
                alert('⚠️ [업로드 제한] 하루 최대 파일 업로드 총량(2MB)을 초과하였거나 이번 파일이 허용치를 초과했습니다.');
                return;
            }
        }

        for (let i = 0; i < fileInput.files.length; i++) {
            const file = fileInput.files[i];
            const data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            uploadedFilesArray.push({ fileName: file.name, fileSize: file.size, fileData: data });
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    const noticePayload = {
        title,
        content,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: loggedInUser.uid,
        date,
        pinned: false,
        files: uploadedFilesArray,
        timestamp: Date.now()
    };

    try {
        await addDoc(collection(db, 'notices'), noticePayload);
        if (needsNoticeTrafficCheck) {
            await commitTrafficIncrement(loggedInUser.uid, 'noticeCount', 1);
        }
        if (needsUploadTrafficCheck) {
            await commitTrafficIncrement(loggedInUser.uid, 'uploadBytes', totalNewSize);
        }
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        if (fileInput) fileInput.value = '';
        alert('공지사항이 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('작성 실패 (파일 용량이 너무 크거나 서버 통신 오류입니다): ' + err.message);
    }
}

async function togglePin(docId, isChecked) {
    if (!ensureAdminAction()) return;
    await updateDoc(doc(db, 'notices', docId), { pinned: isChecked });
}

function renderNotices() {
    const list = document.getElementById('notice-list');
    if (!list) return;

    const isAdmin = loggedInUser && loggedInUser.role === 'admin';
    const pinHeader = document.getElementById('th-pin-header');
    if (pinHeader) pinHeader.style.display = isAdmin ? 'table-cell' : 'none';

    displayNoticesGlobal = [...notices].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    renderNoticePage(currentPage);
}

function renderNoticePage(pageNum) {
    const list = document.getElementById('notice-list');
    if (!list) return;
    list.innerHTML = '';
    const isAdmin = loggedInUser && loggedInUser.role === 'admin';

    const startIdx = (pageNum - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const slicedNotices = displayNoticesGlobal.slice(startIdx, endIdx);

    slicedNotices.forEach((n, index) => {
        const tr = document.createElement('tr');
        if (n.pinned) tr.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';

        if (isAdmin) {
            const pinTd = document.createElement('td');
            pinTd.className = 'pin-col';
            const pinInput = document.createElement('input');
            pinInput.type = 'checkbox';
            pinInput.className = 'pin-checkbox';
            pinInput.checked = !!n.pinned;
            pinInput.addEventListener('change', () => togglePin(n.docId, pinInput.checked));
            pinTd.appendChild(pinInput);
            tr.appendChild(pinTd);
        }

        const titleTd = document.createElement('td');
        titleTd.className = 'clickable-td';
        titleTd.textContent = `${n.pinned ? '📌 [고정] ' : ''}${n.title || ''}${n.files && n.files.length ? ' 📎' : ''}`;
        titleTd.addEventListener('click', () => viewNotice(startIdx + index));
        tr.appendChild(titleTd);

        const authorTd = document.createElement('td');
        authorTd.style.color = 'var(--text-secondary)';
        authorTd.style.fontSize = '0.95rem';
        authorTd.textContent = formatAuthorLabel(n);
        tr.appendChild(authorTd);

        const dateTd = document.createElement('td');
        dateTd.style.color = 'var(--text-secondary)';
        dateTd.style.fontSize = '0.95rem';
        dateTd.textContent = n.date || '';
        tr.appendChild(dateTd);

        list.appendChild(tr);
    });
    renderPaginationControls();
}

function renderPaginationControls() {
    const container = document.getElementById('pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(displayNoticesGlobal.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const PAGE_BLOCK_SIZE = 10;
    const currentBlock = Math.ceil(currentPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    if (startPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.innerText = '이전';
        prevBtn.type = 'button';
        prevBtn.className = 'page-btn';
        prevBtn.onclick = () => window.changePage(startPage - 1);
        container.appendChild(prevBtn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.innerText = `${i}`;
        btn.type = 'button';
        btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
        btn.onclick = () => window.changePage(i);
        container.appendChild(btn);
    }

    if (endPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '다음';
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.onclick = () => window.changePage(endPage + 1);
        container.appendChild(nextBtn);
    }
}

function viewNotice(index) {
    const n = displayNoticesGlobal[index];
    if (!n) return;
    currentNoticeDocId = n.docId;

    const modalTitle = document.getElementById('modal-title');
    const modalAuthor = document.getElementById('modal-author');
    const modalDate = document.getElementById('modal-date');
    const modalText = document.getElementById('modal-text');
    const modalDeleteBtn = document.getElementById('modal-delete-btn');
    const fileBox = document.getElementById('modal-file-box');
    const fileListContainer = document.getElementById('modal-file-list');

    if (modalTitle) modalTitle.innerText = n.title;
    if (modalAuthor) modalAuthor.innerText = `✍️ ${formatAuthorLabel(n)}`;
    if (modalDate) modalDate.innerText = `📅 ${n.date}`;
    if (modalText) modalText.innerText = n.content;

    if (modalDeleteBtn) modalDeleteBtn.style.display = (loggedInUser && loggedInUser.role === 'admin') ? 'block' : 'none';

    if (fileListContainer) fileListContainer.innerHTML = '';
    const filesToRender = n.files || [];

    if (filesToRender.length > 0) {
        if (fileBox) fileBox.style.display = 'block';
        filesToRender.forEach((fObj) => {
            const link = document.createElement('a');
            link.className = 'file-item-link';
            link.href = '#';
            link.innerText = `📄 ${fObj.fileName} 다운로드`;
            link.onclick = (e) => {
                e.preventDefault();
                executeFileDownloadSecure(e, fObj.fileSize, fObj.fileData, fObj.fileName);
            };
            fileListContainer.appendChild(link);
        });
    } else {
        if (fileBox) fileBox.style.display = 'none';
    }

    const commentWriteContainer = document.getElementById('comment-write-container');
    const commentGuestMessage = document.getElementById('comment-guest-message');
    if (commentWriteContainer) commentWriteContainer.style.display = loggedInUser ? 'block' : 'none';
    if (commentGuestMessage) commentGuestMessage.style.display = loggedInUser ? 'none' : 'block';

    if (commentsSnapshotListener) commentsSnapshotListener();
    commentsSnapshotListener = onSnapshot(
        query(collection(doc(db, 'notices', n.docId), 'comments'), orderBy('timestamp', 'asc')),
        (snapshot) => {
            const cList = document.getElementById('comment-list');
            if (!cList) return;
            cList.innerHTML = '';
            if (snapshot.empty) {
                cList.innerHTML = '';
                const emptyState = document.createElement('div');
                emptyState.style.color = 'var(--text-secondary)';
                emptyState.style.textAlign = 'center';
                emptyState.style.fontStyle = 'italic';
                emptyState.style.fontSize = '0.85rem';
                emptyState.style.padding = '1rem 0';
                emptyState.textContent = '등록된 댓글이 없습니다.';
                cList.appendChild(emptyState);
                return;
            }
            snapshot.forEach((docSnap) => {
                const c = docSnap.data();
                const item = document.createElement('div');
                item.className = 'comment-item';

                const header = document.createElement('div');
                header.className = 'comment-header';

                const authorSpan = document.createElement('span');
                authorSpan.style.color = '#fff';
                authorSpan.style.fontWeight = '700';
                authorSpan.textContent = formatAuthorLabel(c);

                const dateSpan = document.createElement('span');
                dateSpan.textContent = c.date || '';

                header.appendChild(authorSpan);
                header.appendChild(dateSpan);

                const body = document.createElement('div');
                body.className = 'comment-body';
                body.textContent = c.content || '';

                item.appendChild(header);
                item.appendChild(body);
                cList.appendChild(item);
            });
        }
    );

    const noticeModal = document.getElementById('notice-modal');
    if (noticeModal) noticeModal.style.display = 'flex';
}

async function executeFileDownloadSecure(e, size, dataStr, nameStr) {
    if (!loggedInUser) return alert('다운로드는 로그인된 회원 정보 세션이 있어야 동작합니다.');
    if (loggedInUser.role !== 'admin') {
        const isDownloadAllowed = await verifyAndIncrementTraffic(loggedInUser.uid, 'downloadBytes', size || 0, 5 * 1024 * 1024);
        if (!isDownloadAllowed) {
            alert('❌ [다운로드 제한] 하루 최대 파일 다운로드 총량(5MB) 한도를 초과하여 다운로드가 차단되었습니다.');
            return;
        }
    }
    const gateLink = document.createElement('a');
    gateLink.href = dataStr;
    gateLink.download = nameStr;
    document.body.appendChild(gateLink);
    gateLink.click();
    document.body.removeChild(gateLink);
}

async function addComment() {
    if (!loggedInUser) return alert('로그인이 풀렸습니다.');
    const input = document.getElementById('comment-input');
    const commentVal = input?.value.trim();
    if (!commentVal) return;

    if (loggedInUser.role !== 'admin') {
        const bytes = getByteLength(commentVal);
        if (bytes > 500) {
            alert(`❌ [바이트 초과] 댓글 크기가 500바이트를 초과하여 등록할 수 없습니다. (현재: ${bytes}바이트)`);
            return;
        }
        const isCommentAllowed = await checkTrafficAllowed(loggedInUser.uid, 'commentCount', 1, 10);
        if (!isCommentAllowed) {
            alert('❌ [작성 빈도 제한] 악성 트래픽 방어 정책에 의해 하루 최대 댓글 작성 가능 횟수(10회)를 초과하여 차단되었습니다.');
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    try {
        await addDoc(collection(doc(db, 'notices', currentNoticeDocId), 'comments'), {
            content: commentVal,
            authorName: loggedInUser.name,
            authorBatch: loggedInUser.batch,
            authorRole: loggedInUser.role,
            authorId: loggedInUser.uid,
            date,
            timestamp: Date.now()
        });
        if (loggedInUser.role !== 'admin') {
            await commitTrafficIncrement(loggedInUser.uid, 'commentCount', 1);
        }
        if (input) input.value = '';
        alert('댓글이 성공적으로 등록되었습니다.');
    } catch (err) {
        alert('댓글 등록에 실패했습니다: ' + err.message);
    }
}

async function deleteCurrentNotice() {
    if (!ensureAdminAction()) return;
    if (!confirm('정말 이 공지사항을 삭제 처리 하시겠습니까? 복구가 불가합니다.')) return;
    if (!currentNoticeDocId) return;
    try {
        await deleteDoc(doc(db, 'notices', currentNoticeDocId));
        alert('성공적으로 공지가 영구 제거되었습니다.');
        closeNotice();
    } catch (err) {
        alert('공지사항 삭제에 실패했습니다: ' + err.message);
    }
}

function closeNotice() {
    const noticeModal = document.getElementById('notice-modal');
    if (noticeModal) noticeModal.style.display = 'none';
    if (commentsSnapshotListener) commentsSnapshotListener();
}

async function addFaqQuestion() {
    if (!loggedInUser) return alert('로그인이 필요합니다.');
    const titleInput = document.getElementById('faq-title-input');
    const contentInput = document.getElementById('faq-question-input');
    const title = titleInput?.value.trim();
    const content = contentInput?.value.trim();

    if (!title) return alert('질문 제목을 입력해 주세요.');
    if (!content) return alert('질문 내용을 입력해 주세요.');
    if (title.length > 50) {
        alert('❌ [길이 제한] FAQ 제목은 50자 이내로 입력해 주세요.');
        return;
    }

    const bytes = getByteLength(content);
    if (bytes > 3000) {
        alert(`❌ [바이트 초과] FAQ 질문은 3000바이트 이내로만 작성할 수 있습니다. (현재: ${bytes}바이트)`);
        return;
    }

    const isQuestionAllowed = await checkTrafficAllowed(loggedInUser.uid, 'faqQuestionCount', 1, 1);
    if (!isQuestionAllowed) {
        alert('❌ [작성 제한] 오늘은 이미 FAQ 질문을 등록했습니다. 하루 최대 1회만 가능합니다.');
        return;
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    const newFaq = {
        title,
        content,
        authorName: loggedInUser.name,
        authorRole: loggedInUser.role,
        authorId: loggedInUser.uid,
        date,
        timestamp: Date.now()
    };
    try {
        const docRef = await addDoc(collection(db, 'faqs'), newFaq);
        await commitTrafficIncrement(loggedInUser.uid, 'faqQuestionCount', 1);
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        faqs.unshift({ ...newFaq, docId: docRef.id });
        displayFaqsGlobal = [...faqs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        currentFaqPage = 1;
        renderFaqPage(currentFaqPage);
        alert('FAQ 질문이 등록되었습니다.');
    } catch (err) {
        alert('FAQ 질문 등록에 실패했습니다: ' + err.message);
    }
}

function renderFaqs() {
    const list = document.getElementById('faq-list');
    if (!list) return;
    displayFaqsGlobal = [...faqs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderFaqPage(currentFaqPage);
}

function renderFaqPage(pageNum) {
    const list = document.getElementById('faq-list');
    if (!list) return;
    list.innerHTML = '';

    const startIdx = (pageNum - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const slicedFaqs = displayFaqsGlobal.slice(startIdx, endIdx);

    slicedFaqs.forEach((faq, index) => {
        const tr = document.createElement('tr');
        const questionTd = document.createElement('td');
        questionTd.className = 'clickable-td';
        questionTd.textContent = faq.title || faq.question || '';
        questionTd.addEventListener('click', () => viewFaq(startIdx + index));
        tr.appendChild(questionTd);

        const authorTd = document.createElement('td');
        authorTd.style.color = 'var(--text-secondary)';
        authorTd.style.fontSize = '0.95rem';
        authorTd.textContent = formatAuthorLabel(faq);
        tr.appendChild(authorTd);

        const dateTd = document.createElement('td');
        dateTd.style.color = 'var(--text-secondary)';
        dateTd.style.fontSize = '0.95rem';
        dateTd.textContent = faq.date || '';
        tr.appendChild(dateTd);

        list.appendChild(tr);
    });
    renderFaqPaginationControls();
}

function renderFaqPaginationControls() {
    const container = document.getElementById('faq-pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(displayFaqsGlobal.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    const PAGE_BLOCK_SIZE = 10;
    const currentBlock = Math.ceil(currentFaqPage / PAGE_BLOCK_SIZE);
    const startPage = (currentBlock - 1) * PAGE_BLOCK_SIZE + 1;
    const endPage = Math.min(startPage + PAGE_BLOCK_SIZE - 1, totalPages);

    if (startPage > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.innerText = '이전';
        prevBtn.type = 'button';
        prevBtn.className = 'page-btn';
        prevBtn.onclick = () => window.changeFaqPage(startPage - 1);
        container.appendChild(prevBtn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.innerText = `${i}`;
        btn.type = 'button';
        btn.className = `page-btn ${i === currentFaqPage ? 'active' : ''}`;
        btn.onclick = () => window.changeFaqPage(i);
        container.appendChild(btn);
    }

    if (endPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '다음';
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.onclick = () => window.changeFaqPage(endPage + 1);
        container.appendChild(nextBtn);
    }
}

function viewFaq(index) {
    const faq = displayFaqsGlobal[index];
    if (!faq) return;
    currentFaqDocId = faq.docId;

    const title = document.getElementById('faq-modal-title');
    const author = document.getElementById('faq-modal-author');
    const date = document.getElementById('faq-modal-date');
    const text = document.getElementById('faq-modal-text');

    if (title) title.innerText = faq.title || faq.question || '';
    if (author) author.innerText = `✍️ ${formatAuthorLabel(faq)}`;
    if (date) date.innerText = `📅 ${faq.date || ''}`;
    if (text) text.innerText = faq.content || faq.question || '';

    const answerWriteContainer = document.getElementById('faq-answer-write-container');
    const answerGuestMessage = document.getElementById('faq-answer-guest-message');
    const canAnswer = !!loggedInUser && ['member', 'admin'].includes(loggedInUser.role);
    if (answerWriteContainer) answerWriteContainer.style.display = canAnswer ? 'block' : 'none';
    if (answerGuestMessage) answerGuestMessage.style.display = canAnswer ? 'none' : 'block';

    if (faqAnswersSnapshotListener) faqAnswersSnapshotListener();
    faqAnswersSnapshotListener = onSnapshot(
        query(collection(doc(db, 'faqs', faq.docId), 'answers'), orderBy('timestamp', 'asc')),
        (snapshot) => {
            const list = document.getElementById('faq-answer-list');
            if (!list) return;
            list.innerHTML = '';
            if (snapshot.empty) {
                const emptyState = document.createElement('div');
                emptyState.style.color = 'var(--text-secondary)';
                emptyState.style.textAlign = 'center';
                emptyState.style.fontStyle = 'italic';
                emptyState.style.fontSize = '0.85rem';
                emptyState.style.padding = '1rem 0';
                emptyState.textContent = '등록된 답변이 없습니다.';
                list.appendChild(emptyState);
                return;
            }
            snapshot.forEach((docSnap) => {
                const answer = docSnap.data();
                const item = document.createElement('div');
                item.className = 'comment-item';
                const header = document.createElement('div');
                header.className = 'comment-header';
                const authorSpan = document.createElement('span');
                authorSpan.style.color = '#fff';
                authorSpan.style.fontWeight = '700';
                authorSpan.textContent = formatAuthorLabel(answer);
                const dateSpan = document.createElement('span');
                dateSpan.textContent = answer.date || '';
                header.appendChild(authorSpan);
                header.appendChild(dateSpan);
                const body = document.createElement('div');
                body.className = 'comment-body';
                body.textContent = answer.content || '';
                item.appendChild(header);
                item.appendChild(body);
                list.appendChild(item);
            });
        }
    );

    const faqModal = document.getElementById('faq-modal');
    if (faqModal) faqModal.style.display = 'flex';
}

async function addFaqAnswer() {
    if (!loggedInUser) return alert('로그인이 필요합니다.');
    if (!['member', 'admin'].includes(loggedInUser.role)) return alert('부원 및 관리자만 답변을 작성할 수 있습니다.');
    const input = document.getElementById('faq-answer-input');
    const content = input?.value.trim();
    if (!content) return alert('답변 내용을 입력해 주세요.');

    const bytes = getByteLength(content);
    if (bytes > 1000) {
        alert(`❌ [바이트 초과] FAQ 답변은 1000바이트 이내로만 작성할 수 있습니다. (현재: ${bytes}바이트)`);
        return;
    }

    const answersRef = collection(doc(db, 'faqs', currentFaqDocId), 'answers');
    const existingAnswers = await getDocs(answersRef);
    if (existingAnswers.size >= 2) {
        alert('❌ [답변 제한] 이 질문에는 이미 답변이 2개 등록되어 있습니다.');
        return;
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    await addDoc(answersRef, {
        content,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: loggedInUser.uid,
        date,
        timestamp: Date.now()
    });
    if (input) input.value = '';
    alert('답변이 등록되었습니다.');
}

function closeFaq() {
    const faqModal = document.getElementById('faq-modal');
    if (faqModal) faqModal.style.display = 'none';
    if (faqAnswersSnapshotListener) faqAnswersSnapshotListener();
}

function getMemberKey(member) {
    return member?.docId || member?.uid || member?.id || '';
}

function syncMemberSelectionHighlight() {
    const selectedKey = getMemberKey(selectedMemberData);
    document.querySelectorAll('.member-option-btn').forEach((btn) => {
        const isActive = btn.dataset.memberKey === selectedKey;
        btn.classList.toggle('active', isActive);
    });
}

function renderMemberDetailPanel(member) {
    const panel = document.getElementById('member-detail-panel');
    if (!panel) return;

    if (!member) {
        panel.innerHTML = '<p style="color: var(--text-secondary);">멤버를 선택하면 설명을 확인할 수 있습니다.</p>';
        return;
    }

    const description = (member.description || '').trim();
    const fallbackText = '이 부원에 대한 설명이 없습니다.';
    const canEdit = !!(loggedInUser && (loggedInUser.uid === member.uid || loggedInUser.id === member.id));

    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'member-detail-header';

    const title = document.createElement('h4');
    title.className = 'member-detail-title';
    title.textContent = formatUserIdentityLabel(member);
    header.appendChild(title);

    const role = document.createElement('p');
    role.className = 'member-detail-role';
    role.textContent = getRoleLabel(member?.role);
    header.appendChild(role);

    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'member-detail-body';

    const descriptionText = document.createElement('p');
    descriptionText.className = 'member-detail-description';
    descriptionText.textContent = description || fallbackText;
    body.appendChild(descriptionText);

    if (canEdit) {
        const editBox = document.createElement('div');
        editBox.className = 'member-edit-box';

        const textarea = document.createElement('textarea');
        textarea.className = 'member-edit-textarea';
        textarea.placeholder = '이 멤버의 설명을 작성하세요...';
        textarea.value = description;
        editBox.appendChild(textarea);

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'btn member-detail-save-btn';
        saveBtn.textContent = '저장';
        saveBtn.addEventListener('click', async () => {
            const newValue = textarea.value.trim();
            if (!loggedInUser) {
                alert('로그인 후 수정할 수 있습니다.');
                return;
            }
            if (loggedInUser.uid && member.uid && loggedInUser.uid !== member.uid) {
                alert('본인 계정의 설명만 수정할 수 있습니다.');
                return;
            }
            try {
                const targetDocId = member.docId || member.uid || member.id;
                await updateDoc(doc(db, 'users', targetDocId), { description: newValue });
                selectedMemberData = { ...member, description: newValue };
                renderMemberDetailPanel(selectedMemberData);
                syncMemberSelectionHighlight();
                alert('멤버 설명이 저장되었습니다.');
            } catch (err) {
                alert('설명 저장에 실패했습니다: ' + err.message);
            }
        });
        editBox.appendChild(saveBtn);
        body.appendChild(editBox);
    }

    panel.appendChild(body);
}

function handleMemberSelection(member) {
    selectedMemberData = member;
    renderMemberDetailPanel(member);
    syncMemberSelectionHighlight();
}

function listenMembersSection() {
    onSnapshot(collection(db, 'users'), (snapshot) => {
        const gAdmin = document.getElementById('group-admin');
        const gMember = document.getElementById('group-member');
        const gHonored = document.getElementById('group-honored');
        if (gAdmin) gAdmin.innerHTML = '';
        if (gMember) gMember.innerHTML = '';
        if (gHonored) gHonored.innerHTML = '';

        let hasAdmin = false;
        let hasMember = false;
        let hasHonored = false;
        const members = [];
        const seenMemberIdentityKeys = new Set();

        snapshot.forEach((docSnap) => {
            const u = { ...docSnap.data(), docId: docSnap.id };
            const identityKey = `${u.batch || ''}|${(u.name || u.displayName || u.email || '').trim().toLowerCase()}`;
            if (seenMemberIdentityKeys.has(identityKey)) {
                return;
            }
            seenMemberIdentityKeys.add(identityKey);
            members.push(u);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'member-option-btn';
            button.dataset.memberKey = getMemberKey(u);
            button.textContent = formatUserIdentityLabel(u);
            button.addEventListener('click', () => handleMemberSelection(u));
            if (u.role === 'admin') {
                gAdmin?.appendChild(button);
                hasAdmin = true;
            } else if (u.role === 'member') {
                gMember?.appendChild(button);
                hasMember = true;
            } else if (u.role === 'honored') {
                gHonored?.appendChild(button);
                hasHonored = true;
            }
        });

        if (!hasAdmin && gAdmin) gAdmin.innerHTML = "<p style='color:var(--text-secondary); font-style:italic;'>등록된 관리자가 없습니다.</p>";
        if (!hasMember && gMember) gMember.innerHTML = "<p style='color:var(--text-secondary); font-style:italic;'>등록된 부원이 없습니다.</p>";
        if (!hasHonored && gHonored) gHonored.innerHTML = "<p style='color:var(--text-secondary); font-style:italic;'>등록된 명예부원이 없습니다.</p>";

        const selectedKey = getMemberKey(selectedMemberData);
        if (selectedKey) {
            const matchingMember = members.find((member) => getMemberKey(member) === selectedKey);
            if (matchingMember) {
                renderMemberDetailPanel(matchingMember);
            } else {
                selectedMemberData = null;
                renderMemberDetailPanel(null);
            }
        } else {
            renderMemberDetailPanel(null);
        }
        syncMemberSelectionHighlight();
    });
}

function listenAdminUserConsole() {
    if (!loggedInUser || loggedInUser.role !== 'admin') {
        const tbody = document.getElementById('admin-user-list');
        if (tbody) tbody.innerHTML = '';
        return;
    }

    onSnapshot(collection(db, 'users'), (snapshot) => {
        const tbody = document.getElementById('admin-user-list');
        if (!tbody) return;
        tbody.innerHTML = '';

        snapshot.forEach((docSnap) => {
            const u = docSnap.data();
            const tr = document.createElement('tr');

            const infoTd = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = u.name || '';
            infoTd.appendChild(strong);
            infoTd.appendChild(document.createTextNode(' '));

            const idSpan = document.createElement('span');
            idSpan.style.color = '#666';
            idSpan.style.fontSize = '0.85rem';
            idSpan.textContent = `(${u.id || ''})`;
            infoTd.appendChild(idSpan);
            infoTd.appendChild(document.createElement('br'));

            const warnSpan = document.createElement('span');
            warnSpan.style.color = '#ffaa00';
            warnSpan.style.fontSize = '0.8rem';
            warnSpan.style.fontWeight = 'bold';
            warnSpan.textContent = `⚠️ 경고 ${String(u.warnings || 0)}회`;
            infoTd.appendChild(warnSpan);

            const roleTd = document.createElement('td');
            const roleLabel = document.createElement('span');
            roleLabel.style.fontWeight = 'bold';
            roleLabel.style.color = '#fff';
            roleLabel.textContent = getRoleLabel(u.role);
            roleTd.appendChild(roleLabel);

            const selectTd = document.createElement('td');
            const roleSelect = document.createElement('select');
            roleSelect.style.background = '#0a0a0a';
            roleSelect.style.color = '#fff';
            roleSelect.style.border = '1px solid #444';
            roleSelect.style.padding = '5px';
            roleSelect.style.borderRadius = '4px';
            roleSelect.style.width = 'auto';
            roleSelect.style.marginBottom = '0';
            ['general', 'honored', 'member', 'admin'].forEach((roleValue) => {
                const option = document.createElement('option');
                option.value = roleValue;
                option.textContent = roleValue === 'general' ? '등급 없음 (general)' : roleValue === 'honored' ? '명예부원 (honored)' : roleValue === 'member' ? '부원 (member)' : '관리자 (admin)';
                if (u.role === roleValue) option.selected = true;
                roleSelect.appendChild(option);
            });
            selectTd.appendChild(roleSelect);

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.textContent = '변경 확정';
            confirmBtn.style.padding = '5px 12px';
            confirmBtn.style.marginLeft = '8px';
            confirmBtn.style.background = '#fff';
            confirmBtn.style.color = '#000';
            confirmBtn.style.border = 'none';
            confirmBtn.style.cursor = 'pointer';
            confirmBtn.style.fontWeight = 'bold';
            confirmBtn.style.borderRadius = '3px';
            confirmBtn.addEventListener('click', () => commitRoleChange(u.uid, roleSelect.value));
            selectTd.appendChild(confirmBtn);

            const actionTd = document.createElement('td');
            actionTd.style.textAlign = 'center';
            const warnBtn = document.createElement('button');
            warnBtn.type = 'button';
            warnBtn.className = 'btn-mini btn-warn';
            warnBtn.textContent = '경고 조치';
            warnBtn.addEventListener('click', () => warnUser(u.uid));

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn-mini btn-del';
            deleteBtn.textContent = '계정 삭제';
            deleteBtn.addEventListener('click', () => deleteUserByAdmin(u.uid));

            actionTd.appendChild(warnBtn);
            actionTd.appendChild(deleteBtn);

            tr.appendChild(infoTd);
            tr.appendChild(roleTd);
            tr.appendChild(selectTd);
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });
    });
}

async function commitRoleChange(userId, targetRole) {
    if (!ensureAdminAction()) return;
    const roleToApply = targetRole || (() => {
        const selectElement = document.getElementById(`role-select-${userId}`);
        return selectElement ? selectElement.value : null;
    })();
    if (!roleToApply) return;
    try {
        await updateDoc(doc(db, 'users', userId), { role: roleToApply });
        alert('해당 회원의 등급 권한이 성공적으로 업데이트되었습니다.');
        if (loggedInUser && loggedInUser.uid === userId) {
            const userSnapshot = await getDoc(doc(db, 'users', userId));
            if (userSnapshot.exists()) applyUserSessionUI(userSnapshot.data());
        }
    } catch (err) {
        alert('등급 변경에 실패했습니다: ' + err.message);
    }
}

async function warnUser(userId) {
    if (!ensureAdminAction()) return;
    if (!confirm('이 유저에게 경고 1회를 누적하겠습니까?')) return;
    try {
        await updateDoc(doc(db, 'users', userId), { warnings: increment(1), hasUnseenWarning: true });
        alert('경고가 부여되었습니다.');
    } catch (err) {
        alert('경고 부여에 실패했습니다: ' + err.message);
    }
}

async function deleteUserByAdmin(userId) {
    if (!ensureAdminAction()) return;
    if (!confirm('⚠️ 이 유저를 강제 탈퇴시키겠습니까? 삭제한 이후 복구가 불가합니다.')) return;
    try {
        await deleteDoc(doc(db, 'users', userId));
        alert('계정 삭제를 완료했습니다.');
    } catch (err) {
        alert('계정 삭제에 실패했습니다: ' + err.message);
    }
}

// 모바일 메뉴 토글
window.toggleMobileMenu = function() {
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const isOpen = hamburgerMenu?.classList.toggle('active');
    mobileNav?.classList.toggle('active', isOpen);
    document.body.classList.toggle('menu-open', isOpen);
};

// 모바일 메뉴 닫기
window.closeMobileMenu = function() {
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('mobile-nav');
    
    if (hamburgerMenu) hamburgerMenu.classList.remove('active');
    if (mobileNav) mobileNav.classList.remove('active');
    document.body.classList.remove('menu-open');
};

async function initSystemConfiguration() {
    onSnapshot(collection(db, 'notices'), (querySnapshot) => {
        notices = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            notices.push(data);
        });
        renderNotices();
    });

    onSnapshot(collection(db, 'faqs'), (querySnapshot) => {
        faqs = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            faqs.push(data);
        });
        renderFaqs();
    });

    listenMembersSection();
    listenAdminUserConsole();

    renderRoute();
}

window.changePage = function (pageNum) {
    currentPage = pageNum;
    renderNoticePage(currentPage);
};

window.changeFaqPage = function (pageNum) {
    currentFaqPage = pageNum;
    renderFaqPage(currentFaqPage);
};

window.navigateTo = navigateTo;
window.handleAuthNavClick = handleAuthNavClick;
window.addNotice = addNotice;
window.togglePin = togglePin;
window.viewNotice = viewNotice;
window.addComment = addComment;
window.closeNotice = closeNotice;
window.deleteCurrentNotice = deleteCurrentNotice;
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
window.addFaqQuestion = addFaqQuestion;
window.addFaqAnswer = addFaqAnswer;
window.closeFaq = closeFaq;

auth.initializeAuthCallbacks(applyUserSessionUI);
initSystemConfiguration();
