import { firebaseConfig, functionsRegion, firebaseSdkVersion } from "./firebase-config.js";

const sdk = `https://www.gstatic.com/firebasejs/${firebaseSdkVersion}`;
const [{ initializeApp }, authSdk, firestoreSdk, functionsSdk] = await Promise.all([
  import(`${sdk}/firebase-app.js`),
  import(`${sdk}/firebase-auth.js`),
  import(`${sdk}/firebase-firestore.js`),
  import(`${sdk}/firebase-functions.js`)
]);

const configured = !firebaseConfig.apiKey.startsWith("REPLACE_");
const state = { user:null, pages:[], progress:new Map(), filter:"all", query:"", updateAvailable:false, isAdmin:false };
const $ = (id) => document.getElementById(id);

let auth, db, functions;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = authSdk.getAuth(app);
  db = firestoreSdk.getFirestore(app);
  functions = functionsSdk.getFunctions(app, functionsRegion);
  authSdk.onAuthStateChanged(auth, handleAuthState);
} else {
  showBanner("Firebase configuration needs the real Web API key from Firebase Console before sign-in can work.", true);
  $("authButton").disabled = true;
}

$("settingsButton").addEventListener("click", () => $("settingsDialog").showModal());
$("authButton").addEventListener("click", signIn);
$("signOutButton").addEventListener("click", () => auth && authSdk.signOut(auth));
$("checkUpdatesButton").addEventListener("click", checkUpdates);
$("updateDocsButton").addEventListener("click", updateDocumentation);
$("searchInput").addEventListener("input", (e) => { state.query=e.target.value.toLowerCase().trim(); render(); });
$("wpmInput").addEventListener("change", savePreferences);
document.querySelectorAll(".filter-button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".filter-button").forEach(x=>x.classList.remove("active")); b.classList.add("active"); state.filter=b.dataset.filter; render();
}));

async function signIn(){
  if(!auth) return;
  try { await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider()); }
  catch(error){ if(error.code === "auth/popup-blocked" || error.code === "auth/cancelled-popup-request") await authSdk.signInWithRedirect(auth,new authSdk.GoogleAuthProvider()); else showBanner(error.message,true); }
}

async function handleAuthState(user){
  state.user=user; state.progress.clear(); state.pages=[]; state.isAdmin=false;
  $("authButton").classList.toggle("hidden",!!user); $("userChip").classList.toggle("hidden",!user); $("signOutButton").classList.toggle("hidden",!user);
  if(!user){ $("userChip").textContent=""; $("accountDescription").textContent="Not signed in."; render(); return; }
  $("userChip").textContent=user.displayName || user.email; $("accountDescription").textContent=user.email || "Google account";
  const token=await user.getIdTokenResult(true); state.isAdmin=token.claims.admin===true; $("updateDocsButton").classList.toggle("hidden",!state.isAdmin);
  await Promise.all([loadCatalog(),loadProgress(),loadPreferences()]); render();
  window.setTimeout(checkUpdates, 50);
}

async function loadCatalog(){
  const snap=await firestoreSdk.getDocs(firestoreSdk.collection(db,"documentation","pages","items"));
  state.pages=snap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!p.deprecated).sort((a,b)=>(a.order??99999)-(b.order??99999));
}
async function loadProgress(){
  const snap=await firestoreSdk.getDocs(firestoreSdk.collection(db,"users",state.user.uid,"progress")); snap.forEach(d=>state.progress.set(d.id,d.data()));
}
async function loadPreferences(){
  const ref=firestoreSdk.doc(db,"users",state.user.uid,"settings","preferences"); const snap=await firestoreSdk.getDoc(ref); if(snap.exists()&&snap.data().readingWpm) $("wpmInput").value=snap.data().readingWpm;
}
async function savePreferences(){
  if(!state.user) return; const readingWpm=Math.max(100,Math.min(500,Number($("wpmInput").value)||200));
  await firestoreSdk.setDoc(firestoreSdk.doc(db,"users",state.user.uid,"settings","preferences"),{readingWpm,updatedAt:firestoreSdk.serverTimestamp()},{merge:true}); render();
}
async function setCompleted(pageId,completed){
  if(!state.user) return showBanner("Sign in to save progress across devices.");
  const ref=firestoreSdk.doc(db,"users",state.user.uid,"progress",pageId);
  const value={pageId,completed,completedAt:completed?firestoreSdk.serverTimestamp():null,updatedAt:firestoreSdk.serverTimestamp()};
  await firestoreSdk.setDoc(ref,value,{merge:true}); state.progress.set(pageId,{...(state.progress.get(pageId)||{}),...value}); render();
}

async function checkUpdates(){
  if(!state.user||!functions) return;
  const button=$("checkUpdatesButton"); button.disabled=true; $("updateStatus").textContent="Checking JetBrains documentation…";
  try{ const result=await functionsSdk.httpsCallable(functions,"checkDocumentationUpdate")(); state.updateAvailable=!!result.data.updateAvailable;
    $("updateStatus").textContent=state.updateAvailable?"A newer Kotlin documentation revision is available.":"Documentation catalog is up to date.";
    if(state.updateAvailable) showBanner("Kotlin documentation has changed. Open Settings to review and update the catalog.");
  }catch(e){ $("updateStatus").textContent=`Update check unavailable: ${e.message}`; }
  finally{button.disabled=false;}
}
async function updateDocumentation(){
  if(!state.user||!state.isAdmin) return; const b=$("updateDocsButton"); b.disabled=true; $("updateStatus").textContent="Updating documentation catalog…";
  try{const result=await functionsSdk.httpsCallable(functions,"updateDocumentation")(); const x=result.data; $("updateStatus").textContent=`Updated: ${x.added} added, ${x.changed} changed, ${x.removed} removed, ${x.total} total.`; state.updateAvailable=false; await loadCatalog(); render();}
  catch(e){$("updateStatus").textContent=`Update failed: ${e.message}`;} finally{b.disabled=false;}
}

function isReview(page){return page.learningMode==="review" || /Kotlin tour/.test(page.hierarchy||"") && /Intermediate/.test(page.hierarchy||"");}
function isDone(page){return state.progress.get(page.id)?.completed===true || page.initiallyCompleted===true;}
function filteredPages(){return state.pages.filter(p=>{const done=isDone(p),review=isReview(p); if(state.filter==="done"&&!done)return false;if(state.filter==="todo"&&(done||review))return false;if(state.filter==="review"&&!review)return false; const hay=`${p.title||""} ${p.hierarchy||""}`.toLowerCase();return !state.query||hay.includes(state.query);});}
function render(){
  const total=state.pages.length,done=state.pages.filter(isDone).length,pct=total?Math.round(done/total*100):0,remaining=state.pages.filter(p=>!isDone(p)).reduce((n,p)=>n+(p.estimatedStudyMinutes||0),0);
  $("progressRing").style.setProperty("--progress",pct); $("progressPercent").textContent=`${pct}%`; $("pagesMetric").textContent=total?`${done} / ${total}`:"—"; $("timeMetric").textContent=total?formatMinutes(remaining):"—"; $("catalogMetric").textContent=total?total:"—"; $("catalogMetricSub").textContent=total?"documentation pages":"not loaded";
  $("progressHeadline").textContent=state.user?(total?`${total-done} pages left in your roadmap`:"Catalog ready for its first sync"):"Sign in to sync your progress";
  $("progressSubline").textContent=state.user?"Completion is stored privately under your Google account.":"Your progress follows your Google account across devices.";
  $("emptyState").classList.toggle("hidden",total>0); $("curriculum").classList.toggle("hidden",total===0); if(!total)return;
  const groups=new Map(); filteredPages().forEach(p=>{const category=p.category||String(p.hierarchy||"Other").split(" → ")[0];if(!groups.has(category))groups.set(category,[]);groups.get(category).push(p)});
  $("curriculum").innerHTML=[...groups].map(([category,pages])=>`<article class="category glass"><div class="category-header"><span class="category-title">${esc(category)}</span><span class="category-meta">${pages.filter(isDone).length}/${pages.length} complete</span></div><div class="lesson-list">${pages.map(lessonHtml).join("")}</div></article>`).join("") || `<div class="empty-state glass"><h2>No matching pages</h2><p>Try another search or filter.</p></div>`;
  $("curriculum").querySelectorAll(".lesson-check").forEach(c=>c.addEventListener("change",()=>setCompleted(c.dataset.id,c.checked)));
}
function lessonHtml(p){const review=isReview(p),done=isDone(p),reading=p.estimatedReadingMinutes||Math.max(1,Math.ceil((p.wordCount||0)/(Number($("wpmInput").value)||200)));return `<div class="lesson"><input class="lesson-check" data-id="${esc(p.id)}" type="checkbox" ${done?"checked":""} aria-label="Mark ${esc(p.title)} complete"><div><div class="lesson-title"><a href="${esc(p.URL||p.url||"#")}" target="_blank" rel="noopener">${esc(p.title||"Untitled")}</a>${review?'<span class="review-badge">REVIEW</span>':''}</div><div class="lesson-path">${esc(p.hierarchy||"")}</div></div><div class="lesson-stats">${Number(p.wordCount||0).toLocaleString()} words · ${reading}m read · ${p.estimatedStudyMinutes||"—"}m study</div></div>`}
function formatMinutes(m){if(m<60)return `${Math.round(m)}m`;const h=Math.floor(m/60),min=Math.round(m%60);return min?`${h}h ${min}m`:`${h}h`}
function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function showBanner(message,error=false){const el=$("statusBanner");el.textContent=message;el.classList.remove("hidden");el.classList.toggle("error",error)}
render();
