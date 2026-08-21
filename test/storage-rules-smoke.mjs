// storage.rules 수동 스모크 테스트. test/rules.test.mjs와 같은 패턴이지만
// Storage 쪽은 파일 배열 기반 검증(hasOnly 등)이 없어 케이스 수가 적어
// 별도 파일로 뒀다. firestore.get() cross-service 호출이 실제로 Firestore
// 에뮬레이터 데이터를 읽어오는지가 핵심 확인 대상이다.
//
// 실행 전: npm i --no-save firebase-tools @firebase/rules-unit-testing firebase
//         firebase emulators:start --only firestore,storage --project dynamis-audit
// 실행:    node test/storage-rules-smoke.mjs
//
// ⚠️ 샌드박스에서 작성할 당시 firestore.get() cross-service 호출(myRole()/작성자
// 대조)이 이 환경의 Storage↔Firestore 에뮬레이터 간 통신에서만 "no rule allows
// host 127.0.0.1"로 실패해, 허용(allow) 경로(S-2/S-4/S-10)를 로컬에서 끝까지
// 검증하지 못했다. 거부(block) 경로는 전부 통과했고 문법도 Firebase 공식 문서와
// 대조 확인했지만, 실제 Firebase 프로젝트(또는 이 샌드박스 밖의 로컬 환경)에서
// 한 번은 이 스크립트를 다시 돌려 S-2/S-4/S-10이 'allow'로 나오는지 확인할 것.
// (실패 시 fail-closed라 보안 사고는 아니지만, 그러면 아무도 첨부를 못 올린다.)
import { readFileSync } from 'fs';
import {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, deleteObject } from 'firebase/storage';

const testEnv = await initializeTestEnvironment({
    projectId: 'dynamis-audit',
    firestore: { rules: readFileSync('firebase.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
});

async function seed(fn) {
    await testEnv.withSecurityRulesDisabled(async (c) => fn(c.firestore()));
}

await testEnv.clearFirestore();
await seed(async (db) => {
    await setDoc(doc(db, 'users/alice'), { uid: 'alice', id: 'alice1', batch: '42기', name: '앨리스', role: 'member' });
    await setDoc(doc(db, 'users/hosea'), { uid: 'hosea', id: 'hosea1', batch: '43기', name: '호세아', role: 'honored' });
    await setDoc(doc(db, 'users/admin1'), { uid: 'admin1', id: 'adm', batch: '41기', name: '관리자', role: 'admin' });
    await setDoc(doc(db, 'notices/n1'), { title: 't', authorId: 'alice', date: 'd', timestamp: 1 });
});

const results = [];
async function check(id, desc, expect, fn) {
    let actual;
    try {
        await (expect === 'block' ? assertFails(fn()) : assertSucceeds(fn()));
        actual = expect;
    } catch (e) {
        actual = expect === 'block' ? 'allow' : 'block';
        if (process.env.DEBUG) console.error(id, e.message);
    }
    const ok = actual === expect;
    results.push({ id, desc, expect, actual, ok });
    console.log(`${ok ? '  OK ' : 'FAIL'} [${id}] ${desc}  (기대=${expect} 실제=${actual})`);
}

function storageAs(uid) {
    const ctx = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
    return ctx.storage();
}

const smallPng = new Uint8Array(1000);
const bigFile = new Uint8Array(800000); // 700KB 상한 초과

await check('S-1', '비로그인은 업로드 불가', 'block', () =>
    uploadBytes(ref(storageAs(null), 'attachments/notices/n1/f1'), smallPng, { contentType: 'image/png' })
);

await check('S-2', '작성자 본인은 업로드 가능', 'allow', () =>
    uploadBytes(ref(storageAs('alice'), 'attachments/notices/n1/f2'), smallPng, { contentType: 'image/png' })
);

await check('S-3', '작성자가 아닌 일반 부원은 업로드 불가', 'block', () =>
    uploadBytes(ref(storageAs('bob'), 'attachments/notices/n1/f3'), smallPng, { contentType: 'image/png' })
);

await check('S-4', '관리자는 남의 notice에도 업로드 가능', 'allow', () =>
    uploadBytes(ref(storageAs('admin1'), 'attachments/notices/n1/f4'), smallPng, { contentType: 'image/png' })
);

await check('S-5', '명예부원은 본인 글이어도 업로드 불가', 'block', () => {
    return seed(async (db) => setDoc(doc(db, 'notices/n2'), { title: 't', authorId: 'hosea', date: 'd', timestamp: 1 }))
        .then(() => uploadBytes(ref(storageAs('hosea'), 'attachments/notices/n2/f5'), smallPng, { contentType: 'image/png' }));
});

await check('S-6', '700KB 초과 파일은 작성자여도 거부', 'block', () =>
    uploadBytes(ref(storageAs('alice'), 'attachments/notices/n1/f6'), bigFile, { contentType: 'image/png' })
);

await check('S-7', 'HTML MIME은 작성자여도 거부 (액티브 콘텐츠 차단)', 'block', () =>
    uploadBytes(ref(storageAs('alice'), 'attachments/notices/n1/f7'), smallPng, { contentType: 'text/html' })
);

await check('S-8', '존재하지 않는 notice 경로는 거부', 'block', () =>
    uploadBytes(ref(storageAs('alice'), 'attachments/notices/does-not-exist/f8'), smallPng, { contentType: 'image/png' })
);

await check('S-9', 'attachments/ 밖 임의 경로는 항상 거부', 'block', () =>
    uploadBytes(ref(storageAs('admin1'), 'random/other/path'), smallPng, { contentType: 'image/png' })
);

await check('S-10', '작성자 본인은 첨부 삭제 가능', 'allow', () =>
    deleteObject(ref(storageAs('alice'), 'attachments/notices/n1/f2'))
);

await check('S-11', '작성자가 아니면 첨부 삭제 불가', 'block', () =>
    deleteObject(ref(storageAs('bob'), 'attachments/notices/n1/f4'))
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (failed.length) {
    console.log('실패:', failed.map((f) => f.id).join(', '));
    process.exit(1);
}
await testEnv.cleanup();
process.exit(0);
