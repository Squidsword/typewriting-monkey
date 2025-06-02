import admin from "firebase-admin";
import serviceAccount
  from "./typewriting-monkey-firebase-admin.json";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

export const db = admin.firestore();
