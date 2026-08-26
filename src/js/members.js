import { db, auth as firebaseAuth } from './firebase-config.js';
import {
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    writeBatch
} from "firebase/firestore";
import { formatUserIdentityLabel, getRoleLabel } from './utils.js';
import { loggedInUser } from './state.js';
import { renderLikeWidget } from './likes.js';
import { emit, on, EVENTS } from './bus.js';
import { reportListLoadError } from './loaderror.js';
import { pollCachedList } from './listCache.js';

let selectedMemberData = null;
// 마지막으로 렌더된 부원 목록. 홈 대시보드/통합 검색이 재구독 없이 재사용한다.
let memberCache = [];
let memberLikeUnsub = null;
// 목록 버튼마다 붙는 하트 위젯의 구독 해제 함수들. 목록을 다시 그릴 때 모두 정리한다.
let memberButtonLikeUnsubs = [];
// 하트를 붙일 자리와 대상 uid. 부원 목록 화면에 실제로 들어왔을 때만 구독을 연다.
let memberLikeMounts = [];

// [읽기 비용] 하트 위젯은 부원 1명당 users/{uid}/likes 구독을 하나씩 연다.
// 예전에는 이걸 목록을 그리는 시점에 무조건 열었는데, 부원 목록은 앱이 뜰 때
// (라우트와 무관하게) 한 번 그려지므로 홈에만 들렀다 나가는 방문자도 부원 수만큼
// 구독을 열고 있었다. 좋아요가 0개여도 빈 쿼리는 1 read로 과금되므로, 부원이
// 30명이면 홈 방문 한 번에 30 read가 그냥 나갔다 — 무료 티어 하루 50,000 read
// 기준으로 방문자당 읽기의 약 1/4을 차지하던 항목이다.
//
// 이제는 부원 목록 화면이 실제로 활성일 때만 구독을 열고, 화면을 벗어나면 닫는다.
// 기능은 그대로다(목록에서도 하트 개수가 실시간으로 보인다). 화면을 보지 않는
// 사람에게 비용을 물리지 않을 뿐이다.
function isMembersSectionActive() {
    return !!document.getElementById('members')?.classList.contains('active');
}

function mountMemberButtonLikeWidgets() {
    if (memberButtonLikeUnsubs.length > 0) return; // 이미 열려 있음
    memberLikeMounts.forEach(({ el, key }) => {
        memberButtonLikeUnsubs.push(renderLikeWidget(el, ['users', key]));
    });
}

function clearMemberButtonLikeWidgets() {
    memberButtonLikeUnsubs.forEach((fn) => {
        try { fn(); } catch { /* 이미 해제됨 */ }
    });
    memberButtonLikeUnsubs = [];
    // 구독을 끊은 뒤에도 하트가 남아 있으면 개수가 갱신되지 않는 채로 보인다.
    memberLikeMounts.forEach(({ el }) => { el.innerHTML = ''; });
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
    // 공개 프로필에는 로그인 아이디(id)가 없으므로 uid로만 본인 여부를 판정한다.
    const canEdit = !!(loggedInUser && firebaseAuth.currentUser?.uid && firebaseAuth.currentUser.uid === member.uid);

    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'member-detail-header';

    // 이름 + 하트를 한 줄로 묶어 좌측에 배치.
    const nameRow = document.createElement('div');
    nameRow.className = 'member-detail-name-row';

    const title = document.createElement('h4');
    title.className = 'member-detail-title';
    title.textContent = formatUserIdentityLabel(member);
    nameRow.appendChild(title);

    const likeMount = document.createElement('div');
    likeMount.className = 'member-detail-like';
    nameRow.appendChild(likeMount);

    header.appendChild(nameRow);

    // 역할은 박스 우측 상단에 배치.
    const role = document.createElement('p');
    role.className = 'member-detail-role';
    role.textContent = getRoleLabel(member?.role);
    header.appendChild(role);

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
                const targetDocId = member.docId || member.uid;
                // 원본(users)과 공개 사본(memberProfiles)을 한 배치로 함께 갱신한다.
                // 따로 쓰면 한쪽만 성공했을 때 목록에 보이는 설명과 실제 값이 어긋난다.
                const batch = writeBatch(db);
                batch.update(doc(db, 'users', targetDocId), { description: newValue });
                batch.set(doc(db, 'memberProfiles', targetDocId), {
                    uid: targetDocId,
                    name: member.name || '',
                    batch: member.batch || '',
                    role: member.role || 'general',
                    description: newValue
                });
                await batch.commit();
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

let membersUnsub = null;

// 로그인한 본인의 공개 프로필(memberProfiles)이 users 문서와 어긋나 있으면 맞춘다.
//
// 이 컬렉션이 생기기 전에 가입한 계정에는 공개 프로필 문서가 아예 없다. 별도
// 마이그레이션 스크립트를 돌리는 대신, 각자 로그인할 때 본인 것만 스스로 만들도록
// 해 자연스럽게 채워지게 한다(관리자가 /admin에 들어오면 나머지도 일괄 보정된다 —
// admin.js의 backfillMemberProfiles 참고).
async function ensureOwnProfileMirrored() {
    const uid = firebaseAuth.currentUser?.uid;
    if (!loggedInUser || !uid) return;

    const role = loggedInUser.role || 'general';
    try {
        // 미승인(general) 계정은 공개 프로필을 갖지 않는다. 부원 목록에 나타나지도
        // 않는데 실명·기수만 공개로 노출되던 문제 때문이다(firebase.rules 참고).
        // 예전 버전이 가입 시점에 만들어 둔 문서가 남아 있을 수 있으므로, 남아 있으면
        // 본인 로그인 시 스스로 지운다.
        if (role === 'general') {
            const snap = await getDoc(doc(db, 'memberProfiles', uid));
            if (snap.exists()) await deleteDoc(doc(db, 'memberProfiles', uid));
            return;
        }

        const desired = {
            uid,
            name: loggedInUser.name || '',
            batch: loggedInUser.batch || '',
            role,
            description: loggedInUser.description || ''
        };
        const snap = await getDoc(doc(db, 'memberProfiles', uid));
        const current = snap.exists() ? snap.data() : null;
        const isUpToDate = current && ['name', 'batch', 'role', 'description']
            .every((key) => (current[key] || '') === desired[key]);
        if (isUpToDate) return;
        await setDoc(doc(db, 'memberProfiles', uid), desired);
    } catch (err) {
        console.warn('[Members] 공개 프로필 동기화 실패:', err?.message || err);
    }
}

// 부원 목록과 설명은 비로그인 방문자도 볼 수 있다.
//
// 다만 users 문서에는 경고 누적 횟수·로그인 아이디 같은 비공개 정보가 함께 들어
// 있어 통째로 공개할 수 없으므로(규칙은 필드 단위 읽기 제한을 지원하지 않는다),
// 공개해도 되는 네 필드만 복제해 둔 memberProfiles를 구독한다.
// 로그인 여부와 무관하게 읽히므로 구독은 한 번만 열고 유지한다.
export function syncMembersSection() {
    ensureOwnProfileMirrored();

    if (membersUnsub) {
        // 로그인 상태가 바뀌면 "내 설명 수정" 입력란 노출 여부가 달라지므로 다시 그린다.
        renderMemberDetailPanel(selectedMemberData);
        syncMemberSelectionHighlight();
        return;
    }

    // [DDoS 대응] notice.js와 같은 이유로 onSnapshot 직결 대신 캐시 폴링으로
    // 바꿨다. 자세한 배경은 listCache.js 참고. API가 이미 { ...doc.data(), docId }
    // 형태의 배열을 돌려주므로, 아래는 QuerySnapshot 대신 그 배열을 순회한다.
    membersUnsub = pollCachedList('/api/list-members', (docs) => {
        const gAdmin = document.getElementById('group-admin');
        const gMember = document.getElementById('group-member');
        const gHonored = document.getElementById('group-honored');
        // 목록을 새로 그리기 전에 이전 버튼 하트 위젯 구독을 모두 해제 (누수 방지).
        // 자리 목록도 함께 비운다 — 아래에서 새 DOM으로 다시 채운다.
        clearMemberButtonLikeWidgets();
        memberLikeMounts = [];
        if (gAdmin) gAdmin.innerHTML = '';
        if (gMember) gMember.innerHTML = '';
        if (gHonored) gHonored.innerHTML = '';

        let hasAdmin = false;
        let hasMember = false;
        let hasHonored = false;
        const members = [];
        const seenMemberIdentityKeys = new Set();

        docs.forEach((u) => {
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
                memberLikeMounts.push({ el: likeMount, key: memberKey });
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
        // 부원 목록 화면을 보고 있는 중이었다면 하트를 다시 붙인다.
        // (앱이 뜰 때 /members로 바로 들어온 경우도 여기서 처리된다 — 라우트
        //  이벤트 순서에 기대지 않고 섹션의 활성 상태를 직접 본다.)
        if (isMembersSectionActive()) mountMemberButtonLikeWidgets();
        memberCache = members;
        emit(EVENTS.MEMBERS_CHANGED, memberCache);
    }, (err) => reportListLoadError('부원 목록', err));

    // 부원 목록에 들어올 때만 하트 구독을 열고, 나가면 닫는다.
    on(EVENTS.ROUTE_CHANGED, (sectionId) => {
        if (sectionId === 'members') mountMemberButtonLikeWidgets();
        else clearMemberButtonLikeWidgets();
    });
}

// 현재 메모리에 올라와 있는 부원 목록(읽기 전용 사본).
// users 컬렉션은 로그인 상태에서만 읽을 수 있으므로, 비로그인 시에는 빈 배열이다.
export function getMembers() {
    return memberCache.slice();
}
