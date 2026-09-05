import { firebaseConfig, firebaseSdkVersion } from "./firebase-config.js";

const sdk=`https://www.gstatic.com/firebasejs/${firebaseSdkVersion}`;
const [{getApps,getApp,initializeApp},authSdk,firestoreSdk]=await Promise.all([
  import(`${sdk}/firebase-app.js`),
  import(`${sdk}/firebase-auth.js`),
  import(`${sdk}/firebase-firestore.js`)
]);

const $=id=>document.getElementById(id);
const app=getApps().length?getApp():initializeApp(firebaseConfig);
const auth=authSdk.getAuth(app);
const db=firestoreSdk.getFirestore(app);
const DEFAULT_DAILY_MINUTES=30;
const MINUTE_STEP=5;
let savedDailyMinutes=DEFAULT_DAILY_MINUTES;
let draftDailyMinutes=DEFAULT_DAILY_MINUTES;
let currentUser=null;
const scrollTimers=new WeakMap();

function wheelValues(max,step=1){return Array.from({length:Math.floor(max/step)+1},(_,i)=>i*step);}
function buildWheel(element,values){
  element.innerHTML=`<div class="wheel-spacer"></div>${values.map(value=>`<button type="button" class="wheel-option" data-value="${value}" role="option" aria-selected="false">${String(value).padStart(2,"0")}</button>`).join("")}<div class="wheel-spacer"></div>`;
  element.addEventListener("scroll",()=>{
    clearTimeout(scrollTimers.get(element));
    scrollTimers.set(element,setTimeout(()=>commitWheelPosition(element),90));
  },{passive:true});
  element.addEventListener("click",event=>{
    const option=event.target.closest(".wheel-option");
    if(!option)return;
    selectOption(element,option,true);
    updateDraftFromSelected();
  });
}
function nearestOption(element){
  const center=element.scrollTop+element.clientHeight/2;
  return [...element.querySelectorAll(".wheel-option")].reduce((best,option)=>{
    const optionCenter=option.offsetTop+option.offsetHeight/2;
    return !best||Math.abs(optionCenter-center)<best.distance?{option,distance:Math.abs(optionCenter-center)}:best;
  },null)?.option;
}
function selectOption(element,option,smooth=false){
  if(!option)return;
  element.querySelectorAll(".wheel-option").forEach(item=>{
    const selected=item===option;
    item.classList.toggle("selected",selected);
    item.setAttribute("aria-selected",String(selected));
  });
  element.scrollTo({top:option.offsetTop-(element.clientHeight-option.offsetHeight)/2,behavior:smooth?"smooth":"auto"});
}
function commitWheelPosition(element){
  const option=nearestOption(element);
  if(!option)return;
  selectOption(element,option,false);
  updateDraftFromSelected();
}
function scrollToValue(element,value){
  const option=element.querySelector(`[data-value="${value}"]`)||element.querySelector(".wheel-option");
  selectOption(element,option,false);
}
function selectedValue(element){
  const selected=element.querySelector('.wheel-option[aria-selected="true"]');
  return Number(selected?.dataset.value||0);
}
function updateDraftFromSelected(){
  const hours=selectedValue($("dailyHoursWheel"));
  const minutes=selectedValue($("dailyMinutesWheel"));
  draftDailyMinutes=Math.max(MINUTE_STEP,hours*60+minutes);
}
function captureVisibleWheelValues(){
  const hours=Number(nearestOption($("dailyHoursWheel"))?.dataset.value||0);
  const minutes=Number(nearestOption($("dailyMinutesWheel"))?.dataset.value||0);
  selectOption($("dailyHoursWheel"),$("dailyHoursWheel").querySelector(`[data-value="${hours}"]`),false);
  selectOption($("dailyMinutesWheel"),$("dailyMinutesWheel").querySelector(`[data-value="${minutes}"]`),false);
  draftDailyMinutes=Math.max(MINUTE_STEP,hours*60+minutes);
  return draftDailyMinutes;
}
function setPicker(totalMinutes){
  const safe=Math.max(MINUTE_STEP,Math.round(totalMinutes/MINUTE_STEP)*MINUTE_STEP);
  const hours=Math.min(12,Math.floor(safe/60));
  const minutes=hours===12?0:safe%60;
  requestAnimationFrame(()=>{
    scrollToValue($("dailyHoursWheel"),hours);
    scrollToValue($("dailyMinutesWheel"),minutes);
  });
  draftDailyMinutes=safe;
  updateMetric(savedDailyMinutes);
}
function parseRemainingMinutes(text){
  if(!text||text.trim()==="—")return null;
  const days=Number(text.match(/(\d+)d/)?.[1]||0);
  const hours=Number(text.match(/(\d+)h/)?.[1]||0);
  const minutes=Number(text.match(/(\d+)m/)?.[1]||0);
  return days*1440+hours*60+minutes;
}
function formatDailyGoal(minutes){
  const hours=Math.floor(minutes/60),mins=minutes%60;
  if(hours&&mins)return `${hours}h ${mins}m/day`;
  if(hours)return `${hours}h/day`;
  return `${mins}m/day`;
}
function updateMetric(goalMinutes=savedDailyMinutes){
  const remaining=parseRemainingMinutes($("timeMetric")?.textContent);
  $("dailyGoalSub").textContent=`at ${formatDailyGoal(goalMinutes)}`;
  $("dailyGoalMetric").textContent=remaining===null?"—":remaining===0?"Done":`${Math.ceil(remaining/goalMinutes)}d`;
}
async function loadDailyGoal(user){
  currentUser=user;
  if(!user){savedDailyMinutes=DEFAULT_DAILY_MINUTES;setPicker(savedDailyMinutes);return;}
  try{
    const ref=firestoreSdk.doc(db,"users",user.uid,"settings","preferences");
    const snap=await firestoreSdk.getDoc(ref);
    savedDailyMinutes=Math.max(MINUTE_STEP,Number(snap.data()?.dailyStudyMinutes)||DEFAULT_DAILY_MINUTES);
  }catch(error){
    console.warn("Could not load daily study goal",error);
    savedDailyMinutes=DEFAULT_DAILY_MINUTES;
  }
  setPicker(savedDailyMinutes);
  updateMetric(savedDailyMinutes);
}
async function saveDailyGoal(){
  const nextDailyMinutes=captureVisibleWheelValues();
  savedDailyMinutes=nextDailyMinutes;
  updateMetric(savedDailyMinutes);
  if(!currentUser)return;
  try{
    await firestoreSdk.setDoc(
      firestoreSdk.doc(db,"users",currentUser.uid,"settings","preferences"),
      {dailyStudyMinutes:savedDailyMinutes,updatedAt:firestoreSdk.serverTimestamp()},
      {merge:true}
    );
  }catch(error){
    console.warn("Could not save daily study goal",error);
  }
}

buildWheel($("dailyHoursWheel"),wheelValues(12));
buildWheel($("dailyMinutesWheel"),wheelValues(55,MINUTE_STEP));
setPicker(DEFAULT_DAILY_MINUTES);
authSdk.onAuthStateChanged(auth,loadDailyGoal);
$("settingsButton").addEventListener("click",()=>setPicker(savedDailyMinutes));
window.addEventListener("klt-save-settings",saveDailyGoal);

const timeObserver=new MutationObserver(()=>updateMetric(savedDailyMinutes));
timeObserver.observe($("timeMetric"),{childList:true,characterData:true,subtree:true});
updateMetric(savedDailyMinutes);
