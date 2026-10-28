import './style.css';
import {configured,watchAuth,signInGoogle,logOut,db as FDB} from './firebase.js';

/* ---------- constants ---------- */
const APP_URL=location.origin+location.pathname;
const COUNTIES=['基隆市','台北市','新北市','桃園市','新竹市','新竹縣','苗栗縣','台中市','彰化縣','南投縣','雲林縣','嘉義市','嘉義縣','台南市','高雄市','屏東縣','宜蘭縣','花蓮縣','台東縣','澎湖縣','金門縣','連江縣'];
const GEAR_CATS=['帳篷寢具','營具家具','廚房','照明電器','個人用品','其他'];
const SHOP_CATS=['食材','飲料','調味','消耗品','裝備','其他'];
const WEATHER=['晴朗','多雲','有雨','寒冷'];
const CAMPTYPE=['碎石','混和','草皮','棧板'];
const FACIL=['飲水機','冰箱','插座','沐浴洗髮乳','吹風機'];
const PROS=['草地平整','衛浴乾淨','熱水充足','景觀超美','路況良好','高度隱私','星空燦爛','清靜悠閒','遮蔭豐富','營主熱情','交通便利','營位寬敞'];
const CONS=['沒有缺點','人太多','熱水不穩','浴廁少','山路陡','難搭帳','泥濘','很曬','風大','有蟑螂','蒼蠅多','蚊蟲多'];
const SUBS=['members','gear','packs','meals','shopping','expenses','schedule','photos'];
const WD='日一二三四五六';
const CODE_CHARS='ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* ---------- state ---------- */
const S={db:null,user:null,assets:null,uid:null,canWrite:true,offline:false,connecting:true,
  allTrips:[],tripsLoaded:false,myIds:null,kit:null,starter:[],
  route:{view:'home'},tab:'overview',
  sub:{},subTripId:null,unsubs:[],counts:{},countSubs:{},tripMembers:{},
  names:{},gearFilter:'all',shopFilter:'all',stats:null,pendingJoin:null};

/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const newCode=()=>Array.from({length:6},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join('');
const DAY=864e5;
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const todayStr=()=>ymd(new Date());
function parseD(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function addDays(s,n){const d=parseD(s);d.setDate(d.getDate()+n);return ymd(d)}
const daysBetween=(a,b)=>Math.round((parseD(b)-parseD(a))/DAY);
function fmtD(s){if(!s)return'';const d=parseD(s);return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`}
function fmtRange(t){if(!t.startDate)return'日期未定';return fmtD(t.startDate)+(t.endDate&&t.endDate!==t.startDate?' – '+fmtD(t.endDate):'')}
const nights=t=>t.startDate&&t.endDate?Math.max(0,daysBetween(t.startDate,t.endDate)):0;
function status(t){if(!t.startDate)return'plan';const td=todayStr(),end=t.endDate||t.startDate;if(end<td)return'done';if(t.startDate<=td)return'now';return'plan'}
const STATUS_L={plan:'規劃中',now:'露營中',done:'已完成'};
function countdown(t){const st=status(t);if(st==='now')return['露營中','TODAY'];if(st==='done'||!t.startDate)return null;const d=daysBetween(todayStr(),t.startDate);if(d===0)return['今天','出發'];if(d===1)return['明天','出發'];return[`${d}`,'天後出發']}
const money=n=>'$'+Math.round(n||0).toLocaleString('zh-TW');
const stars=n=>n?'★'.repeat(n)+'☆'.repeat(5-n):'';
const where=t=>[t.county,t.location].filter(Boolean).join(' ');

/* people: a key is a user id, or "g:名字" for someone without an account */
function nameOf(k){if(!k)return'';if(k.startsWith('g:'))return k.slice(2);const p=S.names[k];if(k===S.uid&&!(p&&p.name))return'我';return(p&&p.name)||'成員'}
function hue(s){let h=0;for(const c of String(s))h=(h*31+c.codePointAt(0))%360;return h}
function av(k){const p=!k.startsWith('g:')&&S.names[k];const n=nameOf(k);
  if(p&&p.avatarUrl)return `<span class="av"><img src="${esc(p.avatarUrl)}" alt="" referrerpolicy="no-referrer"></span>`;
  return `<span class="av" style="background:hsl(${hue(k)} 18% 52%)" aria-hidden="true">${esc([...n][0]||'?')}</span>`}
const who=k=>`<span class="who">${av(k)}<span>${esc(nameOf(k))}${k===S.uid?'（我）':''}</span>${k.startsWith('g:')?'<em class="vtag">虛擬</em>':''}</span>`;
async function resolveNames(ids){
  if(!S.db)return;
  const need=[...new Set(ids)].filter(i=>i&&!i.startsWith('g:')&&!(i in S.names));
  if(!need.length)return;
  need.forEach(i=>S.names[i]=null);
  await Promise.all(need.map(async i=>{try{const s=await S.db.doc('users/'+i).get();const d=s.exists?s.data():{};S.names[i]={name:d.name||'',avatarUrl:d.photo||''}}catch(e){S.names[i]={name:'',avatarUrl:''}}}));
  render();
}
function membersOf(t){const ids=S.tripMembers[t.id]||[];return[...ids,...(t.guests||[]).map(g=>'g:'+g)]}
const isMember=t=>!!t&&(S.tripMembers[t.id]||[]).includes(S.uid)||(S.myIds||[]).includes(t&&t.id);

const ICONS={
  tent:'<path d="M2 20h20M12 4 3 20M12 4l9 16M9.5 20 12 14l2.5 6"/>',
  chart:'<path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/>',
  pack:'<path d="M6 9a6 6 0 0 1 12 0v11H6z"/><path d="M9.5 5V3.5h5V5M9 14h6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="m5 12.5 4.5 4.5L19 7"/>',
  back:'<path d="M15 5l-7 7 7 7"/>',pin:'<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/>',camera:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  map:'<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  wallet:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  star:'<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
  landmark:'<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  share:'<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
};
const ico=n=>`<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- show unexpected errors on screen ---------- */
window.addEventListener('error',e=>{try{toast('發生錯誤：'+(e.message||e.error||'unknown'),8000)}catch(_){}});
window.addEventListener('unhandledrejection',e=>{const r=e.reason;if(r&&(r.code==='auth/popup-closed-by-user'||r.code==='auth/cancelled-popup-request'))return;try{toast('發生錯誤：'+((r&&(r.code||r.message))||r||'unknown'),8000)}catch(_){}});
/* ---------- writes ---------- */
function W(fn){
  const run=(async()=>{for(let i=0;i<4;i++){try{return await fn()}catch(e){const c=e&&e.code;if((c==='resource-exhausted'||c==='unavailable'||c==='aborted')&&i<3){await sleep(500*(i+1));continue}throw e}}})();
  run.catch(e=>{console.warn(e);toast(e&&e.code==='permission-denied'?'沒有權限修改，你可能已經不在這個行程裡了。':'沒有存成功，請稍後再試一次。',4000)});
  return Promise.race([run,sleep(1500)]);
}
const D=p=>S.db.doc(p);
const myIndexRef=()=>S.db.collection('data/users/'+S.uid).doc('trips');
const myKitRef=()=>S.db.collection('data/users/'+S.uid).doc('kit');
async function setMyIds(ids){S.myIds=ids;render();await W(()=>myIndexRef().set({ids,updatedAt:Date.now()}))}

let toastT;function toast(m,ms=2600){const t=$('#toast');t.textContent=m;t.classList.remove('has-btn');t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),ms)}
function undoToast(m,fn){const t=$('#toast');t.innerHTML=`<span>${esc(m)}</span><button type="button" id="undo">復原</button>`;t.classList.add('show','has-btn');
  $('#undo').onclick=()=>{t.classList.remove('show','has-btn');fn()};clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show','has-btn'),5000)}
/* swipe left to reveal 刪除 */
const swipe=(kind,id,inner,ok)=>ok?`<div class="swipe${S.openSwipe===kind+':'+id?' open':''}" data-key="${kind}:${id}"><button class="swipe-del" data-act="swipe-del" data-kind="${kind}" data-id="${id}" tabindex="-1">刪除</button><div class="swipe-row">${inner}</div></div>`:inner;
let sw=null,swAte=false;
document.addEventListener('pointerdown',e=>{
  const row=e.target.closest('.swipe-row');
  if(!e.target.closest('.swipe-del'))document.querySelectorAll('.swipe.open').forEach(w=>{if(!row||row.parentElement!==w){w.classList.remove('open');S.openSwipe=null}});
  if(!row||e.button>0)return;
  sw={row,x:e.clientX,y:e.clientY,dx:0,drag:false,base:row.parentElement.classList.contains('open')?-88:0,pid:e.pointerId};
});
document.addEventListener('pointermove',e=>{
  if(!sw||e.pointerId!==sw.pid)return;
  const dx=e.clientX-sw.x,dy=e.clientY-sw.y;
  if(!sw.drag){if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)*1.2){sw.drag=true;sw.row.style.transition='none';try{sw.row.setPointerCapture(e.pointerId)}catch(_){}}else if(Math.abs(dy)>8){sw=null;return}else return}
  sw.dx=dx;sw.row.style.transform=`translateX(${Math.max(-120,Math.min(0,sw.base+dx))}px)`;
});
function swEnd(){
  if(!sw)return;const s=sw;sw=null;if(!s.drag)return;
  s.row.style.transition='';s.row.style.transform='';
  const w=s.row.parentElement,open=s.base+s.dx<-40;
  w.classList.toggle('open',open);S.openSwipe=open?w.dataset.key:null;
  swAte=true;setTimeout(()=>swAte=false,60);
}
document.addEventListener('pointerup',swEnd);document.addEventListener('pointercancel',swEnd);
document.addEventListener('click',e=>{
  if(swAte){e.preventDefault();e.stopPropagation();return}
  const w=e.target.closest('.swipe.open');
  if(w&&!e.target.closest('.swipe-del')){e.preventDefault();e.stopPropagation();w.classList.remove('open');S.openSwipe=null}
},true);
async function swipeDelete(kind,id){
  S.openSwipe=null;const t=curTrip();
  if(kind==='kit'){const a=S.kit||[],x=a.find(i=>i.id===id);if(!x)return;const at=a.indexOf(x);await saveKit(a.filter(i=>i.id!==id));
    undoToast(`已刪除「${x.name}」`,()=>{const b=[...(S.kit||[])];b.splice(at,0,x);saveKit(b)});return}
  if(!t)return;
  if(kind==='pack'){const a=packOf(S.uid),x=a.find(i=>i.id===id);if(!x)return;const at=a.indexOf(x);await savePack(t,a.filter(i=>i.id!==id));
    undoToast(`已刪除「${x.name}」`,()=>{const b=[...packOf(S.uid)];b.splice(at,0,x);savePack(t,b)});return}
  const x=(S.sub[kind]||[]).find(i=>i.id===id);if(!x)return;
  const {id:_,...data}=x;
  S.sub[kind]=S.sub[kind].filter(i=>i.id!==id);render();
  await W(()=>D(`trips/${t.id}/${kind}/${id}`).delete());
  undoToast(`已刪除「${x.name}」`,()=>W(()=>D(`trips/${t.id}/${kind}/${id}`).set(data)));
}

/* ---------- routing ---------- */
function parseRoute(){const h=decodeURIComponent(location.hash.slice(1));if(h.startsWith('trip-'))return{view:'trip',id:h.slice(5)};if(h.startsWith('join-'))return{view:'join',code:h.slice(5).toUpperCase()};if(h==='stats')return{view:'stats'};if(h==='kit')return{view:'kit'};return{view:'home'}}
function onRoute(){
  const r=S.route=parseRoute();
  if(r.view==='join'){S.pendingJoin=r.code;try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}S.route={view:'home'};tryPendingJoin()}
  if(S.route.view==='trip'){if(S.subTripId!==S.route.id){S.tab='overview';S.gearView='shared';S.gearFilter='all';S.shopFilter='all';subTrip(S.route.id)}}
  else unsubTrip();
  if(S.route.view==='stats')loadStats();
  render();
}
window.addEventListener('hashchange',()=>{onRoute();window.scrollTo(0,0)});

/* ---------- subscriptions ---------- */
function subTrip(id){
  unsubTrip();S.subTripId=id;S.sub={};
  if(!S.db)return;
  for(const k of SUBS)subOne(id,k,0);
}
function subOne(id,k,tries){
  {
    S.unsubs.push(S.db.collection(`trips/${id}/${k}`).onSnapshot(s=>{
      S.sub[k]=s.docs.map(d=>({id:d.id,...d.data()}));
      if(k==='members'){S.tripMembers[id]=S.sub.members.map(m=>m.id);resolveNames(S.tripMembers[id])}
      render();
    },e=>{console.warn(k,e);if(tries<6)setTimeout(()=>{if(S.subTripId===id)subOne(id,k,tries+1)},1000*(tries+1));else{S.subErr=S.subErr||{};S.subErr[k]=(e&&(e.code||e.message))||'unknown';render()}}));
  }
}
function unsubTrip(){S.unsubs.forEach(u=>{try{u()}catch(e){}});S.unsubs=[];S.subTripId=null;S.sub={}}
const myTrips=()=>S.myIds?S.allTrips.filter(t=>S.myIds.includes(t.id)):[];
const upcoming=()=>myTrips().filter(t=>status(t)!=='done').sort((a,b)=>(a.startDate||'9999').localeCompare(b.startDate||'9999'));
const past=()=>myTrips().filter(t=>status(t)==='done').sort((a,b)=>b.startDate.localeCompare(a.startDate));
function syncCounts(){
  if(!S.db)return;
  const want=new Set(upcoming().slice(0,6).map(t=>t.id));
  for(const id of Object.keys(S.countSubs))if(!want.has(id)){S.countSubs[id].forEach(u=>u());delete S.countSubs[id]}
  for(const id of want)if(!S.countSubs[id]){
    const c=S.counts[id]=S.counts[id]||{};
    S.countSubs[id]=['gear','shopping','members'].map(k=>S.db.collection(`trips/${id}/${k}`).onSnapshot(s=>{
      if(k==='members'){S.tripMembers[id]=s.docs.map(d=>d.id);resolveNames(S.tripMembers[id])}
      else{const docs=s.docs.map(d=>d.data());c[k]={total:docs.length,done:docs.filter(x=>k==='gear'?x.done:x.bought).length}}
      render();
    },e=>console.warn(e)));
  }
}

/* ---------- render ---------- */
let rq=false;function render(){if(rq)return;rq=true;requestAnimationFrame(()=>{rq=false;draw()})}
function draw(){
  const nav=$('#nav');
  if(!configured){$('#main').innerHTML=vSetup();nav.hidden=true;return}
  if(!S.authReady){$('#main').innerHTML=`<div class="empty" style="padding-top:40vh">載入中…</div>`;nav.hidden=true;return}
  if(!S.uid){$('#main').innerHTML=vLogin();nav.hidden=true;return}
  nav.hidden=false;
  const r=S.route;
  $('#main').innerHTML=r.view==='trip'?vTrip():r.view==='stats'?vStats():r.view==='kit'?vKit():vHome();
  const cur=r.view==='trip'?'home':r.view;
  $('#nav .in').innerHTML=[['home','#','tent','行程'],['stats','#stats','chart','統計'],['kit','#kit','pack','裝備']].map(([k,href,i,l])=>`<a href="${href}"${cur===k?' aria-current="page"':''}>${ico(i)}<span>${l}</span></a>`).join('');
}
function topBar(eyebrow,title){
  const me=S.uid?`<button class="me" data-act="account">${av(S.uid)}<span>${esc(nameOf(S.uid))}</span></button>`:'';
  return `<header class="top"><div class="grow"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div>${me}</header>${connNotice()}`;
}
function connNotice(){
  if(!navigator.onLine)return `<div class="notice">目前沒有網路。你的修改會先存在手機上，連上網路後自動同步。</div>`;
  return '';
}
function progress(c,k,label,cls=''){
  const x=c&&c[k];const tot=x?x.total:0,dn=x?x.done:0;const pct=tot?Math.round(dn/tot*100):0;
  return `<div><div class="bar-l"><span>${label}</span><span class="num">${x?`${dn}/${tot}`:'…'}</span></div><div class="bar ${cls}"><i style="width:${pct}%"></i></div></div>`;
}
const cdHtml=t=>{const c=countdown(t);return c?`<span class="cd"><b class="num">${c[0]}</b><span>${c[1]}</span></span>`:''};
const can=()=>S.canWrite&&!!S.db&&!!S.uid;

/* ---------- HOME ---------- */
function vHome(){
  let h=topBar('Camping Log','露營日誌');
  const ready=S.tripsLoaded&&S.myIds!==null;
  if(can())h+=`<div class="actions">
    <button class="act primary" data-act="new-trip"><span class="ic">${ico('plus')}</span><span>建立行程<small>邀朋友一起規劃</small></span></button>
    <button class="act ghost" data-act="join"><span class="ic">${ico('key')}</span><span>輸入房間碼<small>加入朋友的行程</small></span></button></div>`;
  if(!ready)return h+(S.connecting||S.db?`<div class="empty">正在讀取行程…</div>`:'');
  const up=upcoming(),ps=past();
  if(!up.length&&!ps.length){
    h+=`<section class="empty-hero"><div class="big">${ico('tent')}</div><h2>還沒有任何行程</h2><p>建立一趟露營，把房間碼或邀請連結傳給朋友，大家就能一起分配裝備、列購物清單、記帳分攤。收到朋友的房間碼，就按「輸入房間碼」加入。</p></section>`;
  }
  if(up.length){
    const f=up[0],mem=membersOf(f);
    h+=`<section class="sec"><div class="sec-head"><h2>接下來</h2><span class="count">${up.length} 趟規劃中</span></div>
    <a class="feat" href="#trip-${f.id}">
      <div class="feat-top"><span class="pill ${status(f)}">${STATUS_L[status(f)]}</span>${cdHtml(f)}</div>
      <h3>${esc(f.name)}</h3>
      <p class="meta"><span>${ico('cal')}${fmtRange(f)}${nights(f)?` · ${nights(f)} 晚`:''}</span>${where(f)?`<span>${ico('pin')}${esc(where(f))}</span>`:''}</p>
      ${mem.length?`<div class="avs">${mem.slice(0,8).map(av).join('')}${mem.length>8?`<span class="av" style="background:var(--ink-3)">+${mem.length-8}</span>`:''}</div>`:''}
      <div class="ready">${progress(S.counts[f.id],'gear','裝備備妥')}${progress(S.counts[f.id],'shopping','採買完成','amber')}</div>
    </a>
    ${up.slice(1).map(t=>{const d=t.startDate?parseD(t.startDate):null;return `<a class="row-card" href="#trip-${t.id}">
      <div class="date-tile">${d?`<span class="m">${d.getMonth()+1}月</span><span class="d num">${d.getDate()}</span>`:'<span class="m">未定</span>'}</div>
      <div class="body"><h4>${esc(t.name)}</h4><div class="sub">${esc(where(t))||'地點未定'}</div></div>${cdHtml(t)}</a>`}).join('')}
    </section>`;
  }
  if(ps.length){
    h+=`<section class="sec"><div class="sec-head"><h2>去過的營地</h2><span class="count">${ps.length} 趟</span></div><div class="memgrid">${ps.map(t=>`<a class="mem" href="#trip-${t.id}">
      <div class="ph">${t.cover?`<img src="${esc(t.cover)}" alt="" loading="lazy">`:`<span>${esc([...t.name][0]||'營')}</span>`}</div>
      <div class="cap"><h4>${esc(t.name)}</h4><div class="sub"><span class="num">${t.startDate.slice(0,4)}.${t.startDate.slice(5,7)}</span><span class="stars">${stars(t.rating)}</span></div></div></a>`).join('')}</div></section>`;
  }
  if(can())h+=`<div class="legacy-link"><button class="btn-text" data-act="legacy-import">${ico('share')}從舊版露營日誌匯入資料</button></div>`;
  return h;
}

/* ---------- TRIP ---------- */
const curTrip=()=>S.allTrips.find(t=>t.id===S.route.id);
const loading=`<div class="empty">正在讀取…</div>`;
function vTrip(){
  if(!S.tripsLoaded)return loading;
  const t=curTrip();
  if(!t)return `<div class="empty-hero"><h2>找不到這個行程</h2><p>可能已經被刪除了。</p><a class="btn ghost" href="#">回到行程列表</a></div>`;
  const st=status(t),sub=S.sub,member=isMember(t);
  const cnt=k=>sub[k]?sub[k].length:'';
  const tabs=[['overview','總覽'],['gear','裝備',cnt('gear')],['shop','購物',cnt('shopping')],['money','分帳',cnt('expenses')]];
  const body=S.tab==='gear'?pGear(t):S.tab==='shop'?pShop(t):S.tab==='money'?pMoney(t):pOverview(t);
  return `<header class="trip-head">
    <div class="nav"><a class="icon-btn" href="#" aria-label="回到行程列表">${ico('back')}</a><span class="grow"></span>
      ${member&&can()?`<button class="btn small ghost" data-act="invite">${ico('share')}邀請</button><button class="icon-btn" data-act="edit-trip" aria-label="編輯行程">${ico('edit')}</button>`:''}</div>
    <div class="status"><span class="pill ${st}">${STATUS_L[st]}</span>${(()=>{const c=countdown(t);return c&&st!=='now'?`<span class="cd">${c[0]==='今天'||c[0]==='明天'?c[0]+'出發':c[0]+' 天後出發'}</span>`:''})()}</div>
    <h1>${esc(t.name)}</h1>
    <p class="meta"><span>${ico('cal')}${fmtRange(t)}${nights(t)?` · ${nights(t)} 晚`:''}</span>${where(t)?`<span>${ico('pin')}${esc(where(t))}</span>`:''}</p>
  </header>
  ${!member&&can()?`<div class="notice join"><span>你還沒加入這個行程，加入後才能一起勾選和記帳。</span><button class="btn small primary" data-act="join-this">加入行程</button></div>`:''}
  <div class="tabs"><div class="in" role="tablist">${tabs.map(([k,l,n])=>`<button role="tab" aria-selected="${S.tab===k}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div></div>
  ${body}`;
}
const canT=t=>can()&&isMember(t);

function pOverview(t){
  const st=status(t),photos=(S.sub.photos||[]).slice().sort((a,b)=>a.createdAt-b.createdAt);
  const g=S.sub.gear,s=S.sub.shopping;
  const c={gear:g&&{total:g.length,done:g.filter(x=>x.done).length},shopping:s&&{total:s.length,done:s.filter(x=>x.bought).length}};
  const hasReview=t.rating||t.notes||(t.pros||[]).length||(t.cons||[]).length||t.weather;
  const q=encodeURIComponent([t.county,t.location||t.name].filter(Boolean).join(' '));
  const mem=membersOf(t);
  return `<div class="panel">
  ${t.cover&&st==='done'?`<div class="cover"><img src="${esc(t.cover)}" alt=""></div>`:''}
  ${canT(t)&&st!=='done'?`<button class="invite" data-act="invite" style="width:100%;text-align:left"><span class="grow"><small>房間碼</small><span class="code">${esc(t.code)}</span></span><span class="btn small primary">${ico('share')}邀請朋友</span></button>`:''}
  <section class="block"><div class="block-head"><h3>同行成員</h3><span class="hint">${mem.length} 人</span><span class="grow"></span>${canT(t)?`<button class="btn-text" data-act="guests">${ico('plus')}新增虛擬成員</button>`:''}</div>
    <div class="people">${mem.map(who).join('')}</div>
  </section>
  ${st!=='done'?`<section class="block"><div class="block-head"><h3>準備進度</h3></div><div class="card ready">${progress(c,'gear','裝備備妥')}${progress(c,'shopping','採買完成','amber')}</div></section>`:''}
  ${menuBlock(t)}
  <section class="block"><div class="block-head"><h3>營地資訊</h3></div>
    <dl class="card kv">
      <dt>日期</dt><dd>${fmtRange(t)}${nights(t)?`，${nights(t)} 晚`:''}</dd>
      <dt>地點</dt><dd>${esc(where(t))||'未填'}${q?` <a class="btn-text" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">${ico('map')}地圖</a>`:''}</dd>
      ${t.pitchArea?`<dt>營位</dt><dd>${esc(t.pitchArea)}</dd>`:''}
      ${t.campType?`<dt>地形</dt><dd>${esc(t.campType)}</dd>`:''}
      ${(t.facilities||[]).length?`<dt>設備</dt><dd><div class="tags">${t.facilities.map(f=>`<span class="tag">${esc(f)}</span>`).join('')}</div></dd>`:''}
    </dl>
  </section>
  <section class="block"><div class="block-head"><h3>照片</h3><span class="hint">${photos.length?photos.length+' 張':''}</span></div>
    <div class="photos">${photos.map(p=>`<button data-act="photo" data-id="${p.id}" aria-label="查看照片"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join('')}
    ${canT(t)?`<label for="photo-input">${ico('camera')}<span>加照片</span></label>`:''}${!photos.length&&!canT(t)?'<span class="hint">還沒有照片</span>':''}</div>
  </section>
  <section class="block"><div class="block-head"><h3>露營心得</h3><span class="grow"></span>${canT(t)?`<button class="btn-text" data-act="review">${hasReview?'編輯':'寫心得'}</button>`:''}</div>
    ${hasReview?`<div class="card" style="display:grid;gap:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${t.rating?`<span class="stars" style="font-size:18px">${stars(t.rating)}</span>`:''}${t.weather?`<span class="tag">${esc(t.weather)}</span>`:''}</div>
      ${(t.pros||[]).length?`<div class="tags">${t.pros.map(p=>`<span class="tag good">${esc(p)}</span>`).join('')}</div>`:''}
      ${(t.cons||[]).length?`<div class="tags">${t.cons.map(p=>`<span class="tag bad">${esc(p)}</span>`).join('')}</div>`:''}
      ${t.notes?`<p class="notes">${esc(t.notes)}</p>`:''}
    </div>`:`<div class="card"><p class="notes" style="color:var(--ink-3)">${st==='done'?'這趟還沒有心得，趁記憶還新鮮寫一下吧。':'露營回來之後，在這裡留下評分、優缺點和日誌。'}</p></div>`}
  </section>
  </div>`;
}

function memberFilter(kind,list,cur,field,t){
  const keys=[...new Set([...membersOf(t),...list.map(x=>x[field]).filter(Boolean)])];
  const opts=[['all','全部'],['todo',kind==='gear'?'還沒備妥':'還沒買'],...(keys.includes(S.uid)?[['p:'+S.uid,'我負責的']]:[]),...keys.filter(k=>k!==S.uid).map(k=>['p:'+k,nameOf(k)]),['none','未分配']];
  return `<div class="filters">${opts.map(([v,l])=>`<button class="fchip" aria-pressed="${cur===v}" data-act="filter" data-kind="${kind}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`;
}
function applyFilter(list,f,field,doneF){
  if(f==='todo')return list.filter(x=>!x[doneF]);
  if(f==='none')return list.filter(x=>!x[field]);
  if(f.startsWith('p:'))return list.filter(x=>x[field]===f.slice(2));
  return list;
}
function grouped(list,cats,doneF,row){
  const by={};for(const x of list){const c=x.cat||'其他';(by[c]=by[c]||[]).push(x)}
  const order=[...cats,...Object.keys(by).filter(c=>!cats.includes(c))];
  return order.filter(c=>by[c]).map(c=>{const arr=by[c].sort((a,b)=>(a[doneF]-b[doneF])||((a.createdAt||0)-(b.createdAt||0)));return `<div class="group-l"><span>${esc(c)}</span><span class="num">${arr.filter(x=>x[doneF]).length}/${arr.length}</span></div><div class="list">${arr.map(row).join('')}</div>`}).join('');
}
function checkRow(t,x,col,doneF,formAct,ownerF,extra){
  const on=!!x[doneF];
  return `<div class="item${on?' on':''}">
    <button class="chk" data-act="toggle" data-col="${col}" data-f="${doneF}" data-id="${x.id}" aria-label="${on?'取消勾選':'勾選'}" ${canT(t)?'':'disabled'}>${ico('check')}</button>
    <button class="txt" data-act="${formAct}" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="nm">${esc(x.name)}${extra||''}</span>${on&&x.doneBy?`<span class="by">${esc(nameOf(x.doneBy))} 已勾選</span>`:''}</button>
    <span class="side">${canT(t)?`<button class="who-btn" data-act="reassign" data-col="${col}" data-f="${ownerF}" data-id="${x.id}">${x[ownerF]?who(x[ownerF]):'<span class="pick">指定</span>'}</button>`:(x[ownerF]?who(x[ownerF]):'<span class="by">未分配</span>')}</span></div>`;
}
const swipeRow=(t,kind,x,html)=>swipe(kind,x.id,html,canT(t));
const PERSONAL_DEFAULT=new Set(['帳篷','地墊','營柱','營釘','睡袋','床墊','枕頭','毯子','小地墊','露營椅','水杯','行動電源','相機','平板','Switch']);
const scopeOf=x=>x.scope||(x.cat==='個人用品'||PERSONAL_DEFAULT.has(x.name)?'mine':'shared');
const packOf=k=>{const p=(S.sub.packs||[]).find(x=>x.id===k);return(p&&p.items)||[]};
function pGear(t){
  const v=S.gearView||'shared';
  return `<div class="panel"><div class="seg" role="tablist">
    <button role="tab" data-act="gear-view" data-v="shared" aria-selected="${v==='shared'}"><b>公用裝備</b><small>一團帶一份</small></button>
    <button role="tab" data-act="gear-view" data-v="mine" aria-selected="${v==='mine'}"><b>我的行李</b><small>自己打包</small></button></div>
    ${v==='mine'?pMine(t):pShared(t)}</div>`;
}
function pShared(t){
  const g=S.sub.gear;if(!g)return loading;
  const f=S.gearFilter;
  const list=f==='none'?g.filter(x=>!x.assignee):f.startsWith('p:')?g.filter(x=>x.assignee===f.slice(2)):g;
  const unclaimed=g.filter(x=>!x.assignee).length;
  const keys=[...new Set([...membersOf(t),...g.map(x=>x.assignee).filter(Boolean)])];
  const opts=[['all','全部'],['none',`還沒人帶${unclaimed?' '+unclaimed:''}`],...(keys.includes(S.uid)?[['p:'+S.uid,'我帶的']]:[]),...keys.filter(k=>k!==S.uid).map(k=>['p:'+k,nameOf(k)])];
  const row=x=>swipeRow(t,'gear',x,`<div class="item${x.done?' on':''}">
    <button class="chk" data-act="toggle" data-col="gear" data-f="done" data-id="${x.id}" aria-label="${x.done?'取消已裝好':'標記已裝好'}" ${canT(t)&&x.assignee?'':'disabled'}>${ico('check')}</button>
    <button class="txt" data-act="gear-form" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="nm">${esc(x.name)}</span>${x.done?`<span class="by">已裝好</span>`:''}</button>
    <span class="side">${x.assignee?(canT(t)?`<button class="who-btn" data-act="reassign" data-col="gear" data-f="assignee" data-id="${x.id}">${who(x.assignee)}</button>`:who(x.assignee)):canT(t)?`<button class="claim" data-act="claim" data-id="${x.id}">我來帶</button>`:'<span class="by">還沒人帶</span>'}</span></div>`);
  return `<section class="block">
    <div class="block-head"><h3>公用裝備</h3><span class="hint">${g.length?(unclaimed?`${unclaimed} 項還沒人帶`:'每項都有人帶了'):''}</span><span class="grow"></span>
    ${canT(t)?`<button class="btn-text" data-act="import-kit">帶入我的裝備</button><button class="btn small primary" data-act="gear-form">${ico('plus')}新增</button>`:''}</div>
    ${g.length?`<div class="filters">${opts.map(([v,l])=>`<button class="fchip" aria-pressed="${f===v}" data-act="filter" data-kind="gear" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`:''}
    ${g.length?(list.length?grouped(list,GEAR_CATS,'done',row):`<div class="empty">${f==='none'?'每一項都有人帶了':'這個篩選條件下沒有項目'}</div>`)
      :`<div class="empty">卡式爐、桌子、燈、延長線這類一團帶一份的東西列在這裡。<br>可以按「新增」，或「帶入我的裝備」把你要帶給大家用的東西加進來。</div>`}
  </section>`;
}
function pMine(t){
  if(!S.sub.packs)return loading;
  const items=packOf(S.uid),done=items.filter(x=>x.done).length;
  const people=membersOf(t).filter(k=>!k.startsWith('g:'));
  const row=x=>`<div class="item${x.done?' on':''}">
    <button class="chk" data-act="pack-toggle" data-id="${x.id}" aria-label="${x.done?'取消打包':'標記打包好'}" ${canT(t)?'':'disabled'}>${ico('check')}</button>
    <button class="txt" data-act="pack-edit" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="nm">${esc(x.name)}</span></button></div>`;
  return `<section class="block">
    <div class="block-head"><h3>我的行李</h3><span class="hint">${items.length?`${done}/${items.length} 打包好`:''}</span><span class="grow"></span>
    ${canT(t)?`<button class="btn-text" data-act="import-kit">帶入我的裝備</button><button class="btn small primary" data-act="pack-form">${ico('plus')}新增</button>`:''}</div>
    <p class="seg-hint">只有你看得到細項，其他人只看得到下面的進度。點項目可以編輯，往左滑可以刪除。</p>
    ${items.length?grouped(items,GEAR_CATS,'done',x=>swipeRow(t,'pack',x,row(x))):`<div class="empty">睡袋、衣服、盥洗用品這類自己帶的東西列在這裡。<br>按「帶入我的裝備」可以一次加進來。</div>`}
  </section>
  ${people.length>1?`<section class="block"><div class="block-head"><h3>大家的打包進度</h3></div><div class="card bal">${people.map(k=>{const it=packOf(k),d=it.filter(x=>x.done).length;return `<div class="pack-row">${who(k)}<div class="bar"><i style="width:${it.length?d/it.length*100:0}%"></i></div><span class="num">${it.length?`${d}/${it.length}`:'還沒開始'}</span></div>`}).join('')}</div></section>`:''}`;
}
async function savePack(t,items){
  const arr=S.sub.packs=S.sub.packs||[];const p=arr.find(x=>x.id===S.uid);if(p)p.items=items;else arr.push({id:S.uid,items});render();
  await W(()=>D(`trips/${t.id}/packs/${S.uid}`).set({items,updatedAt:Date.now()}));
}
function packForm(t){
  sheet({title:'加到我的行李',body:`${fld('東西',inp('f-name','','例如：保暖外套'))}${fld('分類',sel('f-cat',GEAR_CATS,'個人用品'))}
    <label class="check-row"><input type="checkbox" id="f-tokit"><span>也存到我的裝備清單（標為個人）</span></label>`,
    onSubmit:async f=>{const name=val(f,'f-name');if(!name){toast('請填名稱');return false}const cat=val(f,'f-cat');
      await savePack(t,[...packOf(S.uid),{id:newId(),name,cat,done:false,createdAt:Date.now()}]);
      if($('#f-tokit').checked)await saveKit([...(S.kit||[]),{id:newId(),name,cat,scope:'mine'}]);}});
}
function pShop(t){
  const s=S.sub.shopping;if(!s)return loading;
  const list=applyFilter(s,S.shopFilter,'buyer','bought');
  return `<div class="panel"><section class="block">
    <div class="block-head"><h3>購物清單</h3><span class="hint">${s.filter(x=>x.bought).length}/${s.length}</span><span class="grow"></span>
    ${canT(t)?`<button class="btn small primary" data-act="shop-form">${ico('plus')}新增</button>`:''}</div>
    ${s.length?memberFilter('shop',s,S.shopFilter,'buyer',t):''}
    ${s.length?(list.length?grouped(list,SHOP_CATS,'bought',x=>swipeRow(t,'shopping',x,checkRow(t,x,'shopping','bought','shop-form','buyer',x.qty?` <span class="by">× ${esc(x.qty)}</span>`:''))):`<div class="empty">這個篩選條件下沒有項目</div>`)
      :`<div class="empty">還沒有要買的東西。食材、飲料、冰塊、木炭都可以先列上來，分給負責的人。</div>`}
  </section></div>`;
}
/* ---------- menu ---------- */
const SLOTS=['早餐','午餐','晚餐','點心','宵夜'];
const lines=v=>String(v||'').split(/[\n,，、]+/).map(x=>x.trim()).filter(Boolean);
// "牛小排 2盒" -> {name:'牛小排',qty:'2盒'}
function parseIng(line){const m=line.match(/^(.*?)[\s×xX*]+([\d０-９.]+\s*\S*)$/);return m&&m[1].trim()?{name:m[1].trim(),qty:m[2].trim()}:{name:line,qty:''}}
function menuBlock(t){
  const meals=S.sub.meals;if(!meals)return `<section class="block"><div class="menu-sheet"><div class="mn-head"><small>MENU</small><span class="mn-rule"></span></div><p class="mn-empty"><span>${S.subErr&&S.subErr.meals?'菜單讀取失敗（'+esc(S.subErr.meals)+'），請截圖給開發者':'菜單讀取中…'}</span></p></div></section>`;
  const days=tripDays(t),by={};
  for(const m of meals)(by[m.date||'']=by[m.date||'']||[]).push(m);
  const keys=[...days.filter(d=>by[d]),...Object.keys(by).filter(k=>!days.includes(k)).sort()];
  const edit=canT(t);
  const row=m=>`<button class="mn-row" data-act="meal-form" data-id="${m.id}" ${edit?'':'disabled'}>
      <span class="mn-slot">${esc(m.slot||'一餐')}</span>
      <span class="mn-dish">${(m.dishes||[]).map(esc).join('<i>・</i>')||'<em>未定</em>'}</span>
      <span class="mn-dots" aria-hidden="true"></span>
      <span class="mn-cook">${m.cook?esc(nameOf(m.cook)):''}</span></button>`;
  const day=k=>{const i=days.indexOf(k);const d=k?parseD(k):null;
    const arr=by[k].sort((a,b)=>SLOTS.indexOf(a.slot)-SLOTS.indexOf(b.slot));
    return `<div class="mn-day"><div class="mn-day-h"><span>${i>=0?`第${'一二三四五六七八九十'[i]||i+1}天`:'其他'}</span>${d?`<small>${d.getMonth()+1}.${d.getDate()} 週${'日一二三四五六'[d.getDay()]}</small>`:''}</div>${arr.map(row).join('')}</div>`};
  return `<section class="block"><div class="menu-sheet">
    <div class="mn-head"><small>MENU</small><span class="mn-rule"></span></div>
    ${meals.length?keys.map(day).join(''):`<p class="mn-empty">還沒排菜單<br><span>大家想吃什麼，先寫上來吧</span></p>`}
    ${edit?`<button class="mn-add" data-act="menu-edit">${ico('edit')}編輯菜單</button>`:''}
  </div></section>`;
}
/* edit the whole menu at once: one row per day and meal */
function menuEditor(t){
  const days=tripDays(t),members=membersOf(t),meals=S.sub.meals||[];
  const keys=days.length?days:[''];
  const find=(d,sl)=>meals.find(m=>(m.date||'')===d&&m.slot===sl);
  const extra=['點心','宵夜'];
  const cookSel=(id,v)=>`<select class="me-cook" id="${id}"><option value="">誰煮</option>${members.map(k=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(nameOf(k))}</option>`).join('')}</select>`;
  const row=(d,di,sl)=>{const m=find(d,sl),id=`me-${di}-${SLOTS.indexOf(sl)}`;
    return `<div class="me-row${extra.includes(sl)&&!m?' me-extra':''}"${extra.includes(sl)&&!m?' hidden':''}><span class="me-slot">${sl}</span><input type="text" id="${id}" value="${esc(m?(m.dishes||[]).join('、'):'')}" placeholder="${sl==='早餐'?'例如：蛋餅、咖啡':sl==='晚餐'?'例如：烤肉、玉米濃湯':'吃什麼？'}">${members.length?cookSel(id+'-c',m?m.cook:''):''}</div>`};
  sheet({title:'編輯菜單',submit:'儲存菜單',body:`<p class="fld-h" style="margin:0">每一格打菜名，多道菜用「、」隔開。留空就是這餐不排。</p>
    ${keys.map((d,di)=>`<div class="me-day"><div class="me-day-h"><b>${d?`第${'一二三四五六七八九十'[di]||di+1}天`:'菜單'}</b>${d?`<span>${fmtD(d)}</span>`:''}</div>${SLOTS.map(sl=>row(d,di,sl)).join('')}</div>`).join('')}
    <button type="button" class="btn-text" id="me-more">${ico('plus')}也排點心、宵夜</button>`,
    onSubmit:async f=>{
      let n=0;const jobs=[];
      keys.forEach((d,di)=>SLOTS.forEach(sl=>{
        const el=$(`#me-${di}-${SLOTS.indexOf(sl)}`);if(!el)return;
        const dishes=String(el.value).split(/[、，,\n]+/).map(x=>x.trim()).filter(Boolean);
        const c=$(`#me-${di}-${SLOTS.indexOf(sl)}-c`),cook=c?c.value:'';
        const m=find(d,sl);
        if(m&&!dishes.length){if(!(m.ingredients||[]).length)jobs.push(()=>D(`trips/${t.id}/meals/${m.id}`).delete());else jobs.push(()=>D(`trips/${t.id}/meals/${m.id}`).update({dishes:[],cook}))}
        else if(m&&(dishes.join('、')!==(m.dishes||[]).join('、')||cook!==(m.cook||'')))jobs.push(()=>D(`trips/${t.id}/meals/${m.id}`).update({dishes,cook}));
        else if(!m&&dishes.length)jobs.push(()=>D(`trips/${t.id}/meals/${newId()}${n++}`).set({date:d,slot:sl,dishes,cook,ingredients:[],createdAt:Date.now()+n}));
      }));
      for(const j of jobs)await W(j);
      toast(jobs.length?'菜單已更新':'沒有變更');
    }});
  $('#me-more').addEventListener('click',e=>{document.querySelectorAll('.me-extra').forEach(r=>r.hidden=false);e.currentTarget.hidden=true});
  if(!document.querySelector('.me-extra'))$('#me-more').hidden=true;
}
function mealForm(t,item,date){
  const isNew=!item;const days=tripDays(t),members=membersOf(t);
  item=item||{date:date||days[0]||'',slot:'晚餐',cook:S.uid};
  let dishes=[...(item.dishes||[])],ings=(item.ingredients||[]).map(x=>({...x}));
  const dayPick=days.length?chips('mday',days,[days.includes(item.date)?item.date:days[0]],true,'',days.map((d,i)=>`Day ${i+1}　${fmtD(d)}`)):inp('f-date',item.date,'','date');
  const di=days.indexOf(item.date);
  const label=`${di>=0?`第${'一二三四五六七八九十'[di]||di+1}天`:(item.date?fmtD(item.date):'')}${di>=0||item.date?'・':''}${item.slot||'一餐'}`;
  const f=sheet({title:isNew?'加一餐':label,body:`
    ${isNew?grp('哪一天',dayPick)+grp('哪一餐',chips('slot',SLOTS,[item.slot],true)):''}
    ${grp('吃什麼',`<div class="tagbox" id="dish-box"></div><div class="addrow"><input type="text" id="dish-in" placeholder="輸入一道菜，例如：烤肉" enterkeyhint="done"><button type="button" class="add-btn" id="dish-add" aria-label="加入這道菜">${ico('plus')}</button></div>`)}
    ${grp('要準備的食材',`<div class="ing-box" id="ing-box"></div><div class="addrow"><input type="text" id="ing-in" placeholder="食材，例如：牛小排" enterkeyhint="done"><input type="text" id="ing-qty" class="qty" placeholder="數量"><button type="button" class="add-btn" id="ing-add" aria-label="加入這樣食材">${ico('plus')}</button></div>`)}
    ${members.length?grp('誰負責煮',chips('cook',members,[item.cook],true,'',members.map(k=>nameOf(k)+(k===S.uid?'（我）':'')))):''}
    <label class="toggle-row"><input type="checkbox" id="f-toshop"${isNew?' checked':''}><span><b>食材加到購物清單</b><small>由負責煮的人採買，已經在清單上的不會重複</small></span></label>`,
    danger:isNew?null:{label:'刪除這一餐',fn:()=>W(()=>D(`trips/${t.id}/meals/${item.id}`).delete())},
    onSubmit:async f=>{
      addDish();addIng();
      if(!dishes.length&&!ings.length){toast('至少加一道菜或一樣食材');return false}
      const data={date:!isNew?(item.date||''):days.length?(readChips(f,'mday')[0]||days[0]):val(f,'f-date'),slot:!isNew?(item.slot||'晚餐'):(readChips(f,'slot')[0]||'晚餐'),cook:readChips(f,'cook')[0]||'',dishes,ingredients:ings};
      if(isNew)await W(()=>D(`trips/${t.id}/meals/${newId()}`).set({...data,createdAt:Date.now()}));
      else await W(()=>D(`trips/${t.id}/meals/${item.id}`).update(data));
      if($('#f-toshop').checked){
        const have=new Set((S.sub.shopping||[]).map(x=>x.name));const add=ings.filter(i=>!have.has(i.name));
        let k=0;for(const i of add)await W(()=>D(`trips/${t.id}/shopping/${newId()}${k++}`).set({name:i.name,qty:i.qty||'',cat:'食材',buyer:data.cook||'',bought:false,createdAt:Date.now()+k}));
        toast(add.length?`已把 ${add.length} 樣食材加到購物清單`:'已儲存，食材都已經在購物清單上了');
      }else toast('已儲存');
    }});
  f.querySelectorAll('[data-name=mday],[data-name=slot]').forEach(g=>g.setAttribute('data-keep',''));
  const drawDish=()=>{$('#dish-box').innerHTML=dishes.map((d,i)=>`<span class="tagx">${esc(d)}<button type="button" data-di="${i}" aria-label="移除 ${esc(d)}">${ico('x')}</button></span>`).join('')};
  const drawIng=()=>{$('#ing-box').innerHTML=ings.map((g,i)=>`<div class="ing"><span>${esc(g.name)}</span>${g.qty?`<em>${esc(g.qty)}</em>`:''}<button type="button" data-ii="${i}" aria-label="移除 ${esc(g.name)}">${ico('x')}</button></div>`).join('')};
  function addDish(){const el=$('#dish-in');if(!el)return;const v=el.value.trim();if(v&&!dishes.includes(v))dishes.push(v);el.value='';drawDish()}
  function addIng(){const el=$('#ing-in'),q=$('#ing-qty');if(!el)return;const v=el.value.trim();if(v){const ex=ings.find(g=>g.name===v);if(ex)ex.qty=q.value.trim()||ex.qty;else ings.push({name:v,qty:q.value.trim()})}el.value='';q.value='';drawIng()}
  drawDish();drawIng();
  $('#dish-add').addEventListener('click',()=>{addDish();$('#dish-in').focus()});
  $('#ing-add').addEventListener('click',()=>{addIng();$('#ing-in').focus()});
  $('#dish-in').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addDish()}});
  ['#ing-in','#ing-qty'].forEach(s=>$(s).addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();addIng();$('#ing-in').focus()}}));
  $('#dish-box').addEventListener('click',e=>{const b=e.target.closest('[data-di]');if(b){dishes.splice(+b.dataset.di,1);drawDish()}});
  $('#ing-box').addEventListener('click',e=>{const b=e.target.closest('[data-ii]');if(b){ings.splice(+b.dataset.ii,1);drawIng()}});
}
function reassignSheet(t,col,f,item){
  const cur=item[f]||'',keys=[...new Set([...membersOf(t),...(cur?[cur]:[])])];
  const title=col==='gear'?`誰帶「${item.name}」？`:`誰去買「${item.name}」？`;
  sheet({title,cancel:'取消',body:`<div class="pick-people">${keys.map(k=>`<button type="button" class="pick-person${k===cur?' on':''}" data-k="${esc(k)}">${av(k)}<span>${esc(nameOf(k))}${k===S.uid?'（我）':''}</span>${k.startsWith('g:')?'<em class="vtag">虛擬</em>':''}${k===cur?ico('check'):''}</button>`).join('')}
    <button type="button" class="pick-person${!cur?' on':''}" data-k=""><span class="av" style="background:var(--line-2)">?</span><span>${col==='gear'?'還沒人帶':'未分配'}</span>${!cur?ico('check'):''}</button></div>`});
  $('.pick-people').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(!b)return;const k=b.dataset.k;closeModal();
    if(k===cur)return;item[f]=k;render();W(()=>D(`trips/${t.id}/${col}/${item.id}`).update({[f]:k}));toast(k?`改成 ${nameOf(k)}`:'已改成未分配')});
}
function tripDays(t){if(!t.startDate)return[];const n=Math.min(nights(t),13);return Array.from({length:n+1},(_,i)=>addDays(t.startDate,i))}
function pPlan(t){
  const items=S.sub.schedule;if(!items)return loading;
  const days=tripDays(t);const by={};
  for(const x of items)(by[x.date||'']=by[x.date||'']||[]).push(x);
  const keys=[...days,...Object.keys(by).filter(k=>!days.includes(k)).sort()];
  const block=k=>{
    const arr=(by[k]||[]).sort((a,b)=>(a.time||'99').localeCompare(b.time||'99'));const i=days.indexOf(k);
    return `<section class="day"><div class="day-h"><b>${i>=0?`Day ${i+1}`:(k?'其他日期':'未排日期')}</b><span>${k?fmtD(k):''}</span><span class="grow"></span>${canT(t)?`<button class="btn-text" data-act="plan-form" data-date="${k}">${ico('plus')}加一項</button>`:''}</div>
      ${arr.length?`<div class="tl">${arr.map(x=>`<button class="tl-item" data-act="plan-form" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="t">${esc(x.time||'—')}</span><span><div class="tt">${esc(x.title)}</div>${x.note?`<div class="tn">${esc(x.note)}</div>`:''}</span></button>`).join('')}</div>`:`<div class="empty" style="padding:14px">還沒安排</div>`}
    </section>`;
  };
  return `<div class="panel">${keys.length?keys.map(block).join(''):`<div class="empty">先在行程設定填好出發和回程日期，就能按天排行程。${canT(t)?`<br><br><button class="btn ghost" data-act="plan-form">直接新增一項</button>`:''}</div>`}</div>`;
}
function splitAll(x,members){
  if(x.splitMode)return x.splitMode==='all';
  // records made before the split choice existed were always meant for everyone
  return true;
}
const splitOf=(x,members)=>splitAll(x,members)?members:x.split;
function settle(members,exps){
  const bal={};members.forEach(m=>bal[m]=0);
  for(const x of exps){
    if(!x.paidBy)continue;
    const split=splitOf(x,members);if(!split.length)continue;
    const amt=+x.amount||0,share=amt/split.length;
    bal[x.paidBy]=(bal[x.paidBy]||0)+amt;split.forEach(m=>bal[m]=(bal[m]||0)-share);
  }
  const cr=[],de=[];
  for(const[m,v]of Object.entries(bal)){if(v>0.5)cr.push([m,v]);else if(v<-0.5)de.push([m,-v])}
  cr.sort((a,b)=>b[1]-a[1]);de.sort((a,b)=>b[1]-a[1]);
  const tx=[];let i=0,j=0;
  while(i<de.length&&j<cr.length){const a=Math.min(de[i][1],cr[j][1]);tx.push({from:de[i][0],to:cr[j][0],amt:a});de[i][1]-=a;cr[j][1]-=a;if(de[i][1]<0.5)i++;if(cr[j][1]<0.5)j++}
  return{bal,tx};
}
function pMoney(t){
  const ex=S.sub.expenses;if(!ex)return loading;
  const members=membersOf(t);
  const total=ex.reduce((a,x)=>a+(+x.amount||0),0);
  const {bal,tx}=settle(members,ex);
  const list=ex.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const noPayer=list.filter(x=>!x.paidBy);
  const mine=ex.reduce((a,x)=>{const sp=splitOf(x,members);return a+(sp.includes(S.uid)?(+x.amount||0)/sp.length:0)},0);
  return `<div class="panel">
  ${canT(t)?`<div class="money-people"><div class="people">${members.map(who).join('')}</div><button class="btn-text" data-act="guests">${ico('plus')}新增虛擬成員</button></div>`:''}
  ${t.imported&&ex.length?`<p class="seg-hint">這些金額是從舊版匯入的，只留著當紀錄，不會算進統計。</p>`:''}
  <div class="sum"><div class="card"><span class="label">總花費</span><span class="big">${money(total)}</span></div><div class="card"><span class="label">我的分攤</span><span class="big">${members.includes(S.uid)?money(mine):'—'}</span></div></div>
  ${noPayer.length?`<section class="block"><div class="warn"><b>${noPayer.length} 筆還沒填誰先付</b><span>這幾筆暫時不算進結清，點一下補上付款人。</span><div class="list">${noPayer.map(x=>`<button class="item" data-act="exp-form" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="txt"><span class="nm">${esc(x.name)}</span></span><span class="amt">${money(x.amount)}</span></button>`).join('')}</div></div></section>`:''}
  ${ex.length?`<section class="block"><div class="block-head"><h3>怎麼結清</h3></div><div class="card">${tx.length?tx.map(x=>`<div class="tx">${who(x.from)}<span class="arrow">轉給</span>${who(x.to)}<span class="amt">${money(x.amt)}</span></div>`).join(''):'<p class="notes" style="color:var(--ink-3)">大家都打平了，不用互相轉帳。</p>'}</div></section>
  <section class="block"><div class="block-head"><h3>每個人的狀況</h3></div><div class="card bal">${Object.entries(bal).map(([m,v])=>`<div class="bal-row">${who(m)}<span class="amt ${v>0.5?'pos':v<-0.5?'neg':''}">${v>0.5?'應收 '+money(v):v<-0.5?'應付 '+money(-v):'打平'}</span></div>`).join('')}</div></section>`:''}
  <section class="block"><div class="block-head"><h3>支出明細</h3><span class="grow"></span>${canT(t)?`<button class="btn small primary" data-act="exp-form">${ico('plus')}記一筆</button>`:''}</div>
    ${list.length?`<div class="list">${list.map(x=>swipeRow(t,'expenses',x,`<div class="item"><button class="txt" data-act="exp-form" data-id="${x.id}" ${canT(t)?'':'disabled'}><span class="nm">${esc(x.name)}</span><span class="by">${x.paidBy?esc(nameOf(x.paidBy))+' 先付':'還沒填誰付'}${splitAll(x,members)?' · 全部均分':` · ${x.split.length} 人分`}</span></button><span class="amt">${money(x.amount)}</span></div>`)).join('')}</div>`:`<div class="empty">還沒有支出。營地費、食材、油錢記進來，會自動算好誰該轉給誰多少。</div>`}
  </section></div>`;
}

/* ---------- STATS ---------- */
async function loadStats(){
  if(!S.db||!S.tripsLoaded||S.myIds===null)return;
  S.stats={loading:true};render();
  const spend={};
  for(const t of past()){try{const s=await S.db.collection(`trips/${t.id}/expenses`).get();spend[t.id]=s.docs.reduce((a,d)=>a+(+d.data().amount||0),0)}catch(e){spend[t.id]=0}}
  S.stats={spend};render();
}
function vStats(){
  let h=topBar('Insights','數據洞察');
  if(!S.tripsLoaded||S.myIds===null)return h+loading;
  const done=past();
  if(!done.length)return h+`<div class="empty-hero"><div class="big">${ico('chart')}</div><h2>還沒有完成的行程</h2><p>露營結束後，這裡會統計你去了幾趟、睡了幾晚、花了多少，以及最常去哪裡。</p></div>`;
  const sp=S.stats&&S.stats.spend;
  const paid=done.filter(t=>!t.imported),legacyN=done.length-paid.length;
  const spent=sp?paid.reduce((a,t)=>a+(sp[t.id]||0),0):null;
  const totalN=done.reduce((a,t)=>a+nights(t),0);
  const counties=(()=>{const m={};done.forEach(t=>{const k=t.county||'未填縣市';m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1])})();
  const placeCount=counties.filter(([k])=>k!=='未填縣市').length;
  const rated=done.filter(t=>t.rating);const avgR=rated.length?rated.reduce((a,t)=>a+t.rating,0)/rated.length:0;
  // per person per night: each trip's spend / (people × nights, day trips count as 1)
  const ppn=(()=>{if(!sp)return null;let sum=0,units=0;paid.forEach(t=>{const n=Math.max(1,nights(t)),p=Math.max(1,membersOf(t).length);if(sp[t.id]){sum+=sp[t.id];units+=n*p}});return units?sum/units:null})();
  const best=rated.slice().sort((a,b)=>b.rating-a.rating||b.startDate.localeCompare(a.startDate))[0];
  const count=arr=>{const m={};arr.forEach(x=>m[x]=(m[x]||0)+1);return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  const pros=count(done.flatMap(t=>t.pros||[])).slice(0,5);
  const cons=count(done.flatMap(t=>(t.cons||[]).filter(c=>c!=='沒有缺點'))).slice(0,5);
  const bars=(rows,cls='')=>{const max=Math.max(...rows.map(r=>r[1]),1);return `<div class="card hbars">${rows.map(([k,v])=>`<div class="hbar"><span>${esc(k)}</span><div class="bar ${cls}"><i style="width:${v/max*100}%"></i></div><span class="num">${v}</span></div>`).join('')}</div>`};
  return h+`<div class="panel" style="padding-top:18px">
  <section class="st-hero">
    <div class="st-eyebrow">${ico('wallet')}總累計花費</div>
    <div class="st-big num">${spent===null?'…':money(spent)}</div>
    <div class="st-mini">
      <div><span>完成場次</span><b class="num">${done.length}<small> 場</small></b></div>
      <div><span>平均單場</span><b class="num">${spent===null?'…':paid.length?money(spent/paid.length):'—'}</b></div>
    </div>
    ${legacyN?`<p class="st-legacy">舊版匯入的 ${legacyN} 趟只算場次和足跡，不算金額。</p>`:''}
  </section>
  <div class="st-pair">
    <div class="st-tile blue"><span class="st-ic">${ico('tent')}</span><b class="num">${totalN}</b><span>睡在帳篷 / NIGHTS</span></div>
    <div class="st-tile green"><span class="st-ic">${ico('pin')}</span><b class="num">${placeCount}</b><span>足跡縣市 / PLACES</span></div>
  </div>
  <div class="st-row orange"><span class="st-ic">${ico('users')}</span><div><p>每人每晚平均花費</p><b class="num">${!sp?'…':ppn===null?'—':money(ppn)}${ppn===null?'':'<small> NTD</small>'}</b></div></div>
  <div class="st-row purple"><span class="st-ic">${ico('star')}</span><div><p>平均評分</p><b class="num">${avgR?avgR.toFixed(1):'—'}${avgR?`<span class="st-pill">${rated.length} 場有評分</span>`:''}</b>${best?`<small class="st-note">最愛：${esc(best.name)} ${stars(best.rating)}</small>`:''}</div></div>
  <section class="card st-places"><h3 class="st-h"><i></i>熱門足跡分佈</h3>
    ${counties.map(([k,v])=>`<div class="st-place"><span class="st-lm">${ico('landmark')}</span><div class="grow"><div class="st-pl"><b>${esc(k)}</b><span>${v} 場紀錄</span></div><div class="bar"><i style="width:${v/done.length*100}%"></i></div></div></div>`).join('')}
  </section>
  ${pros.length?`<section class="block"><div class="block-head"><h3>最常出現的優點</h3></div>${bars(pros)}</section>`:''}
  ${cons.length?`<section class="block"><div class="block-head"><h3>最常踩到的雷</h3></div>${bars(cons,'amber')}</section>`:''}
  </div>`;
}
/* ---------- KIT (per person) ---------- */
function vKit(){
  let h=topBar('My Gear','我的裝備');
  if(!S.db)return h;
  if(S.kit===null)return h+loading;
  if(S.kit===false)return h+`<div class="empty-hero"><div class="big">${ico('pack')}</div><h2>建立你的常用裝備</h2><p>把每次露營都會帶的東西存起來，並標好是「公用」還是「個人」。之後在任何行程按「帶入我的裝備」，就會自動分到公用裝備和你的行李。</p>
    ${can()?`<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${S.starter.length?`<button class="btn primary" data-act="kit-starter">用 ${S.starter.length} 項基本清單開始</button>`:''}<button class="btn ghost" data-act="kit-form">從空白開始</button></div>`:''}</div>`;
  const items=S.kit;
  const sec=(scope,title,hint)=>{
    const arr=items.filter(x=>scopeOf(x)===scope);
    const by={};arr.forEach(x=>{(by[x.cat||'其他']=by[x.cat||'其他']||[]).push(x)});
    const order=[...GEAR_CATS,...Object.keys(by).filter(c=>!GEAR_CATS.includes(c))].filter(c=>by[c]);
    return `<section class="block"><div class="kit-sec"><b>${title}</b><span>${hint} · ${arr.length} 項</span></div>
      ${arr.length?order.map(c=>`<div class="group-l"><span>${esc(c)}</span></div><div class="list">${by[c].map(x=>swipe('kit',x.id,`<button class="kit-item" data-act="kit-edit" data-id="${x.id}" ${can()?'':'disabled'}><span>${esc(x.name)}</span>${can()?`<span class="kit-go">${ico('edit')}</span>`:''}</button>`,can())).join('')}</div>`).join(''):`<div class="empty" style="padding:14px">沒有項目</div>`}</section>`;
  };
  return h+`<div class="panel" style="padding-top:18px"><div class="block-head"><span style="font-size:12px;color:var(--ink-3);font-weight:600;line-height:1.5">只有你看得到 · 共 ${items.length} 項<br>點項目編輯，往左滑刪除</span><span class="grow"></span>${can()?`<button class="btn small primary" data-act="kit-form">${ico('plus')}新增</button>`:''}</div>
  ${sec('shared','公用','一團帶一份，會放進公用裝備')}${sec('mine','個人','自己用的，會放進我的行李')}
  </div>`;
}
/* ---------- sheet ---------- */
function closeModal(){const m=$('#modal');m.hidden=true;m.innerHTML='';document.body.classList.remove('lock')}
function sheet({title,body,submit='儲存',onSubmit,danger,cancel='取消'}){
  const m=$('#modal');
  m.innerHTML=`<div class="sheet-backdrop" data-close></div><form class="sheet" id="sheet-form" novalidate>
    <header class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="關閉">${ico('x')}</button></header>
    <div class="sheet-body">${body}</div>
    <footer class="sheet-foot">${danger?`<button type="button" class="btn-text danger" id="sheet-danger">${esc(danger.label)}</button>`:''}<span class="grow"></span>${cancel?`<button type="button" class="btn ghost" data-close>${esc(cancel)}</button>`:''}${onSubmit?`<button type="submit" class="btn primary" id="sheet-ok">${esc(submit)}</button>`:''}</footer></form>`;
  m.hidden=false;document.body.classList.add('lock');
  const f=$('#sheet-form');
  f.addEventListener('submit',async ev=>{ev.preventDefault();if(!onSubmit)return;const b=$('#sheet-ok');b.disabled=true;try{const r=await onSubmit(f);if(r!==false&&f.isConnected)closeModal()}catch(e){console.warn(e)}finally{if(b.isConnected)b.disabled=false}});
  if(danger){const d=$('#sheet-danger');d.addEventListener('click',async()=>{if(!d.dataset.armed){d.dataset.armed='1';d.textContent=danger.confirm||'再按一次確認刪除';return}d.disabled=true;try{await danger.fn();closeModal()}catch(e){d.disabled=false}})}
  m.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',closeModal));
  if(matchMedia('(pointer:fine)').matches)setTimeout(()=>{const x=f.querySelector('input[type=text],textarea');x&&x.focus()},60);
  return f;
}
const fld=(l,inner,hint='')=>`<label class="fld"><span class="fld-l">${l}</span>${inner}${hint?`<span class="fld-h">${hint}</span>`:''}</label>`;
const grp=(l,inner,hint='')=>`<div class="fld"><span class="fld-l">${l}</span>${inner}${hint?`<span class="fld-h">${hint}</span>`:''}</div>`;
const inp=(id,v,ph='',type='text',extra='')=>`<input type="${type}" id="${id}" name="${id}" value="${esc(v??'')}" placeholder="${esc(ph)}" ${extra}>`;
const sel=(id,opts,v,empty)=>`<select id="${id}" name="${id}">${empty!==undefined?`<option value="">${esc(empty)}</option>`:''}${opts.map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}${v&&!opts.includes(v)?`<option selected>${esc(v)}</option>`:''}</select>`;
const personSel=(id,t,v,empty)=>{const keys=[...new Set([...membersOf(t),...(v?[v]:[])])];return `<select id="${id}" name="${id}"><option value="">${esc(empty)}</option>${keys.map(k=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(nameOf(k))}${k===S.uid?'（我）':''}</option>`).join('')}</select>`};
const chips=(name,opts,selected=[],single=false,cls='',labels)=>`<div class="chips ${cls}" data-name="${name}"${single?' data-single':''}>${opts.map((o,i)=>`<button type="button" class="chip" data-chip data-v="${esc(o)}" aria-pressed="${selected.includes(o)}">${esc(labels?labels[i]:o)}</button>`).join('')}</div>`;
const readChips=(f,n)=>[...f.querySelectorAll(`[data-name="${n}"] [aria-pressed="true"]`)].map(b=>b.dataset.v);
const val=(f,id)=>(f.querySelector('#'+id)?.value||'').trim();
const parseNames=s=>[...new Set(String(s||'').split(/[,，、\s]+/).map(x=>x.trim()).filter(Boolean))];

/* ---------- invite & join ---------- */
const inviteLink=t=>`${APP_URL}#join-${t.code}`;
async function copyText(txt,inputEl){
  try{await navigator.clipboard.writeText(txt);toast('已複製')}
  catch(e){if(inputEl){inputEl.focus();inputEl.select()}toast('請長按選取後複製')}
}
function inviteSheet(t,fresh){
  const f=sheet({title:fresh?'行程建立好了':'邀請朋友加入',cancel:'完成',body:`<div class="share-box">
    <span class="fld-l">房間碼</span><span class="code">${esc(t.code)}</span>
    <button type="button" class="btn ghost small" id="copy-code">${ico('copy')}複製房間碼</button>
  </div>
  ${grp('或傳邀請連結',`<div class="linkrow"><input type="text" id="inv-link" readonly value="${esc(inviteLink(t))}"><button type="button" class="btn primary" id="copy-link">${ico('copy')}複製</button></div>`,'朋友點開連結會直接看到加入畫面；也可以在首頁按「輸入房間碼」。')}
  <div class="notice" style="margin:0">第一次用的朋友，需要先被你加進這個 App 的分享名單（設為「編輯者」），才能加入行程和一起編輯。</div>`});
  $('#copy-code').addEventListener('click',()=>copyText(t.code));
  $('#copy-link').addEventListener('click',()=>copyText(inviteLink(t),$('#inv-link')));
}
async function findByCode(code){
  const local=S.allTrips.find(t=>t.code===code);if(local)return local;
  const s=await S.db.collection('trips').where('code','==',code).limit(1).get();
  return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()};
}
async function joinTrip(t){
  toast('加入中…',15000);
  try{await D(`trips/${t.id}/members/${S.uid}`).set({joinedAt:Date.now(),role:t.ownerId===S.uid?'owner':'member'})}
  catch(e){console.warn(e);toast('加入沒有成功，請確認網路後再試一次',5000);return}
  if(!(S.myIds||[]).includes(t.id))await setMyIds([...(S.myIds||[]),t.id]);
  location.hash='trip-'+t.id;toast(`已加入「${t.name}」`);
}
function joinSheet(prefill=''){
  sheet({title:'輸入房間碼',submit:'加入行程',body:`${fld('朋友給你的 6 碼',inp('f-code',prefill,'例如 K7P2XM','text','class="code-input" maxlength="6" autocomplete="off" autocapitalize="characters"'))}`,
    onSubmit:async f=>{
      const code=val(f,'f-code').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(code.length!==6){toast('房間碼是 6 個字元');return false}
      const t=await findByCode(code);
      if(!t){toast('找不到這個房間碼，請再確認一次');return false}
      if((S.myIds||[]).includes(t.id)){location.hash='trip-'+t.id;return}
      await joinTrip(t);
    }});
}
async function tryPendingJoin(){
  const code=S.pendingJoin;if(!code||!S.db||!S.uid||S.myIds===null||!S.tripsLoaded)return;
  S.pendingJoin=null;
  const t=await findByCode(code).catch(()=>null);
  if(!t){toast('這個邀請連結的行程已經不存在了');return}
  if((S.myIds||[]).includes(t.id)){location.hash='trip-'+t.id;return}
  if(!can()){toast('你目前只能看、不能加入。請 App 擁有者在分享設定把你設為「編輯者」。',5000);return}
  sheet({title:'加入行程',submit:'加入',body:`<div class="share-box"><span class="fld-l">你被邀請加入</span><span style="font-size:22px;font-weight:900">${esc(t.name)}</span><span class="meta" style="justify-content:center">${fmtRange(t)}${where(t)?' · '+esc(where(t)):''}</span></div>`,
    onSubmit:async()=>{await joinTrip(t)}});
}

/* ---------- trip forms ---------- */
/* range calendar: tap departure day, then return day */
function calHtml(s,e){
  const m=(s||todayStr()).slice(0,7);
  return `<div class="cal" id="cal" data-s="${s||''}" data-e="${e||''}" data-m="${m}"></div><input type="hidden" id="f-start" value="${s||''}"><input type="hidden" id="f-end" value="${e||''}">`;
}
function drawCal(){
  const c=$('#cal');if(!c)return;
  const s=c.dataset.s,e=c.dataset.e,[y,mo]=c.dataset.m.split('-').map(Number);
  const first=new Date(y,mo-1,1),days=new Date(y,mo,0).getDate(),td=todayStr();
  let cells='';for(let i=0;i<first.getDay();i++)cells+='<span></span>';
  for(let d=1;d<=days;d++){
    const ds=ymd(new Date(y,mo-1,d));
    const cls=[ds===s?'st':'',ds===e&&e!==s?'en':'',s&&e&&ds>s&&ds<e?'in':'',ds===td?'td':'',s&&e&&e!==s&&(ds===s||ds===e)?'rng':''].join(' ');
    cells+=`<button type="button" class="${cls}" data-d="${ds}">${d}</button>`;
  }
  const n=s&&e?daysBetween(s,e):0;
  const sum=!s?'先點<b>出發日</b>':!e?`出發 <b>${fmtD(s)}</b>，再點<b>回程日</b>（當天來回就再點一次同一天）`:`<b>${fmtD(s)}</b>${e!==s?` → <b>${fmtD(e)}</b>`:''}　${n?`${n} 晚`:'當天來回'}`;
  c.innerHTML=`<div class="cal-sum"><span>${sum}</span>${s?`<button type="button" class="btn-text" data-clear>清除</button>`:''}</div>
    <div class="cal-nav"><button type="button" class="icon-btn" data-mv="-1" aria-label="上個月">${ico('back')}</button><b>${y} 年 ${mo} 月</b><button type="button" class="icon-btn" data-mv="1" aria-label="下個月" style="transform:scaleX(-1)">${ico('back')}</button></div>
    <div class="cal-grid wd">${[...WD].map(w=>`<span>${w}</span>`).join('')}</div><div class="cal-grid">${cells}</div>`;
  $('#f-start').value=s;$('#f-end').value=e||s;
}
document.addEventListener('click',ev=>{
  const c=ev.target.closest('#cal');if(!c)return;
  const b=ev.target.closest('button');if(!b)return;
  if(b.dataset.mv){const[y,m]=c.dataset.m.split('-').map(Number);const d=new Date(y,m-1+(+b.dataset.mv),1);c.dataset.m=ymd(d).slice(0,7)}
  else if(b.hasAttribute('data-clear')){c.dataset.s='';c.dataset.e=''}
  else if(b.dataset.d){const d=b.dataset.d,s=c.dataset.s,e=c.dataset.e;
    if(!s||e){c.dataset.s=d;c.dataset.e=''}else if(d<s){c.dataset.s=d}else c.dataset.e=d}
  drawCal();
});
function guestsForm(t){
  let list=[...(t.guests||[])];
  const draw=()=>{$('#g-list').innerHTML=list.length?list.map((g,i)=>`<span class="who">${av('g:'+g)}<span>${esc(g)}</span><button type="button" class="g-del" data-i="${i}" aria-label="移除 ${esc(g)}">${ico('x')}</button></span>`).join(''):'<span class="fld-h">還沒有虛擬成員</span>'};
  sheet({title:'虛擬成員',body:`
    <p class="fld-h" style="margin:0;font-size:13px;line-height:1.7">虛擬成員不用登入、也看不到這個行程，只是一個名字，但一樣可以<b>分配裝備</b>、<b>一起分帳</b>。適合小孩、長輩，或不想用 App 的朋友。<br>朋友想自己看清單、自己勾的話，就傳<b>房間碼</b>讓他加入。</p>
    ${grp('名字',`<div class="linkrow"><input type="text" id="g-name" placeholder="例如：小寶"><button type="button" class="btn ghost" id="g-add">加入</button></div>`)}
    <div class="people" id="g-list"></div>`,
    onSubmit:async()=>{const extra=val($('#sheet-form'),'g-name');if(extra&&!list.includes(extra))list.push(extra);await W(()=>D('trips/'+t.id).update({guests:list,updatedAt:Date.now()}));toast('已更新虛擬成員')}});
  draw();
  const add=()=>{const v=$('#g-name').value.trim();if(v&&!list.includes(v))list.push(v);$('#g-name').value='';draw()};
  $('#g-add').addEventListener('click',add);
  $('#g-name').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();add()}});
  $('#g-list').addEventListener('click',e=>{const b=e.target.closest('.g-del');if(b){list.splice(+b.dataset.i,1);draw()}});
}
function tripForm(t){
  const isNew=!t;t=t||{};
  setTimeout(drawCal,0);
  const owner=!isNew&&t.ownerId===S.uid;
  sheet({title:isNew?'建立行程':'編輯行程',submit:isNew?'建立並邀請朋友':'儲存',
    body:`${fld('營區名稱',inp('f-name',t.name,'例如：星空森林營地','text','maxlength="60"'))}
      ${grp('日期',calHtml(t.startDate,t.endDate))}
      <div class="two">${fld('縣市',sel('f-county',COUNTIES,t.county,'選擇縣市'))}${fld('鄉鎮 / 地址',inp('f-loc',t.location,'例如：五峰鄉'))}</div>
      ${fld('營位 / 搭帳區',inp('f-pitch',t.pitchArea,'例如：A3 棧板區'))}`,
    danger:isNew?null:owner?{label:'刪除行程',confirm:'再按一次：連同清單、照片全部刪除',fn:()=>deleteTrip(t)}:{label:'退出行程',confirm:'再按一次確認退出',fn:()=>leaveTrip(t)},
    onSubmit:async f=>{
      const name=val(f,'f-name');if(!name){toast('請填營區名稱');return false}
      const startDate=val(f,'f-start'),endDate=val(f,'f-end')||startDate;
      const data={name,startDate,endDate,county:val(f,'f-county'),location:val(f,'f-loc'),pitchArea:val(f,'f-pitch'),updatedAt:Date.now()};
      if(isNew)data.guests=[];
      if(isNew){
        const id=newId();let code=newCode();
        for(let i=0;i<3;i++){if(!(await findByCode(code).catch(()=>null)))break;code=newCode()}
        const nt={...data,code,ownerId:S.uid,createdAt:Date.now()};
        await W(()=>D('trips/'+id).set(nt));
        await W(()=>D(`trips/${id}/members/${S.uid}`).set({joinedAt:Date.now(),role:'owner'}));
        await setMyIds([...(S.myIds||[]),id]);
        location.hash='trip-'+id;
        setTimeout(()=>inviteSheet({id,...nt},true),80);
        return false;
      }
      await W(()=>D('trips/'+t.id).update(data));toast('已儲存');
    }});
}
async function leaveTrip(t){
  await W(()=>D(`trips/${t.id}/members/${S.uid}`).delete());
  await setMyIds((S.myIds||[]).filter(x=>x!==t.id));
  location.hash='';toast('已退出行程');
}
async function deleteTrip(t){
  toast('刪除中…',8000);
  for(const k of SUBS){
    const s=await S.db.collection(`trips/${t.id}/${k}`).get();
    for(const d of s.docs){const data=d.data();if(k==='photos'&&data.assetId&&S.assets){try{await S.assets.delete(data.assetId)}catch(e){}}await W(()=>D(`trips/${t.id}/${k}/${d.id}`).delete())}
  }
  await W(()=>D('trips/'+t.id).delete());
  await setMyIds((S.myIds||[]).filter(x=>x!==t.id));
  location.hash='';toast('行程已刪除');
}
function reviewForm(t){
  sheet({title:'露營心得',body:`
    ${grp('整體評價',`<div class="rate" id="rate">${[1,2,3,4,5].map(n=>`<input type="radio" name="rating" id="r${n}" value="${n}"${t.rating===n?' checked':''}><label for="r${n}" class="${(t.rating||0)>=n?'on':''}" aria-label="${n} 顆星">★</label>`).join('')}</div>`)}
    ${grp('天氣',chips('weather',WEATHER,[t.weather],true))}
    ${grp('營地地形',chips('camp',CAMPTYPE,[t.campType],true))}
    ${grp('營地設備',chips('fac',FACIL,t.facilities||[]))}
    ${grp('優點',chips('pros',PROS,t.pros||[]))}
    ${grp('要留意的地方',chips('cons',CONS,t.cons||[],false,'bad'))}
    ${fld('日誌',`<textarea id="f-notes" placeholder="雲海、營主、隔壁帳的狗、半夜下雨……">${esc(t.notes)}</textarea>`)}`,
    onSubmit:async f=>{
      const r=f.querySelector('input[name=rating]:checked');
      await W(()=>D('trips/'+t.id).update({rating:r?+r.value:0,weather:readChips(f,'weather')[0]||'',campType:readChips(f,'camp')[0]||'',facilities:readChips(f,'fac'),pros:readChips(f,'pros'),cons:readChips(f,'cons'),notes:val(f,'f-notes'),updatedAt:Date.now()}));
      toast('心得已儲存');
    }});
  const rate=$('#rate');rate.addEventListener('change',()=>{const v=+(rate.querySelector(':checked')||{}).value||0;rate.querySelectorAll('label').forEach((l,i)=>l.classList.toggle('on',i<v))});
}
/* move items between 公用裝備 and 我的行李 */
ICONS.swap='<path d="M7 7h12l-3-3M17 17H5l3 3"/>';
const inKit=name=>Array.isArray(S.kit)&&S.kit.some(i=>i.name===name);
const moveBlock=(label,hint,name)=>`<div class="move-box"><button type="button" class="btn ghost" id="f-move">${ico('swap')}${label}</button><span class="fld-h">${hint}</span>${inKit(name)?`<label class="check-row"><input type="checkbox" id="f-remember" checked><span>以後帶入時也這樣分（更新我的裝備清單）</span></label>`:''}</div>`;
async function rememberScope(name,scope){
  if(!Array.isArray(S.kit))return;const hit=S.kit.find(i=>i.name===name);
  if(hit&&scopeOf(hit)!==scope)await saveKit(S.kit.map(i=>i.name===name?{...i,scope}:i));
}
async function packToShared(t,x,remember){
  const same=(S.sub.gear||[]).filter(g=>g.name===x.name);
  const free=same.find(g=>!g.assignee),other=same.find(g=>g.assignee&&g.assignee!==S.uid);
  await savePack(t,packOf(S.uid).filter(i=>i.id!==x.id));
  if(free)await W(()=>D(`trips/${t.id}/gear/${free.id}`).update({assignee:S.uid,done:!!x.done}));
  else await W(()=>D(`trips/${t.id}/gear/${newId()}`).set({name:x.name,cat:x.cat||'其他',assignee:S.uid,done:!!x.done,createdAt:Date.now()}));
  if(remember)await rememberScope(x.name,'shared');
  toast(other?`已移到公用裝備（${nameOf(other.assignee)} 也有帶這個）`:'已移到公用裝備，算你帶');
}
async function sharedToPack(t,g,remember){
  await W(()=>D(`trips/${t.id}/gear/${g.id}`).delete());
  if(!packOf(S.uid).some(i=>i.name===g.name))await savePack(t,[...packOf(S.uid),{id:newId(),name:g.name,cat:g.cat||'其他',done:!!g.done,createdAt:Date.now()}]);
  if(remember)await rememberScope(g.name,'mine');
  toast('已移到我的行李');
}
function bindMove(fn){const b=$('#f-move');if(!b)return;b.addEventListener('click',async()=>{const r=$('#f-remember');const remember=!!(r&&r.checked);b.disabled=true;closeModal();try{await fn(remember)}catch(e){console.warn(e)}})}
function gearForm(t,item){
  const isNew=!item;item=item||{assignee:S.uid,cat:'其他'};
  const canMove=!isNew&&(!item.assignee||item.assignee===S.uid),canCopy=!isNew&&!canMove;
  sheet({title:isNew?'新增裝備':'編輯裝備',body:`${fld('裝備名稱',inp('f-name',item.name,'例如：氣化燈'))}
    <div class="two">${fld('誰負責帶',personSel('f-who',t,item.assignee,'未分配'))}${fld('分類',sel('f-cat',GEAR_CATS,item.cat))}</div>
    ${isNew?`<label class="check-row"><input type="checkbox" id="f-tokit"><span>也存到我的裝備清單</span></label>`:''}
    ${canMove?moveBlock('移到我的行李','只有你自己用的東西才需要移過去，公用清單上會拿掉這一項。',item.name):''}${canCopy?moveBlock('我也自己帶一份',`${esc(nameOf(item.assignee))} 帶的這一項會留在公用清單，另外在你的行李加一項。`,''):''}`,
    danger:isNew?null:{label:'刪除',fn:()=>W(()=>D(`trips/${t.id}/gear/${item.id}`).delete())},
    onSubmit:async f=>{
      const name=val(f,'f-name');if(!name){toast('請填裝備名稱');return false}
      const data={name,assignee:val(f,'f-who'),cat:val(f,'f-cat')};
      if(isNew){await W(()=>D(`trips/${t.id}/gear/${newId()}`).set({...data,done:false,createdAt:Date.now()}));if($('#f-tokit').checked)await saveKit([...(S.kit||[]),{id:newId(),name,cat:data.cat}])}
      else await W(()=>D(`trips/${t.id}/gear/${item.id}`).update(data));
    }});
  if(canMove)bindMove(r=>sharedToPack(t,item,r));
  if(canCopy)bindMove(async()=>{if(!packOf(S.uid).some(i=>i.name===item.name))await savePack(t,[...packOf(S.uid),{id:newId(),name:item.name,cat:item.cat||'其他',done:false,createdAt:Date.now()}]);toast('已加到我的行李')});
}
function shopForm(t,item){
  const isNew=!item;item=item||{buyer:S.uid,cat:'食材'};
  sheet({title:isNew?'新增要買的東西':'編輯購物項目',body:`<div class="two">${fld('品項',inp('f-name',item.name,'例如：牛小排'))}${fld('數量',inp('f-qty',item.qty,'例如：2 盒'))}</div>
    <div class="two">${fld('誰去買',personSel('f-who',t,item.buyer,'未分配'))}${fld('分類',sel('f-cat',SHOP_CATS,item.cat))}</div>`,
    danger:isNew?null:{label:'刪除',fn:()=>W(()=>D(`trips/${t.id}/shopping/${item.id}`).delete())},
    onSubmit:async f=>{
      const name=val(f,'f-name');if(!name){toast('請填品項');return false}
      const data={name,qty:val(f,'f-qty'),buyer:val(f,'f-who'),cat:val(f,'f-cat')};
      if(isNew)await W(()=>D(`trips/${t.id}/shopping/${newId()}`).set({...data,bought:false,createdAt:Date.now()}));
      else await W(()=>D(`trips/${t.id}/shopping/${item.id}`).update(data));
    }});
}
function expForm(t,item){
  const isNew=!item;const members=membersOf(t);
  item=item||{paidBy:S.uid,splitMode:'all'};
  const all=isNew||splitAll(item,members);
  const f=sheet({title:isNew?'記一筆支出':'編輯支出',body:`<div class="two">${fld('項目',inp('f-name',item.name,'例如：營地費'))}${fld('金額（元）',inp('f-amt',item.amount,'0','number','inputmode="numeric" min="0" step="1"'))}</div>
    ${fld('誰先付的',personSel('f-who',t,item.paidBy,'還沒決定'))}
    ${grp('怎麼分',chips('mode',['all','some'],[all?'all':'some'],true,'',['全部人均分','只有部分人'])+`<div id="split-box"${all?' hidden':''} style="margin-top:6px">${chips('split',members,all?members:(item.split||[]),false,'',members.map(k=>nameOf(k)+(k===S.uid?'（我）':'')))}</div>`,`<span id="split-hint">${all?'所有成員平分，之後新加入的人也會一起分。':'勾選要一起分這筆的人。'}</span>`)}`,
    danger:isNew?null:{label:'刪除',fn:()=>W(()=>D(`trips/${t.id}/expenses/${item.id}`).delete())},
    onSubmit:async f=>{
      const name=val(f,'f-name'),amount=Math.round(+val(f,'f-amt'));
      if(!name||!(amount>0)){toast('請填項目和金額');return false}
      let mode=readChips(f,'mode')[0]||'all',sp=[];
      if(mode==='some'){sp=readChips(f,'split');if(!sp.length){toast('至少要有一個人分攤');return false}if(members.every(m=>sp.includes(m)))mode='all'}
      const data={name,amount,paidBy:val(f,'f-who'),splitMode:mode,split:mode==='all'?[]:sp};
      if(isNew)await W(()=>D(`trips/${t.id}/expenses/${newId()}`).set({...data,createdAt:Date.now()}));
      else await W(()=>D(`trips/${t.id}/expenses/${item.id}`).update(data));
    }});
  f.addEventListener('click',e=>{if(!e.target.closest('[data-name="mode"]'))return;setTimeout(()=>{
    const c=e.target.closest('[data-chip]');if(!readChips(f,'mode').length&&c)c.setAttribute('aria-pressed','true');
    const some=readChips(f,'mode')[0]==='some';
    $('#split-box').hidden=!some;$('#split-hint').textContent=some?'勾選要一起分這筆的人。':'所有成員平分，之後新加入的人也會一起分。';
  },0)});
}
function planForm(t,item,date){
  const isNew=!item;item=item||{date:date||t.startDate||''};
  const days=tripDays(t);
  const dateField=days.length?`<select id="f-date" name="f-date">${days.map((d,i)=>`<option value="${d}"${d===item.date?' selected':''}>Day ${i+1} · ${fmtD(d)}</option>`).join('')}${item.date&&!days.includes(item.date)?`<option value="${esc(item.date)}" selected>${fmtD(item.date)}</option>`:''}</select>`:inp('f-date',item.date,'','date');
  sheet({title:isNew?'加到行程表':'編輯行程',body:`<div class="two">${fld('哪一天',dateField)}${fld('時間',inp('f-time',item.time,'','time'))}</div>
    ${fld('要做什麼',inp('f-title',item.title,'例如：抵達營地、搭帳'))}
    ${fld('備註',`<textarea id="f-note" style="min-height:80px" placeholder="集合地點、路線、要提醒大家的事">${esc(item.note)}</textarea>`)}`,
    danger:isNew?null:{label:'刪除',fn:()=>W(()=>D(`trips/${t.id}/schedule/${item.id}`).delete())},
    onSubmit:async f=>{
      const title=val(f,'f-title');if(!title){toast('請填要做什麼');return false}
      const data={date:val(f,'f-date'),time:val(f,'f-time'),title,note:val(f,'f-note')};
      if(isNew)await W(()=>D(`trips/${t.id}/schedule/${newId()}`).set({...data,createdAt:Date.now()}));
      else await W(()=>D(`trips/${t.id}/schedule/${item.id}`).update(data));
    }});
}
async function importItems(tripId,items,assignee){
  let n=0;
  for(const x of items){
    try{
      if(x.claimId)await W(()=>D(`trips/${tripId}/gear/${x.claimId}`).update({assignee}));
      else await W(()=>D(`trips/${tripId}/gear/${newId()}`).set({name:x.name,cat:x.cat||'其他',assignee:assignee||'',done:false,createdAt:Date.now()+n}));
    }catch(e){toast(`帶入到第 ${n+1} 項時中斷了，可以再按一次補齊`,5000);return}
    n++;if(items.length>8&&(n%8===0||n===items.length))toast(`帶入公用裝備 ${n}/${items.length}`,1500);
  }
}
function importKitForm(t){
  const kit=S.kit||[];
  if(!kit.length){toast('你的裝備清單是空的，先到「裝備」頁建立');location.hash='kit';return}
  const shared=S.sub.gear||[],mine=new Set(packOf(S.uid).map(x=>x.name));
  const byName={};shared.forEach(x=>{(byName[x.name]=byName[x.name]||[]).push(x)});
  const note=x=>{
    if(scopeOf(x)==='mine')return mine.has(x.name)?{on:false,txt:'已在行李'}:{on:true,txt:''};
    const ex=byName[x.name]||[];
    if(ex.some(e=>e.assignee===S.uid))return{on:false,txt:'已經是你帶'};
    const other=ex.find(e=>e.assignee);if(other)return{on:false,txt:`${nameOf(other.assignee)} 已經帶了`};
    const free=ex.find(e=>!e.assignee);if(free)return{on:true,txt:'清單上有，會改成你帶',claim:free.id};
    return{on:true,txt:''};
  };
  const section=(scope,title,hint)=>{
    const arr=kit.filter(x=>scopeOf(x)===scope);if(!arr.length)return'';
    const by={};arr.forEach(x=>{(by[x.cat||'其他']=by[x.cat||'其他']||[]).push(x)});
    const order=[...GEAR_CATS,...Object.keys(by).filter(c=>!GEAR_CATS.includes(c))].filter(c=>by[c]);
    return `<div class="pick-sec"><div class="pick-title"><b>${title}</b><span>${hint}</span></div><div class="pick-list">${order.map(c=>`<div class="cat">${esc(c)}</div>${by[c].map(x=>{const n=note(x);return `<label class="check-row"><input type="checkbox" value="${esc(x.id)}"${n.on?' checked':''}><span>${esc(x.name)}${n.txt?` <span class="fld-h">（${esc(n.txt)}）</span>`:''}</span></label>`}).join('')}`).join('')}</div></div>`;
  };
  sheet({title:'帶入我的裝備',submit:'帶入勾選的項目',body:`<p class="fld-h" style="margin:0">勾選這次要帶的東西。公用的會加進公用裝備並算你帶，個人的會放進你的行李。</p>
    ${section('shared','放進公用裝備','我帶給大家用')}${section('mine','放進我的行李','自己用的')}`,
    onSubmit:async f=>{
      const ids=new Set([...f.querySelectorAll('.pick-list input:checked')].map(i=>i.value));
      const pick=kit.filter(x=>ids.has(x.id));if(!pick.length){toast('沒有勾選任何項目');return false}
      const sh=pick.filter(x=>scopeOf(x)==='shared').map(x=>({...x,claimId:note(x).claim}));
      const me=pick.filter(x=>scopeOf(x)==='mine'&&!mine.has(x.name));
      if(me.length)await savePack(t,[...packOf(S.uid),...me.map((x,i)=>({id:newId()+i,name:x.name,cat:x.cat||'其他',done:false,createdAt:Date.now()+i}))]);
      if(sh.length)importItems(t.id,sh,S.uid);
      toast(`已帶入：公用 ${sh.length} 項、行李 ${me.length} 項`);
    }});
}
function kitForm(){
  sheet({title:'新增常用裝備',body:`${fld('裝備名稱',inp('f-name','','例如：天幕'))}${fld('分類',sel('f-cat',GEAR_CATS,'其他'))}
    ${grp('這通常是',chips('scope',['shared','mine'],['shared'],true,'',['公用（一團帶一份）','個人（自己用）']))}`,
    onSubmit:async f=>{const name=val(f,'f-name');if(!name){toast('請填裝備名稱');return false}await saveKit([...(S.kit||[]),{id:newId(),name,cat:val(f,'f-cat'),scope:readChips(f,'scope')[0]||'shared'}]);toast('已加入')}});
}
function kitEdit(x){
  sheet({title:'編輯裝備',body:`${fld('裝備名稱',inp('f-name',x.name))}${fld('分類',sel('f-cat',GEAR_CATS,x.cat||'其他'))}
    ${grp('這通常是',chips('scope',['shared','mine'],[scopeOf(x)],true,'',['公用（一團帶一份）','個人（自己用）']))}`,
    danger:{label:'刪除',confirm:'再按一次確認刪除',fn:()=>saveKit((S.kit||[]).filter(i=>i.id!==x.id))},
    onSubmit:async f=>{const name=val(f,'f-name');if(!name){toast('請填裝備名稱');return false}
      await saveKit((S.kit||[]).map(i=>i.id===x.id?{...i,name,cat:val(f,'f-cat'),scope:readChips(f,'scope')[0]||scopeOf(i)}:i))}});
}
function packEdit(t,x){
  sheet({title:'編輯行李',body:`${fld('東西',inp('f-name',x.name))}${fld('分類',sel('f-cat',GEAR_CATS,x.cat||'其他'))}
    ${moveBlock('移到公用裝備','大家都會用到的東西，移過去後會顯示由你負責帶。',x.name)}`,
    danger:{label:'刪除',confirm:'再按一次確認刪除',fn:()=>savePack(t,packOf(S.uid).filter(i=>i.id!==x.id))},
    onSubmit:async f=>{const name=val(f,'f-name');if(!name){toast('請填名稱');return false}
      await savePack(t,packOf(S.uid).map(i=>i.id===x.id?{...i,name,cat:val(f,'f-cat')}:i))}});
  bindMove(r=>packToShared(t,x,r));
}
/* ---------- import from the old localStorage app ---------- */
const LEGACY_SAMPLES=new Set(['1|星空森林營地','2|溪畔悠遊營地']);
function legacyCounty(o){
  const loc=String((o.location&&o.location.name)||'').replace(/臺/g,'台');
  const hit=COUNTIES.find(c=>loc.includes(c));if(hit)return hit;
  const city=String((o.location&&o.location.city)||'').replace(/臺/g,'台').replace(/[縣市]$/,'');
  if(!city||city==='台灣')return'';
  const opts=COUNTIES.filter(c=>c.startsWith(city));return opts.find(c=>c.endsWith('縣'))||opts[0]||'';
}
function importLegacySheet(){
  sheet({title:'從舊版匯入',submit:'下一步',body:`<p class="fld-h" style="margin:0;font-size:13px;line-height:1.7">在舊版「露營日誌」按右上角的<b>匯出資料</b>，把存下來的檔案選進來，或把複製的內容貼上。</p>
    ${grp('選擇檔案',`<input type="file" id="lg-file" accept=".json,application/json,text/plain">`)}
    ${fld('或貼上內容',`<textarea id="lg-text" placeholder="貼上匯出的內容" style="min-height:90px"></textarea>`)}`,
    onSubmit:async f=>{
      let text=val(f,'lg-text');const file=$('#lg-file').files[0];
      if(file)text=await file.text();
      if(!text){toast('請選擇檔案或貼上內容');return false}
      let data;try{data=JSON.parse(text)}catch(e){toast('看不懂這個內容，請確認是舊版匯出的資料');return false}
      const trips=(Array.isArray(data)?data:(data&&data.trips)||[]).filter(o=>o&&o.name);
      if(!trips.length){toast('裡面沒有找到行程');return false}
      setTimeout(()=>legacyPick(trips),60);
    }});
}
function legacyPick(trips){
  const done=new Set(myTrips().filter(t=>t.legacyId).map(t=>t.legacyId));
  const rows=trips.map((o,i)=>{
    const sample=LEGACY_SAMPLES.has(o.id+'|'+o.name),dup=done.has(String(o.id));
    const ph=(o.photos||[]).filter(u=>String(u).startsWith('data:image')).length;
    const note=dup?'已經匯入過':sample?'舊版內建的範例':'';
    return `<label class="check-row lg-row"><input type="checkbox" value="${i}"${dup||sample?'':' checked'}><span><b>${esc(o.name)}</b><small>${esc(o.date||'沒有日期')}${ph?` · ${ph} 張照片`:''}${note?` · ${note}`:''}</small></span></label>`;
  }).join('');
  sheet({title:`找到 ${trips.length} 趟行程`,submit:'匯入勾選的行程',body:`
    <div class="pick-list">${rows}</div>
    <label class="check-row"><input type="checkbox" id="lg-lists"><span>也匯入裝備和購物清單<small class="fld-h" style="display:block">已經去過的行程通常用不到，不勾比較清爽</small></span></label>
    <p class="fld-h" style="margin:0">評分、心得、優缺點、照片、地點都會搬過來。費用會留在各行程的分帳裡，但<b>不會算進統計</b>。</p>`,
    onSubmit:async f=>{
      const pick=[...f.querySelectorAll('.pick-list input:checked')].map(i=>trips[+i.value]);
      if(!pick.length){toast('沒有勾選任何行程');return false}
      importLegacy(pick,$('#lg-lists').checked);
    }});
}
async function legacyPhoto(du){
  const img=new Image();img.src=du;try{await img.decode()}catch(e){return null}
  const draw=(max,q)=>{const s2=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s2);c.height=Math.round(img.naturalHeight*s2);c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c};
  if(S.assets){try{const b=await new Promise(r=>draw(1600,.85).toBlob(r,'image/jpeg',.85));const r=await S.assets.upload(b);return{url:r.url,assetId:r.id}}catch(e){console.warn(e)}}
  let url=du;if(url.length>180000)url=draw(720,.7).toDataURL('image/jpeg',.7);
  return{url,assetId:''};
}
async function importLegacy(list,withLists){
  const catOf=n=>(S.starter.find(x=>x.name===n)||{}).cat||'其他';
  let n=0,fail=0;
  for(const o of list){
    n++;toast(`匯入中 ${n}/${list.length}：${o.name}`,30000);
    try{
      const guests=new Set();
      const keyOf=nm=>{nm=String(nm||'').trim();if(!nm)return'';if(nm==='我'||nm===nameOf(S.uid))return S.uid;guests.add(nm);return'g:'+nm};
      const gear=withLists?(o.gearList||[]).map(g=>({name:g.name,cat:catOf(g.name),assignee:keyOf(g.assignee),done:!!g.isCompleted})):[];
      const shop=withLists?(o.shoppingList||[]).map(x=>({name:x.name,cat:SHOP_CATS.includes(x.category)?x.category:(x.category&&x.category!=='未分類'?x.category:'其他'),buyer:keyOf(x.buyer),bought:!!x.isPurchased,qty:''})):[];
      const county=legacyCounty(o);
      const id=newId(),date=/^\d{4}-\d{2}-\d{2}$/.test(o.date||'')?o.date:'';
      const trip={name:o.name,startDate:date,endDate:date,county,location:String((o.location&&o.location.name)||'').replace(county,'').replace('未知亮點','').trim(),
        pitchArea:o.pitchArea||'',guests:[...guests],code:newCode(),ownerId:S.uid,createdAt:Date.now(),updatedAt:Date.now(),
        rating:+o.rating||0,weather:o.weather||'',campType:o.campType||'',facilities:o.facilities||[],pros:o.pros||[],cons:(o.cons||[]).map(c=>c==='無!'?'沒有缺點':c),notes:o.notes||'',
        imported:true,legacyId:String(o.id||'')};
      await W(()=>D('trips/'+id).set(trip));
      await W(()=>D(`trips/${id}/members/${S.uid}`).set({joinedAt:Date.now(),role:'owner'}));
      let k=0;
      for(const e of (o.expenses||[]))if(+e.amount>0)await W(()=>D(`trips/${id}/expenses/${newId()}${k++}`).set({name:e.name||'費用',amount:Math.round(+e.amount),paidBy:'',split:[],legacy:true,createdAt:Date.now()+k}));
      let cover='';
      for(const du of (o.photos||[]).filter(u=>String(u).startsWith('data:image'))){
        const ph=await legacyPhoto(du);if(!ph)continue;
        await W(()=>D(`trips/${id}/photos/${newId()}${k++}`).set({...ph,by:S.uid,createdAt:Date.now()+k}));
        if(!cover){cover=ph.url;await W(()=>D('trips/'+id).update({cover}))}
      }
      for(const g of gear)await W(()=>D(`trips/${id}/gear/${newId()}${k++}`).set({...g,createdAt:Date.now()+k}));
      for(const x of shop)await W(()=>D(`trips/${id}/shopping/${newId()}${k++}`).set({...x,createdAt:Date.now()+k}));
      await setMyIds([...new Set([...(S.myIds||[]),id])]);
    }catch(e){console.warn(e);fail++}
  }
  S.stats=null;
  toast(fail?`匯入完成，有 ${fail} 趟沒有成功，可以再匯入一次`:`匯入完成，共 ${list.length} 趟行程`,5000);
}
async function saveKit(items){S.kit=items;render();await W(()=>myKitRef().set({items,updatedAt:Date.now()}))}
function photoView(t,p){
  sheet({title:'照片',cancel:'關閉',body:`<img class="big-photo" src="${esc(p.url)}" alt="">${p.by?`<p class="fld-h" style="margin:0">${esc(nameOf(p.by))} 上傳</p>`:''}`,
    danger:canT(t)?{label:'刪除照片',fn:async()=>{
      await W(()=>D(`trips/${t.id}/photos/${p.id}`).delete());
      if(p.assetId&&S.assets){try{await S.assets.delete(p.assetId)}catch(e){}}
      if(t.cover===p.url){const next=(S.sub.photos||[]).find(x=>x.id!==p.id);await W(()=>D('trips/'+t.id).update({cover:next?next.url:''}))}
    }}:null});
}

/* ---------- photos ---------- */
function loadImg(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file);const i=new Image();i.onload=()=>{res(i);setTimeout(()=>URL.revokeObjectURL(u),1000)};i.onerror=rej;i.src=u})}
async function compress(file,max,q){const img=await loadImg(file);let w=img.naturalWidth,h=img.naturalHeight;const s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return new Promise(r=>c.toBlob(r,'image/jpeg',q))}
const toDataURL=b=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(b)});
async function addPhotos(files){
  const t=curTrip();if(!t||!files.length)return;
  let cover=t.cover,n=0;
  for(const file of files){
    toast(`上傳照片 ${n+1}/${files.length}…`,10000);
    try{
      let url='',assetId='';
      if(S.assets){try{const r=await S.assets.upload(await compress(file,1600,.82));url=r.url;assetId=r.id}catch(e){console.warn(e)}}
      if(!url){url=await toDataURL(await compress(file,720,.7));if(url.length>180000)url=await toDataURL(await compress(file,520,.6))}
      await W(()=>D(`trips/${t.id}/photos/${newId()}`).set({url,assetId,by:S.uid,createdAt:Date.now()}));
      if(!cover){cover=url;await W(()=>D('trips/'+t.id).update({cover:url}))}
      n++;
    }catch(e){console.warn(e)}
  }
  toast(n?`已加入 ${n} 張照片`:'照片沒有上傳成功');
}
$('#photo-input').addEventListener('change',e=>{const fs=[...e.target.files];e.target.value='';addPhotos(fs)});

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const chip=e.target.closest('[data-chip]');
  if(chip){const g=chip.parentElement;if(g.hasAttribute('data-single')){const was=chip.getAttribute('aria-pressed')==='true';if(was&&g.hasAttribute('data-keep'))return;g.querySelectorAll('[data-chip]').forEach(c=>c.setAttribute('aria-pressed','false'));chip.setAttribute('aria-pressed',String(!was))}else chip.setAttribute('aria-pressed',String(chip.getAttribute('aria-pressed')!=='true'));return}
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,t=curTrip(),id=el.dataset.id;
  const need=()=>{if(!can()){toast(S.uid?'目前只能看，不能修改':'請先登入 Claude');return false}return true};
  const needT=()=>need()&&t&&(isMember(t)||(toast('先加入這個行程才能編輯'),false));
  switch(a){
    case'new-trip':if(need())tripForm();break;
    case'join':if(need())joinSheet();break;
    case'join-this':if(need()&&t)joinTrip(t);break;
    case'invite':if(t)inviteSheet(t);break;
    case'edit-trip':if(needT())tripForm(t);break;
    case'guests':if(needT())guestsForm(t);break;
    case'tab':S.tab=el.dataset.tab;render();break;
    case'filter':if(el.dataset.kind==='gear')S.gearFilter=el.dataset.v;else S.shopFilter=el.dataset.v;render();break;
    case'toggle':{if(!needT())break;const col=el.dataset.col,f=el.dataset.f;const it=(S.sub[col]||[]).find(x=>x.id===id);if(!it)break;
      const on=!it[f];it[f]=on;it.doneBy=on?S.uid:'';render();
      W(()=>D(`trips/${t.id}/${col}/${id}`).update({[f]:on,doneBy:on?S.uid:''})).catch(()=>{it[f]=!on;render()});break}
    case'gear-form':if(needT())gearForm(t,id&&(S.sub.gear||[]).find(x=>x.id===id));break;
    case'reassign':{if(!needT())break;const it=(S.sub[el.dataset.col]||[]).find(x=>x.id===id);if(it)reassignSheet(t,el.dataset.col,el.dataset.f,it);break}
    case'menu-edit':if(needT())menuEditor(t);break;
    case'meal-form':if(needT())mealForm(t,id&&(S.sub.meals||[]).find(x=>x.id===id),el.dataset.date);break;
    case'shop-form':if(needT())shopForm(t,id&&(S.sub.shopping||[]).find(x=>x.id===id));break;
    case'exp-form':if(needT())expForm(t,id&&(S.sub.expenses||[]).find(x=>x.id===id));break;
    case'plan-form':if(needT())planForm(t,id&&(S.sub.schedule||[]).find(x=>x.id===id),el.dataset.date);break;
    case'import-kit':if(needT())importKitForm(t);break;
    case'review':if(needT())reviewForm(t);break;
    case'photo':{const p=(S.sub.photos||[]).find(x=>x.id===id);if(p&&t)photoView(t,p);break}
    case'kit-form':if(need())kitForm();break;
    case'kit-starter':if(need())saveKit(S.starter.map(x=>({...x,id:newId()+x.id,scope:scopeOf(x)}))).then(()=>toast('裝備清單建立好了'));break;
    case'kit-scope':if(need())saveKit((S.kit||[]).map(x=>x.id===id?{...x,scope:scopeOf(x)==='shared'?'mine':'shared'}:x));break;
    case'gear-view':S.gearView=el.dataset.v;render();break;
    case'claim':if(needT())W(()=>D(`trips/${t.id}/gear/${id}`).update({assignee:S.uid})).then(()=>toast('已認領，算你帶'));break;
    case'pack-form':if(needT())packForm(t);break;
    case'pack-toggle':if(needT())savePack(t,packOf(S.uid).map(x=>x.id===id?{...x,done:!x.done}:x));break;
    case'pack-edit':{if(!needT())break;const x=packOf(S.uid).find(i=>i.id===id);if(x)packEdit(t,x);break}
    case'kit-edit':{if(!need())break;const x=(S.kit||[]).find(i=>i.id===id);if(x)kitEdit(x);break}
    case'login':signInGoogle().catch(err=>{if(err&&err.code!=='auth/popup-closed-by-user'&&err.code!=='auth/cancelled-popup-request')toast('登入沒有成功（'+((err&&err.code)||'unknown')+'），請再試一次',8000)});break;
    case'account':accountSheet();break;
    case'legacy-import':if(need())importLegacySheet();break;
    case'swipe-del':if(need())swipeDelete(el.dataset.kind,id);break;
    case'kit-del':if(need())saveKit((S.kit||[]).filter(x=>x.id!==id));break;
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});

/* ---------- platform: Google sign-in + Firestore (GitHub Pages build) ---------- */
// Starter list offered the first time someone opens「我的裝備」.
const STARTER_KIT={
  '帳篷寢具':'帳篷 地墊 營柱 營釘 睡袋 床墊 枕頭 毯子 打氣機 小地墊 野餐墊',
  '營具家具':'繩子 鉤子 晾衣繩 衣架 夾子 沙發 露營桌(IGT) 露營椅 小桌子 鐵架 水桶架子 新架子 THOR垃圾桶 大蝸牛 垃圾袋 黑色垃圾袋 露營小旗子',
  '廚房':'碗 水杯 餐具 餐盤 鍋子 煮飯工具組 卡式爐 瓦斯罐 防風片 電鍋 調味料 咖啡包 茶包 桶水 瑞士刀 晾碗架 保鮮膜 餐巾紙 打火機',
  '照明電器':'氣氛燈 卡式燈 插電燈 白色立燈 延長線 行動電源 喇叭 相機 平板 Switch',
  '個人用品':'衣服 褲子 睡衣 拖鞋 毛巾 衛生紙 乾洗髮 洗髮精 沐浴乳 防蚊液 蚊香 防曬',
};
const GOOGLE_G='<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
ICONS.users=ICONS.users||'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>';
ICONS.wallet=ICONS.wallet||'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>';

function vSetup(){
  return `<section class="login"><div class="logo">${ico('tent')}</div><h1>還差一步</h1><p>還沒有填 Firebase 設定。請打開 <b>public/firebase-config.js</b>，貼上 Firebase 主控台裡的設定值。</p></section>`;
}
function vLogin(){
  return `<section class="login">
    <div class="logo">${ico('tent')}</div>
    <div><div class="eyebrow">Camping Log</div><h1>露營日誌</h1></div>
    <p>和朋友一起規劃下一趟露營，也收好每一趟的回憶。</p>
    <button class="gbtn" data-act="login">${GOOGLE_G}用 Google 登入</button>
    <div class="feats">
      <div><span>${ico('users')}</span>建立行程，傳房間碼給朋友加入</div>
      <div><span>${ico('pack')}</span>公用裝備誰帶、自己的行李打包，一目了然</div>
      <div><span>${ico('wallet')}</span>記帳自動分攤，算好誰該轉給誰</div>
    </div>
    ${S.pendingJoin?`<p style="font-size:13px;color:var(--moss-d)">登入後就會加入朋友邀請你的行程。</p>`:''}
  </section>`;
}
function accountSheet(){
  const p=S.names[S.uid]||{};
  sheet({title:'帳號',cancel:'關閉',body:`<div class="share-box">${av(S.uid).replace('class="av"','class="av" style="width:64px;height:64px;font-size:24px"')}<span style="font-size:18px;font-weight:800">${esc(p.name||'')}</span><span class="fld-h">${esc(S.email||'')}</span></div>
    <button type="button" class="btn ghost" id="logout" style="width:100%">登出</button>`});
  $('#logout').addEventListener('click',async()=>{closeModal();await logOut();location.hash=''});
}

// Trips the signed-in person belongs to: one live document per id in their private index.
const tripSubs={},seenTrips=new Set();
let userUnsubs=[];
function afterTrips(){
  S.tripsLoaded=(S.myIds||[]).every(i=>seenTrips.has(i));
  if(S.tripsLoaded){syncCounts();tryPendingJoin();if(S.route.view==='stats'&&!S.stats)loadStats()}
  render();
}
function syncTripDocs(){
  const ids=S.myIds||[];
  for(const id of Object.keys(tripSubs))if(!ids.includes(id)){tripSubs[id]();delete tripSubs[id];seenTrips.delete(id);S.allTrips=S.allTrips.filter(t=>t.id!==id)}
  for(const id of ids)if(!tripSubs[id]){
    tripSubs[id]=S.db.doc('trips/'+id).onSnapshot(s=>{
      S.allTrips=S.allTrips.filter(t=>t.id!==id);
      const d=s.exists&&s.data();if(d&&d.name)S.allTrips.push({id,...d});
      seenTrips.add(id);afterTrips();
    },()=>{S.allTrips=S.allTrips.filter(t=>t.id!==id);seenTrips.add(id);afterTrips()});
  }
  afterTrips();
}
function resetUser(){
  userUnsubs.forEach(f=>{try{f()}catch(e){}});userUnsubs=[];
  Object.keys(tripSubs).forEach(id=>{tripSubs[id]();delete tripSubs[id]});seenTrips.clear();
  Object.values(S.countSubs).forEach(a=>a.forEach(u=>u()));S.countSubs={};S.counts={};
  unsubTrip();
  Object.assign(S,{allTrips:[],tripsLoaded:false,myIds:null,kit:null,stats:null,tripMembers:{}});
}

S.starter=Object.entries(STARTER_KIT).flatMap(([cat,s])=>s.split(' ').map(name=>({name:name.replace('(IGT)',' (IGT)'),cat}))).map((x,i)=>({...x,id:'k'+i}));
S.assets=null;S.offline=false;
S.route=parseRoute();
if(S.route.view==='join'){S.pendingJoin=S.route.code;try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}S.route={view:'home'}}
render();
window.addEventListener('online',render);window.addEventListener('offline',render);
watchAuth(u=>{
  S.authReady=true;resetUser();
  if(!u){S.uid=null;S.db=null;render();return}
  S.uid=u.uid;S.email=u.email||'';S.db=FDB;S.connecting=false;S.canWrite=true;
  S.names[u.uid]={name:u.displayName||'',avatarUrl:u.photoURL||''};
  // public profile, so trip-mates see your name and photo
  FDB.doc('users/'+u.uid).set({name:u.displayName||'',photo:u.photoURL||'',updatedAt:Date.now()},{merge:true}).catch(e=>console.warn(e));
  userUnsubs.push(myIndexRef().onSnapshot(s=>{S.myIds=s.exists?(s.data().ids||[]):[];syncTripDocs()},()=>{S.myIds=[];syncTripDocs()}));
  userUnsubs.push(myKitRef().onSnapshot(s=>{S.kit=s.exists?(s.data().items||[]):false;render()},()=>{S.kit=false;render()}));
  if(S.route.view==='trip')subTrip(S.route.id);
  render();
});

if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{})})}
