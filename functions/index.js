const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

initializeApp();
const db = getFirestore();
const REGION = "us-central1";
const OWNER = "JetBrains";
const REPO = "kotlin-web-site";
const BRANCH = "master";
const TREE_PATH = "docs/kr.tree";
const CACHE_MS = 5 * 60 * 1000;

function requireAuth(request){ if(!request.auth) throw new HttpsError("unauthenticated","Sign in is required."); }
function requireAdmin(request){ requireAuth(request); if(request.auth.token.admin !== true) throw new HttpsError("permission-denied","Administrator access is required."); }
async function githubJson(path){ const r=await fetch(`https://api.github.com${path}`,{headers:{Accept:"application/vnd.github+json","User-Agent":"kotlin-learning-tracker"}}); if(!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`); return r.json(); }
async function githubRaw(path){ const r=await fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`,{headers:{"User-Agent":"kotlin-learning-tracker"}}); if(!r.ok) throw new Error(`GitHub raw ${r.status}: ${path}`); return r.text(); }
async function latestDocsRevision(){ const commits=await githubJson(`/repos/${OWNER}/${REPO}/commits?path=docs&sha=${BRANCH}&per_page=1`); return commits[0]?.sha || null; }

exports.checkDocumentationUpdate = onCall({region:REGION},async(request)=>{
  requireAuth(request);
  const metaRef=db.doc("documentation/meta"); const snap=await metaRef.get(); const meta=snap.data()||{};
  const checked=meta.lastCheckedAt?.toMillis?.()||0;
  let latestRevision=meta.latestCheckedRevision||null;
  if(!latestRevision || Date.now()-checked>CACHE_MS){ latestRevision=await latestDocsRevision(); await metaRef.set({latestCheckedRevision:latestRevision,lastCheckedAt:FieldValue.serverTimestamp()},{merge:true}); }
  return {updateAvailable:!meta.currentRevision || meta.currentRevision!==latestRevision,currentRevision:meta.currentRevision||null,latestRevision,lastCheckedAt:new Date().toISOString()};
});

function attr(tag,name){ const m=tag.match(new RegExp(`${name}=["']([^"']+)["']`)); return m?.[1]||null; }
function titleFromMarkdown(md,fallback){ const front=md.match(/^---[\s\S]*?^---/m)?.[0]||""; const ft=front.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]; const h=md.match(/^#\s+(.+)$/m)?.[1]; return (ft||h||fallback).replace(/<[^>]+>/g,"").trim(); }
function stripForWords(md){ return md.replace(/^---[\s\S]*?^---/m,"").replace(/```[\s\S]*?```/g," ").replace(/~~~[\s\S]*?~~~/g," ").replace(/`[^`]+`/g," ").replace(/<[^>]+>/g," ").replace(/!\[[^\]]*\]\([^)]*\)/g," ").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/[#>*_~|{}\[\]()-]/g," "); }
function wordCount(md){ return (stripForWords(md).match(/[A-Za-z0-9][A-Za-z0-9’'._/+:-]*/g)||[]).length; }
function slugFromTopic(topic){ return topic.replace(/^.*\//,"").replace(/\.(md|topic)$/i,""); }
function pageUrl(topic){ return `https://kotlinlang.org/docs/${slugFromTopic(topic)}.html`; }
function pageId(topic){ return crypto.createHash("sha256").update(topic.toLowerCase()).digest("hex").slice(0,24); }
function studyEstimate(words,md,path){ const read=Math.max(1,Math.ceil(words/200)); const code=(md.match(/```/g)||[]).length/2; let factor=2.2; if(/Language guide|Interoperability|Development/.test(path))factor=2.8; if(/tour/i.test(path))factor=2.4; return Math.max(read,Math.ceil(read*factor+code*3)); }

function parseTree(xml){
  const tokens=xml.match(/<toc-element\b[^>]*(?:\/>|>)|<\/toc-element>/g)||[]; const stack=[]; const pages=[]; let order=0;
  for(const token of tokens){
    if(token.startsWith("</")){stack.pop();continue;}
    const self=token.endsWith("/>"); const topic=attr(token,"topic"), explicit=attr(token,"toc-title");
    const label=explicit || (topic?slugFromTopic(topic):null); const path=label?[...stack,label]:[...stack];
    if(topic && !attr(token,"hidden")){ pages.push({topic,explicitTitle:explicit,hierarchy:path.join(" → "),category:path[0]||"Other",order:order++}); }
    if(!self) stack.push(label||"Section");
  }
  return pages;
}

exports.updateDocumentation = onCall({region:REGION,timeoutSeconds:540,memory:"1GiB"},async(request)=>{
  requireAdmin(request);
  const lockRef=db.doc("documentation/updateLock");
  try{
    await db.runTransaction(async tx=>{const s=await tx.get(lockRef);const d=s.data();if(d?.active && Date.now()-(d.startedAt?.toMillis?.()||Date.now())<10*60*1000)throw new HttpsError("aborted","A documentation update is already running.");tx.set(lockRef,{active:true,startedAt:FieldValue.serverTimestamp(),uid:request.auth.uid});});
    const revision=await latestDocsRevision(); const tree=await githubRaw(TREE_PATH); const entries=parseTree(tree); const next=new Map();
    for(const entry of entries){
      if(!/\.(md|topic)$/i.test(entry.topic))continue;
      const sourcePath=`docs/topics/${entry.topic.replace(/^topics\//,"")}`; let md; try{md=await githubRaw(sourcePath);}catch{continue;}
      const words=wordCount(md); const id=pageId(sourcePath); const title=entry.explicitTitle||titleFromMarkdown(md,slugFromTopic(entry.topic)); const hierarchy=entry.hierarchy.replace(slugFromTopic(entry.topic),title); const read=Math.max(1,Math.ceil(words/200));
      const initiallyCompleted=/Take Kotlin tour → Beginner/.test(hierarchy) && !/Null safety$/i.test(hierarchy);
      const learningMode=/Take Kotlin tour → Intermediate/.test(hierarchy)?"review":"learn";
      next.set(id,{pageId:id,title,hierarchy,URL:pageUrl(entry.topic),sourcePath,wordCount:words,estimatedReadingMinutes:read,estimatedStudyMinutes:studyEstimate(words,md,hierarchy),sourceHash:crypto.createHash("sha256").update(md).digest("hex"),lastUpdatedAt:FieldValue.serverTimestamp(),order:entry.order,category:entry.category,initiallyCompleted,learningMode,deprecated:false});
    }
    const pagesCol=db.collection("documentation/pages/items"); const existing=await pagesCol.get(); const old=new Map(existing.docs.map(d=>[d.id,d.data()])); let added=0,changed=0,removed=0,unchanged=0; let batch=db.batch(),ops=0;
    const flush=async()=>{if(ops){await batch.commit();batch=db.batch();ops=0;}};
    for(const [id,page] of next){const before=old.get(id);if(!before)added++;else if(before.sourceHash!==page.sourceHash||before.hierarchy!==page.hierarchy)changed++;else unchanged++;batch.set(pagesCol.doc(id),page,{merge:true});if(++ops>=400)await flush();}
    for(const [id,page] of old){if(!next.has(id)&&!page.deprecated){removed++;batch.set(pagesCol.doc(id),{deprecated:true,lastUpdatedAt:FieldValue.serverTimestamp()},{merge:true});if(++ops>=400)await flush();}}
    await flush(); await db.doc("documentation/meta").set({schemaVersion:1,currentRevision:revision,latestCheckedRevision:revision,lastUpdatedAt:FieldValue.serverTimestamp(),lastCheckedAt:FieldValue.serverTimestamp(),totalPages:next.size},{merge:true});
    return {added,changed,removed,unchanged,total:next.size};
  } finally { await lockRef.set({active:false,finishedAt:FieldValue.serverTimestamp()},{merge:true}).catch(()=>{}); }
});
