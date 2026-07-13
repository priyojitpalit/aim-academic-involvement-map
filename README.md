# AIM: Academic & Involvement Map

A static HTML/CSS/JavaScript application for a four-year student Academic & Involvement Map. The frontend can be hosted on GitHub Pages. Firebase Authentication and Cloud Firestore provide verified accounts and persistence.

## This version intentionally requires no billing account

It uses only:

- GitHub Pages for the website
- Firebase Authentication for email/password login, email verification, and password-reset emails
- Cloud Firestore for users, plans, comments, relationships, in-app notifications, audit history, settings, and document links

It does **not** use:

- Cloud Functions
- scheduled functions or Cloud Scheduler
- Firebase Storage
- Firebase Extensions
- SMTP or Spring Hill College email integration
- automated plan/comment emails

Firebase Authentication still sends its own verification and password-reset messages. All AIM activity notifications are shown inside the application.

## Main capabilities

### Students

- Build the AIM plan over four academic years, three summers, and post-graduation planning.
- Open one collapsed stage at a time so the path remains compact.
- Draft text is saved immediately in the browser and synchronized to Firestore after approximately 25 seconds of inactivity, when a section closes, when **Save now** is pressed, or when navigating away.
- Add several advisors.
- Request advisor removal; the relationship remains active until an administrator approves it.
- Add links to a résumé, cover letter, degree plan, internship/research/study-abroad materials, certificates, or other documents.
- Receive configurable in-app notifications.

### Faculty

- Have several advisees.
- Add students by email.
- View advisee plans and document links.
- Comment on individual stages.
- Remove their own advisee relationship.
- Receive configurable in-app notifications.

### Administrators

- View and edit every student plan.
- Search all students by name or email.
- Search/select students and advisors while creating many-to-many relationships.
- Enter an email for an unregistered student or faculty member; AIM preapproves the email and saves a pending relationship that activates after registration.
- Promote a registered user to administrator.
- Preapprove an unregistered email as Student, Faculty, or Administrator.
- Approve or reject student requests to remove an advisor.
- View a dashboard summary of activity since local midnight; this replaces a scheduled emailed digest.
- Change registration mode and autosave delay.

## Preview without installing anything

1. Extract the ZIP.
2. Double-click `start-preview.bat`.
3. The browser should open `http://localhost:8000/preview.html`.
4. Use **Preview as** to switch among Student, Faculty, and Admin.

The preview stores demonstration changes only in the browser.

## Firebase setup

### 1. Create a Firebase project

In Firebase Console:

1. Create a project.
2. Add a Web App.
3. Copy the web configuration into `firebase-config.js`.

The file should resemble:

```javascript
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

The `storageBucket` value can remain in the standard Firebase configuration even though this application does not use Firebase Storage.

### 2. Enable Authentication

In **Authentication → Sign-in method**, enable **Email/Password**. Do not enable Email Link unless you deliberately redesign the app for it.

### 3. Create Firestore

Create a Cloud Firestore database in Production mode.

### 4. Install Node.js and Firebase CLI

Install Node.js LTS, then open PowerShell in this project folder:

```powershell
npm install -g firebase-tools
firebase login
firebase use --add
```

### 5. Deploy only Firestore rules and indexes

```powershell
firebase deploy --only firestore
```

`firebase.json` contains no Functions or Storage deployment configuration.

### 6. Create the first administrator

In Firebase Console, create/download a service-account JSON key. Keep it outside this website folder and never upload it to GitHub.

From the project folder:

```powershell
cd admin-tools
npm install
node bootstrap.mjs "C:\path\to\service-account.json" your-admin-email@example.com http://localhost:8000/
```

The script:

- creates or promotes the first administrator;
- initializes application settings;
- preapproves `palitpriyojit@gmail.com` as a Student;
- prints a temporary password only when it had to create the administrator account.

### 7. Test the real app locally

Use the built-in launcher:

```text
start-preview.bat
```

Then open:

```text
http://localhost:8000/index.html
```

The launcher is named `start-preview.bat`, but it serves both `preview.html` and the real `index.html`.

## Registration behavior

### Testing mode

- `@email.shc.edu` is automatically Student.
- `@shc.edu` is automatically Faculty.
- Preapproved emails receive the assigned Student, Faculty, or Admin role.
- Other verified addresses become Pending until an administrator assigns a role.

### Official mode

- Official Student and Faculty domains work automatically.
- Preapproved external emails still work.
- Other addresses cannot enter AIM.

The mode is changed from **Admin Dashboard → Application settings**.

## Unregistered users and pending relationships

A browser-only Firebase application cannot create another person's Authentication account securely. Instead, an administrator can preapprove the email and save a pending student-advisor connection. The person must be told to register. After both accounts exist and are verified, AIM claims the pending relationship automatically.

No invitation email is sent because this build intentionally has no email backend.

## Autosave behavior

1. Every keystroke updates a browser-local draft.
2. Firestore synchronization occurs after the user pauses for the configured delay.
3. Closing a stage, pressing **Save now**, navigating away, or signing out also attempts a Firestore save.
4. If Firestore is unavailable, the local draft remains and is restored the next time that account opens the plan in the same browser.
5. After a successful Firestore save, the local draft is deleted.

Because a local draft can remain on the device while offline, students should avoid using AIM on a public/shared computer for sensitive planning information.

## Notifications

AIM activity notifications are stored in Firestore and displayed in the app. Each user can mute everything or independently control:

- plan updates;
- comments;
- relationships;
- document-link changes;
- administrative actions.

Repeated plan autosaves are grouped into a single in-app notification per sender, recipient, student, and day.

Email verification and password reset are Firebase Authentication messages and are not controlled by these preferences.

## Document handling

The no-billing build stores only document metadata and a shareable URL. Recommended categories are:

- Résumé
- Cover letter
- Degree plan/program checklist
- Internship/research/study-abroad material
- Certificate/award
- Other

Students must configure the linked file's sharing permissions so authorized advisors can open it.

## GitHub Pages publication

1. Create a GitHub repository.
2. Upload the project files, excluding service-account JSON and `node_modules`.
3. In the repository, open **Settings → Pages**.
4. Publish from the repository root on the selected branch.
5. Add the GitHub Pages domain to **Firebase Authentication → Settings → Authorized domains**.
6. In the AIM Admin Dashboard, set **Published app URL** to the full GitHub Pages URL.

## Important files

- `index.html` — real Firebase app entry point
- `app.js` — real application logic
- `preview.html` / `preview.js` — no-Firebase interactive preview
- `styles.css` — application design
- `firebase-config.js` — Firebase Web App configuration
- `firestore.rules` — role-based data security
- `firestore.indexes.json` — required indexes
- `admin-tools/bootstrap.mjs` — first-admin setup
- `TESTING.md` — manual acceptance tests

## Security notes

- Never upload a service-account JSON key to GitHub.
- The Firebase web configuration is not a private key; Firestore Security Rules enforce access.
- A user cannot change their own role or approval status.
- Students cannot directly remove advisors.
- Faculty can read only actively connected advisees.
- Administrators can read all plans and manage roles/relationships.

## Google sign-in

This build includes **Continue with Google**. Firebase Authentication must have both **Google** and **Email/Password** enabled. Role assignment uses the signed-in email address:

- `@email.shc.edu` → Student
- `@shc.edu` → Faculty
- other addresses → Pending unless preapproved by an administrator

Before publishing to GitHub Pages, add the GitHub Pages hostname to **Firebase Console → Authentication → Settings → Authorized domains**.
