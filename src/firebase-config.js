// Firebase Web configuration is public by design; security is enforced by Auth + Firestore rules.
// IMPORTANT: The apiKey supplied by Firebase Gemini looked synthetic. Replace it with the exact
// value from Firebase Console > Project settings > Your apps > Kotlin Learning Tracker Web.
export const firebaseConfig = {
  apiKey: "REPLACE_WITH_FIREBASE_CONSOLE_API_KEY",
  authDomain: "kotlin-learning-tracker.firebaseapp.com",
  projectId: "kotlin-learning-tracker",
  storageBucket: "kotlin-learning-tracker.appspot.com",
  messagingSenderId: "1052213919057",
  appId: "1:1052213919057:web:9c7a23fb51e8e0d6"
};

export const functionsRegion = "us-central1";
export const firebaseSdkVersion = "12.18.0";
