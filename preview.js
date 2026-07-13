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

const FIELD_KEYS = ["academic", "involvement", "highImpact", "career", "summerPlan", "careerExperience", "academicProgress", "serviceTravel", "destination", "preparation"];
const root = document.getElementById("preview-app");
const toastRegion = document.getElementById("toast-region");
let role = localStorage.getItem("aimPreviewRoleV3") || "student";
let plan = JSON.parse(localStorage.getItem("aimPreviewPlanV3") || "null") || samplePlan();
let comments = JSON.parse(localStorage.getItem("aimPreviewCommentsV3") || "[]");
let documents = JSON.parse(localStorage.getItem("aimPreviewDocumentsV3") || "null") || [{ id: "resume", title: "Current Résumé", category: "Resume", url: "https://example.com/resume", createdAt: new Date().toISOString() }];
let removalRequested = localStorage.getItem("aimPreviewRemovalRequestedV3") === "true";
let autosaveTimer = null;
let notificationsMuted = localStorage.getItem("aimPreviewMutedV3") === "true";

const students = [
  { id: "s1", name: "Priyojit Test Student", email: "palitpriyojit@gmail.com" },
  { id: "s2", name: "Alex Badger", email: "alex@email.shc.edu" },
  { id: "s3", name: "Jordan Hill", email: "jordan@email.shc.edu" }
];
const faculty = [
  { id: "f1", name: "Dr. Faculty Advisor", email: "advisor@shc.edu" },
  { id: "f2", name: "Dr. Morgan", email: "morgan@shc.edu" },
  { id: "f3", name: "Dr. Rivera", email: "rivera@shc.edu" }
];

renderShell();

function renderShell() {
  const profile = role === "student" ? { name: students[0].name, email: students[0].email } : role === "faculty" ? { name: faculty[0].name, email: faculty[0].email } : { name: "AIM Administrator", email: "admin@shc.edu" };
  const nav = role === "student"
    ? [["map", "🗺", "My AIM Map"], ["documents", "🔗", "Document Links"], ["people", "👥", "My Advisors"], ["notices", "🔔", "Notifications"], ["profile", "⚙", "My Profile"]]
    : role === "faculty"
      ? [["people", "👥", "My Advisees"], ["notices", "🔔", "Notifications"], ["profile", "⚙", "My Profile"]]
      : [["admin", "▦", "Admin Dashboard"], ["plans", "🗺", "All Student Plans"], ["users", "👤", "Manage Users"], ["people", "⇄", "Relationships"], ["notices", "🔔", "Notifications"], ["profile", "⚙", "My Profile"]];

  root.innerHTML = `<div class="app-shell"><aside class="sidebar" id="sidebar"><div class="sidebar-logo"><strong>AIM</strong><span>Academic &amp;<br>Involvement Map</span></div><nav class="nav-list">${nav.map(([view, icon, label]) => `<button class="nav-button" data-view="${view}"><span>${icon}</span><span>${label}</span></button>`).join("")}</nav><div class="sidebar-footer"><div class="user-mini"><strong>${profile.name}</strong><span>${profile.email}</span><span>${capitalize(role)}</span></div></div></aside><div class="app-main"><header class="topbar"><div class="button-row"><button class="btn btn-secondary btn-small mobile-menu" id="menu">☰</button><h1>AIM</h1></div><div class="topbar-actions"><label class="subtle" for="role-switch">View as</label><select id="role-switch"><option value="student" ${role === "student" ? "selected" : ""}>Student</option><option value="faculty" ${role === "faculty" ? "selected" : ""}>Faculty</option><option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option></select><a class="btn btn-secondary btn-small" href="./index.html">Sign in</a></div></header><main id="preview-main" class="content"></main></div></div>`;

  document.getElementById("role-switch").addEventListener("change", (event) => { role = event.target.value; localStorage.setItem("aimPreviewRoleV3", role); renderShell(); });
  document.getElementById("menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => renderView(button.dataset.view)));
  renderView(nav[0][0]);
}

function renderView(view) {
  clearTimeout(autosaveTimer);
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "map") renderMap(true);
  else if (view === "documents") renderDocuments(true, "map");
  else if (view === "people") role === "student" ? renderAdvisors() : role === "faculty" ? renderAdvisees() : renderRelationships();
  else if (view === "notices") renderNotifications();
  else if (view === "profile") renderProfile();
  else if (view === "admin") renderAdmin();
  else if (view === "plans") renderAllPlans();
  else if (view === "users") renderUsers();
}

function renderMap(editable, includeBack = false) {
  const main = document.getElementById("preview-main");
  main.innerHTML = `<div class="page-head"><div><h2>${editable ? "Your four-year AIM journey" : "Priyojit Test Student's AIM journey"}</h2><p>Open one stage at a time so the path remains compact.</p></div><div class="button-row"><button class="btn btn-secondary" id="preview-print">Print / Save as PDF</button>${includeBack ? '<button class="btn btn-secondary" id="preview-back">← Back</button>' : ""}</div></div>${guideHtml()}<section class="panel plan-documents-summary"><div class="panel-head"><div><h3>Portfolio &amp; document links</h3><p class="subtle">Add a shareable link to your résumé and other planning documents.</p></div><button class="btn btn-secondary btn-small" id="preview-open-documents">${editable ? "Manage links" : "View links"}</button></div>${compactDocuments()}</section><div id="preview-map-form"><div class="map-toolbar"><span class="map-status" id="preview-status">All changes saved</span>${editable ? '<button class="btn btn-primary" id="preview-map-save">Save now</button>' : ""}</div>${timeline(editable)}</div>`;
  document.getElementById("preview-print").addEventListener("click", () => window.print());
  document.getElementById("preview-back")?.addEventListener("click", () => role === "admin" ? renderAllPlans() : renderAdvisees());
  document.getElementById("preview-open-documents").addEventListener("click", () => renderDocuments(editable, includeBack ? (role === "admin" ? "plans" : "advisees") : "map"));
  document.getElementById("preview-map-save")?.addEventListener("click", savePreviewPlan);
  document.querySelectorAll(".stage-fields textarea").forEach((input) => input.addEventListener("input", () => {
    localDraft();
    document.getElementById("preview-status").textContent = "Saving…";
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { savePreviewPlan(); document.getElementById("preview-status").textContent = "Saved automatically just now"; }, 1800);
    const details = input.closest("details");
    const filled = Array.from(details.querySelectorAll("textarea")).filter((item) => item.value.trim()).length;
    details.querySelector("[data-stage-progress]").textContent = filled ? `${filled}/${details.querySelectorAll("textarea").length} started` : "Not started";
  }));
  document.querySelectorAll("details[data-stage]").forEach((details) => details.addEventListener("toggle", () => { if (!details.open && editable) savePreviewPlan(); }));
  document.querySelectorAll(".comment-form").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = form.querySelector("textarea").value.trim();
    if (!text) return;
    comments.push({ sectionKey: form.dataset.section, authorName: role === "admin" ? "AIM Administrator" : faculty[0].name, text, createdAt: new Date().toISOString() });
    localStorage.setItem("aimPreviewCommentsV3", JSON.stringify(comments));
    renderMap(false, true); toast("Comment added.");
  }));
}

function timeline(editable) {
  return `<div class="compact-timeline">${STAGES.map((stage, index) => {
    const value = normalizeStage(stage, plan[stage.key] || {});
    const defs = fieldsForStage(stage);
    const filled = defs.filter(([key]) => value[key]?.trim()).length;
    const stageComments = comments.filter((comment) => comment.sectionKey === stage.key);
    return `<section class="compact-stage" style="--stage-color:${stage.color}"><div class="compact-stage-marker"><span>${index + 1}</span></div><details class="stage-card stage-accordion" data-stage="${stage.key}" ${index === 0 ? "open" : ""}><summary><span class="stage-summary-title">${stage.title}</span><span class="stage-progress" data-stage-progress>${filled ? `${filled}/${defs.length} started` : "Not started"}</span><span class="stage-chevron">⌄</span></summary><div class="stage-body">${editable ? `<div class="stage-fields">${defs.map(([key, label, placeholder]) => field(stage.key, key, label, value[key], placeholder)).join("")}</div>` : defs.map(([key, label]) => read(label, value[key])).join("")}${stageComments.length || role === "faculty" || role === "admin" ? `<div class="comment-block"><strong>Advisor comments</strong>${stageComments.length ? stageComments.map((comment) => `<div class="comment"><div class="comment-head"><strong>${comment.authorName}</strong><span>${new Date(comment.createdAt).toLocaleString()}</span></div><p>${escapeHtml(comment.text)}</p></div>`).join("") : '<p class="subtle">No comments yet.</p>'}${role === "faculty" || role === "admin" ? `<form class="comment-form" data-section="${stage.key}"><div class="field"><textarea placeholder="Add guidance for this section…"></textarea></div><button class="btn btn-soft btn-small">Add comment</button></form>` : ""}</div>` : ""}</div></details></section>`;
  }).join("")}</div>`;
}

function localDraft() {
  const current = collectPlan();
  localStorage.setItem("aimPreviewDraftV3", JSON.stringify({ stages: current, savedAt: Date.now() }));
}
function savePreviewPlan() {
  if (!document.querySelector(".stage-fields")) return;
  plan = collectPlan();
  localStorage.setItem("aimPreviewPlanV3", JSON.stringify(plan));
  localStorage.removeItem("aimPreviewDraftV3");
  const status = document.getElementById("preview-status");
  if (status) status.textContent = "Saved just now";
  toast("Preview plan saved.");
}
function collectPlan() {
  const result = {};
  STAGES.forEach((stage) => {
    const value = normalizeStage(stage, plan[stage.key] || {});
    FIELD_KEYS.forEach((key) => { const input = document.querySelector(`[name="${stage.key}-${key}"]`); if (input) value[key] = input.value.trim(); });
    result[stage.key] = value;
  });
  return result;
}

function renderDocuments(canManage, back) {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>Portfolio &amp; document links</h2><p>A current résumé is the recommended first item.</p></div><button class="btn btn-secondary" id="preview-docs-back">← Back</button></div>${canManage ? `<section class="panel"><h3>Add a document link</h3><form id="preview-document-form" class="grid grid-3"><div class="field"><label>Title</label><input id="preview-doc-title" value="Current Résumé" required></div><div class="field"><label>Category</label><select id="preview-doc-category"><option>Resume</option><option>Cover Letter</option><option>Degree Plan / Program Checklist</option><option>Internship / Research / Study Abroad</option><option>Certificate / Award</option><option>Other</option></select></div><div class="field"><label>Shareable URL</label><input id="preview-doc-url" type="url" value="https://example.com/resume" required></div><div class="field" style="align-self:end"><button class="btn btn-primary">Add link</button></div></form></section>` : ""}<section class="panel" style="margin-top:1rem"><h3>Saved links</h3><div class="document-list">${documents.map((item) => `<article class="document-card"><div class="document-icon">${item.category === "Resume" ? "R" : "↗"}</div><div class="document-info"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category)} · External link</span></div><div class="button-row"><a class="btn btn-secondary btn-small" href="${item.url}" target="_blank">Open</a>${canManage ? `<button class="btn btn-danger btn-small" data-preview-delete-doc="${item.id}">Delete</button>` : ""}</div></article>`).join("")}</div></section>`;
  document.getElementById("preview-docs-back").addEventListener("click", () => back === "plans" ? renderAllPlans() : back === "advisees" ? renderAdvisees() : renderMap(true));
  document.getElementById("preview-document-form")?.addEventListener("submit", (event) => { event.preventDefault(); documents.push({ id: crypto.randomUUID(), title: document.getElementById("preview-doc-title").value, category: document.getElementById("preview-doc-category").value, url: document.getElementById("preview-doc-url").value, createdAt: new Date().toISOString() }); saveDocuments(); renderDocuments(canManage, back); toast("Document link added."); });
  document.querySelectorAll("[data-preview-delete-doc]").forEach((button) => button.addEventListener("click", () => { documents = documents.filter((item) => item.id !== button.dataset.previewDeleteDoc); saveDocuments(); renderDocuments(canManage, back); }));
}

function renderAdvisors() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>My advisors</h2><p>Students can add advisors but must request administrator approval to remove one.</p></div></div><div class="grid grid-2"><section class="panel"><h3>Current advisors</h3><article class="person-card"><div class="person-info"><strong>${faculty[0].name}</strong><span>${faculty[0].email}</span></div>${removalRequested ? '<span class="pill pill-pending">Removal awaiting approval</span>' : '<button class="btn btn-danger btn-small" id="preview-request-removal">Request removal</button>'}</article></section><section class="panel"><h3>Add advisor</h3><div class="field"><label>Search or enter faculty email</label><input list="preview-faculty-list" placeholder="Start typing a name or email"><datalist id="preview-faculty-list">${faculty.map((item) => `<option value="${item.email}">${item.name}</option>`).join("")}</datalist></div><button class="btn btn-primary" id="preview-add-advisor">Add advisor</button></section></div>`;
  document.getElementById("preview-request-removal")?.addEventListener("click", () => { removalRequested = true; localStorage.setItem("aimPreviewRemovalRequestedV3", "true"); renderAdvisors(); toast("Removal request submitted."); });
  document.getElementById("preview-add-advisor").addEventListener("click", () => toast("Advisor connection saved. Unregistered emails become pending connections."));
}

function renderAdvisees() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>My advisees</h2><p>One faculty member can advise many students.</p></div></div><div class="grid grid-2"><section class="panel"><h3>Current advisees</h3>${students.map((item) => `<article class="person-card"><div class="person-info"><strong>${item.name}</strong><span>${item.email}</span></div><button class="btn btn-primary btn-small" data-preview-student="${item.id}">View map</button></article>`).join("")}</section><section class="panel"><h3>Add advisee</h3><div class="field"><label>Search or enter student email</label><input list="preview-student-list"><datalist id="preview-student-list">${students.map((item) => `<option value="${item.email}">${item.name}</option>`).join("")}</datalist></div><button class="btn btn-primary" id="preview-add-advisee">Add advisee</button></section></div>`;
  document.querySelectorAll("[data-preview-student]").forEach((button) => button.addEventListener("click", () => renderMap(false, true)));
  document.getElementById("preview-add-advisee").addEventListener("click", () => toast("Advisee connection saved."));
}

function renderAdmin() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>Administrator dashboard</h2><p>Review accounts, advising relationships, and recent AIM activity.</p></div></div><div class="grid grid-3"><div class="metric"><div class="value">18</div><div class="label">Approved students</div></div><div class="metric"><div class="value">6</div><div class="label">Approved faculty</div></div><div class="metric"><div class="value">3</div><div class="label">Administrators</div></div><div class="metric"><div class="value">27</div><div class="label">Active relationships</div></div><div class="metric"><div class="value">${removalRequested ? 1 : 0}</div><div class="label">Removal requests</div></div><div class="metric"><div class="value">4</div><div class="label">Pending accounts</div></div></div><section class="panel daily-summary" style="margin-top:1rem"><div class="panel-head"><div><h3>Today's AIM summary</h3><p class="subtle">Activity recorded today.</p></div><span>${new Date().toLocaleDateString()}</span></div><div class="summary-grid">${[[7,"Plan saves"],[3,"Comments"],[2,"Relationship changes"],[1,"Document-link change"],[2,"User/admin changes"],[15,"Total actions"]].map(([v,l]) => `<div class="metric"><div class="value">${v}</div><div class="label">${l}</div></div>`).join("")}</div></section><div class="grid grid-2" style="margin-top:1rem"><section class="panel"><h3>Application settings</h3><div class="form-stack"><div class="field"><label>Registration mode</label><select><option>Allow any verified email; administrator approval required</option><option>College and administrator-approved email addresses only</option></select></div><div class="field"><label>Autosave delay</label><select><option>15 seconds</option><option selected>25 seconds</option><option>30 seconds</option></select></div><button class="btn btn-primary" id="preview-save-settings">Save settings</button></div></section><section class="panel"><h3>Pending actions</h3><ul class="plain-list"><li><strong>1</strong> advisor-removal request</li><li><strong>2</strong> accounts awaiting approval</li><li><strong>1</strong> advising relationship awaiting registration</li></ul></section></div>`;
  document.getElementById("preview-save-settings").addEventListener("click", () => toast("Settings saved."));
}

function renderAllPlans() {
  const progress = completion();
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>All student plans</h2><p>Administrators can search and open every student's plan.</p></div></div><section class="panel" style="margin-bottom:1rem"><div class="field"><label>Find a student</label><input id="preview-plan-search" type="search" placeholder="Search by name or email"></div></section><div id="preview-plan-results" class="table-wrap">${planTable(students, progress)}</div>`;
  document.getElementById("preview-plan-search").addEventListener("input", (event) => { const q = event.target.value.toLowerCase(); document.getElementById("preview-plan-results").innerHTML = planTable(students.filter((s) => `${s.name} ${s.email}`.toLowerCase().includes(q)), progress); bindPlanButtons(); }); bindPlanButtons();
}
function planTable(list, progress) { return `<table><thead><tr><th>Student</th><th>Plan progress</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>${list.map((student) => `<tr><td><strong>${student.name}</strong><br><span class="subtle">${student.email}</span></td><td><div class="progress-line"><span style="width:${progress.percent}%"></span></div><small>${progress.completed} of ${progress.total} areas started</small></td><td>Just now</td><td><div class="table-actions"><button class="btn btn-primary btn-small" data-preview-plan>View/edit plan</button><button class="btn btn-secondary btn-small" data-preview-docs>Document links</button></div></td></tr>`).join("")}</tbody></table>`; }
function bindPlanButtons() { document.querySelectorAll("[data-preview-plan]").forEach((b) => b.addEventListener("click", () => renderMap(true, true))); document.querySelectorAll("[data-preview-docs]").forEach((b) => b.addEventListener("click", () => renderDocuments(true, "plans"))); }

function renderUsers() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>Manage users</h2><p>Add an email as Student, Faculty, or Administrator before registration.</p></div></div><section class="panel" style="margin-bottom:1rem"><h3>Add or approve an email</h3><div class="grid grid-3"><div class="field"><label>Email</label><input value="newadmin@gmail.com"></div><div class="field"><label>Role</label><select><option>Student</option><option>Faculty</option><option selected>Administrator</option></select></div><div class="field" style="align-self:end"><button class="btn btn-primary" id="preview-preapprove">Add / approve email</button></div></div><p class="subtle">The account will be ready when this person registers with the same email address.</p></section><section class="panel" style="margin-bottom:1rem"><div class="field"><label>Search users</label><input id="preview-user-search" type="search" placeholder="Name or email"></div></section><div id="preview-users-results" class="table-wrap">${userTable()}</div>`;
  document.getElementById("preview-preapprove").addEventListener("click", () => toast("Email approved as administrator."));
  document.getElementById("preview-user-search").addEventListener("input", () => toast("User list filtered."));
}
function userTable() { return `<table><thead><tr><th>User</th><th>Role</th><th>Approved</th><th>Status</th><th>Action</th></tr></thead><tbody><tr><td><strong>${students[0].name}</strong><br><span class="subtle">${students[0].email}</span></td><td><select><option selected>Student</option><option>Faculty</option><option>Admin</option></select></td><td><input type="checkbox" checked></td><td><select><option>Active</option><option>Disabled</option></select></td><td><button class="btn btn-primary btn-small">Save</button></td></tr><tr><td><strong>External Tester</strong><br><span class="subtle">tester@gmail.com</span></td><td><select><option>Pending</option><option>Student</option><option>Faculty</option><option selected>Admin</option></select></td><td><input type="checkbox" checked></td><td><select><option>Active</option><option>Disabled</option></select></td><td><button class="btn btn-primary btn-small">Save</button></td></tr></tbody></table>`; }

function renderRelationships() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>Advisor relationships</h2><p>Search registered users or enter an email that has not registered yet.</p></div><span class="pill ${removalRequested ? "pill-pending" : "pill-active"}">${removalRequested ? 1 : 0} pending</span></div><section class="panel" style="margin-bottom:1rem"><h3>Add student ↔ advisor</h3><div class="grid grid-3"><div class="field"><label>Search or enter student email</label><input list="admin-preview-students" value="${students[0].email}"><datalist id="admin-preview-students">${students.map((i) => `<option value="${i.email}">${i.name}</option>`).join("")}</datalist></div><div class="field"><label>Search or enter advisor email</label><input list="admin-preview-faculty" value="${faculty[0].email}"><datalist id="admin-preview-faculty">${faculty.map((i) => `<option value="${i.email}">${i.name}</option>`).join("")}</datalist></div><div class="field" style="align-self:end"><button class="btn btn-primary" id="preview-create-relationship">Create relationship</button></div></div><p class="subtle">If an email is not registered, the relationship will activate after registration.</p></section><div class="table-wrap"><table><thead><tr><th>Student</th><th>Faculty</th><th>Status</th><th>Removal request</th><th>Actions</th></tr></thead><tbody><tr><td>${students[0].email}</td><td>${faculty[0].email}</td><td><span class="pill pill-active">Active</span></td><td>${removalRequested ? '<strong>Pending</strong><br><span class="subtle">Advisor assignment changed</span>' : '<span class="subtle">None</span>'}</td><td>${removalRequested ? '<div class="button-row"><button class="btn btn-danger btn-small" id="preview-approve-removal">Approve removal</button><button class="btn btn-secondary btn-small" id="preview-reject-removal">Keep advisor</button></div>' : '<button class="btn btn-secondary btn-small">Admin remove</button>'}</td></tr></tbody></table></div>`;
  document.getElementById("preview-create-relationship").addEventListener("click", () => toast("Advising relationship saved."));
  document.getElementById("preview-approve-removal")?.addEventListener("click", () => { removalRequested = false; localStorage.setItem("aimPreviewRemovalRequestedV3", "false"); renderRelationships(); toast("Advisor removal approved."); });
  document.getElementById("preview-reject-removal")?.addEventListener("click", () => { removalRequested = false; localStorage.setItem("aimPreviewRemovalRequestedV3", "false"); renderRelationships(); toast("Advisor relationship kept."); });
}

function renderNotifications() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>Notifications</h2><p>${notificationsMuted ? "Activity notifications are currently muted." : "Grouped plan updates and other activity appear here."}</p></div></div>${notificationsMuted ? '<div class="empty-state"><strong>Notifications muted</strong><span>Turn them back on in My Profile.</span></div>' : '<div class="notification-list"><article class="notification unread"><div><h3>Student AIM plan updated</h3><p>Priyojit Test Student updated Freshman Year and Sophomore Year. <strong>(3 grouped updates)</strong></p><time>Just now</time></div><button class="btn btn-secondary btn-small">Open</button></article><article class="notification"><div><h3>Advisor relationship changed</h3><p>A new advisor was connected.</p><time>Today</time></div><button class="btn btn-secondary btn-small">Open</button></article></div>'}`;
}

function renderProfile() {
  document.getElementById("preview-main").innerHTML = `<div class="page-head"><div><h2>My profile</h2><p>Every user can turn AIM activity notifications on or off.</p></div></div><div class="grid grid-2"><section class="panel"><h3>Account</h3><div class="form-stack"><div class="field"><label>Display name</label><input value="Preview User"></div><div class="field"><label>Role</label><input value="${capitalize(role)}" disabled></div><button class="btn btn-primary">Save profile</button></div></section><section class="panel"><h3>Notification preferences</h3><form id="preview-prefs" class="preference-list"><label class="preference-item"><input id="preview-mute" type="checkbox" ${notificationsMuted ? "checked" : ""}><span>Mute all AIM notifications</span></label><hr>${["Plan updates","Advisor and admin comments","Advisor relationship changes","Document-link changes","Administrative actions"].map((label) => `<label class="preference-item"><input type="checkbox" checked><span>${label}</span></label>`).join("")}<button class="btn btn-primary">Save notification settings</button></form></section></div>`;
  document.getElementById("preview-prefs").addEventListener("submit", (event) => { event.preventDefault(); notificationsMuted = document.getElementById("preview-mute").checked; localStorage.setItem("aimPreviewMutedV3", String(notificationsMuted)); toast("Notification preferences saved."); });
}

function guideHtml() { return `<details class="aim-guide panel"><summary>Planning guide and examples</summary><div class="guide-grid"><div><h3>High-impact experiences</h3><p>Study abroad, internship, service immersion, or undergraduate research.</p></div><div><h3>Campus involvement</h3><p>Try a club, set a leadership goal, or prepare for a campus role.</p></div><div><h3>Academic goals</h3><p>GPA, mentoring, tutoring, class participation, Dean's List, and capstone.</p></div><div><h3>Summer planning</h3><p>Employment, internships, volunteering, summer school, travel, or professional development.</p></div></div></details>`; }
function compactDocuments() { return documents.length ? `<div class="document-compact-list">${documents.slice(0,4).map((item) => `<a href="${item.url}" target="_blank"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category)}</span></a>`).join("")}</div>` : '<p class="subtle">No document links yet.</p>'; }
function fieldsForStage(stage) { if (stage.type === "summer") return [["summerPlan","Main summer plan","What do you plan to do this summer?"],["careerExperience","Career-related experience","Employment, internship, job shadowing, volunteering…"],["academicProgress","Academic progress","Summer school, degree progress, skill-building…"],["serviceTravel","Service, travel & reflection","Service, community work, or travel…"]]; if (stage.type === "graduation") return [["destination","Primary destination","Job, graduate school, service program…"],["preparation","Preparation and next actions","Applications, references, interviews, portfolio…"]]; return [["academic","Academic goals","GPA, courses, tutoring, mentoring, research, capstone…"],["involvement","Campus involvement & leadership","Clubs, leadership, service…"],["highImpact","High-impact experience","Study abroad, internship, service immersion, research…"],["career","Career preparation","Résumé, networking, portfolio, Career Services…"]]; }
function normalizeStage(stage, value = {}) { const result = Object.fromEntries(FIELD_KEYS.map((key) => [key, String(value[key] || "")])); if (stage.type === "summer") { result.summerPlan ||= value.career || ""; result.careerExperience ||= value.career || ""; result.academicProgress ||= value.academic || ""; result.serviceTravel ||= value.involvement || ""; } if (stage.type === "graduation") { result.destination ||= value.career || ""; result.preparation ||= [value.academic, value.involvement].filter(Boolean).join("\n"); } return result; }
function field(stage, key, label, value = "", placeholder = "") { return `<div class="field"><label>${label}</label><textarea name="${stage}-${key}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || "")}</textarea></div>`; }
function read(title, value) { return `<div class="stage-read-section"><h4>${title}</h4><p class="${value ? "" : "blank"}">${value ? escapeHtml(value) : "Nothing added yet."}</p></div>`; }
function completion() { let completed = 0, total = 0; STAGES.forEach((stage) => fieldsForStage(stage).forEach(([key]) => { total += 1; if (normalizeStage(stage, plan[stage.key] || {})[key].trim()) completed += 1; })); return { completed, total, percent: Math.round((completed / total) * 100) }; }
function saveDocuments() { localStorage.setItem("aimPreviewDocumentsV3", JSON.stringify(documents)); }
function capitalize(value) { return value[0].toUpperCase() + value.slice(1); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function toast(message) { const item = document.createElement("div"); item.className = "toast success"; item.textContent = message; toastRegion.appendChild(item); setTimeout(() => item.remove(), 3000); }
function samplePlan() { return { freshman: { academic: "Explore majors and complete first-year core courses.", involvement: "Attend the involvement fair and join one organization.", highImpact: "Learn about study abroad, research, service immersion, and internship options.", career: "Create a résumé and meet Career Development." }, summer1: { summerPlan: "Work part-time and complete one online core course.", careerExperience: "Job shadow a professional in my field.", academicProgress: "Complete one online core course.", serviceTravel: "Volunteer locally twice each month." }, sophomore: { academic: "Declare my major and identify a faculty mentor.", involvement: "Take an active role in a student organization.", highImpact: "Apply for undergraduate research or study abroad.", career: "Build a first portfolio project." }, summer2: { summerPlan: "Obtain a career-related internship.", careerExperience: "Complete an internship or job-shadowing experience.", academicProgress: "Review degree progress with my advisor.", serviceTravel: "Participate in a community service project." } }; }
