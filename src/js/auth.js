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
    const nameRegex = /^[\s\S]{3,10}$/;

    if (!idRegex.test(id)) {
        return '아이디는 4~20자이며 영문, 숫자, 언더바(_)만 사용할 수 있습니다.';
    }
    if (!batchRegex.test(batch)) {
        return '기수는 예: 42기 형태로 2자리 숫자 + 기로 입력해 주세요.';
    }
    if (!nameRegex.test(name)) {
        return '이름은 3~10자 이내로 입력해 주세요.';
    }
    return null;
}

export function initializeAuthCallbacks(callback) {
    applyUserSessionUIFunc = callback;

    // signInWithRedirect로 나갔다가 돌아왔을 때 실패하면 지금까지는 콘솔에만 찍히고
    // 화면엔 아무 표시가 없어(특히 모바일은 콘솔을 볼 수 없으니) "그냥 안 된다"로만
    // 보였다. 실제 에러 코드를 화면에 노출해 원인을 특정할 수 있게 한다.
    getRedirectResult(auth).catch((err) => {
        console.warn('redirect result error:', err.code, err.message);
        clearPendingAuthIntent();
        let hint = '';
        if (err.code === 'auth/unauthorized-domain') {
            hint = '\n(현재 접속 도메인이 Firebase 콘솔의 승인된 도메인 목록에 없습니다.)';
        } else if (err.code === 'auth/account-exists-with-different-credential') {
            hint = '\n(같은 이메일로 다른 로그인 방식이 이미 가입되어 있습니다.)';
        }
        setAuthStatus(`로그인 실패 (${err.code || 'unknown'}): ${err.message}${hint}`, 'error');
    });

    onAuthStateChanged(auth, async (user) => {
        if (!applyUserSessionUIFunc) return;
        if (!user || user.isAnonymous) {
            console.log('[Auth State] User logged out or anonymous');
            clearPendingAuthIntent();
            applyUserSessionUIFunc(null);
            return;
        }

        try {
            console.log('[Auth State] User logged in:', user.uid, user.email);
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                console.log('[Auth State] Existing user found in Firestore:', userDoc.data().name);
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

            console.log('[Auth State] New user detected, checking pending signup data...');
            const pendingData = getPendingSignupData();
            if (pendingData) {
                console.log('[Auth State] Pending signup data found:', pendingData);
                const resolvedProfile = await resolveUniqueSignupProfile(pendingData.id, pendingData.batch, pendingData.name);
                if (!resolvedProfile.ok) {
                    console.error('[Auth State] Profile validation failed:', resolvedProfile.message);
                    clearPendingSignupData();
                    await signOut(auth);
                    applyUserSessionUIFunc(null);
                    alert(resolvedProfile.message);
                    return;
                }

                console.log('[Auth State] Creating new user profile in Firestore...');
                await setDoc(userDocRef, {
                    uid: user.uid,
                    id: resolvedProfile.id,
                    batch: resolvedProfile.batch,
                    name: resolvedProfile.name,
                    role: 'general',
                    createdAt: Date.now()
                });
                await setDoc(doc(db, 'usernames', resolvedProfile.id), {
                    uid: user.uid,
                    batch: resolvedProfile.batch,
                    name: resolvedProfile.name
                });
                clearPendingSignupData();
                const createdUserDoc = await getDoc(userDocRef);
                console.log('[Auth State] New user profile created successfully:', createdUserDoc.data().name);
                setAuthStatus(`${pendingAuthIntent?.providerLabel || 'GitHub/Google'} 회원가입 성공: 계정이 생성되었습니다.`, 'success');
                clearPendingAuthIntent();
                applyUserSessionUIFunc(createdUserDoc.data());
                return;
            }

            console.log('[Auth State] No pending signup data - unregistered account, rejecting login');
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
    const persistCheckbox = document.getElementById('login-persist-checkbox');
    const shouldPersist = persistCheckbox ? persistCheckbox.checked : false;
    pendingAuthIntent = { type: 'login', providerLabel: providerName };
    setAuthStatus(`${providerName} 로그인 진행 중입니다...`, 'info');

    try {
        // Persistence 설정: 로그인 유지 체크 시 LOCAL, 미체크 시 SESSION.
        const selectedPersistence = shouldPersist ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, selectedPersistence);
        console.log('[Login] Persistence set to:', selectedPersistence === browserLocalPersistence ? 'LOCAL' : 'SESSION');
    } catch (err) {
        console.warn('[Login] Failed to set persistence:', err.message);
    }

    // 모바일에서 signInWithRedirect를 강제했더니 Google은 계정 선택 후 로그인이
    // 완료되지 않고, GitHub는 404로 아예 실패하는 것으로 확인됐다(데스크톱 팝업은
    // 정상 동작). 같은 Firebase/OAuth 앱 설정에서 팝업만 작동하는 걸 보면 원인은
    // 콘솔 설정이 아니라 리디렉트 경로 자체(모바일 크롬의 서드파티 스토리지 파티셔닝이
    // authDomain↔앱 도메인 간 왕복에 필요한 상태 저장을 막는 것으로 추정)에 있다.
    // 그래서 모바일도 다시 데스크톱과 동일하게 팝업을 우선 시도하고, 팝업 자체가
    // 막힌 경우에만 리디렉트로 폴백한다.
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
            setAuthStatus(`${providerName} 로그인 실패: ${err.message}`, 'error');
            alert(`${providerName} 로그인 실패: ${err.message}`);
            return;
        }
    }

    try {
        console.log('[Login] Using redirect for', providerName, 'login');
        await signInWithRedirect(auth, provider);
    } catch (err) {
        if (isProviderNotAllowedError(err)) {
            clearPendingAuthIntent();
            showProviderSetupGuide(providerName, err);
            return;
        }
        clearPendingAuthIntent();
        setAuthStatus(`${providerName} 로그인 실패: ${err.message}`, 'error');
        alert(`${providerName} 로그인 실패: ${err.message}\n팝업이 차단되어 리디렉트 방식으로 시도했습니다.`);
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

    console.log('[Signup Flow] Google signup - showing preview:', { id, batch, name });
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

    console.log('[Signup Flow] GitHub signup - showing preview:', { id, batch, name });
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
    console.log('[Signup Preview] Checking for duplicates...');
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
    
    // 경고 메시지 표시
    if (duplicateWarnings.length > 0) {
        warningsBox.style.display = 'block';
        warningsBox.innerHTML = duplicateWarnings.map(w => `<p style="color: #ff5555; margin: 0.4rem 0; font-size: 0.95rem;">${w}</p>`).join('');
    } else {
        warningsBox.style.display = 'none';
        warningsBox.innerHTML = '';
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
    
    console.log('[Signup Flow] Proceeding with Google OAuth after preview confirmation:', { id, batch, name });
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
            setAuthStatus('Google 회원가입 실패: ' + err.message, 'error');
            alert('Google 회원가입 실패: ' + err.message);
            return;
        }
    }

    try {
        console.log('[Signup Flow] Using redirect for Google signup');
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
    
    console.log('[Signup Flow] Proceeding with GitHub OAuth after preview confirmation:', { id, batch, name });
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
            setAuthStatus('GitHub 회원가입 실패: ' + err.message, 'error');
            alert('GitHub 회원가입 실패: ' + err.message);
            return;
        }
    }

    try {
        console.log('[Signup Flow] Using redirect for GitHub signup');
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
    if (includeTraffic) {
        try {
            const trafficQuery = query(collection(db, 'traffic'), where('__name__', '>=', `${userId}_`), where('__name__', '<=', `${userId}_\uf8ff`));
            const trafficSnapshot = await getDocs(trafficQuery);
            await Promise.all(trafficSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref)));
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

