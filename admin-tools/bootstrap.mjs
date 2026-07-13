import fs from "node:fs";
import crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const [, , serviceAccountPath, adminEmailArg, appUrlArg] = process.argv;

if (!serviceAccountPath || !adminEmailArg) {
  console.error("Usage: node bootstrap.mjs /path/to/service-account.json admin@example.com [https://your-site.github.io/repository/]");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const db = getFirestore();
const adminEmail = adminEmailArg.trim().toLowerCase();
const appUrl = appUrlArg || "https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/";

let adminUser;
let temporaryPassword = null;
try {
  adminUser = await auth.getUserByEmail(adminEmail);
  if (!adminUser.emailVerified) {
    adminUser = await auth.updateUser(adminUser.uid, { emailVerified: true });
  }
} catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  temporaryPassword = `AIM-${crypto.randomBytes(12).toString("base64url")}!9a`;
  adminUser = await auth.createUser({
    email: adminEmail,
    password: temporaryPassword,
    emailVerified: true,
    displayName: "AIM Administrator"
  });
}

const batch = db.batch();
batch.set(db.doc(`users/${adminUser.uid}`), {
  email: adminEmail,
  emailLower: adminEmail,
  displayName: adminUser.displayName || "AIM Administrator",
  role: "admin",
  approved: true,
  status: "active",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  notificationPreferences: {
    allMuted: false,
    planUpdates: true,
    comments: true,
    relationships: true,
    documents: true,
    administrative: true
  },
  lastLoginAt: FieldValue.serverTimestamp()
}, { merge: true });

batch.set(db.doc("settings/app"), {
  registrationMode: "testing",
  autosaveDelaySeconds: 25,
  institutionName: "Spring Hill College",
  studentDomain: "email.shc.edu",
  facultyDomain: "shc.edu",
  appUrl,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true });

batch.set(db.doc("emailApprovals/palitpriyojit@gmail.com"), {
  email: "palitpriyojit@gmail.com",
  role: "student",
  active: true,
  note: "Initial external student test account",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
}, { merge: true });

await batch.commit();

console.log("\nAIM bootstrap completed.");
console.log(`Administrator: ${adminEmail}`);
console.log("Registration mode: testing");
console.log("Preapproved test student: palitpriyojit@gmail.com");
if (temporaryPassword) {
  console.log(`Temporary administrator password: ${temporaryPassword}`);
  console.log("Sign in and use the password-reset feature to replace it immediately.");
} else {
  console.log("The existing Firebase Authentication account was promoted to AIM administrator.");
}
