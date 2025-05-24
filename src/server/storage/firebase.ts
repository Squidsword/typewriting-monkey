import admin from "firebase-admin";
import serviceAccount
  from "./typewriting-monkey-firebase-adminsdk-fbsvc-0e770351ec.json";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

export const db = admin.firestore();
