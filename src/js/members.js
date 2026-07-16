import { db, auth as firebaseAuth } from './firebase-config.js';
import {
    collection,
    doc,
    onSnapshot,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { formatUserIdentityLabel, getRoleLabel } from './utils.js';
import { loggedInUser } from './state.js';
import { renderLikeWidget } from './likes.js';

let selectedMemberData = null;
let memberLikeUnsub = null;
// 목록 버튼마다 붙는 하트 위젯의 구독 해제 함수들. 목록을 다시 그릴 때 모두 정리한다.
let memberButtonLikeUnsubs = [];

function clearMemberButtonLikeWidgets() {
    memberButtonLikeUnsubs.forEach((fn) => {
        try { fn(); } catch { /* 이미 해제됨 */ }
    });
    memberButtonLikeUnsubs = [];
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

    if (memberLikeUnsub) { memberLikeUnsub(); memberLikeUnsub = null; }

    if (!member) {
        panel.innerHTML = '<p style="color: var(--text-secondary);">멤버를 선택하면 설명을 확인할 수 있습니다.</p>';
        return;
    }

    const description = (member.description || '').trim();
    const fallbackText = '이 부원에 대한 설명이 없습니다.';
    const canEdit = !!(loggedInUser && (firebaseAuth.currentUser?.uid === member.uid || loggedInUser.id === member.id));

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

    const likeMount = document.createElement('div');
    likeMount.className = 'member-detail-like';
    header.appendChild(likeMount);

    panel.appendChild(header);

    const memberKey = member.docId || member.uid || member.id;
    if (memberKey) {
        memberLikeUnsub = renderLikeWidget(likeMount, ['users', memberKey]);
    }

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
            if (firebaseAuth.currentUser?.uid && member.uid && firebaseAuth.currentUser?.uid !== member.uid) {
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

export function listenMembersSection() {
    onSnapshot(collection(db, 'users'), (snapshot) => {
        const gAdmin = document.getElementById('group-admin');
        const gMember = document.getElementById('group-member');
        const gHonored = document.getElementById('group-honored');
        // 목록을 새로 그리기 전에 이전 버튼 하트 위젯 구독을 모두 해제 (누수 방지).
        clearMemberButtonLikeWidgets();
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

            // 버튼 내부 구성: [이름] .... [하트]
            // 버튼 안에 버튼(하트)을 넣을 수 없어, 선택 요소는 div(role=button)로 만들고
            // 하트만 실제 button으로 둔다.
            const memberKey = getMemberKey(u);
            const button = document.createElement('div');
            button.className = 'member-option-btn';
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            button.dataset.memberKey = memberKey;
            button.addEventListener('click', () => handleMemberSelection(u));
            button.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleMemberSelection(u); }
            });

            const nameSpan = document.createElement('span');
            nameSpan.className = 'member-option-name';
            nameSpan.textContent = formatUserIdentityLabel(u);
            button.appendChild(nameSpan);

            // 이름 오른쪽 하트: 상세 패널과 같은 users/{uid}/likes 를 구독하므로
            // 어느 쪽에서 눌러도 개수가 양쪽 모두 실시간으로 동시 반영된다.
            const likeMount = document.createElement('div');
            likeMount.className = 'member-option-like';
            // 하트 클릭이 카드 선택으로 번지지 않도록 차단.
            likeMount.addEventListener('click', (e) => e.stopPropagation());
            button.appendChild(likeMount);
            if (memberKey) {
                memberButtonLikeUnsubs.push(renderLikeWidget(likeMount, ['users', memberKey]));
            }

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
