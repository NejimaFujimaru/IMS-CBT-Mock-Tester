// Firebase Configuration File
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDhjERbOHkQNp4iPsd5AalxQQaMtsj_0qg",
  authDomain: "learnfinity-2-fc2fe.firebaseapp.com",
  projectId: "learnfinity-2-fc2fe",
  storageBucket: "learnfinity-2-fc2fe.firebasestorage.app",
  messagingSenderId: "51225077280",
  appId: "1:51225077280:web:a49e140bc4f8c7e953be45",
  measurementId: "G-NZERRJ7MBK"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Export Firebase services for use in other modules
export { app, analytics, auth, db, storage };
