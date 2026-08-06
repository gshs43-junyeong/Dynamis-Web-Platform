import { db } from './firebase-config.js';
import { auth, googleProvider, githubProvider } from './firebase-config.js';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    collectionGroup,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    signInWithPopup,
    signInWithRedirect,
    signOut,
    onAuthStateChanged,
    getRedirectResult,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { debugLog } from './utils.js';

const SIGNUP_STORAGE_KEY = 'dynamis_pending_signup';
let applyUserSessionUIFunc = null;
let signupPreviewData = null;
let pendingAuthIntent = null;

let authStatusTimer = null;

function setAuthStatus(message, type = 'info') {
    const banner = document.getElementById('auth-status-banner');
    if (!banner) return;

    if (authStatusTimer) {
        clearTimeout(authStatusTimer);
        authStatusTimer = null;
    }

    if (!message) {
        banner.style.display = 'none';
        banner.textContent = '';
        banner.className = 'auth-status-banner';
        return;
    }
    banner.textContent = message;
    banner.className = `auth-status-banner ${type}`;
    banner.style.display = 'block';

    authStatusTimer = setTimeout(() => {
        banner.style.display = 'none';
        banner.textContent = '';
        banner.className = 'auth-status-banner';
        authStatusTimer = null;
    }, 7000);
}

function clearPendingAuthIntent() {
    pendingAuthIntent = null;
}

// "로그인 상태 유지" 체크박스 값을 Firebase Auth에 반영한다.
//
// 예전에는 signInWithPopup이 성공한 "다음에" setPersistence를 불렀다. Firebase는
// 로그인 전에 설정하도록 안내하고 있고, 실제로 세션이 이미 만들어진 뒤에 저장소를
// 바꾸는 셈이라 체크박스가 의도대로 동작하지 않을 수 있었다. 대신 페이지가 뜰 때와
// 체크박스가 바뀔 때 미리 적용해두면, 로그인 버튼을 누르는 시점에는 이미 원하는
// persistence가 설정되어 있으므로 클릭 핸들러에서 await를 할 필요가 없다.
// (클릭 직후의 await는 팝업 차단을 유발한다 — signInWithProvider 주석 참고.)
export async function applyPersistencePreference() {
    const persistCheckbox = document.getElementById('login-persist-checkbox');
    const shouldPersist = !!persistCheckbox?.checked;
    const selected = shouldPersist ? browserLocalPersistence : browserSessionPersistence;
    try {
        await setPersistence(auth, selected);
        debugLog('[Login] Persistence set to:', shouldPersist ? 'LOCAL' : 'SESSION');
    } catch (err) {
        console.warn('[Login] Failed to set persistence:', err.message);
    }
}

// auth/internal-error는 Auth 서버가 SDK가 해석하지 못하는 응답을 돌려줬을 때 나오는
// 포괄 에러라, 원문만 보여주면 사용자도 개발자도 원인을 알 수 없다. 이 프로젝트에서
// 가장 흔한 원인(App Check)을 짚어 준다.
function describeAuthError(providerName, err) {
    const code = err?.code || 'unknown';
    if (code === 'auth/internal-error') {
        return `${providerName} 로그인 실패 (auth/internal-error)\n\n`
            + '대부분 App Check 문제입니다. 아래를 확인해 주세요.\n'
            + '1) Firebase 콘솔 > App Check 에서 Authentication 적용(enforce) 상태\n'
            + '2) Firebase 콘솔에 등록된 reCAPTCHA 사이트 키가 src/js/firebase-config.js의\n'
            + '   APP_CHECK_SITE_KEY와 같은 Google reCAPTCHA v3 키인지\n'
            + '3) 현재 접속 도메인이 reCAPTCHA 키의 허용 도메인에 등록되어 있는지\n'
            + '4) localhost 개발 중이라면 콘솔에 찍힌 App Check 디버그 토큰을 등록했는지\n\n'
            + `원문: ${err?.message || ''}`;
    }
    if (code === 'auth/unauthorized-domain') {
        return `${providerName} 로그인 실패: 현재 접속 도메인이 Firebase 콘솔의 승인된 도메인 목록에 없습니다.\n\n원문: ${err?.message || ''}`;
    }
    return `${providerName} 로그인 실패: ${err?.message || code}`;
}

function isProviderNotAllowedError(err) {
    return err?.code === 'auth/operation-not-allowed';
}

function showProviderSetupGuide(providerName, err) {
    const currentOrigin = window.location.origin || 'http://localhost:5173';
    const redirectUri = `${currentOrigin}/__/auth/handler`;

    console.warn(`[Auth] ${providerName} provider setup issue`, {
        origin: currentOrigin,
        redirectUri,
        errorCode: err?.code,
        errorMessage: err?.message
    });

    alert(`${providerName} 로그인은 현재 Firebase 프로젝트에서 허용되지 않았습니다.\n\nFirebase Console > Authentication > Sign-in method에서 ${providerName}를 활성화한 뒤, 승인된 redirect URI에 아래 주소를 추가해 주세요.\n${redirectUri}\n\n오류: ${err?.message || ''}`);
}

function storePendingSignupData(data) {
    sessionStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify(data));
}

function getPendingSignupData() {
    const raw = sessionStorage.getItem(SIGNUP_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function clearPendingSignupData() {
    sessionStorage.removeItem(SIGNUP_STORAGE_KEY);
}

async function resolveUniqueSignupProfile(id, batch, name) {
    const usernamesRef = collection(db, 'usernames');

    const existingIdDoc = await getDoc(doc(db, 'usernames', id));
    if (existingIdDoc.exists()) {
        return { ok: false, message: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' };
    }

    const duplicateNameQuery = query(usernamesRef, where('batch', '==', batch), where('name', '==', name));
    const duplicateNameSnapshot = await getDocs(duplicateNameQuery);
    if (duplicateNameSnapshot.empty) {
        return { ok: true, id, batch, name };
    }

    let candidateName = name;
    let suffix = 1;
    while (duplicateNameSnapshot.docs.some(docSnap => docSnap.data().name === candidateName)) {
        candidateName = `${name}${suffix}`;
        suffix += 1;
    }
    return { ok: true, id, batch, name: candidateName };
}

function validateSignupInput(id, batch, name) {
    const idRegex = /^[A-Za-z0-9_]{4,20}$/;
    const batchRegex = /^\d{2,2}기$/;
    // 실명 입력란이므로 한글/영문/숫자/공백만 허용한다. 예전에는 아무 문자나
    // 통과시켜서 <, >, 따옴표 같은 마크업 문자가 그대로 저장되고, 이 이름이
    // 화면 곳곳(작성자 표기 등)에서 다시 렌더링됐다.
    const nameRegex = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ ]{3,10}$/;

    if (!idRegex.test(id)) {
        return '아이디는 4~20자이며 영문, 숫자, 언더바(_)만 사용할 수 있습니다.';
    }
    if (!batchRegex.test(batch)) {
        return '기수는 예: 42기 형태로 2자리 숫자 + 기로 입력해 주세요.';
    }
    if (!nameRegex.test(name)) {
        return '이름은 한글/영문/숫자 3~10자로 입력해 주세요. (특수문자 불가)';
    }
    return null;
}

export function initializeAuthCallbacks(callback) {
    applyUserSessionUIFunc = callback;

    // 로그인 전에 persistence를 확정해 둔다(로그인 버튼 클릭 시 await 없이 팝업을
    // 바로 열 수 있도록). 체크박스를 건드릴 때마다 다시 반영한다.
    applyPersistencePreference();
    document.getElementById('login-persist-checkbox')
        ?.addEventListener('change', applyPersistencePreference);

    // signInWithRedirect로 나갔다가 돌아왔을 때 실패하면 지금까지는 콘솔에만 찍히고
    // 화면엔 아무 표시가 없어(특히 모바일은 콘솔을 볼 수 없으니) "그냥 안 된다"로만
    // 보였다. 실제 에러 코드를 화면에 노출해 원인을 특정할 수 있게 한다.
    getRedirectResult(auth).catch((err) => {
        console.warn('redirect result error:', err.code, err.message);
        clearPendingAuthIntent();
        if (err.code === 'auth/account-exists-with-different-credential') {
            setAuthStatus(`로그인 실패 (${err.code}): 같은 이메일로 다른 로그인 방식이 이미 가입되어 있습니다.`, 'error');
            return;
        }
        setAuthStatus(describeAuthError('리디렉트', err), 'error');
    });

    onAuthStateChanged(auth, async (user) => {
        if (!applyUserSessionUIFunc) return;
        if (!user || user.isAnonymous) {
            debugLog('[Auth State] User logged out or anonymous');
            clearPendingAuthIntent();
            applyUserSessionUIFunc(null);
            return;
        }

        try {
            debugLog('[Auth State] User logged in');
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                debugLog('[Auth State] Existing user found in Firestore');
                clearPendingSignupData();
                if (pendingAuthIntent?.type === 'signup') {
                    setAuthStatus(`${pendingAuthIntent.providerLabel} 회원가입 성공: 계정이 연결되었습니다.`, 'success');
                } else if (pendingAuthIntent?.type === 'login') {
                    setAuthStatus(`${pendingAuthIntent.providerLabel} 로그인 성공: 계정이 연결되었습니다.`, 'success');
                }
                clearPendingAuthIntent();
                applyUserSessionUIFunc(userDoc.data());

                if (userDoc.data().hasUnseenWarning) {
                    alert(`⚠️ 관리자로부터 경고를 받았습니다. (누적 경고: ${userDoc.data().warnings || 1}회)\n커뮤니티 이용 규칙을 다시 확인해 주세요.`);
                    try {
                        await updateDoc(userDocRef, { hasUnseenWarning: false });
                    } catch (warnClearErr) {
                        console.warn('[Auth State] 경고 확인 플래그 해제 실패:', warnClearErr.message);
                    }
                }
                return;
            }

            debugLog('[Auth State] New user detected, checking pending signup data...');
            const pendingData = getPendingSignupData();
            if (pendingData) {
                debugLog('[Auth State] Pending signup data found');
                const resolvedProfile = await resolveUniqueSignupProfile(pendingData.id, pendingData.batch, pendingData.name);
                if (!resolvedProfile.ok) {
                    console.error('[Auth State] Profile validation failed:', resolvedProfile.message);
                    clearPendingSignupData();
                    await signOut(auth);
                    applyUserSessionUIFunc(null);
                    alert(resolvedProfile.message);
                    return;
                }

                debugLog('[Auth State] Creating new user profile in Firestore...');
                await setDoc(userDocRef, {
                    uid: user.uid,
                    id: resolvedProfile.id,
                    batch: resolvedProfile.batch,
                    name: resolvedProfile.name,
                    role: 'general',
                    // 경고 누적은 0으로 명시해 둔다. 예전에는 이 필드를 아예 만들지
                    // 않아서, 규칙의 isValidUserUpdate가 warnings를 직접 참조하다
                    // "undefined" 평가 오류로 거부되는 바람에 경고를 한 번도 받지 않은
                    // 사용자가 소개글을 저장할 수 없었다. 규칙 쪽도 .get()으로 고쳤지만,
                    // 데이터 형태 자체를 일관되게 두는 편이 낫다.
                    warnings: 0,
                    createdAt: Date.now()
                });
                await setDoc(doc(db, 'usernames', resolvedProfile.id), {
                    uid: user.uid,
                    batch: resolvedProfile.batch,
                    name: resolvedProfile.name
                });
                // 공개 프로필(memberProfiles)은 여기서 만들지 않는다.
                //
                // 가입 직후 등급은 항상 'general'이고, 부원 목록은 admin/member/honored만
                // 렌더링하므로 미승인 계정은 화면 어디에도 나타나지 않는다. 그런데
                // 예전에는 가입 시점에 공개 프로필을 함께 만들어서, 이 컬렉션을 통째로
                // 읽으면 화면에 없는 사람들의 실명·기수까지 그대로 노출됐다.
                // 관리자가 부원으로 승격시킬 때 admin.js가 공개 프로필을 만든다.
                clearPendingSignupData();
                const createdUserDoc = await getDoc(userDocRef);
                debugLog('[Auth State] New user profile created successfully');
                setAuthStatus(`${pendingAuthIntent?.providerLabel || 'GitHub/Google'} 회원가입 성공: 계정이 생성되었습니다.`, 'success');
                clearPendingAuthIntent();
                applyUserSessionUIFunc(createdUserDoc.data());
                return;
            }

            debugLog('[Auth State] No pending signup data - unregistered account, rejecting login');
            clearPendingSignupData();
            clearPendingAuthIntent();
            await signOut(auth);
            applyUserSessionUIFunc(null);
            alert('가입되지 않은 계정입니다. 먼저 회원가입을 진행해 주세요.');
        } catch (err) {
            console.error('[Auth State] Failed to resolve user session:', err);
            clearPendingSignupData();
            clearPendingAuthIntent();
            applyUserSessionUIFunc(null);
            alert('로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n' + (err?.message || ''));
        }
    });
}

async function signInWithProvider(provider, providerName) {
    pendingAuthIntent = { type: 'login', providerLabel: providerName };
    setAuthStatus(`${providerName} 로그인 진행 중입니다...`, 'info');

    // persistence는 여기서 await하지 않는다. 로그인 전에 설정해야 한다는 건 맞지만,
    // 클릭 직후 await를 하나라도 끼우면 그 사이 user activation(사용자 제스처)이
    // 소진되어 signInWithPopup의 window.open이 "사용자가 직접 연 것이 아닌" 팝업으로
    // 취급돼 모바일 크롬에서 차단당한다. 그래서 체크박스가 바뀔 때마다 미리
    // 적용해두고(applyPersistencePreference), 여기서는 팝업만 곧바로 연다.
    try {
        await signInWithPopup(auth, provider);
        return;
    } catch (err) {
        console.warn(`${providerName} popup login failed, fallback to redirect:`, err.code, err.message);
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide(providerName, err);
            return;
        }
        if (err.code !== 'auth/popup-blocked' && err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/operation-not-supported-in-this-environment') {
            clearPendingAuthIntent();
            const message = describeAuthError(providerName, err);
            setAuthStatus(message, 'error');
            alert(message);
            return;
        }
    }

    // 팝업 자체가 진짜로 차단된 경우에만 여기로 온다. 이 시점엔 이미 제스처가
    // 끝났으므로 persistence를 확실히 반영하고 넘어가도 손해가 없다.
    await applyPersistencePreference();

    try {
        debugLog('[Login] Using redirect for', providerName, 'login');
        await signInWithRedirect(auth, provider);
    } catch (err) {
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide(providerName, err);
            return;
        }
        clearPendingAuthIntent();
        const message = describeAuthError(providerName, err);
        setAuthStatus(message, 'error');
        alert(`${message}\n\n(팝업이 차단되어 리디렉트 방식으로 시도했습니다.)`);
    }
}

export async function handleLoginWithGoogle() {
    await signInWithProvider(googleProvider, 'Google');
}

export async function handleLoginWithGitHub() {
    await signInWithProvider(githubProvider, 'GitHub');
}

function areConsentChecksPassed() {
    const consent1 = document.getElementById('signup-consent-1');
    const consent2 = document.getElementById('signup-consent-2');
    const consent3 = document.getElementById('signup-consent-3');
    return !!(consent1?.checked && consent2?.checked && consent3?.checked);
}

export async function handleSignupWithGoogle() {
    const idInput = document.getElementById('signup-id');
    const batchInput = document.getElementById('signup-batch');
    const nameInput = document.getElementById('signup-name');
    if (!idInput || !batchInput || !nameInput) {
        alert('회원가입 폼을 찾을 수 없습니다. 페이지를 새로 고침해 주세요.');
        return;
    }

    const id = idInput.value.trim();
    const batch = batchInput.value.trim();
    const name = nameInput.value.trim();

    if (!id || !batch || !name) {
        alert('학번/아이디, 기수, 이름을 모두 입력해 주세요.');
        return;
    }

    const validationMessage = validateSignupInput(id, batch, name);
    if (validationMessage) {
        alert(validationMessage);
        return;
    }

    if (!areConsentChecksPassed()) {
        alert('회원가입을 진행하려면 모든 동의 항목에 체크해 주세요.');
        return;
    }

    debugLog('[Signup Flow] Google signup - showing preview:', { id, batch, name });
    await window.showSignupPreview(id, batch, name, 'google');
}

export async function handleSignupWithGitHub() {
    const idInput = document.getElementById('signup-id');
    const batchInput = document.getElementById('signup-batch');
    const nameInput = document.getElementById('signup-name');
    if (!idInput || !batchInput || !nameInput) {
        alert('회원가입 폼을 찾을 수 없습니다. 페이지를 새로 고침해 주세요.');
        return;
    }

    const id = idInput.value.trim();
    const batch = batchInput.value.trim();
    const name = nameInput.value.trim();

    if (!id || !batch || !name) {
        alert('학번/아이디, 기수, 이름을 모두 입력해 주세요.');
        return;
    }

    const validationMessage = validateSignupInput(id, batch, name);
    if (validationMessage) {
        alert(validationMessage);
        return;
    }

    if (!areConsentChecksPassed()) {
        alert('회원가입을 진행하려면 모든 동의 항목에 체크해 주세요.');
        return;
    }

    debugLog('[Signup Flow] GitHub signup - showing preview:', { id, batch, name });
    await window.showSignupPreview(id, batch, name, 'github');
}

export async function handleLogout() {
    try {
        await signOut(auth);
        setAuthStatus('로그아웃되었습니다.', 'info');
        window.location.href = window.location.pathname.replace(/\/[^\/]*$/, '/home');
    } catch (err) {
        alert('로그아웃 실패: ' + err.message);
    }
}

window.showSignupPreview = async function(id, batch, name, provider) {
    document.getElementById('preview-id').textContent = id;
    document.getElementById('preview-batch').textContent = batch;
    document.getElementById('preview-name').textContent = name;
    
    signupPreviewData = { id, batch, name };
    
    const googleBtn = document.getElementById('signup-preview-google-btn');
    const githubBtn = document.getElementById('signup-preview-github-btn');
    const warningsBox = document.getElementById('signup-preview-warnings');
    
    if (provider === 'google') {
        googleBtn.style.display = 'block';
        githubBtn.style.display = 'none';
    } else {
        googleBtn.style.display = 'none';
        githubBtn.style.display = 'block';
    }
    
    // 중복 검사 수행
    debugLog('[Signup Preview] Checking for duplicates...');
    const usernamesRef = collection(db, 'usernames');
    let duplicateWarnings = [];
    let hasDuplicate = false;
    
    try {
        // 아이디 중복 검사
        const existingIdSnap = await getDoc(doc(db, 'usernames', id));
        if (existingIdSnap.exists()) {
            duplicateWarnings.push('⚠️ 이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.');
            hasDuplicate = true;
            console.warn('[Signup Preview] Duplicate ID detected:', id);
        }
        
        // (기수, 이름) 조합 중복 검사
        const duplicateNameQuery = query(usernamesRef, where('batch', '==', batch), where('name', '==', name));
        const duplicateNameSnapshot = await getDocs(duplicateNameQuery);
        if (!duplicateNameSnapshot.empty) {
            duplicateWarnings.push(`⚠️ 같은 기수(${batch})와 이름(${name})의 계정이 이미 존재합니다. 이름을 다르게 입력해 주세요.`);
            hasDuplicate = true;
            console.warn('[Signup Preview] Duplicate (batch, name) detected:', batch, name);
        }
    } catch (err) {
        console.error('[Signup Preview] Error checking duplicates:', err);
    }
    
    // 경고 메시지 표시.
    // 문구에 사용자가 입력한 이름/기수가 섞여 들어가므로 innerHTML로 조립하면
    // 입력값이 그대로 마크업으로 해석된다. textContent로만 넣는다.
    warningsBox.textContent = '';
    if (duplicateWarnings.length > 0) {
        warningsBox.style.display = 'block';
        duplicateWarnings.forEach((w) => {
            const p = document.createElement('p');
            p.style.color = '#ff5555';
            p.style.margin = '0.4rem 0';
            p.style.fontSize = '0.95rem';
            p.textContent = w;
            warningsBox.appendChild(p);
        });
    } else {
        warningsBox.style.display = 'none';
    }
    
    // 중복 여부에 따라 버튼 활성/비활성화
    if (hasDuplicate) {
        googleBtn.disabled = true;
        githubBtn.disabled = true;
        googleBtn.style.opacity = '0.5';
        githubBtn.style.opacity = '0.5';
        googleBtn.style.cursor = 'not-allowed';
        githubBtn.style.cursor = 'not-allowed';
    } else {
        googleBtn.disabled = false;
        githubBtn.disabled = false;
        googleBtn.style.opacity = '1';
        githubBtn.style.opacity = '1';
        googleBtn.style.cursor = 'pointer';
        githubBtn.style.cursor = 'pointer';
    }
    
    document.getElementById('signup-preview-modal').style.display = 'flex';
};

window.closeSignupPreview = function() {
    document.getElementById('signup-preview-modal').style.display = 'none';
    signupPreviewData = null;
};

window.proceedSignupWithGoogle = async function() {
    if (!signupPreviewData) return;
    const { id, batch, name } = signupPreviewData;
    
    debugLog('[Signup Flow] Proceeding with Google OAuth after preview confirmation:', { id, batch, name });
    window.closeSignupPreview();
    storePendingSignupData({ id, batch, name });
    pendingAuthIntent = { type: 'signup', providerLabel: 'Google' };
    setAuthStatus('Google 회원가입 진행 중입니다...', 'info');
    
    try {
        await signInWithPopup(auth, googleProvider);
        return;
    } catch (err) {
        console.warn('[Signup Flow] Google popup failed, fallback to redirect:', err.code, err.message);
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide('Google', err);
            return;
        }
        if (err.code !== 'auth/popup-blocked' && err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/operation-not-supported-in-this-environment') {
            clearPendingAuthIntent();
            const message = describeAuthError('Google 회원가입', err);
            setAuthStatus(message, 'error');
            alert(message);
            return;
        }
    }

    try {
        debugLog('[Signup Flow] Using redirect for Google signup');
        await signInWithRedirect(auth, googleProvider);
    } catch (err) {
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide('Google', err);
            return;
        }
        clearPendingAuthIntent();
        setAuthStatus('Google 회원가입 실패: ' + err.message, 'error');
        alert('Google 회원가입 실패: ' + err.message + '\n팝업이 차단되어 리디렉트 방식으로 시도했습니다.');
    }
};

window.proceedSignupWithGitHub = async function() {
    if (!signupPreviewData) return;
    const { id, batch, name } = signupPreviewData;
    
    debugLog('[Signup Flow] Proceeding with GitHub OAuth after preview confirmation:', { id, batch, name });
    window.closeSignupPreview();
    storePendingSignupData({ id, batch, name });
    pendingAuthIntent = { type: 'signup', providerLabel: 'GitHub' };
    setAuthStatus('GitHub 회원가입 진행 중입니다...', 'info');
    
    try {
        await signInWithPopup(auth, githubProvider);
        return;
    } catch (err) {
        console.warn('[Signup Flow] GitHub popup failed, fallback to redirect:', err.code, err.message);
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide('GitHub', err);
            return;
        }
        if (err.code !== 'auth/popup-blocked' && err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/operation-not-supported-in-this-environment') {
            clearPendingAuthIntent();
            const message = describeAuthError('GitHub 회원가입', err);
            setAuthStatus(message, 'error');
            alert(message);
            return;
        }
    }

    try {
        debugLog('[Signup Flow] Using redirect for GitHub signup');
        await signInWithRedirect(auth, githubProvider);
    } catch (err) {
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide('GitHub', err);
            return;
        }
        clearPendingAuthIntent();
        setAuthStatus('GitHub 회원가입 실패: ' + err.message, 'error');
        alert('GitHub 회원가입 실패: ' + err.message + '\n팝업이 차단되어 리디렉트 방식으로 시도했습니다.');
    }
};

// 특정 사용자가 작성한 부가 데이터(공지/이벤트/댓글/트래픽)를 best-effort로 정리한다.
// 각 단계는 독립적으로 try/catch 하므로, 한 쿼리가 규칙/권한 문제로 실패해도
// 나머지 정리와(무엇보다) 핵심 계정 문서 삭제가 막히지 않는다.
// includeTraffic: 트래픽 통계는 본인만 읽을 수 있으므로 본인 탈퇴 때만 true.
export async function purgeUserOwnedData(userId, { includeTraffic = false } = {}) {
    // 1. 본인이 작성한 공지 삭제
    try {
        const noticesSnapshot = await getDocs(query(collection(db, 'notices'), where('authorId', '==', userId)));
        await Promise.all(noticesSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
    } catch (err) {
        console.warn('[Purge] 공지 정리 실패(계속 진행):', err.message);
    }
    // 2. 본인이 작성한 이벤트 삭제
    try {
        const eventsSnapshot = await getDocs(query(collection(db, 'events'), where('authorId', '==', userId)));
        await Promise.all(eventsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
    } catch (err) {
        console.warn('[Purge] 이벤트 정리 실패(계속 진행):', err.message);
    }
    // 3. 본인이 작성한 댓글 삭제 (공지/이벤트 전반 collectionGroup 조회)
    try {
        const commentsSnapshot = await getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', userId)));
        await Promise.all(commentsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
    } catch (err) {
        console.warn('[Purge] 댓글 정리 실패(계속 진행):', err.message);
    }
    // 4. 트래픽 통계 삭제 (본인만 읽기 가능)
    // 문서 ID가 traffic/{uid}_{날짜} 에서 traffic/{uid} 로 바뀌어 단일 문서를 지운다.
    if (includeTraffic) {
        try {
            await deleteDoc(doc(db, 'traffic', userId));
        } catch (err) {
            console.warn('[Purge] 트래픽 정리 실패(계속 진행):', err.message);
        }
    }
}

export async function handleDeleteAccount() {
    const loggedInUser = window.loggedInUser;
    if (!loggedInUser) return alert('인증 정보가 없습니다.');

    if (!confirm('⚠️ 정말 탈퇴하시겠습니까? 이 작업은 절대 되돌릴 수 없습니다.')) return;
    if (!confirm('🚨 최종 확인: 탈퇴 시 본인 계정 정보는 물론, 그동안 작성하신 모든 공지사항, 댓글, 일일 트래픽 통계 데이터가 데이터베이스에서 영구 소멸됩니다. 이에 동의하십니까?')) return;

    const userId = loggedInUser.uid || loggedInUser.id;

    // 부가 데이터는 best-effort로 먼저 정리한다(일부 실패해도 무방).
    await purgeUserOwnedData(userId, { includeTraffic: true });

    // 핵심: 계정 문서 삭제. 이게 성공해야 실질적인 탈퇴가 완료된다.
    try {
        await deleteDoc(doc(db, 'users', userId));
        try {
            await deleteDoc(doc(db, 'memberProfiles', userId));
        } catch (profileErr) {
            console.warn('[Delete Account] 공개 프로필 삭제 실패(이미 없을 수 있음):', profileErr.message);
        }
        if (loggedInUser.id) {
            try {
                await deleteDoc(doc(db, 'usernames', loggedInUser.id));
            } catch (usernameErr) {
                console.warn('[Delete Account] usernames 문서 삭제 실패(이미 없을 수 있음):', usernameErr.message);
            }
        }
    } catch (err) {
        console.error('[Delete Account] 계정 문서 삭제 실패:', err);
        alert('⚠️ 탈퇴 처리 중 오류가 발생했습니다. 권한(Rules) 설정을 확인해 보세요: ' + err.message);
        return;
    }

    // 가능하면 Firebase Auth 계정 자체도 삭제한다(최근 로그인이 아니면 재인증 필요).
    // 실패해도 Firestore 계정 정보는 이미 파기됐으므로 로그아웃으로 세션을 종료한다.
    try {
        if (auth.currentUser) {
            await auth.currentUser.delete();
        }
    } catch (authErr) {
        console.warn('[Delete Account] Auth 계정 삭제 건너뜀(재로그인 필요 등):', authErr.code, authErr.message);
        try { await signOut(auth); } catch { /* 무시 */ }
    }

    alert('정상 처리되었습니다. 계정 정보 및 활동 기록이 파기되었습니다.');
    window.location.href = window.location.pathname.replace(/\/[^\/]*$/, '/home');
}

