// Firestore 보안 규칙 회귀 테스트.
//
// 규칙은 "고쳤다고 생각했는데 실제로는 안 고쳐진" 일이 유난히 잦다 — 조건 하나를
// 함수 안쪽에 넣었는지 top-level에 뒀는지에 따라 평가 결과가 달라지는 사례가 이
// 저장소에도 이미 여러 번 있었다(firebase.rules 주석 참고). 그래서 실제 공격
// 시나리오를 에뮬레이터에 그대로 던져 보고, 막혀야 할 것이 막히는지 + 정상 동작이
// 깨지지 않았는지를 함께 확인한다.
//
// 실행:
//   npm i --no-save firebase-tools @firebase/rules-unit-testing firebase
//   npm run test:rules
//
// 각 항목은 독립적이다(매 검사 전 clearFirestore 후 재시드).
import { readFileSync } from 'fs';
import {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} from '@firebase/rules-unit-testing';
import {
    doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where,
    collection, writeBatch, increment,
    serverTimestamp,
} from 'firebase/firestore';

// firebase.json의 firestore.rules 값과 같은 파일이어야 한다.
const RULES = 'firebase.rules';

const testEnv = await initializeTestEnvironment({
    projectId: 'dynamis-audit',
    firestore: { rules: readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8085 },
});

// 규칙의 KST 판정(request.time + 9h)과 동일하게 계산
function kstToday(offsetDays = 0) {
    const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const TODAY = kstToday();
const now = () => Date.now();

const results = [];
async function check(id, desc, expect, fn, setup) {
    await reseed();
    if (setup) await seed(setup);
    // expect: 'block' = 반드시 거부되어야 함, 'allow' = 반드시 허용되어야 함
    let actual;
    try {
        await (expect === 'block' ? assertFails(fn()) : assertSucceeds(fn()));
        actual = expect;
    } catch {
        actual = expect === 'block' ? 'allow' : 'block';
    }
    const ok = actual === expect;
    results.push({ id, desc, expect, actual, ok });
    console.log(`${ok ? '  OK ' : 'FAIL'} [${id}] ${desc}  (기대=${expect} 실제=${actual})`);
}

async function seed(fn) { await testEnv.withSecurityRulesDisabled(async (c) => fn(c.firestore())); }

// ── 공통 시드 ────────────────────────────────────────────────────────────────
async function reseed() {
    await testEnv.clearFirestore();
    await seed(async (db) => {
        await setDoc(doc(db, 'users/alice'), { uid: 'alice', id: 'alice1', batch: '42기', name: '앨리스맨', role: 'member', warnings: 0 });
        // bob: warnings 필드가 아예 없는 계정 (실제 가입 코드가 만드는 형태) — L-5
        await setDoc(doc(db, 'users/bob'), { uid: 'bob', id: 'bob1', batch: '43기', name: '밥밥밥', role: 'member' });
        await setDoc(doc(db, 'users/carol'), { uid: 'carol', id: 'carol1', batch: '43기', name: '캐롤캐롤', role: 'general' });
        await setDoc(doc(db, 'users/admin1'), { uid: 'admin1', id: 'adm', batch: '41기', name: '관리자님', role: 'admin', warnings: 0 });

        await setDoc(doc(db, 'notices/n1'), {
            title: 'notice', content: 'body', authorId: 'alice', authorName: '앨리스맨',
            authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: false,
        });
        await setDoc(doc(db, 'notices/n1/comments/c1'), {
            content: '정상 댓글', authorId: 'alice', authorName: '앨리스맨',
            authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(),
        });
        await setDoc(doc(db, 'faqs/f1'), {
            title: '질문', content: '내용', authorId: 'alice', authorName: '앨리스맨',
            authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(),
        });
        await setDoc(doc(db, 'events/e1'), {
            title: 'evt', authorId: 'alice', authorName: '앨리스맨', authorBatch: '42기',
            authorRole: 'member', date: '2026.8.6', timestamp: now(), deadline: now() + 86400000,
        });
    });
}

const ctx = (uid) => testEnv.authenticatedContext(uid).firestore();

console.log('\n=== H-2 : update 경로 검증 부재 ===');
await reseed();
await check('H-2a', '댓글 update로 작성자명/등급 사칭 (alice→관리자 표기)', 'block', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1/comments/c1'), {
        authorName: '관리자님', authorRole: 'admin', authorBatch: '41기',
    }));
await check('H-2b', '댓글 update로 본문 1000자 제한 우회 (60KB)', 'block', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1/comments/c1'), { content: 'A'.repeat(60000) }));
await check('H-2c', '댓글 update로 첨부 files 배열 주입', 'block', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1/comments/c1'), {
        files: [{ fileName: 'x', fileData: 'B'.repeat(300000) }],
    }));
await check('H-2d', '댓글 update로 authorId 타인 전가', 'block', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1/comments/c1'), { authorId: 'bob' }));
await check('H-2e', '타인(부원)이 남의 FAQ 질문 본문을 임의 수정', 'block', () =>
    updateDoc(doc(ctx('bob'), 'faqs/f1'), { title: '변조됨', content: '변조' }));
await check('H-2f', '[정상] 본인 댓글 내용만 정상 수정', 'allow', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1/comments/c1'), { content: '수정한 댓글' }));

console.log('\n=== H-3 : 일일 한도 우회 ===');
const seedTrafficToday = async (db) => { await setDoc(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: 5 }); };
await check('H-3a', 'traffic 문서 통째 삭제(오늘자 카운터 리셋)', 'block', () =>
    deleteDoc(doc(ctx('alice'), 'traffic/alice')), seedTrafficToday);
await check('H-3b', 'traffic update로 카운터를 0으로 되돌리기', 'block', () =>
    setDoc(doc(ctx('alice'), 'traffic/alice'), { ...TODAY, noticeCount: 0 }), seedTrafficToday);
await check('H-3c', 'traffic 날짜를 과거로 바꿔 리셋 유도', 'block', () =>
    setDoc(doc(ctx('alice'), 'traffic/alice'), { ...kstToday(-1), noticeCount: 0 }), seedTrafficToday);
await check('H-3d', '[정상] 카운터 증가(+1)는 허용', 'allow', () =>
    setDoc(doc(ctx('alice'), 'traffic/alice'), { ...TODAY, noticeCount: increment(1) }, { merge: true }), seedTrafficToday);

// 날짜가 바뀐 경우의 리셋은 반드시 허용되어야 한다
await check('H-3e', '[정상] 어제자 문서 → 오늘자로 리셋', 'allow',
    () => setDoc(doc(ctx('alice'), 'traffic/alice'), { ...TODAY, noticeCount: 1 }),
    async (db) => { await setDoc(doc(db, 'traffic/alice'), { ...kstToday(-1), noticeCount: 5 }); });
await check('H-3f', '[정상] 어제자 문서 삭제(탈퇴 정리)는 계속 허용', 'allow',
    () => deleteDoc(doc(ctx('alice'), 'traffic/alice')),
    async (db) => { await setDoc(doc(db, 'traffic/alice'), { ...kstToday(-1), noticeCount: 5 }); });

console.log('\n=== 정상 글쓰기 배치(쿼터 연동)가 계속 동작하는가 ===');
await reseed();
await check('Q-1', '[정상] 공지 작성 + 쿼터 +1 배치 (첫 글)', 'allow', async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/new1'), {
        title: 't', content: 'c', authorId: 'alice', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: false,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: 1 });
    return b.commit();
});
await check('Q-2', '[정상] 같은 날 두 번째 공지 (increment 머지)', 'allow', async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/new2'), {
        title: 't2', content: 'c2', authorId: 'alice', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: false,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: increment(1) }, { merge: true });
    return b.commit();
}, async (db) => { await setDoc(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: 1 }); });
await check('Q-3', '쿼터 증가를 빼먹은 단독 공지 쓰기는 여전히 거부', 'block', () =>
    setDoc(doc(ctx('alice'), 'notices/solo'), {
        title: 't', content: 'c', authorId: 'alice', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: false,
    }));
await check('Q-4', '[정상] 댓글 작성 + 쿼터 배치', 'allow', async () => {
    const db = ctx('bob');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/n1/comments/cbob'), {
        content: '밥의 댓글', authorId: 'bob', authorName: '밥밥밥',
        authorBatch: '43기', authorRole: 'member', date: '2026.8.6', timestamp: now(),
    });
    b.set(doc(db, 'traffic/bob'), { ...TODAY, commentCount: 1 });
    return b.commit();
});

console.log('\n=== M-4 : events update 첨부 검증 누락 ===');
await reseed();
await check('M-4a', '이벤트 update로 700KB 초과 첨부 주입', 'block', () =>
    updateDoc(doc(ctx('alice'), 'events/e1'), {
        files: [{ fileName: 'big', fileData: 'C'.repeat(900000) }],
    }));

console.log('\n=== L-5 : warnings 필드 없는 계정의 소개글 저장 (기능 장애) ===');
await reseed();
await check('L-5a', '[정상] warnings 필드가 없는 계정이 본인 소개글 저장', 'allow', () =>
    updateDoc(doc(ctx('bob'), 'users/bob'), { description: '안녕하세요 밥입니다' }));
await check('L-5b', '[정상] warnings 필드가 있는 계정이 본인 소개글 저장', 'allow', () =>
    updateDoc(doc(ctx('alice'), 'users/alice'), { description: '앨리스 소개' }));
await check('L-5c', '본인이 warnings를 임의로 낮추는 것은 여전히 차단', 'block',
    () => updateDoc(doc(ctx('alice'), 'users/alice'), { warnings: 0, description: 'x' }),
    async (db) => setDoc(doc(db, 'users/alice'), { uid: 'alice', id: 'alice1', batch: '42기', name: '앨리스맨', role: 'member', warnings: 3 }));
await check('L-5d', '[정상] 관리자는 경고를 부여할 수 있다', 'allow', () =>
    updateDoc(doc(ctx('admin1'), 'users/bob'), { warnings: 1, hasUnseenWarning: true }));

console.log('\n=== L-3 : serverTimeCheck 무검증 쓰기 ===');
await reseed();
await check('L-3a', 'serverTimeCheck에 임의 대용량 페이로드 쓰기', 'block', () =>
    setDoc(doc(ctx('alice'), 'serverTimeCheck/alice'), { junk: 'D'.repeat(500000) }));

console.log('\n=== L-2 : 하위 문서 timestamp 신선도 ===');
await reseed();
await check('L-2a', '댓글에 미래 timestamp를 실어 정렬 상단 고정', 'block', async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/n1/comments/future'), {
        content: '미래 댓글', authorId: 'alice', authorName: '앨리스맨', authorBatch: '42기',
        authorRole: 'member', date: '2026.8.6', timestamp: 9999999999999,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, commentCount: 1 });
    return b.commit();
});

console.log('\n=== 추가 발견: update로 timestamp 위조(정렬 상단 점유) ===');
await check('X-1', '본인 공지 update로 timestamp를 미래값으로 변조', 'block', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1'), { timestamp: 9999999999999 }));
await check('X-2', '본인 이벤트 update로 timestamp를 미래값으로 변조', 'block', () =>
    updateDoc(doc(ctx('alice'), 'events/e1'), { timestamp: 9999999999999 }));
await check('X-3', '[정상] 본인 공지 본문 수정은 계속 가능', 'allow', () =>
    updateDoc(doc(ctx('alice'), 'notices/n1'), { content: '고친 본문' }));
await check('X-4', '댓글에 정의되지 않은 필드 주입(hasOnly)', 'block', async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/n1/comments/extra'), {
        content: 'x', authorId: 'alice', authorName: '앨리스맨', authorBatch: '42기',
        authorRole: 'member', date: '2026.8.6', timestamp: now(), isAdminBadge: true,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, commentCount: 1 });
    return b.commit();
});
await check('X-5', '[정상] serverTimeCheck 정상 쓰기(서버 시각)는 계속 허용', 'allow', () =>
    setDoc(doc(ctx('alice'), 'serverTimeCheck/alice'), { t: serverTimestamp() }));

console.log('\n=== 기존 방어가 유지되는지 (회귀) ===');
await reseed();
await check('R-1', '작성자 사칭 create는 여전히 차단', 'block', async () => {
    const db = ctx('bob');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/imp'), {
        title: 't', content: 'c', authorId: 'bob', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'admin', date: '2026.8.6', timestamp: now(), pinned: false,
    });
    b.set(doc(db, 'traffic/bob'), { ...TODAY, noticeCount: 1 });
    return b.commit();
});
await check('R-2', '셀프 고정(pinned) create는 여전히 차단', 'block', async () => {
    const db = ctx('bob');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/pin'), {
        title: 't', content: 'c', authorId: 'bob', authorName: '밥밥밥',
        authorBatch: '43기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: true,
    });
    b.set(doc(db, 'traffic/bob'), { ...TODAY, noticeCount: 1 });
    return b.commit();
});
await check('R-3', '미승인(general) 계정의 공지 작성은 여전히 차단', 'block', async () => {
    const db = ctx('carol');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/gen'), {
        title: 't', content: 'c', authorId: 'carol', authorName: '캐롤캐롤',
        authorBatch: '43기', authorRole: 'general', date: '2026.8.6', timestamp: now(), pinned: false,
    });
    b.set(doc(db, 'traffic/carol'), { ...TODAY, noticeCount: 1 });
    return b.commit();
});
await check('R-4', '좋아요 취소(delete)는 여전히 차단', 'block',
    () => deleteDoc(doc(ctx('alice'), 'notices/n1/likes/alice')),
    async (db) => setDoc(doc(db, 'notices/n1/likes/alice'), { uid: 'alice', timestamp: now() }));
await check('R-5', '비로그인 users 열람은 여전히 차단', 'block', () =>
    getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users/alice')));
await check('R-6', '[정상] 비로그인 memberProfiles 열람은 계속 허용', 'allow', () =>
    getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'memberProfiles/alice')));
await check('R-7', '[정상] 관리자는 타인 등급 변경 가능', 'allow', () =>
    updateDoc(doc(ctx('admin1'), 'users/bob'), { role: 'honored' }));

console.log('\n=== 가입 플로우(auth.js 변경분: warnings: 0 명시) ===');
await check('S-1', '[정상] 신규 가입 users 문서 생성 (warnings: 0 포함)', 'allow', () =>
    setDoc(doc(ctx('newbie'), 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입회원',
        role: 'general', warnings: 0, createdAt: now(),
    }));
await check('S-2', '가입 시 role을 admin으로 실어 보내는 자가 승격은 여전히 차단', 'block', () =>
    setDoc(doc(ctx('newbie'), 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입회원',
        role: 'admin', warnings: 0, createdAt: now(),
    }));
await check('S-3', '가입 시 warnings를 음수/임의값으로 실어 보내기 차단', 'block', () =>
    setDoc(doc(ctx('newbie'), 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입회원',
        role: 'general', warnings: -5, createdAt: now(),
    }));
await check('S-4', '[정상] 신규 가입자가 곧바로 소개글 저장 (L-5 회귀)', 'allow',
    () => updateDoc(doc(ctx('newbie'), 'users/newbie'), { description: '반갑습니다' }),
    async (db) => setDoc(doc(db, 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입회원',
        role: 'general', warnings: 0, createdAt: now(),
    }));

console.log('\n=== M-1 : 미승인(general) 계정의 공개 프로필 노출 ===');
await check('M-1a', '가입 직후(general) 계정이 공개 프로필을 만드는 것 차단', 'block', () =>
    setDoc(doc(ctx('carol'), 'memberProfiles/carol'), {
        uid: 'carol', name: '캐롤캐롤', batch: '43기', role: 'general', description: '',
    }));
await check('M-1b', '[정상] 승인된 부원은 공개 프로필 생성 가능', 'allow', () =>
    setDoc(doc(ctx('alice'), 'memberProfiles/alice'), {
        uid: 'alice', name: '앨리스맨', batch: '42기', role: 'member', description: '',
    }));
await check('M-1c', '[정상] 강등 시 관리자가 공개 프로필 삭제 가능', 'allow',
    () => deleteDoc(doc(ctx('admin1'), 'memberProfiles/alice')),
    async (db) => setDoc(doc(db, 'memberProfiles/alice'), {
        uid: 'alice', name: '앨리스맨', batch: '42기', role: 'member', description: '',
    }));
await check('M-1d', '공개 프로필 등급을 실제보다 높게 위조 차단', 'block', () =>
    setDoc(doc(ctx('alice'), 'memberProfiles/alice'), {
        uid: 'alice', name: '앨리스맨', batch: '42기', role: 'admin', description: '',
    }));

console.log('\n=== M-2 : users 읽기 범위 축소 ===');
await check('M-2a', '로그인만 한 사용자가 남의 계정 문서 열람', 'block', () =>
    getDoc(doc(ctx('carol'), 'users/alice')));
await check('M-2b', '[정상] 본인 계정 문서는 열람 가능', 'allow', () =>
    getDoc(doc(ctx('alice'), 'users/alice')));
await check('M-2c', '[정상] 관리자는 남의 계정 문서 열람 가능', 'allow', () =>
    getDoc(doc(ctx('admin1'), 'users/alice')));

console.log('\n=== M-6 : usernames 아이디 선점 ===');
await check('M-6a', '남의 아이디를 임의로 선점', 'block', () =>
    setDoc(doc(ctx('alice'), 'usernames/hong_gildong'), {
        uid: 'alice', batch: '42기', name: '홍길동인',
    }));
await check('M-6b', '본인 uid가 아닌 값으로 usernames 생성', 'block', () =>
    setDoc(doc(ctx('alice'), 'usernames/alice1'), {
        uid: 'bob', batch: '42기', name: '앨리스맨',
    }));
await check('M-6c', '[정상] 본인 users.id와 일치하는 문서는 생성 가능', 'allow', () =>
    setDoc(doc(ctx('alice'), 'usernames/alice1'), {
        uid: 'alice', batch: '42기', name: '앨리스맨',
    }));
await check('M-6d', '[정상] 가입 중복 검사용 질의(list)는 계속 허용', 'allow', () =>
    getDocs(query(collection(ctx('alice'), 'usernames'), where('batch', '==', '42기'), where('name', '==', '앨리스맨'))));

console.log('\n=== L-13 : 이벤트 본문 문서 / 마감 시각 ===');
await check('L-13a', "content 하위 문서를 'main' 외 임의 ID로 무제한 생성", 'block', () =>
    setDoc(doc(ctx('alice'), 'events/e1/content/spam1'), { content: 'x' }));
await check('L-13b', '[정상] main 본문 작성은 계속 가능', 'allow', () =>
    setDoc(doc(ctx('alice'), 'events/e1/content/main'), { content: '행사 본문' }));
await check('L-13c', '작성자가 마감 시각을 사후 연장', 'block', () =>
    updateDoc(doc(ctx('alice'), 'events/e1'), { deadline: now() + 999999999 }));

console.log('\n=== L-6 : 이름 문자 검증 서버 이식 ===');
await check('L-6a', '제로폭 문자를 섞은 이름으로 가입', 'block', () =>
    setDoc(doc(ctx('newbie'), 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입\u200b회원',
        role: 'general', warnings: 0, createdAt: now(),
    }));
await check('L-6b', '[정상] 한글 정상 이름은 통과', 'allow', () =>
    setDoc(doc(ctx('newbie'), 'users/newbie'), {
        uid: 'newbie', id: 'newbie1', batch: '44기', name: '신입회원',
        role: 'general', warnings: 0, createdAt: now(),
    }));

console.log('\n=== L-1 : 첨부 파일명 / MIME ===');
const noticeWith = (files) => async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/att'), {
        title: 't', content: 'c', authorId: 'alice', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'member', date: '2026.8.6',
        timestamp: now(), pinned: false, files,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: 1 });
    return b.commit();
};
await check('L-1a', 'data:text/html 첨부(로컬 실행 위험)', 'block',
    noticeWith([{ fileName: 'report.html', fileSize: 10, fileData: 'data:text/html;base64,PHNjcmlwdD4=' }]));
await check('L-1b', 'image/svg+xml 첨부', 'block',
    noticeWith([{ fileName: 'a.svg', fileSize: 10, fileData: 'data:image/svg+xml;base64,PHN2Zz4=' }]));
await check('L-1c', 'RTL override(U+202E)를 넣은 파일명', 'block',
    noticeWith([{ fileName: '\u202Ecod.exe', fileSize: 10, fileData: 'data:application/pdf;base64,AAA=' }]));
await check('L-1d', '경로 구분자가 든 파일명', 'block',
    noticeWith([{ fileName: '../../etc/passwd', fileSize: 10, fileData: 'data:application/pdf;base64,AAA=' }]));
await check('L-1e', '[정상] 한글 이름의 PDF 첨부는 계속 허용', 'allow',
    noticeWith([{ fileName: '재료역학 정리.pdf', fileSize: 10, fileData: 'data:application/pdf;base64,AAA=' }]));
await check('L-1f', '[정상] 한글 이름의 hwp/zip 첨부도 계속 허용(허용목록 방식 아님)', 'allow',
    noticeWith([{ fileName: '세미나 자료.hwp', fileSize: 10, fileData: 'data:application/x-hwp;base64,AAA=' }]));

console.log('\n=== L-14 : 서버 한도를 클라이언트 바이트 한도에 맞춤 ===');
await check('L-14a', '클라이언트 한도(2000B)를 넘는 공지 본문', 'block', async () => {
    const db = ctx('alice');
    const b = writeBatch(db);
    b.set(doc(db, 'notices/big'), {
        title: 't', content: 'A'.repeat(9000), authorId: 'alice', authorName: '앨리스맨',
        authorBatch: '42기', authorRole: 'member', date: '2026.8.6', timestamp: now(), pinned: false,
    });
    b.set(doc(db, 'traffic/alice'), { ...TODAY, noticeCount: 1 });
    return b.commit();
});

await testEnv.cleanup();

const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(64));
console.log(`총 ${results.length}건 / 통과 ${results.length - failed.length} / 미통과 ${failed.length}`);
if (failed.length) {
    console.log('\n미통과(= 취약점이 살아있거나 정상 동작이 깨짐):');
    for (const f of failed) console.log(`  [${f.id}] ${f.desc} → 기대 ${f.expect} 였으나 ${f.actual}`);
}
process.exit(failed.length ? 1 : 0);
