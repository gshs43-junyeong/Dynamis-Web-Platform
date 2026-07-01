import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { db } from './firebase-config.js';

export async function verifyAndIncrementTraffic(userId, actionType, sizeOrCount, maxLimit) {
    if (!userId) {
        return false;
    }

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const trafficDocRef = doc(db, 'traffic', `${userId}_${todayStr}`);

    try {
        const docSnapshot = await getDoc(trafficDocRef);
        let currentVal = 0;

        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            currentVal = data[actionType] || 0;
        }

        if (currentVal + sizeOrCount > maxLimit) {
            return false;
        }

        await setDoc(trafficDocRef, { [actionType]: currentVal + sizeOrCount }, { merge: true });
        return true;
    } catch (error) {
        console.error('트래픽 제어 시스템 통신 장애:', error);
        return false;
    }
}
