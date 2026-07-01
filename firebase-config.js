import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyC31TiRfm5yMKfMGDc8eLAUJXLS2BoldCQ",
    authDomain: "dynamis-web-platform-server.firebaseapp.com",
    projectId: "dynamis-web-platform-server",
    storageBucket: "dynamis-web-platform-server.firebasestorage.app",
    messagingSenderId: "337456639728",
    appId: "1:337456639728:web:cff8a4f7f54ba4700d5c35"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

const appCheckSiteKey = "6LfYjjEtAAAAAKG2hFqqY0hazDsV8QoA8xmG_iYL"; // Firebase 콘솔에서 발급받은 키로 교체하세요.
initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true
});

export const db = getFirestore(app);
