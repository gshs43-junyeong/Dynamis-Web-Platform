import { db } from './firebase-config.js';
import { auth, googleProvider, githubProvider } from './firebase-config.js';
import {
    doc,
    getDoc,
    setDoc,
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

function setAuthStatus(message, type = 'info') {
    const banner = document.getElementById('auth-status-banner');
    if (!banner) return;
    if (!message) {
        banner.style.display = 'none';
        banner.textContent = '';
        banner.className = 'auth-status-banner';
        return;
    }
    banner.textContent = message;
    banner.className = `auth-status-banner ${type}`;
    banner.style.display = 'block';
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
    const usersRef = collection(db, 'users');
    const existingIdQuery = query(usersRef, where('id', '==', id));
    const existingIdSnapshot = await getDocs(existingIdQuery);
    if (!existingIdSnapshot.empty) {
        return { ok: false, message: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' };
    }

    const duplicateNameQuery = query(usersRef, where('batch', '==', batch), where('name', '==', name));
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

    getRedirectResult(auth).catch((err) => {
        console.warn('redirect result error:', err.code, err.message);
    });

    onAuthStateChanged(auth, async (user) => {
        if (!applyUserSessionUIFunc) return;
        if (!user || user.isAnonymous) {
            console.log('[Auth State] User logged out or anonymous');
            clearPendingAuthIntent();
            applyUserSessionUIFunc(null);
            return;
        }

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
                email: user.email || '',
                role: 'general',
                createdAt: Date.now()
            });
            clearPendingSignupData();
            const createdUserDoc = await getDoc(userDocRef);
            console.log('[Auth State] New user profile created successfully:', createdUserDoc.data().name);
            setAuthStatus(`${pendingAuthIntent?.providerLabel || 'GitHub/Google'} 회원가입 성공: 계정이 생성되었습니다.`, 'success');
            clearPendingAuthIntent();
            applyUserSessionUIFunc(createdUserDoc.data());
            return;
        }

        console.log('[Auth State] No pending data - creating login-only profile');
        const displayName = user.displayName || user.email?.split('@')[0] || user.uid;
        await setDoc(userDocRef, {
            uid: user.uid,
            id: user.uid,
            batch: '',
            name: displayName,
            email: user.email || '',
            role: 'general',
            createdAt: Date.now()
        });
        const createdUserDoc = await getDoc(userDocRef);
        console.log('[Auth State] Login-only profile created:', createdUserDoc.data().name);
        if (pendingAuthIntent?.type === 'signup') {
            setAuthStatus(`${pendingAuthIntent.providerLabel} 회원가입 성공: 계정이 생성되었습니다.`, 'success');
        } else if (pendingAuthIntent?.type === 'login') {
            setAuthStatus(`${pendingAuthIntent.providerLabel} 로그인 성공: 계정이 연결되었습니다.`, 'success');
        }
        clearPendingAuthIntent();
        applyUserSessionUIFunc(createdUserDoc.data());
    });
}

async function signInWithProvider(provider, providerName) {
    const persistCheckbox = document.getElementById('login-persist-checkbox');
    const shouldPersist = persistCheckbox ? persistCheckbox.checked : false;
    pendingAuthIntent = { type: 'login', providerLabel: providerName };
    setAuthStatus(`${providerName} 로그인 진행 중입니다...`, 'info');

    try {
        // Persistence 설정: 로그인 유지 체크 시 LOCAL, 미체크 시 SESSION
        const selectedPersistence = shouldPersist ? browserLocalPersistence : browserSessionPersistence;
        await setPersistence(auth, selectedPersistence);
        console.log('[Login] Persistence set to:', shouldPersist ? 'LOCAL (유지됨)' : 'SESSION (세션 종료 시 로그아웃)');
    } catch (err) {
        console.warn('[Login] Failed to set persistence:', err.message);
    }

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
    const usersRef = collection(db, 'users');
    let duplicateWarnings = [];
    let hasDuplicate = false;
    
    try {
        // 아이디 중복 검사
        const existingIdQuery = query(usersRef, where('id', '==', id));
        const existingIdSnapshot = await getDocs(existingIdQuery);
        if (!existingIdSnapshot.empty) {
            duplicateWarnings.push('⚠️ 이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.');
            hasDuplicate = true;
            console.warn('[Signup Preview] Duplicate ID detected:', id);
        }
        
        // (기수, 이름) 조합 중복 검사
        const duplicateNameQuery = query(usersRef, where('batch', '==', batch), where('name', '==', name));
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

export async function handleDeleteAccount() {
    const loggedInUser = window.loggedInUser;
    if (!loggedInUser) return alert('인증 정보가 없습니다.');

    if (!confirm('⚠️ 정말 탈퇴하시겠습니까? 이 작업은 절대 되돌릴 수 없습니다.')) return;
    if (!confirm('🚨 최종 확인: 탈퇴 시 본인 계정 정보는 물론, 그동안 작성하신 모든 공지사항, 댓글, 일일 트래픽 통계 데이터가 데이터베이스에서 영구 소멸됩니다. 이에 동의하십니까?')) return;

    const userId = loggedInUser.uid || loggedInUser.id;
    try {
        const noticesSnapshot = await getDocs(query(collection(db, 'notices'), where('authorId', '==', userId)));
        await Promise.all(noticesSnapshot.docs.map(docSnap => deleteDoc(doc(db, 'notices', docSnap.id))));

        const commentsSnapshot = await getDocs(query(collectionGroup(db, 'comments'), where('authorId', '==', userId)));
        await Promise.all(commentsSnapshot.docs.map(docSnap => deleteDoc(doc(db, docSnap.ref.path))));

        const trafficQuery = query(collection(db, 'traffic'), where('__name__', '>=', `${userId}_`), where('__name__', '<=', `${userId}_\uf8ff`));
        const trafficSnapshot = await getDocs(trafficQuery);
        await Promise.all(trafficSnapshot.docs.map(docSnap => deleteDoc(doc(db, 'traffic', docSnap.id))));

        await deleteDoc(doc(db, 'users', userId));

        alert('정상 처리되었습니다. 계정 정보 및 모든 활동 기록이 완벽히 파기되었습니다.');
        window.location.href = window.location.pathname.replace(/\/[^\/]*$/, '/home');
    } catch (err) {
        console.error(err);
        alert('⚠️ 탈퇴 및 데이터 파기 연동 중 오류가 발생했습니다. 권한(Rules) 설정을 확인해 보세요: ' + err.message);
    }
}
