import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  reload,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  limit,
  orderBy,
  serverTimestamp,
  writeBatch,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const STAGES = [
  { key: "freshman", title: "Freshman Year", color: "#6fd57d", type: "year" },
  { key: "summer1", title: "Summer One", color: "#4dcbbb", type: "summer" },
  { key: "sophomore", title: "Sophomore Year", color: "#67afe8", type: "year" },
  { key: "summer2", title: "Summer Two", color: "#a88be0", type: "summer" },
  { key: "junior", title: "Junior Year", color: "#eb7ac2", type: "year" },
  { key: "summer3", title: "Summer Three", color: "#f49c8d", type: "summer" },
  { key: "senior", title: "Senior Year", color: "#f5ad65", type: "year" },
  { key: "graduation", title: "Job / Grad School / Service", color: "#ffca35", type: "graduation" }
];

const PLAN_FIELD_KEYS = [
  "academic", "involvement", "highImpact", "career",
  "summerPlan", "careerExperience", "academicProgress", "serviceTravel",
  "destination", "preparation"
];

const DOCUMENT_CATEGORIES = [
  "Resume", "Cover Letter", "Degree Plan / Program Checklist",
  "Internship / Research / Study Abroad", "Certificate / Award", "Other"
];

const DEFAULT_NOTIFICATION_PREFERENCES = {
  allMuted: false,
  planUpdates: true,
  comments: true,
  relationships: true,
  documents: true,
  administrative: true
};

const DEFAULT_SETTINGS = {
  registrationMode: "testing",
  institutionName: "Spring Hill College",
  studentDomain: "email.shc.edu",
  facultyDomain: "shc.edu",
  appUrl: window.location.origin + window.location.pathname,
  autosaveDelaySeconds: 25
};

const AUTOSAVE_DELAY_MS = 25000;
const appRoot = document.getElementById("app");
const toastRegion = document.getElementById("toast-region");

let firebaseApp;
let auth;
let db;
let authRun = 0;

const state = {
  user: null,
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  currentView: null,
  currentStudentUid: null,
  autosave: null
};

const isConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.startsWith("PASTE_")
);

if (!isConfigured) {
  renderSetupRequired();
} else {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  auth.useDeviceLanguage();
  db = getFirestore(firebaseApp);
  onAuthStateChanged(auth, handleAuthState);
}

window.addEventListener("beforeunload", () => persistDraftLocally());

async function handleAuthState(user) {
  const run = ++authRun;
  state.user = user;
  state.profile = null;
  state.autosave = null;

  try {
    state.settings = await loadSettings();
  } catch (error) {
    console.error(error);
    state.settings = { ...DEFAULT_SETTINGS };
  }

  if (run !== authRun) return;
  if (!user) {
    renderAuthPage("signin");
    return;
  }
  if (!user.emailVerified) {
    renderVerificationPage(user);
    return;
  }

  try {
    await user.getIdToken(true);
    state.profile = await ensureProfile(user);
  } catch (error) {
    console.error(error);
    if (error.code === "aim/external-not-approved" || error.code === "permission-denied") {
      renderAccessDenied(user.email);
    } else if (String(error.message || "").includes("settings/app")) {
      renderMessagePage(
        "AIM unavailable",
        "AIM has not been configured yet. Please contact the application administrator.",
        "⚙"
      );
    } else {
      renderMessagePage("Could not open AIM", friendlyError(error), "!");
    }
    return;
  }

  if (run !== authRun) return;
  if (state.profile.status === "disabled") {
    renderDisabledPage();
    return;
  }
  if (!state.profile.approved || state.profile.role === "pending") {
    renderPendingPage();
    return;
  }

  claimPendingInvites().catch((error) => console.warn("Invite claim skipped:", error));
  renderShell();
}

async function loadSettings() {
  const snap = await getDoc(doc(db, "settings", "app"));
  return snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : { ...DEFAULT_SETTINGS };
}

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, { lastLoginAt: serverTimestamp() }).catch(() => {});
    return { id: existing.id, ...existing.data() };
  }

  const email = normalizeEmail(user.email);
  const access = await determineInitialAccess(email);
  const profile = {
    email,
    emailLower: email,
    displayName: (user.displayName || email.split("@")[0]).trim(),
    role: access.role,
    approved: access.approved,
    status: "active",
    notificationPreferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp()
  };

  await setDoc(ref, profile);
  const created = await getDoc(ref);
  return { id: created.id, ...created.data() };
}

async function determineInitialAccess(email) {
  const approval = await getDoc(doc(db, "emailApprovals", email));
  if (approval.exists() && approval.data().active === true && ["student", "faculty", "admin"].includes(approval.data().role)) {
    return { role: approval.data().role, approved: true };
  }
  if (email.endsWith(`@${state.settings.studentDomain}`)) {
    return { role: "student", approved: true };
  }
  if (email.endsWith(`@${state.settings.facultyDomain}`) && !email.endsWith(`@${state.settings.studentDomain}`)) {
    return { role: "faculty", approved: true };
  }
  if (state.settings.registrationMode === "testing") {
    return { role: "pending", approved: false };
  }
  const error = new Error("This email address has not been approved for AIM.");
  error.code = "aim/external-not-approved";
  throw error;
}

function renderSetupRequired() {
  appRoot.innerHTML = `
    <main id="main-content" class="message-page">
      <section class="message-card card">
        <div class="message-icon">⚙</div>
        <h1>AIM is not available yet</h1>
        <p class="subtle">Please contact the application administrator.</p>
      </section>
    </main>`;
}

function renderAuthPage(tab = "signin") {
  appRoot.innerHTML = `
    <main id="main-content" class="auth-page">
      <section class="auth-shell card">
        <div class="auth-brand">
          <div class="brand-lockup"><span class="brand-mark">AIM</span><span class="brand-name">Academic &amp;<br>Involvement Map</span></div>
        </div>
        <div class="auth-panel">
          <h2>${tab === "signin" ? "Sign in" : "Create account"}</h2>
          <div class="auth-tabs">
            <button class="auth-tab ${tab === "signin" ? "active" : ""}" data-auth-tab="signin">Sign in</button>
            <button class="auth-tab ${tab === "register" ? "active" : ""}" data-auth-tab="register">Create account</button>
          </div>
          ${tab === "signin" ? signinFormHtml() : registerFormHtml()}
        </div>
      </section>
    </main>`;

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => renderAuthPage(button.dataset.authTab));
  });
  attachAuthForm(tab);
}

function googleSignInHtml() {
  return `<button class="btn btn-google" id="google-signin" type="button" aria-label="Continue with Google">
    <span class="google-mark" aria-hidden="true">G</span>
    <span>Continue with Google</span>
  </button>
  <div class="auth-divider" role="separator"><span>or use email and password</span></div>`;
}

function signinFormHtml() {
  return `${googleSignInHtml()}<form id="auth-form" class="form-stack">
    <div class="field"><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" minlength="6" required></div>
    <button class="btn btn-primary" type="submit">Sign in</button>
    <button class="btn btn-link" id="forgot-password" type="button">Forgot password?</button>
  </form>`;
}

function registerFormHtml() {
  return `${googleSignInHtml()}<form id="auth-form" class="form-stack">
    <div class="field"><label for="display-name">Full name</label><input id="display-name" maxlength="100" autocomplete="name" required></div>
    <div class="field"><label for="email">Email address</label><input id="email" type="email" autocomplete="email" required></div>
    <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="new-password" minlength="8" required><small>Use at least eight characters.</small></div>
    <button class="btn btn-primary" type="submit">Create account</button>
  </form>`;
}

function attachAuthForm(tab) {
  document.getElementById("google-signin")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, "Opening Google…");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (error.code !== "auth/popup-closed-by-user") {
        toast(friendlyError(error), "error");
      }
      setBusy(button, false, "Continue with Google");
    }
  });

  const form = document.getElementById("auth-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const email = normalizeEmail(document.getElementById("email").value);
    const password = document.getElementById("password").value;
    setBusy(button, true, tab === "signin" ? "Signing in…" : "Creating…");
    try {
      if (tab === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const displayName = document.getElementById("display-name").value.trim();
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName });
        await sendEmailVerification(credential.user, actionCodeSettings());
        renderVerificationPage(credential.user, true);
      }
    } catch (error) {
      toast(friendlyError(error), "error");
      setBusy(button, false, tab === "signin" ? "Sign in" : "Create account");
    }
  });

  document.getElementById("forgot-password")?.addEventListener("click", async () => {
    const email = normalizeEmail(document.getElementById("email").value);
    if (!isValidEmail(email)) return toast("Enter your email address first.", "error");
    try {
      await sendPasswordResetEmail(auth, email, actionCodeSettings());
      toast("Password-reset email sent.", "success");
    } catch (error) {
      toast(friendlyError(error), "error");
    }
  });
}

function renderVerificationPage(user, justSent = false) {
  appRoot.innerHTML = `<main id="main-content" class="message-page"><section class="message-card card">
    <div class="message-icon">✉</div><h1>Verify your email address</h1>
    <p>We ${justSent ? "sent" : "have sent"} a verification link to <strong>${escapeHtml(user.email)}</strong>. Open it, then return here.</p>
    <div class="button-row" style="justify-content:center;margin-top:1.2rem">
      <button class="btn btn-primary" id="verification-check">I verified my email</button>
      <button class="btn btn-secondary" id="verification-resend">Resend email</button>
      <button class="btn btn-link" id="verification-signout">Use another account</button>
    </div>

  </section></main>`;

  document.getElementById("verification-check").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Checking…");
    try {
      await reload(auth.currentUser);
      if (!auth.currentUser.emailVerified) throw new Error("The email address is not verified yet.");
      await auth.currentUser.getIdToken(true);
      handleAuthState(auth.currentUser);
    } catch (error) {
      toast(friendlyError(error), "error");
      setBusy(event.currentTarget, false, "I verified my email");
    }
  });
  document.getElementById("verification-resend").addEventListener("click", async () => {
    try { await sendEmailVerification(auth.currentUser, actionCodeSettings()); toast("Verification email sent.", "success"); }
    catch (error) { toast(friendlyError(error), "error"); }
  });
  document.getElementById("verification-signout").addEventListener("click", () => signOut(auth));
}

function renderPendingPage() {
  renderMessagePage(
    "Account awaiting approval",
    "An administrator must activate this account.",
    "⏳",
    true
  );
}

function renderAccessDenied(email) {
  renderMessagePage(
    "Account not authorized",
    `${email || "This account"} cannot access AIM.`,
    "!",
    true
  );
}

function renderDisabledPage() {
  renderMessagePage("Account disabled", "An AIM administrator has disabled this account.", "!", true);
}

function renderMessagePage(title, message, icon = "i", includeSignout = false) {
  appRoot.innerHTML = `<main id="main-content" class="message-page"><section class="message-card card">
    <div class="message-icon">${icon}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
    ${includeSignout ? '<button class="btn btn-secondary" id="message-signout">Sign out</button>' : ""}
  </section></main>`;
  document.getElementById("message-signout")?.addEventListener("click", () => signOut(auth));
}

function actionCodeSettings() {
  return { url: state.settings.appUrl || window.location.href, handleCodeInApp: false };
}

function renderShell() {
  const role = state.profile.role;
  const nav = navItemsForRole(role);
  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo"><strong>AIM</strong><span>Academic &amp;<br>Involvement Map</span></div>
        <nav class="nav-list" aria-label="Main navigation">
          ${nav.map((item) => `<button class="nav-button" data-nav="${item.view}"><span>${item.icon}</span><span>${escapeHtml(item.label)}</span></button>`).join("")}
        </nav>
        <div class="sidebar-footer"><div class="user-mini"><strong>${escapeHtml(state.profile.displayName)}</strong><span>${escapeHtml(state.profile.email)}</span><span>${capitalize(role)}</span></div></div>
      </aside>
      <div class="app-main">
        <header class="topbar">
          <div class="button-row"><button class="btn btn-secondary btn-small mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button><h1 id="view-title">AIM</h1></div>
          <div class="topbar-actions"><button class="btn btn-secondary btn-small" id="signout-button">Sign out</button></div>
        </header>
        <main id="main-content" class="content"><div class="loader-inline"><span class="spinner"></span> Loading…</div></main>
      </div>
    </div>`;

  document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  document.getElementById("signout-button").addEventListener("click", async () => {
    await flushAutosaveIfNeeded();
    await signOut(auth);
  });
  document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  navigate(defaultViewForRole(role));
}

function navItemsForRole(role) {
  if (role === "student") {
    return [
      { view: "map", label: "My AIM Map", icon: "🗺" },
      { view: "documents", label: "Document Links", icon: "🔗" },
      { view: "advisors", label: "My Advisors", icon: "👥" },
      { view: "notifications", label: "Notifications", icon: "🔔" },
      { view: "profile", label: "My Profile", icon: "⚙" }
    ];
  }
  if (role === "faculty") {
    return [
      { view: "advisees", label: "My Advisees", icon: "👥" },
      { view: "notifications", label: "Notifications", icon: "🔔" },
      { view: "profile", label: "My Profile", icon: "⚙" }
    ];
  }
  return [
    { view: "admin", label: "Admin Dashboard", icon: "▦" },
    { view: "plans", label: "All Student Plans", icon: "🗺" },
    { view: "users", label: "Manage Users", icon: "👤" },
    { view: "relationships", label: "Relationships", icon: "⇄" },
    { view: "notifications", label: "Notifications", icon: "🔔" },
    { view: "profile", label: "My Profile", icon: "⚙" }
  ];
}

function defaultViewForRole(role) {
  return role === "student" ? "map" : role === "faculty" ? "advisees" : "admin";
}

async function navigate(view, options = {}) {
  const changingPlan = state.currentView && (state.currentView !== view || (view === "studentPlan" && state.currentStudentUid !== options.studentUid));
  if (changingPlan) await flushAutosaveIfNeeded();

  state.currentView = view;
  state.currentStudentUid = options.studentUid || null;
  document.getElementById("sidebar")?.classList.remove("open");
  document.querySelectorAll("[data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  const titles = {
    map: "My AIM Map", documents: "Document Links", advisors: "My Advisors", advisees: "My Advisees",
    studentPlan: "Student AIM Map", notifications: "Notifications", profile: "My Profile", admin: "Admin Dashboard",
    plans: "All Student Plans", users: "Manage Users", relationships: "Advisor Relationships"
  };
  const title = document.getElementById("view-title");
  if (title) title.textContent = titles[view] || "AIM";
  setMainLoading();

  try {
    if (view === "map") await renderStudentPlan(state.user.uid, { editable: true });
    else if (view === "documents") await renderDocuments(options.studentUid || state.user.uid, { backView: options.backView });
    else if (view === "advisors") await renderAdvisors();
    else if (view === "advisees") await renderAdvisees();
    else if (view === "studentPlan") await renderStudentPlan(options.studentUid || state.currentStudentUid, { editable: state.profile.role === "admin", backView: options.backView });
    else if (view === "notifications") await renderNotifications();
    else if (view === "profile") await renderProfile();
    else if (view === "admin") await renderAdminDashboard();
    else if (view === "plans") await renderAdminPlans();
    else if (view === "users") await renderAdminUsers();
    else if (view === "relationships") await renderAdminRelationships();
  } catch (error) {
    console.error(error);
    const main = document.getElementById("main-content");
    if (main) main.innerHTML = `<section class="panel"><h2>Unable to load this page</h2><p>${escapeHtml(friendlyError(error))}</p></section>`;
  }
}

function setMainLoading() {
  const main = document.getElementById("main-content");
  if (main) main.innerHTML = '<div class="loader-inline"><span class="spinner"></span> Loading…</div>';
}

async function renderStudentPlan(studentUid, options = {}) {
  if (!studentUid) throw new Error("No student was selected.");
  const [studentSnap, planSnap, commentsSnap, documentsSnap] = await Promise.all([
    getDoc(doc(db, "users", studentUid)),
    getDoc(doc(db, "plans", studentUid)),
    getDocs(query(collection(db, "plans", studentUid, "comments"), orderBy("createdAt", "asc"))),
    getDocs(collection(db, "studentDocuments", studentUid, "items"))
  ]);
  if (!studentSnap.exists()) throw new Error("The student profile no longer exists.");

  const student = { id: studentSnap.id, ...studentSnap.data() };
  if (student.role !== "student") throw new Error("The selected account is not a student.");
  const cloudPlan = planSnap.exists() ? planSnap.data() : { stages: {} };
  const localDraft = readLocalDraft(studentUid);
  const cloudUpdated = timestampMillis(cloudPlan.updatedAt);
  const useLocalDraft = localDraft && localDraft.savedAt > cloudUpdated;
  const plan = useLocalDraft ? { ...cloudPlan, stages: localDraft.stages } : cloudPlan;
  const comments = commentsSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const documents = documentsSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  const canEdit = options.editable === true && (studentUid === state.user.uid || state.profile.role === "admin");
  const canComment = state.profile.role === "admin" || state.profile.role === "faculty";

  document.getElementById("main-content").innerHTML = `
    <div class="page-head">
      <div><h2>${canEdit && studentUid === state.user.uid ? "My AIM Map" : `${escapeHtml(student.displayName)}'s AIM Map`}</h2></div>
      <div class="button-row"><button class="btn btn-secondary" id="print-plan-button" type="button">Print / Save as PDF</button>${options.backView ? '<button class="btn btn-secondary" id="back-from-plan">← Back</button>' : ""}</div>
    </div>
    ${useLocalDraft ? '<div class="status-banner testing"><strong>Recovered work:</strong> Your recent changes were restored and will save automatically.</div>' : ""}
    ${aimGuideHtml()}
    <section class="panel plan-documents-summary">
      <div class="panel-head"><div><h3>Portfolio &amp; documents</h3></div>
      <button class="btn btn-secondary btn-small" id="open-plan-documents" type="button">${studentUid === state.user.uid ? "Manage" : "View"}</button></div>
      ${documents.length ? compactDocumentListHtml(documents) : '<p class="subtle">No document links have been added yet.</p>'}
    </section>
    ${canEdit ? `<div id="map-form" class="aim-map-form"><div class="map-toolbar"><span class="map-status" id="map-status">${useLocalDraft ? "Recovered recent changes" : planSnap.exists() ? `Saved ${formatDate(cloudPlan.updatedAt)}` : "Not saved yet"}</span><button class="btn btn-primary" id="map-save-now" type="button">Save now</button></div>${timelineHtml(plan.stages || {}, comments, true, canComment, studentUid)}</div>` : timelineHtml(plan.stages || {}, comments, false, canComment, studentUid)}
  `;

  document.getElementById("print-plan-button").addEventListener("click", () => window.print());
  document.getElementById("open-plan-documents").addEventListener("click", () => navigate("documents", { studentUid, backView: options.backView || (state.profile.role === "admin" ? "plans" : state.profile.role === "faculty" ? "advisees" : "map") }));
  document.getElementById("back-from-plan")?.addEventListener("click", () => navigate(options.backView));

  if (canEdit) setupAutosave({ studentUid, student, plan });
  attachStageToggleHandlers();
  attachCommentHandlers(studentUid, student, options);
}

function setupAutosave({ studentUid, student, plan }) {
  clearAutosaveTimer();
  state.autosave = {
    studentUid,
    student,
    originalStages: normalizeAllStages(plan.stages || {}),
    dirtySections: new Set(),
    timer: null,
    saving: false
  };

  document.querySelectorAll(".stage-fields textarea").forEach((input) => {
    input.addEventListener("input", () => {
      const stageKey = input.closest("details[data-stage]")?.dataset.stage;
      if (stageKey) state.autosave.dirtySections.add(stageKey);
      persistDraftLocally();
      setAutosaveStatus("Saving…");
      scheduleAutosave();
      updateStageSummary(stageKey);
    });
  });

  document.getElementById("map-save-now")?.addEventListener("click", () => saveCurrentPlan({ reason: "manual" }));
}

function attachStageToggleHandlers() {
  document.querySelectorAll("details[data-stage]").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open && state.autosave?.dirtySections.has(details.dataset.stage)) {
        saveCurrentPlan({ reason: "section-closed" });
      }
    });
  });
}

function scheduleAutosave() {
  if (!state.autosave) return;
  clearTimeout(state.autosave.timer);
  const delay = Math.max(10, Number(state.settings.autosaveDelaySeconds || 25)) * 1000 || AUTOSAVE_DELAY_MS;
  state.autosave.timer = setTimeout(() => saveCurrentPlan({ reason: "idle" }), delay);
}

function clearAutosaveTimer() {
  if (state.autosave?.timer) clearTimeout(state.autosave.timer);
}

function collectStagesFromForm() {
  const stages = {};
  STAGES.forEach((stage) => {
    const value = normalizeStageData(stage, {});
    stageFieldDefinitions(stage).forEach(([key]) => {
      const input = document.querySelector(`[name="${stage.key}-${key}"]`);
      value[key] = input ? input.value.trim() : "";
    });
    stages[stage.key] = value;
  });
  return stages;
}

function persistDraftLocally() {
  if (!state.autosave || !document.getElementById("map-form")) return;
  try {
    localStorage.setItem(draftKey(state.autosave.studentUid), JSON.stringify({ stages: collectStagesFromForm(), savedAt: Date.now() }));
  } catch (error) {
    console.warn("Could not save local draft", error);
  }
}

function readLocalDraft(studentUid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(draftKey(studentUid)) || "null");
    return parsed?.stages && parsed?.savedAt ? parsed : null;
  } catch {
    return null;
  }
}

function draftKey(studentUid) {
  return `aim-local-draft:${studentUid}`;
}

async function saveCurrentPlan({ reason = "autosave" } = {}) {
  if (!state.autosave || state.autosave.saving || !state.autosave.dirtySections.size) return true;
  const controller = state.autosave;
  controller.saving = true;
  clearAutosaveTimer();
  setAutosaveStatus("Saving…", "saving");
  const stages = collectStagesFromForm();
  const changedSections = Array.from(controller.dirtySections);
  try {
    await setDoc(doc(db, "plans", controller.studentUid), {
      studentUid: controller.studentUid,
      studentName: controller.student.displayName,
      studentEmail: controller.student.email,
      stages,
      updatedAt: serverTimestamp(),
      updatedByUid: state.user.uid
    }, { merge: true });
    controller.originalStages = stages;
    controller.dirtySections.clear();
    localStorage.removeItem(draftKey(controller.studentUid));
    setAutosaveStatus(`All changes saved${reason === "manual" ? "" : " automatically"}`, "saved");
    await recordAudit("plan_saved", {
      studentUid: controller.studentUid,
      targetUid: controller.studentUid,
      targetEmail: controller.student.email,
      summary: `${state.profile.displayName} saved ${changedSections.map(stageTitle).join(", ") || "the AIM plan"}.`,
      metadata: { changedSections, reason }
    });
    await notifyPlanChange(controller.student, changedSections);
    return true;
  } catch (error) {
    persistDraftLocally();
    setAutosaveStatus("Cloud save failed · draft remains on this device", "error");
    toast(friendlyError(error), "error");
    return false;
  } finally {
    controller.saving = false;
  }
}

async function flushAutosaveIfNeeded() {
  if (!state.autosave?.dirtySections.size) return true;
  return saveCurrentPlan({ reason: "navigation" });
}

function setAutosaveStatus(text, kind = "") {
  const status = document.getElementById("map-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.state = kind;
}

function updateStageSummary(stageKey) {
  if (!stageKey) return;
  const details = document.querySelector(`details[data-stage="${stageKey}"]`);
  if (!details) return;
  const filled = Array.from(details.querySelectorAll("textarea")).filter((item) => item.value.trim()).length;
  const total = details.querySelectorAll("textarea").length;
  const badge = details.querySelector("[data-stage-progress]");
  if (badge) badge.textContent = filled ? `${filled}/${total} started` : "Not started";
}

function timelineHtml(stages, comments, editable, canComment, studentUid) {
  return `<div class="compact-timeline">${STAGES.map((stage, index) => {
    const value = normalizeStageData(stage, stages[stage.key] || {});
    const definitions = stageFieldDefinitions(stage);
    const sectionComments = comments.filter((comment) => comment.sectionKey === stage.key);
    const filled = definitions.filter(([key]) => String(value[key] || "").trim()).length;
    return `<section class="compact-stage" style="--stage-color:${stage.color}">
      <div class="compact-stage-marker"><span>${index + 1}</span></div>
      <details class="stage-card stage-accordion" data-stage="${stage.key}" ${index === 0 ? "open" : ""}>
        <summary><span class="stage-summary-title">${escapeHtml(stage.title)}</span><span class="stage-progress" data-stage-progress>${filled ? `${filled}/${definitions.length} started` : "Not started"}</span><span class="stage-chevron" aria-hidden="true">⌄</span></summary>
        <div class="stage-body">
          ${editable ? `<div class="stage-fields">${definitions.map(([key, label, placeholder]) => textareaField(`${stage.key}-${key}`, label, value[key], placeholder)).join("")}</div>` : definitions.map(([key, label]) => readSection(label, value[key])).join("")}
          ${(sectionComments.length || canComment) ? `<div class="comment-block"><strong>Advisor comments</strong>${sectionComments.length ? sectionComments.map(commentHtml).join("") : '<p class="subtle">No comments yet.</p>'}${canComment ? `<form class="comment-form" data-section="${stage.key}"><div class="field"><label class="sr-only" for="comment-${stage.key}">Comment on ${escapeHtml(stage.title)}</label><textarea id="comment-${stage.key}" maxlength="2000" placeholder="Add guidance for this section…" required></textarea></div><button class="btn btn-soft btn-small" type="submit">Add comment</button></form>` : ""}</div>` : ""}
        </div>
      </details>
    </section>`;
  }).join("")}</div>`;
}

function aimGuideHtml() {
  return `<details class="aim-guide panel"><summary>Planning guide and examples</summary><div class="guide-grid">
    <div><h3>High-impact experiences</h3><p>Study abroad, internship, service immersion, or undergraduate research—often planned for the sophomore or junior year.</p></div>
    <div><h3>Campus involvement</h3><p>Try a club, set a leadership goal, or prepare to apply for a campus leadership role.</p></div>
    <div><h3>Academic goals</h3><p>Maintain or raise GPA, build a mentoring relationship, use tutoring, participate in class, make the Dean's List, and plan the senior capstone.</p></div>
    <div><h3>Summer planning</h3><p>Use all three summers for employment, internships, job shadowing, volunteering, summer school, travel, or professional development.</p></div>
  </div></details>`;
}

function stageFieldDefinitions(stage) {
  if (stage.type === "summer") {
    return [
      ["summerPlan", "Main summer plan", "What do you plan to do this summer?"],
      ["careerExperience", "Career-related experience", "Employment, internship, job shadowing, volunteering, or professional development…"],
      ["academicProgress", "Academic progress", "Summer school, degree progress, skill-building, or PTH 205 preparation…"],
      ["serviceTravel", "Service, travel & reflection", "Service-related travel, community work, or what you hope to learn…"]
    ];
  }
  if (stage.type === "graduation") {
    return [
      ["destination", "Primary destination", "Job, graduate school, service program, or another post-graduation goal…"],
      ["preparation", "Preparation and next actions", "Applications, references, interviews, portfolio, entrance exams, financial planning…"]
    ];
  }
  return [
    ["academic", "Academic goals", "GPA, courses, tutoring, mentoring, major decisions, research, capstone…"],
    ["involvement", "Campus involvement & leadership", "Clubs, campus roles, leadership, service, and community involvement…"],
    ["highImpact", "High-impact experience", "Study abroad, internship, service immersion, or undergraduate research…"],
    ["career", "Career preparation", "Résumé, networking, portfolio, Career Services, graduate-school or job preparation…"]
  ];
}

function normalizeStageData(stage, value = {}) {
  const normalized = Object.fromEntries(PLAN_FIELD_KEYS.map((key) => [key, String(value[key] || "")]));
  if (stage.type === "summer") {
    if (!normalized.summerPlan) normalized.summerPlan = value.career || "";
    if (!normalized.careerExperience) normalized.careerExperience = value.career || "";
    if (!normalized.academicProgress) normalized.academicProgress = value.academic || "";
    if (!normalized.serviceTravel) normalized.serviceTravel = value.involvement || "";
  } else if (stage.type === "graduation") {
    if (!normalized.destination) normalized.destination = value.career || "";
    if (!normalized.preparation) normalized.preparation = [value.academic, value.involvement].filter(Boolean).join("\n");
  }
  return normalized;
}

function normalizeAllStages(stages = {}) {
  return Object.fromEntries(STAGES.map((stage) => [stage.key, normalizeStageData(stage, stages[stage.key] || {})]));
}

function textareaField(name, label, value = "", placeholder = "") {
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label><textarea id="${name}" name="${name}" maxlength="4000" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value || "")}</textarea></div>`;
}

function readSection(title, text) {
  return `<div class="stage-read-section"><h4>${escapeHtml(title)}</h4><p class="${text ? "" : "blank"}">${text ? escapeHtml(text) : "Nothing added yet."}</p></div>`;
}

function commentHtml(comment) {
  const canDelete = state.profile?.role === "admin" || comment.authorUid === state.user?.uid;
  return `<div class="comment"><div class="comment-head"><strong>${escapeHtml(comment.authorName || "Advisor")}</strong><span>${formatDate(comment.createdAt)}</span></div><p>${escapeHtml(comment.text)}</p>${canDelete ? `<div class="button-row" style="margin-top:.55rem"><button class="btn btn-danger btn-small" type="button" data-delete-comment="${escapeAttr(comment.id)}">Delete</button></div>` : ""}</div>`;
}

function attachCommentHandlers(studentUid, student, options) {
  document.querySelectorAll("[data-delete-comment]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this comment?")) return;
      try {
        await flushAutosaveIfNeeded();
        await deleteDoc(doc(db, "plans", studentUid, "comments", button.dataset.deleteComment));
        await recordAudit("comment_deleted", { studentUid, targetUid: studentUid, targetEmail: student.email, summary: `${state.profile.displayName} deleted an advisor comment.` });
        toast("Comment deleted.", "success");
        await renderStudentPlan(studentUid, options);
      } catch (error) { toast(friendlyError(error), "error"); }
    });
  });

  document.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = form.querySelector("textarea").value.trim();
      if (!text) return;
      const button = form.querySelector("button[type=submit]");
      setBusy(button, true, "Adding…");
      try {
        await flushAutosaveIfNeeded();
        await addDoc(collection(db, "plans", studentUid, "comments"), {
          studentUid,
          sectionKey: form.dataset.section,
          text,
          authorUid: state.user.uid,
          authorName: state.profile.displayName,
          authorRole: state.profile.role,
          createdAt: serverTimestamp()
        });
        await recordAudit("comment_added", { studentUid, targetUid: studentUid, targetEmail: student.email, summary: `${state.profile.displayName} commented on ${stageTitle(form.dataset.section)}.` });
        // A notification failure must not make a successfully saved comment
        // appear to have failed.
        await notifyComment(student, form.dataset.section).catch((error) => {
          console.warn("Comment notification skipped", error);
        });
        toast("Comment added.", "success");
        await renderStudentPlan(studentUid, options);
      } catch (error) {
        toast(friendlyError(error), "error");
        setBusy(button, false, "Add comment");
      }
    });
  });
}

function compactDocumentListHtml(documents) {
  return `<div class="document-compact-list">${documents.slice(0, 4).map((item) => `<a href="${escapeAttr(item.url || "#")}" target="_blank" rel="noopener"><strong>${escapeHtml(item.title || item.category || "Document")}</strong><span>${escapeHtml(item.category || "Document")}</span></a>`).join("")}${documents.length > 4 ? `<span class="subtle">+${documents.length - 4} more</span>` : ""}</div>`;
}

async function renderDocuments(studentUid, options = {}) {
  if (!studentUid) throw new Error("No student was selected.");
  const [studentSnap, docsSnap] = await Promise.all([
    getDoc(doc(db, "users", studentUid)),
    getDocs(collection(db, "studentDocuments", studentUid, "items"))
  ]);
  if (!studentSnap.exists() || studentSnap.data().role !== "student") throw new Error("The selected student does not exist.");
  const student = { id: studentSnap.id, ...studentSnap.data() };
  const items = docsSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  const canManage = studentUid === state.user.uid || state.profile.role === "admin";

  document.getElementById("main-content").innerHTML = `
    <div class="page-head"><div><h2>${studentUid === state.user.uid ? "My Documents" : `${escapeHtml(student.displayName)}'s Documents`}</h2></div>${options.backView ? '<button class="btn btn-secondary" id="documents-back">← Back</button>' : ""}</div>
    <div class="status-banner official"><strong>Shareable links:</strong> Make sure each advisor has permission to open the linked file.</div>
    ${canManage ? `<section class="panel"><h3>Add a document link</h3><form id="document-link-form" class="grid grid-3">
      <div class="field"><label for="link-title">Document title</label><input id="link-title" maxlength="120" placeholder="Current résumé" required></div>
      <div class="field"><label for="link-category">Category</label><select id="link-category">${DOCUMENT_CATEGORIES.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></div>
      <div class="field"><label for="document-url">Shareable URL</label><input id="document-url" type="url" placeholder="https://…" required><small>Use a link that your advisors can open.</small></div>
      <div class="field" style="align-self:end"><button class="btn btn-primary" type="submit">Add link</button></div>
    </form></section>` : ""}
    <section class="panel" style="margin-top:1rem"><div class="panel-head"><h3>Saved links</h3><span class="subtle">${items.length} item${items.length === 1 ? "" : "s"}</span></div>${items.length ? `<div class="document-list">${items.map((item) => documentCardHtml(item, canManage)).join("")}</div>` : emptyStateHtml("No document links yet", "Add a résumé or another useful planning document link.")}</section>`;

  document.getElementById("documents-back")?.addEventListener("click", () => navigate(options.backView));
  document.getElementById("document-link-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    setBusy(button, true, "Adding…");
    try {
      const url = document.getElementById("document-url").value.trim();
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Enter a valid http or https link.");
      const title = document.getElementById("link-title").value.trim();
      const category = document.getElementById("link-category").value;
      await addDoc(collection(db, "studentDocuments", studentUid, "items"), {
        studentUid, title, category, source: "link", url,
        uploadedByUid: state.user.uid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      await recordAudit("document_added", { studentUid, targetUid: studentUid, targetEmail: student.email, summary: `${state.profile.displayName} added the document link “${title}”.` });
      await notifyDocumentChange(student, `A document link was added: ${title}.`);
      toast("Document link added.", "success");
      renderDocuments(studentUid, options);
    } catch (error) {
      toast(friendlyError(error), "error");
      setBusy(button, false, "Add link");
    }
  });

  document.querySelectorAll("[data-delete-document]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = items.find((entry) => entry.id === button.dataset.deleteDocument);
      if (!item || !confirm(`Delete ${item.title || "this link"}?`)) return;
      try {
        await deleteDoc(doc(db, "studentDocuments", studentUid, "items", item.id));
        await recordAudit("document_deleted", { studentUid, targetUid: studentUid, targetEmail: student.email, summary: `${state.profile.displayName} deleted the document link “${item.title || "Document"}”.` });
        await notifyDocumentChange(student, `A document link was removed: ${item.title || "Document"}.`);
        toast("Document link deleted.", "success");
        renderDocuments(studentUid, options);
      } catch (error) { toast(friendlyError(error), "error"); }
    });
  });
}

function documentCardHtml(item, canManage) {
  return `<article class="document-card"><div class="document-icon">${item.category === "Resume" ? "R" : "↗"}</div><div class="document-info"><strong>${escapeHtml(item.title || "Document")}</strong><span>${escapeHtml(item.category || "Document")} · External link</span><small>Added ${formatDate(item.createdAt)}</small></div><div class="button-row"><a class="btn btn-secondary btn-small" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open</a>${canManage ? `<button class="btn btn-danger btn-small" type="button" data-delete-document="${escapeAttr(item.id)}">Delete</button>` : ""}</div></article>`;
}

async function renderAdvisors() {
  const relationships = await getRelationshipsForStudent(state.user.uid);
  const active = relationships.filter((item) => item.status === "active");
  const requestsSnap = await getDocs(query(collection(db, "relationshipRemovalRequests"), where("studentUid", "==", state.user.uid)));
  const requests = new Map(requestsSnap.docs.map((item) => [item.data().relationshipId, { id: item.id, ...item.data() }]));
  const advisors = (await Promise.all(active.map(async (relationship) => ({ relationship, person: await getUser(relationship.facultyUid) })))).filter((item) => item.person);

  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>My Advisors</h2></div></div>
    <div class="grid grid-2"><section class="panel"><h3>Current advisors</h3><div class="people-list">${advisors.length ? advisors.map(({ relationship, person }) => personCardHtml(person, "advisor", { request: requests.get(relationship.id) })).join("") : emptyStateHtml("No advisors yet", "Choose an advisor from the faculty directory or enter an email address.")}</div></section>
    <section class="panel"><h3>Add an advisor</h3><form id="advisor-email-form" class="form-stack"><div class="field"><label for="advisor-email">Faculty email</label><input id="advisor-email" type="email" list="advisor-directory" required><datalist id="advisor-directory">${(await getUsersByRole("faculty")).map((item) => `<option value="${escapeAttr(item.email)}">${escapeHtml(item.displayName)}</option>`).join("")}</datalist></div><button class="btn btn-primary" type="submit">Add advisor</button></form></section></div>`;

  document.getElementById("advisor-email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = normalizeEmail(document.getElementById("advisor-email").value);
    await runRelationshipAction(event.currentTarget, async () => {
      await addAdvisorByEmail(email);
      toast("Advisor connection saved.", "success");
      await renderAdvisors();
    });
  });

  document.querySelectorAll("[data-request-advisor-removal]").forEach((button) => {
    button.addEventListener("click", async () => {
      const facultyUid = button.dataset.requestAdvisorRemoval;
      const reason = prompt("Why should this advisor be removed? The administrator will review the request.");
      if (!reason?.trim()) return;
      const id = relationshipId(state.user.uid, facultyUid);
      try {
        await setDoc(doc(db, "relationshipRemovalRequests", id), {
          relationshipId: id,
          studentUid: state.user.uid,
          facultyUid,
          requestedByUid: state.user.uid,
          reason: reason.trim(),
          status: "pending",
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
        await recordAudit("removal_requested", { studentUid: state.user.uid, facultyUid, targetUid: facultyUid, summary: `${state.profile.displayName} requested advisor removal.` });
        await notifyRemovalRequest(facultyUid, reason.trim());
        toast("Removal request sent to administrators.", "success");
        renderAdvisors();
      } catch (error) { toast(friendlyError(error), "error"); }
    });
  });
}

async function renderAdvisees() {
  const relationships = await getRelationshipsForFaculty(state.user.uid);
  const active = relationships.filter((item) => item.status === "active");
  const students = (await Promise.all(active.map((item) => getUser(item.studentUid)))).filter(Boolean);

  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>My Advisees</h2></div></div>
    <div class="grid grid-2"><section class="panel"><h3>Current advisees</h3><div class="people-list">${students.length ? students.map((person) => personCardHtml(person, "advisee")).join("") : emptyStateHtml("No advisees yet", "Add a student by email address.")}</div></section>
    <section class="panel"><h3>Add student</h3><form id="advisee-email-form" class="form-stack"><div class="field"><label for="advisee-email">Student email</label><input id="advisee-email" type="email" list="student-directory" required><datalist id="student-directory">${(await getUsersByRole("student")).map((item) => `<option value="${escapeAttr(item.email)}">${escapeHtml(item.displayName)}</option>`).join("")}</datalist></div><button class="btn btn-primary" type="submit">Add student</button></form></section></div>`;

  document.getElementById("advisee-email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = normalizeEmail(document.getElementById("advisee-email").value);
    await runRelationshipAction(event.currentTarget, async () => {
      await addAdviseeByEmail(email);
      toast("Advisee connection saved.", "success");
      await renderAdvisees();
    });
  });
  document.querySelectorAll("[data-view-student]").forEach((button) => button.addEventListener("click", () => navigate("studentPlan", { studentUid: button.dataset.viewStudent, backView: "advisees" })));
  document.querySelectorAll("[data-remove-advisee]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Remove this advisee relationship? The student and administrators will see the change in AIM.")) return;
      const studentUid = button.dataset.removeAdvisee;
      try {
        await notifyRelationshipStatus(studentUid, state.user.uid, "Your advisor removed this advising connection.");
        await updateDoc(doc(db, "relationships", relationshipId(studentUid, state.user.uid)), { status: "removed", updatedAt: serverTimestamp(), updatedByUid: state.user.uid });
        await recordAudit("relationship_removed", { studentUid, facultyUid: state.user.uid, targetUid: studentUid, summary: `${state.profile.displayName} removed an advisee relationship.` });
        toast("Advisee removed.", "success");
        renderAdvisees();
      } catch (error) { toast(friendlyError(error), "error"); }
    });
  });
}

function personCardHtml(person, kind, context = {}) {
  let actions;
  if (kind === "advisor") {
    actions = context.request?.status === "pending" ? '<span class="pill pill-pending">Removal awaiting admin approval</span>' : `<button class="btn btn-danger btn-small" data-request-advisor-removal="${person.id}">Request removal</button>`;
  } else {
    actions = `<div class="button-row"><button class="btn btn-primary btn-small" data-view-student="${person.id}">View map</button><button class="btn btn-danger btn-small" data-remove-advisee="${person.id}">Remove</button></div>`;
  }
  return `<article class="person-card"><div class="person-info"><strong>${escapeHtml(person.displayName)}</strong><span>${escapeHtml(person.email)}</span>${context.request ? `<small>Reason: ${escapeHtml(context.request.reason || "Not provided")}</small>` : ""}</div>${actions}</article>`;
}

async function runRelationshipAction(form, action) {
  const button = form.querySelector("button[type=submit]");
  const original = button.textContent;
  setBusy(button, true, "Saving…");
  try { await action(); }
  catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, original); }
}

async function addAdvisorByEmail(email) {
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
  const faculty = await findUserByEmail(email);
  if (faculty) {
    if (faculty.role !== "faculty" || !faculty.approved || faculty.status !== "active") throw new Error("That account is not an active faculty account.");
    await createRelationship(state.user.uid, faculty.id, "student");
    return;
  }
  await createRelationshipInvite({ studentEmail: state.profile.email, facultyEmail: email, initiatedByRole: "student" });
  await recordAudit("relationship_invited", { studentUid: state.user.uid, targetEmail: email, summary: `${state.profile.displayName} added an unregistered advisor email.` });
}

async function addAdviseeByEmail(email) {
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
  const student = await findUserByEmail(email);
  if (student) {
    if (student.role !== "student" || !student.approved || student.status !== "active") throw new Error("That account is not an active student account.");
    await createRelationship(student.id, state.user.uid, "faculty");
    return;
  }
  await createRelationshipInvite({ studentEmail: email, facultyEmail: state.profile.email, initiatedByRole: "faculty" });
  await recordAudit("relationship_invited", { facultyUid: state.user.uid, targetEmail: email, summary: `${state.profile.displayName} added an unregistered student email.` });
}

async function createRelationship(studentUid, facultyUid, initiatedByRole) {
  const [student, faculty] = await Promise.all([getUser(studentUid), getUser(facultyUid)]);
  if (!student || student.role !== "student") throw new Error("A valid student account is required.");
  if (!faculty || faculty.role !== "faculty") throw new Error("A valid faculty account is required.");

  const id = relationshipId(studentUid, facultyUid);
  const relationshipRef = doc(db, "relationships", id);

  // A participant may not read a relationship document before it exists.
  // Treat a permission-denied read as "not created yet"; the subsequent
  // create is still checked by the Firestore relationship rules.
  let existing = null;
  try {
    existing = await getDoc(relationshipRef);
  } catch (error) {
    const code = String(error?.code || "");
    if (code !== "permission-denied" && code !== "firestore/permission-denied") {
      throw error;
    }
  }

  const restoring = existing?.exists() === true;
  if (restoring) {
    await updateDoc(relationshipRef, {
      status: "active",
      initiatedByUid: state.user.uid,
      initiatedByRole,
      updatedByUid: state.user.uid,
      updatedAt: serverTimestamp()
    });
  } else {
    await setDoc(relationshipRef, {
      studentUid,
      facultyUid,
      studentEmail: student.email,
      facultyEmail: faculty.email,
      status: "active",
      initiatedByUid: state.user.uid,
      initiatedByRole,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  await recordAudit(restoring ? "relationship_restored" : "relationship_created", {
    studentUid,
    facultyUid,
    targetUid: state.user.uid === studentUid ? facultyUid : studentUid,
    summary: `${student.displayName} and ${faculty.displayName} were connected in AIM.`
  });

  // A notification problem should never undo or falsely report a successful
  // advisor connection.
  await notifyRelationshipStatus(
    studentUid,
    facultyUid,
    `${student.displayName} and ${faculty.displayName} are now connected in AIM.`
  ).catch((error) => console.warn("Relationship notification skipped", error));
}

async function createRelationshipInvite({ studentEmail, facultyEmail, initiatedByRole }) {
  const normalizedStudent = normalizeEmail(studentEmail);
  const normalizedFaculty = normalizeEmail(facultyEmail);
  const id = await hashText(`${normalizedStudent}__${normalizedFaculty}`);
  await setDoc(doc(db, "relationshipInvites", id), {
    studentEmail: normalizedStudent,
    facultyEmail: normalizedFaculty,
    initiatedByUid: state.user.uid,
    initiatedByRole,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function claimPendingInvites() {
  if (!state.profile?.approved || !["student", "faculty"].includes(state.profile.role)) return;
  const field = state.profile.role === "student" ? "studentEmail" : "facultyEmail";
  const snaps = await getDocs(query(collection(db, "relationshipInvites"), where(field, "==", state.profile.email)));
  for (const inviteDoc of snaps.docs) {
    const invite = inviteDoc.data();
    if (invite.status !== "pending") continue;
    const [student, faculty] = await Promise.all([findUserByEmail(invite.studentEmail), findUserByEmail(invite.facultyEmail)]);
    if (!student || !faculty || student.role !== "student" || faculty.role !== "faculty") continue;
    await createRelationship(student.id, faculty.id, invite.initiatedByRole || state.profile.role);
    await updateDoc(inviteDoc.ref, { status: "claimed", claimedAt: serverTimestamp(), claimedByUid: state.user.uid, updatedAt: serverTimestamp() });
  }
}

async function getRelationshipsForStudent(uid) {
  const snap = await getDocs(query(collection(db, "relationships"), where("studentUid", "==", uid)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getRelationshipsForFaculty(uid) {
  const snap = await getDocs(query(collection(db, "relationships"), where("facultyUid", "==", uid)));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function notifyPlanChange(student, changedSections) {
  const relationships = (await getRelationshipsForStudent(student.id)).filter((item) => item.status === "active");
  const recipients = new Set(relationships.map((item) => item.facultyUid));
  if (state.profile.role === "admin") recipients.add(student.id);
  recipients.delete(state.user.uid);
  await Promise.all(Array.from(recipients).map((recipientUid) => addOrGroupNotification({
    recipientUid,
    senderUid: state.user.uid,
    studentUid: student.id,
    facultyUid: relationships.find((item) => item.facultyUid === recipientUid)?.facultyUid || "",
    type: "plan-update",
    category: "planUpdates",
    title: "AIM plan updated",
    body: `${state.profile.displayName} updated ${changedSections.map(stageTitle).join(", ") || "the AIM plan"}.`,
    relatedStudentUid: student.id
  }, `plan-${recipientUid}-${state.user.uid}-${student.id}-${dateKey(new Date())}`)));
}

async function notifyComment(student, sectionKey) {
  // Faculty members are allowed to see their own relationship with a student,
  // but not the student's complete advisor list. Avoid querying every advisor
  // when a faculty member leaves a comment.
  if (state.profile.role === "faculty") {
    return addNotification({
      recipientUid: student.id,
      senderUid: state.user.uid,
      studentUid: student.id,
      facultyUid: state.user.uid,
      type: "comment",
      category: "comments",
      title: "New AIM comment",
      body: `${state.profile.displayName} commented on ${stageTitle(sectionKey)}.`,
      relatedStudentUid: student.id
    });
  }

  // Administrators may notify the student and all active advisors.
  const relationships = (await getRelationshipsForStudent(student.id)).filter((item) => item.status === "active");
  const recipients = new Set([student.id]);
  relationships.forEach((item) => recipients.add(item.facultyUid));
  recipients.delete(state.user.uid);

  await Promise.all(Array.from(recipients).map((recipientUid) => addNotification({
    recipientUid,
    senderUid: state.user.uid,
    studentUid: student.id,
    facultyUid: relationships.find((item) => item.facultyUid === recipientUid)?.facultyUid || "",
    type: "comment",
    category: "comments",
    title: "New AIM comment",
    body: `${state.profile.displayName} commented on ${stageTitle(sectionKey)}.`,
    relatedStudentUid: student.id
  })));
}

async function notifyDocumentChange(student, body) {
  const relationships = (await getRelationshipsForStudent(student.id)).filter((item) => item.status === "active");
  const recipients = new Set(relationships.map((item) => item.facultyUid));
  if (state.profile.role === "admin") recipients.add(student.id);
  recipients.delete(state.user.uid);
  await Promise.all(Array.from(recipients).map((recipientUid) => addNotification({
    recipientUid, senderUid: state.user.uid, studentUid: student.id,
    facultyUid: relationships.find((item) => item.facultyUid === recipientUid)?.facultyUid || "",
    type: "document-update", category: "documents", title: "AIM document links changed", body, relatedStudentUid: student.id
  })));
}

async function notifyRelationshipStatus(studentUid, facultyUid, body) {
  const recipients = [studentUid, facultyUid].filter((uid) => uid && uid !== state.user.uid);
  await Promise.all(recipients.map((recipientUid) => addNotification({
    recipientUid, senderUid: state.user.uid, studentUid, facultyUid,
    type: "relationship", category: "relationships", title: "AIM advising relationship changed", body, relatedStudentUid: studentUid
  })));
}

async function notifyRemovalRequest(facultyUid, reason) {
  const admins = await getUsersByRole("admin");
  const recipients = new Set([facultyUid, ...admins.map((item) => item.id)]);
  recipients.delete(state.user.uid);
  await Promise.all(Array.from(recipients).map((recipientUid) => addNotification({
    recipientUid, senderUid: state.user.uid, studentUid: state.user.uid, facultyUid,
    type: "removal-request", category: recipientUid === facultyUid ? "relationships" : "administrative",
    title: "Advisor removal request", body: `${state.profile.displayName} requested advisor removal. Reason: ${reason}`, relatedStudentUid: state.user.uid
  })));
}

async function addNotification(payload) {
  if (!(await recipientAllows(payload.recipientUid, payload.category))) return null;
  return addDoc(collection(db, "notifications"), { ...payload, read: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), eventCount: 1 });
}

async function addOrGroupNotification(payload, groupKey) {
  if (!(await recipientAllows(payload.recipientUid, payload.category))) return null;
  const id = await hashText(groupKey);
  const ref = doc(db, "notifications", id);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const count = Number(existing.data().eventCount || 1) + 1;
    return updateDoc(ref, { ...payload, read: false, updatedAt: serverTimestamp(), eventCount: count });
  }
  return setDoc(ref, { ...payload, read: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), eventCount: 1 });
}

async function recipientAllows(recipientUid, category) {
  if (!recipientUid) return false;
  const recipient = await getUser(recipientUid);
  if (!recipient || !recipient.approved || recipient.status !== "active") return false;
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(recipient.notificationPreferences || {}) };
  return !prefs.allMuted && prefs[category] !== false;
}

async function renderNotifications() {
  const snap = await getDocs(query(collection(db, "notifications"), where("recipientUid", "==", state.user.uid)));
  const notifications = snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => timestampMillis(b.updatedAt || b.createdAt) - timestampMillis(a.updatedAt || a.createdAt));
  const unread = notifications.filter((item) => !item.read).length;
  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>Notifications</h2>${unread ? `<p>${unread} unread notification${unread === 1 ? "" : "s"}</p>` : ""}</div>${unread ? '<button class="btn btn-secondary" id="mark-all-read">Mark all read</button>' : ""}</div>
    <div class="notification-list">${notifications.length ? notifications.map(notificationHtml).join("") : emptyStateHtml("No notifications", "Plan updates, comments, document links, and relationship changes will appear here.")}</div>`;

  document.getElementById("mark-all-read")?.addEventListener("click", async () => {
    const batch = writeBatch(db);
    notifications.filter((item) => !item.read).forEach((item) => batch.update(doc(db, "notifications", item.id), { read: true, readAt: serverTimestamp() }));
    try { await batch.commit(); toast("Notifications marked as read.", "success"); renderNotifications(); }
    catch (error) { toast(friendlyError(error), "error"); }
  });

  document.querySelectorAll("[data-notification-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = notifications.find((entry) => entry.id === button.dataset.notificationId);
      if (!item) return;
      if (!item.read) await updateDoc(doc(db, "notifications", item.id), { read: true, readAt: serverTimestamp() }).catch(() => {});
      if (item.relatedStudentUid && ["faculty", "admin"].includes(state.profile.role)) navigate("studentPlan", { studentUid: item.relatedStudentUid, backView: "notifications" });
      else if (state.profile.role === "student") navigate("map");
    });
  });
}

function notificationHtml(item) {
  const count = Number(item.eventCount || 1);
  return `<article class="notification ${item.read ? "" : "unread"}"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}${count > 1 ? ` <strong>(${count} grouped updates)</strong>` : ""}</p><time>${formatDate(item.updatedAt || item.createdAt)}</time></div><button class="btn btn-secondary btn-small" data-notification-id="${item.id}">Open</button></article>`;
}

async function renderProfile() {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(state.profile.notificationPreferences || {}) };
  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>My Profile</h2></div></div>
    <div class="grid grid-2"><section class="panel"><h3>Account</h3><form id="profile-form" class="form-stack"><div class="field"><label for="profile-name">Display name</label><input id="profile-name" maxlength="100" value="${escapeAttr(state.profile.displayName)}" required></div><div class="field"><label>Email</label><input value="${escapeAttr(state.profile.email)}" disabled></div><div class="field"><label>Role</label><input value="${escapeAttr(capitalize(state.profile.role))}" disabled></div><button class="btn btn-primary" type="submit">Save profile</button></form></section>
    <section class="panel"><h3>Notification Preferences</h3><form id="notification-preferences-form" class="preference-list">
      ${preferenceCheckbox("allMuted", "Mute all AIM notifications", prefs.allMuted)}
      <hr>
      ${preferenceCheckbox("planUpdates", "Plan updates", prefs.planUpdates)}
      ${preferenceCheckbox("comments", "Advisor and admin comments", prefs.comments)}
      ${preferenceCheckbox("relationships", "Advisor relationship changes", prefs.relationships)}
      ${preferenceCheckbox("documents", "Document-link changes", prefs.documents)}
      ${preferenceCheckbox("administrative", "Administrative actions", prefs.administrative)}
      <button class="btn btn-primary" type="submit">Save notification settings</button>
    </form></section></div>`;

  document.getElementById("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("profile-name").value.trim();
    if (!name) return;
    const button = event.currentTarget.querySelector("button");
    setBusy(button, true, "Saving…");
    try {
      await updateDoc(doc(db, "users", state.user.uid), { displayName: name, updatedAt: serverTimestamp() });
      await updateProfile(auth.currentUser, { displayName: name });
      state.profile.displayName = name;
      await recordAudit("profile_updated", { targetUid: state.user.uid, targetEmail: state.profile.email, summary: `${name} updated their profile.` });
      toast("Profile saved.", "success");
      renderShell();
    } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Save profile"); }
  });

  document.getElementById("notification-preferences-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const notificationPreferences = Object.fromEntries(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).map((key) => [key, form.elements[key].checked]));
    const button = form.querySelector("button");
    setBusy(button, true, "Saving…");
    try {
      await updateDoc(doc(db, "users", state.user.uid), { notificationPreferences, updatedAt: serverTimestamp() });
      state.profile.notificationPreferences = notificationPreferences;
      await recordAudit("notification_preferences_updated", { targetUid: state.user.uid, targetEmail: state.profile.email, summary: `${state.profile.displayName} updated notification preferences.` });
      toast("Notification settings saved.", "success");
      setBusy(button, false, "Save notification settings");
    } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Save notification settings"); }
  });
}

function preferenceCheckbox(name, label, checked) {
  return `<label class="preference-item"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}

async function renderAdminDashboard() {
  requireAdmin();
  const [usersSnap, relationshipsSnap, removalSnap, logs] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "relationships")),
    getDocs(collection(db, "relationshipRemovalRequests")),
    getTodayAuditLogs()
  ]);
  const users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const pendingRemovals = removalSnap.docs.filter((item) => item.data().status === "pending").length;
  const summary = summarizeAuditLogs(logs);

  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>Administrator Dashboard</h2></div></div>
    <div class="grid grid-3">${metricHtml(users.filter((u) => u.role === "student" && u.approved && u.status === "active").length, "Approved students")}${metricHtml(users.filter((u) => u.role === "faculty" && u.approved && u.status === "active").length, "Approved faculty")}${metricHtml(users.filter((u) => u.role === "admin" && u.approved && u.status === "active").length, "Administrators")}${metricHtml(relationshipsSnap.docs.filter((item) => item.data().status === "active").length, "Active relationships")}${metricHtml(pendingRemovals, "Removal requests")}${metricHtml(users.filter((u) => u.role === "pending" || !u.approved).length, "Pending accounts")}</div>
    <section class="panel daily-summary" style="margin-top:1rem"><div class="panel-head"><div><h3>Today's Summary</h3></div><span class="subtle">${new Date().toLocaleDateString()}</span></div><div class="summary-grid">${metricHtml(summary.planSaves, "Plan saves")}${metricHtml(summary.comments, "Comments")}${metricHtml(summary.relationships, "Relationship changes")}${metricHtml(summary.documents, "Document-link changes")}${metricHtml(summary.userChanges, "User/admin changes")}${metricHtml(summary.total, "Total logged actions")}</div></section>
    <div class="grid grid-2" style="margin-top:1rem"><section class="panel"><h3>Application settings</h3><form id="admin-settings-form" class="form-stack"><div class="field"><label for="registration-mode">Registration mode</label><select id="registration-mode"><option value="testing" ${state.settings.registrationMode === "testing" ? "selected" : ""}>Testing</option><option value="official" ${state.settings.registrationMode === "official" ? "selected" : ""}>College accounts only</option></select></div><div class="field"><label for="app-url">AIM web address</label><input id="app-url" type="url" value="${escapeAttr(state.settings.appUrl || "")}" required></div><div class="field"><label for="autosave-delay">Autosave delay</label><select id="autosave-delay"><option value="15" ${Number(state.settings.autosaveDelaySeconds) === 15 ? "selected" : ""}>15 seconds</option><option value="25" ${Number(state.settings.autosaveDelaySeconds || 25) === 25 ? "selected" : ""}>25 seconds</option><option value="30" ${Number(state.settings.autosaveDelaySeconds) === 30 ? "selected" : ""}>30 seconds</option></select></div><button class="btn btn-primary" type="submit">Save settings</button></form></section>
    <section class="panel"><h3>Pending actions</h3><ul class="plain-list"><li><strong>${pendingRemovals}</strong> advisor-removal request${pendingRemovals === 1 ? "" : "s"}</li><li><strong>${users.filter((u) => u.role === "pending" || !u.approved).length}</strong> account${users.filter((u) => u.role === "pending" || !u.approved).length === 1 ? "" : "s"} awaiting approval</li><li><strong>${relationshipsSnap.docs.filter((item) => item.data().status === "pending").length}</strong> advising relationship${relationshipsSnap.docs.filter((item) => item.data().status === "pending").length === 1 ? "" : "s"} awaiting registration or approval</li></ul></section></div>`;

  document.getElementById("admin-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    setBusy(button, true, "Saving…");
    try {
      const update = {
        registrationMode: document.getElementById("registration-mode").value,
        appUrl: document.getElementById("app-url").value.trim(),
        autosaveDelaySeconds: Number(document.getElementById("autosave-delay").value),
        updatedAt: serverTimestamp(), updatedByUid: state.user.uid
      };
      await setDoc(doc(db, "settings", "app"), update, { merge: true });
      state.settings = { ...state.settings, ...update };
      await recordAudit("settings_changed", { summary: `${state.profile.displayName} changed AIM application settings.` });
      toast("Settings saved.", "success");
      setBusy(button, false, "Save settings");
    } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Save settings"); }
  });
}

async function getTodayAuditLogs() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const snap = await getDocs(query(collection(db, "auditLogs"), where("createdAt", ">=", Timestamp.fromDate(start))));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function summarizeAuditLogs(logs) {
  const actions = logs.map((item) => item.action);
  return {
    total: logs.length,
    planSaves: actions.filter((a) => a === "plan_saved").length,
    comments: actions.filter((a) => a.startsWith("comment_")).length,
    relationships: actions.filter((a) => a.startsWith("relationship_") || a.startsWith("removal_")).length,
    documents: actions.filter((a) => a.startsWith("document_")).length,
    userChanges: actions.filter((a) => ["user_role_changed", "email_preapproved", "settings_changed", "admin_invited"].includes(a)).length
  };
}

async function renderAdminPlans() {
  requireAdmin();
  const [students, plansSnap] = await Promise.all([getUsersByRole("student"), getDocs(collection(db, "plans"))]);
  const plans = new Map(plansSnap.docs.map((item) => [item.id, item.data()]));
  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>All Student Plans</h2></div></div>
    <section class="panel" style="margin-bottom:1rem"><div class="field"><label for="student-plan-search">Find a student</label><input id="student-plan-search" type="search" placeholder="Search by name or email"></div></section>
    <div id="student-plan-table" class="table-wrap">${adminPlansTableHtml(students, plans)}</div>`;
  document.getElementById("student-plan-search").addEventListener("input", (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = students.filter((student) => `${student.displayName} ${student.email}`.toLowerCase().includes(term));
    document.getElementById("student-plan-table").innerHTML = adminPlansTableHtml(filtered, plans);
    bindAdminPlanActions();
  });
  bindAdminPlanActions();
}

function adminPlansTableHtml(students, plans) {
  return `<table><thead><tr><th>Student</th><th>Plan progress</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>${students.length ? students.map((student) => adminPlanRowHtml(student, plans.get(student.id))).join("") : '<tr><td colspan="4" class="subtle">No matching students.</td></tr>'}</tbody></table>`;
}

function bindAdminPlanActions() {
  document.querySelectorAll("[data-admin-plan]").forEach((button) => button.addEventListener("click", () => navigate("studentPlan", { studentUid: button.dataset.adminPlan, backView: "plans" })));
  document.querySelectorAll("[data-admin-documents]").forEach((button) => button.addEventListener("click", () => navigate("documents", { studentUid: button.dataset.adminDocuments, backView: "plans" })));
}

function adminPlanRowHtml(student, plan) {
  const progress = planCompletion(plan?.stages || {});
  return `<tr><td><strong>${escapeHtml(student.displayName)}</strong><br><span class="subtle">${escapeHtml(student.email)}</span></td><td><div class="progress-line"><span style="width:${progress.percent}%"></span></div><small>${progress.completed} of ${progress.total} planning areas started</small></td><td>${plan ? formatDate(plan.updatedAt) : "Not started"}</td><td><div class="table-actions"><button class="btn btn-primary btn-small" data-admin-plan="${student.id}">View/edit plan</button><button class="btn btn-secondary btn-small" data-admin-documents="${student.id}">Document links</button></div></td></tr>`;
}

function planCompletion(stages) {
  let completed = 0;
  let total = 0;
  STAGES.forEach((stage) => stageFieldDefinitions(stage).forEach(([key]) => { total += 1; if (String(stages?.[stage.key]?.[key] || "").trim()) completed += 1; }));
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
}

async function renderAdminUsers() {
  requireAdmin();
  const [usersSnap, approvalsSnap] = await Promise.all([getDocs(collection(db, "users")), getDocs(collection(db, "emailApprovals"))]);
  const users = usersSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
  const approvals = approvalsSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.email || a.id).localeCompare(b.email || b.id));

  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>Manage Users</h2></div></div>
    <section class="panel" style="margin-bottom:1rem"><h3>Add or Approve Email</h3><form id="preapprove-form" class="grid grid-3"><div class="field"><label for="preapprove-email">Email address</label><input id="preapprove-email" type="email" required></div><div class="field"><label for="preapprove-role">Role</label><select id="preapprove-role"><option value="student">Student</option><option value="faculty">Faculty</option><option value="admin">Administrator</option></select></div><div class="field" style="align-self:end"><button class="btn btn-primary" type="submit">Add / approve email</button></div></form></section>
    <section class="panel" style="margin-bottom:1rem"><div class="field"><label for="user-search">Search registered users</label><input id="user-search" type="search" placeholder="Name or email"></div></section>
    <div id="users-table" class="table-wrap">${usersTableHtml(users)}</div>
    <section class="panel" style="margin-top:1rem"><div class="panel-head"><h3>Approved email addresses</h3><span class="subtle">${approvals.length}</span></div>${approvals.length ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead><tbody>${approvals.map((item) => `<tr><td>${escapeHtml(item.email || item.id)}</td><td>${rolePill(item.role)}</td><td>${item.active ? statusPill("active") : statusPill("disabled")}</td><td><button class="btn btn-danger btn-small" data-remove-approval="${escapeAttr(item.id)}">Remove approval</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="subtle">No additional approved email addresses.</p>'}</section>`;

  document.getElementById("preapprove-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = normalizeEmail(document.getElementById("preapprove-email").value);
    const role = document.getElementById("preapprove-role").value;
    const button = event.currentTarget.querySelector("button");
    setBusy(button, true, "Saving…");
    try {
      if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
      const existing = await findUserByEmail(email, { includeInactive: true });
      if (existing) {
        await updateDoc(doc(db, "users", existing.id), { role, approved: true, status: "active", updatedAt: serverTimestamp(), updatedByUid: state.user.uid });
        await addNotification({ recipientUid: existing.id, senderUid: state.user.uid, studentUid: role === "student" ? existing.id : "", facultyUid: role === "faculty" ? existing.id : "", type: "administrative", category: "administrative", title: "AIM account role changed", body: `An administrator assigned your AIM role as ${capitalize(role)}.`, relatedStudentUid: role === "student" ? existing.id : "" }).catch(() => {});
        await recordAudit("user_role_changed", { targetUid: existing.id, targetEmail: email, summary: `${state.profile.displayName} assigned ${email} as ${role}.` });
      } else {
        await setDoc(doc(db, "emailApprovals", email), { email, role, active: true, createdByUid: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        await recordAudit(role === "admin" ? "admin_invited" : "email_preapproved", { targetEmail: email, summary: `${state.profile.displayName} preapproved ${email} as ${role}.` });
      }
      toast(existing ? "Registered user updated." : "Email approved. Share the AIM registration instructions with the person.", "success");
      renderAdminUsers();
    } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Add / approve email"); }
  });

  document.getElementById("user-search").addEventListener("input", (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = users.filter((user) => `${user.displayName} ${user.email}`.toLowerCase().includes(term));
    document.getElementById("users-table").innerHTML = usersTableHtml(filtered);
    bindUserTableActions();
  });
  bindUserTableActions();

  document.querySelectorAll("[data-remove-approval]").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("Remove this preapproval? A currently registered account will not be deleted.")) return;
    try { await deleteDoc(doc(db, "emailApprovals", button.dataset.removeApproval)); toast("Preapproval removed.", "success"); renderAdminUsers(); }
    catch (error) { toast(friendlyError(error), "error"); }
  }));
}

function usersTableHtml(users) {
  return `<table><thead><tr><th>User</th><th>Role</th><th>Approved</th><th>Status</th><th>Actions</th></tr></thead><tbody>${users.length ? users.map((user) => {
    const self = user.id === state.user.uid;
    return `<tr data-user-row="${user.id}"><td><strong>${escapeHtml(user.displayName || "Unnamed")}</strong><br><span class="subtle">${escapeHtml(user.email)}</span></td><td><select data-user-role ${self ? "disabled" : ""}><option value="pending" ${user.role === "pending" ? "selected" : ""}>Pending</option><option value="student" ${user.role === "student" ? "selected" : ""}>Student</option><option value="faculty" ${user.role === "faculty" ? "selected" : ""}>Faculty</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option></select></td><td><input data-user-approved type="checkbox" ${user.approved ? "checked" : ""} ${self ? "disabled" : ""}></td><td><select data-user-status ${self ? "disabled" : ""}><option value="active" ${user.status === "active" ? "selected" : ""}>Active</option><option value="disabled" ${user.status === "disabled" ? "selected" : ""}>Disabled</option></select></td><td><div class="table-actions">${self ? '<span class="subtle">Current admin</span>' : '<button class="btn btn-primary btn-small" data-save-user>Save</button>'}${user.role === "student" ? `<button class="btn btn-secondary btn-small" data-admin-view-plan="${user.id}">View plan</button>` : ""}</div></td></tr>`;
  }).join("") : '<tr><td colspan="5" class="subtle">No matching users.</td></tr>'}</tbody></table>`;
}

function bindUserTableActions() {
  document.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      const row = button.closest("tr");
      const uid = row.dataset.userRow;
      const role = row.querySelector("[data-user-role]").value;
      const approved = row.querySelector("[data-user-approved]").checked;
      const status = row.querySelector("[data-user-status]").value;
      setBusy(button, true, "Saving…");
      try {
        const target = await getUser(uid);
        await updateDoc(doc(db, "users", uid), { role, approved, status, updatedAt: serverTimestamp(), updatedByUid: state.user.uid });
        await addNotification({ recipientUid: uid, senderUid: state.user.uid, studentUid: role === "student" ? uid : "", facultyUid: role === "faculty" ? uid : "", type: "administrative", category: "administrative", title: "AIM account changed", body: `Your AIM role is now ${capitalize(role)} and your account is ${status}.`, relatedStudentUid: role === "student" ? uid : "" }).catch(() => {});
        await recordAudit("user_role_changed", { targetUid: uid, targetEmail: target?.email || "", summary: `${state.profile.displayName} changed ${target?.email || uid} to ${role}/${status}.` });
        toast("User updated.", "success");
        setBusy(button, false, "Save");
      } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Save"); }
    });
  });
  document.querySelectorAll("[data-admin-view-plan]").forEach((button) => button.addEventListener("click", () => navigate("studentPlan", { studentUid: button.dataset.adminViewPlan, backView: "users" })));
}

async function renderAdminRelationships() {
  requireAdmin();
  const [relationshipSnap, requestSnap, inviteSnap, students, faculty] = await Promise.all([
    getDocs(collection(db, "relationships")),
    getDocs(collection(db, "relationshipRemovalRequests")),
    getDocs(collection(db, "relationshipInvites")),
    getUsersByRole("student"),
    getUsersByRole("faculty")
  ]);
  const relationships = relationshipSnap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  const requests = new Map(requestSnap.docs.map((item) => [item.data().relationshipId || item.id, { id: item.id, ...item.data() }]));
  const pendingInvites = inviteSnap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.status === "pending");
  const pendingCount = Array.from(requests.values()).filter((item) => item.status === "pending").length;

  document.getElementById("main-content").innerHTML = `<div class="page-head"><div><h2>Advisor Relationships</h2></div><span class="pill ${pendingCount ? "pill-pending" : "pill-active"}">${pendingCount} removal request${pendingCount === 1 ? "" : "s"} pending</span></div>
    <section class="panel" style="margin-bottom:1rem"><h3>Add Student–Advisor Relationship</h3><form id="admin-relationship-form" class="grid grid-3"><div class="field"><label for="admin-student-email">Student email</label><input id="admin-student-email" type="email" list="admin-student-list" placeholder="student@email.shc.edu" required><datalist id="admin-student-list">${students.map((item) => `<option value="${escapeAttr(item.email)}">${escapeHtml(item.displayName)}</option>`).join("")}</datalist></div><div class="field"><label for="admin-faculty-email">Advisor email</label><input id="admin-faculty-email" type="email" list="admin-faculty-list" placeholder="advisor@shc.edu" required><datalist id="admin-faculty-list">${faculty.map((item) => `<option value="${escapeAttr(item.email)}">${escapeHtml(item.displayName)}</option>`).join("")}</datalist></div><div class="field" style="align-self:end"><button class="btn btn-primary" type="submit">Create relationship</button></div></form></section>
    ${pendingInvites.length ? `<section class="panel" style="margin-bottom:1rem"><div class="panel-head"><h3>Pending unregistered connections</h3><span class="subtle">${pendingInvites.length}</span></div><div class="table-wrap"><table><thead><tr><th>Student email</th><th>Advisor email</th><th>Created</th><th>Action</th></tr></thead><tbody>${pendingInvites.map((item) => `<tr><td>${escapeHtml(item.studentEmail)}</td><td>${escapeHtml(item.facultyEmail)}</td><td>${formatDate(item.createdAt)}</td><td><button class="btn btn-danger btn-small" data-cancel-invite="${item.id}">Cancel</button></td></tr>`).join("")}</tbody></table></div></section>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Faculty</th><th>Status</th><th>Removal request</th><th>Actions</th></tr></thead><tbody>${relationships.length ? relationships.map((item) => relationshipRowHtml(item, requests.get(item.id))).join("") : '<tr><td colspan="5" class="subtle">No relationships yet.</td></tr>'}</tbody></table></div>`;

  document.getElementById("admin-relationship-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentEmail = normalizeEmail(document.getElementById("admin-student-email").value);
    const facultyEmail = normalizeEmail(document.getElementById("admin-faculty-email").value);
    const button = event.currentTarget.querySelector("button");
    setBusy(button, true, "Creating…");
    try {
      if (!isValidEmail(studentEmail) || !isValidEmail(facultyEmail)) throw new Error("Enter valid student and advisor email addresses.");
      let [student, advisor] = await Promise.all([findUserByEmail(studentEmail, { includeInactive: true }), findUserByEmail(facultyEmail, { includeInactive: true })]);
      if (student && student.role !== "student") throw new Error(`${studentEmail} is registered but is not assigned as a student.`);
      if (advisor && advisor.role !== "faculty") throw new Error(`${facultyEmail} is registered but is not assigned as faculty.`);
      if (!student) await preapproveEmail(studentEmail, "student");
      if (!advisor) await preapproveEmail(facultyEmail, "faculty");
      if (student && advisor) {
        await createRelationship(student.id, advisor.id, "admin");
        toast("Relationship created.", "success");
      } else {
        await createRelationshipInvite({ studentEmail, facultyEmail, initiatedByRole: "admin" });
        await recordAudit("relationship_invited", { targetEmail: `${studentEmail}; ${facultyEmail}`, summary: `${state.profile.displayName} created a pending student-advisor connection.` });
        toast("Pending relationship saved.", "success");
      }
      renderAdminRelationships();
    } catch (error) { toast(friendlyError(error), "error"); setBusy(button, false, "Create relationship"); }
  });

  document.querySelectorAll("[data-cancel-invite]").forEach((button) => button.addEventListener("click", async () => {
    try { await updateDoc(doc(db, "relationshipInvites", button.dataset.cancelInvite), { status: "cancelled", updatedAt: serverTimestamp(), updatedByUid: state.user.uid }); toast("Pending connection cancelled.", "success"); renderAdminRelationships(); }
    catch (error) { toast(friendlyError(error), "error"); }
  }));

  document.querySelectorAll("[data-approve-removal]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.approveRemoval;
    if (!confirm("Approve this request and remove the advisor relationship?")) return;
    try {
      const relationship = relationships.find((item) => item.id === id);
      const batch = writeBatch(db);
      batch.update(doc(db, "relationships", id), { status: "removed", updatedAt: serverTimestamp(), updatedByUid: state.user.uid });
      batch.update(doc(db, "relationshipRemovalRequests", id), { status: "approved", reviewedAt: serverTimestamp(), reviewedByUid: state.user.uid, updatedAt: serverTimestamp() });
      await batch.commit();
      await notifyRelationshipStatus(relationship.studentUid, relationship.facultyUid, "An administrator approved the student's advisor-removal request.");
      await recordAudit("removal_approved", { studentUid: relationship.studentUid, facultyUid: relationship.facultyUid, summary: `${state.profile.displayName} approved advisor removal.` });
      toast("Advisor removal approved.", "success"); renderAdminRelationships();
    } catch (error) { toast(friendlyError(error), "error"); }
  }));

  document.querySelectorAll("[data-reject-removal]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.rejectRemoval;
    try {
      const relationship = relationships.find((item) => item.id === id);
      await updateDoc(doc(db, "relationshipRemovalRequests", id), { status: "rejected", reviewedAt: serverTimestamp(), reviewedByUid: state.user.uid, updatedAt: serverTimestamp() });
      await notifyRelationshipStatus(relationship.studentUid, relationship.facultyUid, "An administrator kept the advisor relationship active.");
      await recordAudit("removal_rejected", { studentUid: relationship.studentUid, facultyUid: relationship.facultyUid, summary: `${state.profile.displayName} rejected advisor removal.` });
      toast("The advisor relationship remains active.", "success"); renderAdminRelationships();
    } catch (error) { toast(friendlyError(error), "error"); }
  }));

  document.querySelectorAll("[data-toggle-relationship]").forEach((button) => button.addEventListener("click", async () => {
    const relationship = relationships.find((item) => item.id === button.dataset.toggleRelationship);
    const nextStatus = button.dataset.nextStatus;
    try {
      await updateDoc(doc(db, "relationships", relationship.id), { status: nextStatus, updatedAt: serverTimestamp(), updatedByUid: state.user.uid });
      await notifyRelationshipStatus(relationship.studentUid, relationship.facultyUid, `An administrator ${nextStatus === "active" ? "restored" : "removed"} this advising relationship.`);
      await recordAudit(nextStatus === "active" ? "relationship_restored" : "relationship_removed", { studentUid: relationship.studentUid, facultyUid: relationship.facultyUid, summary: `${state.profile.displayName} ${nextStatus === "active" ? "restored" : "removed"} an advising relationship.` });
      toast("Relationship updated.", "success"); renderAdminRelationships();
    } catch (error) { toast(friendlyError(error), "error"); }
  }));
  document.querySelectorAll("[data-admin-rel-plan]").forEach((button) => button.addEventListener("click", () => navigate("studentPlan", { studentUid: button.dataset.adminRelPlan, backView: "relationships" })));
}

function relationshipRowHtml(item, request) {
  const pending = request?.status === "pending";
  return `<tr><td>${escapeHtml(item.studentEmail || item.studentUid)}</td><td>${escapeHtml(item.facultyEmail || item.facultyUid)}</td><td>${statusPill(item.status)}</td><td>${pending ? `<strong>Pending</strong><br><span class="subtle">${escapeHtml(request.reason || "No reason supplied")}</span><br><small>${formatDate(request.requestedAt)}</small>` : request ? `${statusPill(request.status)}<br><span class="subtle">${escapeHtml(request.reason || "")}</span>` : '<span class="subtle">None</span>'}</td><td><div class="table-actions">${pending ? `<button class="btn btn-danger btn-small" data-approve-removal="${item.id}">Approve removal</button><button class="btn btn-secondary btn-small" data-reject-removal="${item.id}">Keep advisor</button>` : `<button class="btn btn-secondary btn-small" data-toggle-relationship="${item.id}" data-next-status="${item.status === "active" ? "removed" : "active"}">${item.status === "active" ? "Admin remove" : "Restore"}</button>`}<button class="btn btn-secondary btn-small" data-admin-rel-plan="${item.studentUid}">View plan</button></div></td></tr>`;
}

async function preapproveEmail(email, role) {
  await setDoc(doc(db, "emailApprovals", email), { email, role, active: true, createdByUid: state.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  await recordAudit(role === "admin" ? "admin_invited" : "email_preapproved", { targetEmail: email, summary: `${state.profile.displayName} preapproved ${email} as ${role}.` });
}

async function recordAudit(action, details = {}) {
  if (!db || !state.user || !state.profile) return;
  return addDoc(collection(db, "auditLogs"), {
    actorUid: state.user.uid,
    actorName: state.profile.displayName,
    actorRole: state.profile.role,
    action,
    targetType: details.targetType || "",
    targetUid: details.targetUid || "",
    targetEmail: details.targetEmail || "",
    studentUid: details.studentUid || "",
    facultyUid: details.facultyUid || "",
    summary: details.summary || action,
    metadata: details.metadata || {},
    createdAt: serverTimestamp()
  }).catch((error) => console.warn("Audit log skipped", error));
}

function requireAdmin() {
  if (state.profile.role !== "admin") throw new Error("Administrator access is required.");
}

async function getUsersByRole(role) {
  const snap = await getDocs(query(collection(db, "users"), where("role", "==", role), where("approved", "==", true), where("status", "==", "active")));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));
}

async function getUser(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    if (error.code === "permission-denied" || error.code === "firestore/permission-denied") return null;
    throw error;
  }
}

async function findUserByEmail(email, options = {}) {
  const constraints = [where("emailLower", "==", normalizeEmail(email))];
  if (!options.includeInactive && state.profile?.role !== "admin") constraints.push(where("approved", "==", true), where("status", "==", "active"));
  constraints.push(limit(1));
  const snap = await getDocs(query(collection(db, "users"), ...constraints));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

function relationshipId(studentUid, facultyUid) { return `${studentUid}__${facultyUid}`; }
function metricHtml(value, label) { return `<div class="metric"><div class="value">${escapeHtml(String(value))}</div><div class="label">${escapeHtml(label)}</div></div>`; }
function rolePill(role) { const safe = ["student", "faculty", "admin", "pending"].includes(role) ? role : "pending"; return `<span class="pill pill-${safe}">${capitalize(safe)}</span>`; }
function statusPill(status) { const safe = ["active", "disabled", "pending", "approved", "rejected", "removed", "claimed", "cancelled"].includes(status) ? status : "pending"; return `<span class="pill pill-${safe === "active" || safe === "approved" || safe === "claimed" ? "active" : safe === "disabled" || safe === "removed" || safe === "rejected" || safe === "cancelled" ? "disabled" : "pending"}">${capitalize(safe)}</span>`; }
function emptyStateHtml(title, text) { return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`; }
function stageTitle(key) { return STAGES.find((item) => item.key === key)?.title || key; }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function capitalize(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1) : ""; }
function dateKey(date) { return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`; }
function timestampMillis(value) { if (!value) return 0; if (typeof value.toMillis === "function") return value.toMillis(); const parsed = new Date(value).getTime(); return Number.isFinite(parsed) ? parsed : 0; }
function formatDate(value) { const millis = timestampMillis(value); return millis ? new Date(millis).toLocaleString() : "Just now"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, "&#96;"); }
async function hashText(text) { const bytes = new TextEncoder().encode(text); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function setBusy(button, busy, label) { if (!button) return; button.disabled = busy; button.textContent = label; }
function toast(message, type = "") { const item = document.createElement("div"); item.className = `toast ${type}`; item.textContent = message; toastRegion.appendChild(item); setTimeout(() => item.remove(), 4000); }
function friendlyError(error) {
  const code = String(error?.code || "");
  const messages = {
    "auth/invalid-credential": "The email address or password is incorrect.",
    "auth/email-already-in-use": "An account already exists for this email address.",
    "auth/weak-password": "Choose a stronger password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "permission-denied": "You do not have permission to perform that action.",
    "firestore/permission-denied": "You do not have permission to perform that action."
  };
  return messages[code] || error?.message || "Something went wrong.";
}
