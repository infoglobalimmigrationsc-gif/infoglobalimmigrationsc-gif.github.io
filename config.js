// config.js - Firebase Configuration for Global Immigration SC
// Retrieved from Firebase Console on Project Settings page

const firebaseConfig = {
    apiKey: "AIzaSyAJ3p91t83EQeQ6XopPfvisc1fIdsWIMm8",
    authDomain: "global-immigration-sc.firebaseapp.com",
    projectId: "global-immigration-sc",
    storageBucket: "global-immigration-sc.firebasestorage.app",
    messagingSenderId: "791181145117",
    appId: "1:791181145117:web:527b7df63c9a32adf9c2f4",
    measurementId: "G-1FJHEV0NLW"
};

// Make configuration available globally
if (typeof window !== 'undefined') {
    window.firebaseConfig = firebaseConfig;
}

// Console log for verification (remove in production)
console.log('✅ Firebase configuration loaded successfully');
