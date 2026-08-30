import { firebaseConfig, firebaseSdkVersion } from "./firebase-config.js";
import { LESSON_STATUS, isLessonStatus, lessonStatus, matchesStatusFilter } from "./status.mjs";

const sdk = `https://www.gstatic.com/firebasejs/${firebaseSdkVersion}`;
const [{ initializeApp }, authSdk, firestoreSdk] = await Promise.all([
  import(`${sdk}/firebase-app.js`),
  import(`${sdk}/firebase-auth.js`),
  import(`${sdk}/firebase-firestore.js`)
]);

const SOURCE = {
  repo: "JetBrains/kotlin-web-site",
  branch: "master",
  treePath: "docs/kr.tree",
  rawBase: "https://raw.githubusercontent.com/JetBrains/kotlin-web-site/master/"
};

const configured = !firebaseConfig.apiKey.startsWith("REPLACE_");
const state = { user:null, pages:[], progress:new Map(), filter:"all", query:"", updateAvailable:false, isAdmin:false, readingWpm:200 };
const $ = (id) => document.getElementById(id);

let auth, db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = authSdk.getAuth(app);
  db = firestoreSdk.getFirestore(app);
  authSdk.onAuthStateChanged(auth, handleAuthState);
} else {
  showBanner("Firebase configuration is incomplete.", true);
  $("authButton").disabled = true;
}

$("settingsButton").addEventListener("click", () => $("settingsDialog").showModal());
$("settingsDialog").addEventListener("close", applyReadingSpeed);
$("authButton").addEventListener("click", signIn);
$("signOutButton").addEventListener("click", () => auth && authSdk.signOut(auth));
$("checkUpdatesButton").addEventListener("click", checkUpdates);
$("updateDocsButton").addEventListener("click", updateDocumentation);
$("statusBannerClose").addEventListener("click", hideBanner);
$("searchInput").addEventListener("input", (e) => { state.query=e.target.value.toLowerCase().trim(); render(); });
document.querySelectorAll(".filter-button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".filter-button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); state.filter=b.dataset.filter; render();
}));

async function signIn(){
  if(!auth) return;
  try { await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider()); }
  catch(error){
    if(error.code === "auth/popup-blocked" || error.code === "auth/cancelled-popup-request") {
      await authSdk.signInWithRedirect(auth,new authSdk.GoogleAuthProvider());
    } else showBanner(error.message,true);
  }
}

async function handleAuthState(user){
  state.user=user; state.progress.clear(); state.pages=[]; state.isAdmin=false;
  $("authButton").classList.toggle("hidden",!!user);
  $("userChip").classList.toggle("hidden",!user);
  $("signOutButton").classList.toggle("hidden",!user);
  if(!user){
    $("userChip").textContent=""; $("accountDescription").textContent="Not signed in."; render(); return;
  }
  $("userChip").textContent=user.displayName || user.email;
  $("accountDescription").textContent=user.email || "Google account";
  const token=await user.getIdTokenResult(true);
  state.isAdmin=token.claims.admin===true;
  $("updateDocsButton").classList.toggle("hidden",!state.isAdmin);
  await Promise.all([loadCatalog(),loadProgress(),loadPreferences()]);
  render();
  window.setTimeout(checkUpdates, 100);
}

async function loadCatalog(){
  const snap=await firestoreSdk.getDocs(firestoreSdk.collection(db,"documentation","pages","items"));
  state.pages=snap.docs.map(d=>({...d.data(),pageId:d.id})).filter(p=>!p.deprecated)
    .sort((a,b)=>(a.order??99999)-(b.order??99999));
}
async function loadProgress(){
  const snap=await firestoreSdk.getDocs(firestoreSdk.collection(db,"users",state.user.uid,"progress"));
  snap.forEach(d=>state.progress.set(d.id,{...d.data(),pageId:d.id}));
}
async function loadPreferences(){
  const ref=firestoreSdk.doc(db,"users",state.user.uid,"settings","preferences");
  const snap=await firestoreSdk.getDoc(ref);
  state.readingWpm=snap.exists()&&snap.data().readingWpm?clampWpm(snap.data().readingWpm):200;
  $("wpmInput").value=state.readingWpm;
}
async function applyReadingSpeed(){
  const readingWpm=clampWpm($("wpmInput").value);
  $("wpmInput").value=readingWpm;
  if(readingWpm===state.readingWpm) return;
  state.readingWpm=readingWpm;
  render();
  if(!state.user) return;
  try{
    await firestoreSdk.setDoc(
      firestoreSdk.doc(db,"users",state.user.uid,"settings","preferences"),
      {readingWpm,updatedAt:firestoreSdk.serverTimestamp()},{merge:true}
    );
  }catch(error){
    showBanner(`Could not save reading speed: ${error.message}`,true);
  }
}
function clampWpm(value){return Math.max(100,Math.min(500,Number(value)||200));}
async function setLessonStatus(pageId,status,sourcePath){
  if(!state.user) return showBanner("Sign in to save progress across devices.");
  requirePageId(pageId,sourcePath);
  if(!isLessonStatus(status))throw new Error(`Invalid lesson status: ${status}`);
  const ref=firestoreSdk.doc(db,"users",state.user.uid,"progress",pageId);
  const existing=state.progress.get(pageId)||{};
  const completed=status===LESSON_STATUS.COMPLETED;
  const value={pageId,status,completed,completedAt:completed?(existing.completedAt||firestoreSdk.serverTimestamp()):null,updatedAt:firestoreSdk.serverTimestamp()};
  await firestoreSdk.setDoc(ref,value,{merge:true});
  state.progress.set(pageId,{...existing,...value});
  render();
}

async function getLatestRevision(){
  const url=`https://api.github.com/repos/${SOURCE.repo}/commits?path=docs&per_page=1`;
  const response=await fetch(url,{headers:{Accept:"application/vnd.github+json"}});
  if(!response.ok) throw new Error(`GitHub update check failed (${response.status})`);
  const data=await response.json();
  return data[0]?.sha || null;
}

async function checkUpdates(){
  if(!state.user) return;
  const button=$("checkUpdatesButton"); button.disabled=true;
  $("updateStatus").textContent="Checking JetBrains documentation…";
  try{
    const [latest, metaSnap]=await Promise.all([
      getLatestRevision(),
      firestoreSdk.getDoc(firestoreSdk.doc(db,"documentation","meta"))
    ]);
    const current=metaSnap.exists()?metaSnap.data().currentRevision:null;
    state.updateAvailable=!current || current!==latest;
    $("updateStatus").textContent=state.updateAvailable
      ? "A newer Kotlin documentation revision is available."
      : "Documentation catalog is up to date.";
    if(state.updateAvailable) showBanner("Kotlin documentation has changed. Open Settings to update the catalog.");
  }catch(e){
    $("updateStatus").textContent=`Update check unavailable: ${e.message}`;
  }finally{button.disabled=false;}
}

async function updateDocumentation(){
  if(!state.user||!state.isAdmin) return;
  const b=$("updateDocsButton"); b.disabled=true;
  $("updateStatus").textContent="Downloading Kotlin documentation index…";
  try{
    const revision=await getLatestRevision();
    const [tree,topicPaths]=await Promise.all([
      fetchText(`${SOURCE.rawBase}${SOURCE.treePath}`),
      getTopicPathLookup()
    ]);
    let entries=parseTree(tree);
    const resolution=resolveTopicPaths(entries,topicPaths);
    if(resolution.unresolved.length||resolution.ambiguous.length){
      throw new Error(formatResolutionError(resolution));
    }
    entries=resolution.resolved;

    // Keep What's New near the end of the learning roadmap rather than its sidebar position.
    entries=entries.sort((a,b)=>roadmapRank(a)-roadmapRank(b) || a.originalOrder-b.originalOrder);
    $("updateStatus").textContent=`Analyzing ${entries.length} documentation pages…`;

    const downloadFailures=[];
    const docs=await mapLimit(entries,8,async (entry,index)=>{
      try {
        const markdown=await fetchText(`${SOURCE.rawBase}${entry.sourcePath}`);
        return await buildPage(entry,markdown,index);
      } catch (error) {
        if(error.code==="invalid-page-id") throw error;
        downloadFailures.push({sourcePath:entry.sourcePath,message:error.message});
        console.warn("Skipping documentation source",entry.sourcePath,error);
        return null;
      }
    });
    const pages=docs.filter(Boolean);

    const existingSnap=await firestoreSdk.getDocs(firestoreSdk.collection(db,"documentation","pages","items"));
    const existing=new Map(existingSnap.docs.map(d=>[d.id,{...d.data(),pageId:d.id}]));
    const incoming=new Map(pages.map(page=>[requirePageId(page.pageId,page.sourcePath),page]));
    let added=0,changed=0,removed=0,unchanged=0;
    const writes=[];

    for(const page of pages){
      const pageId=requirePageId(page.pageId,page.sourcePath);
      const old=existing.get(pageId);
      if(!old) added++;
      else if(old.sourceHash!==page.sourceHash || old.order!==page.order || old.hierarchy!==page.hierarchy) changed++;
      else unchanged++;
      writes.push({ref:firestoreSdk.doc(db,"documentation","pages","items",pageId),data:page});
    }
    for(const [pageId,old] of existing){
      requirePageId(pageId,old.sourcePath);
      if(!incoming.has(pageId) && !downloadFailures.some(failure=>failure.sourcePath===old.sourcePath) && !old.deprecated){
        removed++;
        writes.push({ref:firestoreSdk.doc(db,"documentation","pages","items",pageId),data:{deprecated:true,deprecatedAt:firestoreSdk.serverTimestamp()}});
      }
    }
    await commitInChunks(writes);
    await firestoreSdk.setDoc(firestoreSdk.doc(db,"documentation","meta"),{
      currentRevision:revision,
      lastUpdatedAt:firestoreSdk.serverTimestamp(),
      total:pages.length,
      sourceRepository:SOURCE.repo,
      sourceTree:SOURCE.treePath
    },{merge:true});

    const diagnostics=downloadFailures.length?` Skipped ${downloadFailures.length} download failure(s): ${downloadFailures.slice(0,3).map(failure=>failure.sourcePath).join(", ")}.`:"";
    $("updateStatus").textContent=`Updated: ${added} added, ${changed} changed, ${removed} removed, ${pages.length} total.${diagnostics}`;
    state.updateAvailable=false;
    hideBanner();
    await loadCatalog(); render();
  }catch(e){
    console.error(e);
    $("updateStatus").textContent=`Update failed: ${e.message}`;
  }finally{b.disabled=false;}
}

function parseTree(xml){
  const results=[];
  const stack=[];
  const tokenRe=/<\/?toc-element\b[^>]*>/g;
  let match,order=0;
  while((match=tokenRe.exec(xml))){
    const token=match[0];
    if(token.startsWith("</")){ stack.pop(); continue; }
    const title=attr(token,"toc-title") || attr(token,"title") || "";
    const topic=attr(token,"topic");
    const hidden=attr(token,"hidden")==="true";
    const selfClosing=/\/>$/.test(token);
    if(topic && !hidden){
      const clean=topic.replace(/^\//,"");
      const sourcePath=clean.startsWith("docs/")?clean:`docs/topics/${clean}`;
      results.push({title:title || titleFromPath(clean),hierarchy:[...stack,title || titleFromPath(clean)].filter(Boolean).join(" → "),topic:clean,sourcePath,originalOrder:order++});
    }
    if(!selfClosing && title) stack.push(title);
  }
  return dedupe(results,p=>p.sourcePath);
}

async function getTopicPathLookup(){
  const url=`https://api.github.com/repos/${SOURCE.repo}/git/trees/${encodeURIComponent(SOURCE.branch)}?recursive=1`;
  const response=await fetch(url,{headers:{Accept:"application/vnd.github+json"}});
  if(!response.ok)throw new Error(`GitHub topic tree request failed (${response.status})`);
  const data=await response.json();
  if(data.truncated)throw new Error("GitHub topic tree response was truncated; refusing to resolve partial paths.");
  const paths=(data.tree||[]).filter(item=>item.type==="blob"&&item.path.startsWith("docs/topics/")).map(item=>item.path);
  const byFilename=new Map();
  for(const path of paths){const filename=path.split("/").pop();if(!byFilename.has(filename))byFilename.set(filename,[]);byFilename.get(filename).push(path);}
  return {paths:new Set(paths),byFilename};
}

function resolveTopicPaths(entries,lookup){
  const resolved=[],unresolved=[],ambiguous=[];
  for(const entry of entries){
    const direct=entry.topic.startsWith("docs/")?entry.topic:`docs/topics/${entry.topic}`;
    if(lookup.paths.has(direct)){resolved.push({...entry,sourcePath:direct});continue;}
    const matches=lookup.byFilename.get(entry.topic.split("/").pop())||[];
    if(matches.length===1)resolved.push({...entry,sourcePath:matches[0]});
    else if(matches.length===0)unresolved.push(entry);
    else ambiguous.push({entry,matches});
  }
  return {resolved,unresolved,ambiguous};
}

function formatResolutionError({resolved,unresolved,ambiguous}){
  const details=[...unresolved.map(entry=>`${entry.topic} (unresolved)`),...ambiguous.map(({entry,matches})=>`${entry.topic} (ambiguous: ${matches.join(", ")})`)];
  return `Topic path resolution stopped before Firestore writes: ${resolved.length} resolved, ${unresolved.length} unresolved, ${ambiguous.length} ambiguous. ${details.slice(0,5).join("; ")}`;
}

async function buildPage(entry,markdown,index){
  const text=stripMarkdown(markdown);
  const wordCount=text?text.split(/\s+/).filter(Boolean).length:0;
  const codeBlocks=(markdown.match(/```[\s\S]*?```/g)||[]).length;
  const reading=Math.max(1,Math.ceil(wordCount/200));
  const factor=/Language guide|Interoperability|Development/i.test(entry.hierarchy)?2.8:/Kotlin tour/i.test(entry.hierarchy)?2.4:2.2;
  const estimatedStudyMinutes=Math.max(reading,Math.ceil(reading*factor+codeBlocks*2));
  const slug=entry.sourcePath.split("/").pop().replace(/\.(md|topic)$/i,"");
  const pageId=requirePageId(await shortHash(entry.sourcePath.toLowerCase()),entry.sourcePath);
  const sourceHash=await shortHash(markdown);
  const beginnerNullSafety=/Take Kotlin tour → Beginner → Null safety$/i.test(entry.hierarchy);
  const intermediate=/Take Kotlin tour → Intermediate/i.test(entry.hierarchy);
  const beginnerBeforeNull=/Take Kotlin tour → Beginner/i.test(entry.hierarchy) && !beginnerNullSafety;
  return {
    pageId,
    title:entry.title || titleFromPath(slug),
    hierarchy:entry.hierarchy,
    URL:`https://kotlinlang.org/docs/${slug}.html`,
    sourcePath:entry.sourcePath,
    sourceHash,
    wordCount,
    estimatedReadingMinutes:reading,
    estimatedStudyMinutes,
    order:index,
    category:entry.hierarchy.split(" → ")[0] || "Other",
    learningMode:(beginnerNullSafety||intermediate)?"review":"learn",
    initiallyCompleted:beginnerBeforeNull,
    deprecated:false,
    lastUpdatedAt:firestoreSdk.serverTimestamp()
  };
}

function roadmapRank(entry){return /^What's New/i.test(entry.hierarchy)?1000:0;}
function attr(token,name){const m=token.match(new RegExp(`${name}="([^"]*)"`));return m?.[1]||"";}
function titleFromPath(path){return path.split("/").pop().replace(/\.(md|topic)$/i,"").replace(/[-_]/g," ").replace(/\b\w/g,c=>c.toUpperCase());}
function dedupe(items,key){const seen=new Set();return items.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});}
function stripMarkdown(md){return md.replace(/```[\s\S]*?```/g," ").replace(/`[^`]*`/g," ").replace(/<[^>]+>/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[#>*_~|=-]/g," ").replace(/\s+/g," ").trim();}
async function shortHash(value){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,24);}
function requirePageId(pageId,sourcePath){if(typeof pageId!=="string"||!pageId.trim()){const error=new Error(`Invalid pageId generated for ${sourcePath||"unknown source"}: expected a non-empty string.`);error.code="invalid-page-id";throw error;}return pageId;}
async function fetchText(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${url}`);return r.text();}
async function mapLimit(items,limit,worker){const output=new Array(items.length);let cursor=0;async function run(){while(true){const i=cursor++;if(i>=items.length)return;output[i]=await worker(items[i],i);}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return output;}
async function commitInChunks(writes){for(let i=0;i<writes.length;i+=400){const batch=firestoreSdk.writeBatch(db);for(const item of writes.slice(i,i+400))batch.set(item.ref,item.data,{merge:true});await batch.commit();}}

function statusOf(page){return lessonStatus(page,state.progress.get(page.pageId));}
function isDone(page){return statusOf(page)===LESSON_STATUS.COMPLETED;}
function filteredPages(){return state.pages.filter(p=>{if(!matchesStatusFilter(statusOf(p),state.filter))return false;const hay=`${p.title||""} ${p.hierarchy||""}`.toLowerCase();return !state.query||hay.includes(state.query);});}
function studyFactor(page){return /Language guide|Interoperability|Development/i.test(page.hierarchy||"")?2.8:/Kotlin tour/i.test(page.hierarchy||"")?2.4:2.2;}
function readingMinutesFor(page,wpm=state.readingWpm){return Math.max(1,Math.ceil((page.wordCount||0)/wpm));}
function studyMinutesFor(page,wpm=state.readingWpm){const factor=studyFactor(page),baselineReading=readingMinutesFor(page,200),currentReading=readingMinutesFor(page,wpm),baselineStudy=Number(page.estimatedStudyMinutes)||baselineReading;const practiceMinutes=Math.max(0,baselineStudy-Math.ceil(baselineReading*factor));return Math.max(currentReading,Math.ceil(currentReading*factor+practiceMinutes));}
function hierarchyParents(page,category){const parts=String(page.hierarchy||"").split("→").map(part=>part.trim()).filter(Boolean);if(parts[0]===category)parts.shift();if(parts.length&&parts.at(-1).localeCompare(String(page.title||""),undefined,{sensitivity:"base"})===0)parts.pop();return parts;}
function hierarchyTree(pages,category){const root={children:new Map(),pages:[]};for(const page of pages){let node=root;for(const name of hierarchyParents(page,category)){if(!node.children.has(name))node.children.set(name,{name,children:new Map(),pages:[]});node=node.children.get(name);}node.pages.push(page);}return root;}
function hierarchyCount(node){const pages=[...node.pages];for(const child of node.children.values())pages.push(...hierarchyCount(child).pages);return {pages,done:pages.filter(isDone).length};}
function hierarchyHtml(node,depth=0){const direct=node.pages.length?`<div class="lesson-list">${node.pages.map(lessonHtml).join("")}</div>`:"";const children=[...node.children.values()].map(child=>{const count=hierarchyCount(child);return `<section class="hierarchy-group" style="--depth:${depth}"><div class="hierarchy-heading"><span>${esc(child.name)}</span><span class="hierarchy-meta">${count.done}/${count.pages.length} complete</span></div>${hierarchyHtml(child,depth+1)}</section>`;}).join("");return `${direct}${children}`;}
function render(){
  const total=state.pages.length,done=state.pages.filter(isDone).length,pct=total?Math.round(done/total*100):0,remaining=state.pages.filter(p=>!isDone(p)).reduce((n,p)=>n+studyMinutesFor(p),0);
  $("progressRing").style.setProperty("--progress",pct); $("progressPercent").textContent=`${pct}%`; $("pagesMetric").textContent=total?`${done} / ${total}`:"—"; $("timeMetric").textContent=total?formatMinutes(remaining):"—"; $("catalogMetric").textContent=total?total:"—"; $("catalogMetricSub").textContent=total?"documentation pages":"not loaded";
  $("progressHeadline").textContent=state.user?(total?`${total-done} pages left in your roadmap`:"Catalog ready for its first sync"):"Sign in to sync your progress";
  $("progressSubline").textContent=state.user?"Completion is stored privately under your Google account.":"Your progress follows your Google account across devices.";
  $("emptyState").classList.toggle("hidden",total>0); $("curriculum").classList.toggle("hidden",total===0); if(!total)return;
  const groups=new Map(); filteredPages().forEach(p=>{const category=p.category||String(p.hierarchy||"Other").split(" → ")[0];if(!groups.has(category))groups.set(category,[]);groups.get(category).push(p)});
  $("curriculum").innerHTML=[...groups].map(([category,pages])=>`<article class="category glass"><div class="category-header"><span class="category-title">${esc(category)}</span><span class="category-meta">${pages.filter(isDone).length}/${pages.length} complete</span></div><div class="hierarchy-tree">${hierarchyHtml(hierarchyTree(pages,category))}</div></article>`).join("") || `<div class="empty-state glass"><h2>No matching pages</h2><p>Try another search or filter.</p></div>`;
  $("curriculum").querySelectorAll(".lesson-status").forEach(control=>control.addEventListener("change",async()=>{control.disabled=true;try{await setLessonStatus(control.dataset.pageId,control.value,control.dataset.sourcePath);}catch(error){showBanner(`Could not update lesson status: ${error.message}`,true);render();}}));
}
function lessonHtml(p){const status=statusOf(p),reading=readingMinutesFor(p),study=studyMinutesFor(p);return `<div class="lesson"><select class="lesson-status status-${esc(status)}" data-page-id="${esc(p.pageId)}" data-source-path="${esc(p.sourcePath)}" aria-label="Status for ${esc(p.title)}"><option value="toLearn" ${status===LESSON_STATUS.TO_LEARN?"selected":""}>To Learn</option><option value="review" ${status===LESSON_STATUS.REVIEW?"selected":""}>Review</option><option value="completed" ${status===LESSON_STATUS.COMPLETED?"selected":""}>Completed</option></select><div class="lesson-title"><a href="${esc(p.URL||p.url||"#")}" target="_blank" rel="noopener">${esc(p.title||"Untitled")}</a></div><div class="lesson-stats">${Number(p.wordCount||0).toLocaleString()} words · ${reading}m read · ${study}m study</div></div>`;}
function formatMinutes(m){if(m<60)return `${Math.round(m)}m`;const totalMinutes=Math.round(m);if(totalMinutes<1440){const h=Math.floor(totalMinutes/60),min=totalMinutes%60;return min?`${h}h ${min}m`:`${h}h`;}const days=Math.floor(totalMinutes/1440),remainingMinutes=totalMinutes%1440,hours=Math.floor(remainingMinutes/60),min=remainingMinutes%60;const parts=[`${days}d`];if(hours)parts.push(`${hours}h`);if(min)parts.push(`${min}m`);return parts.join(" ");}
function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function showBanner(message,error=false){$("statusBannerMessage").textContent=message;const el=$("statusBanner");el.classList.remove("hidden");el.classList.toggle("error",error);}
function hideBanner(){const el=$("statusBanner");el.classList.add("hidden");el.classList.remove("error");$("statusBannerMessage").textContent="";}
render();