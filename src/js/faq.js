import { db, auth as firebaseAuth } from './firebase-config.js';
import { checkTrafficAllowed, commitTrafficIncrement } from './traffic.js';
import {
    collection,
    doc,
    onSnapshot,
    query,
    addDoc,
    orderBy,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ITEMS_PER_PAGE, formatAuthorLabel, getByteLength } from './utils.js';
import { loggedInUser } from './state.js';

let faqs = [];
let displayFaqsGlobal = [];
let currentFaqDocId = null;
let faqAnswersSnapshotListener = null;
let currentFaqPage = 1;

export async function addFaqQuestion() {
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

    const needsFaqTrafficCheck = loggedInUser.role !== 'admin';
    if (needsFaqTrafficCheck) {
        const faqTrafficResult = await checkTrafficAllowed(firebaseAuth.currentUser?.uid, 'faqQuestionCount', 1, 1);
        if (!faqTrafficResult.allowed) {
            if (faqTrafficResult.error) {
                alert('⚠️ 작성 가능 여부를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n(' + (faqTrafficResult.message || '') + ')');
            } else {
                alert(`❌ [작성 제한] 오늘은 이미 FAQ 질문을 등록했습니다. 하루 최대 1회만 가능합니다. (현재 누적: ${faqTrafficResult.currentVal}회)`);
            }
            return;
        }
    }

    const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g, '.').replace(/\.$/, '');
    const newFaq = {
        title,
        content,
        authorName: loggedInUser.name,
        authorBatch: loggedInUser.batch,
        authorRole: loggedInUser.role,
        authorId: firebaseAuth.currentUser?.uid,
        date,
        timestamp: Date.now()
    };
    try {
        await addDoc(collection(db, 'faqs'), newFaq);
        if (needsFaqTrafficCheck) {
            await commitTrafficIncrement(firebaseAuth.currentUser?.uid, 'faqQuestionCount', 1);
        }
        if (titleInput) titleInput.value = '';
        if (contentInput) contentInput.value = '';
        currentFaqPage = 1;
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
        prevBtn.onclick = () => changeFaqPage(startPage - 1);
        container.appendChild(prevBtn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.innerText = `${i}`;
        btn.type = 'button';
        btn.className = `page-btn ${i === currentFaqPage ? 'active' : ''}`;
        btn.onclick = () => changeFaqPage(i);
        container.appendChild(btn);
    }

    if (endPage < totalPages) {
        const nextBtn = document.createElement('button');
        nextBtn.innerText = '다음';
        nextBtn.type = 'button';
        nextBtn.className = 'page-btn';
        nextBtn.onclick = () => changeFaqPage(endPage + 1);
        container.appendChild(nextBtn);
    }
}

export function changeFaqPage(pageNum) {
    currentFaqPage = pageNum;
    renderFaqPage(currentFaqPage);
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

export async function addFaqAnswer() {
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
        authorId: firebaseAuth.currentUser?.uid,
        date,
        timestamp: Date.now()
    });
    if (input) input.value = '';
    alert('답변이 등록되었습니다.');
}

export function closeFaq() {
    const faqModal = document.getElementById('faq-modal');
    if (faqModal) faqModal.style.display = 'none';
    if (faqAnswersSnapshotListener) faqAnswersSnapshotListener();
}

export function listenFaqs() {
    onSnapshot(collection(db, 'faqs'), (querySnapshot) => {
        faqs = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            faqs.push(data);
        });
        renderFaqs();
    });
}
