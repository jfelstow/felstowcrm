/* Felstow CRM — front-end logic (vanilla JS + Supabase) */

const STAGES = ['Lead','Contacted','Discovery Call','Proposal Sent','Signed','Onboarding','Active Client','Lost','Dormant'];
const TYPES  = ['Bookkeeping','Bookkeeping & Cash-flow','Consulting','Cash-flow','Cleanup','Brand Sourcing'];
const SOURCES= ['Referral','Website','Network','Cold outreach'];
const PRICING= ['Retainer','Hourly','Project'];
const PROB   = ['Hot','Warm','Cold'];
const ACT_TYPES = ['Call','Email','Meeting','Note','Task'];

// Stage → status auto-derivation
function statusForStage(stage){
  if (['Signed','Onboarding','Active Client'].includes(stage)) return 'Active';
  if (stage === 'Lost') return 'Lost';
  if (stage === 'Dormant') return 'Dormant';
  return 'Prospect';
}

const $  = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const money = n => '$' + (Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0});
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0,10);

let sb, me = {id:null,role:'contractor',name:''};
let clients = [];          // accessible clients
let view = 'pipeline';
let openId = null;

// ── Boot ──────────────────────────────────────────────
function boot(){
  if (!window.SUPABASE_URL || window.SUPABASE_URL.includes('YOUR-PROJECT')){
    $('#loginErr').textContent = 'config.js is not set up yet — add your Supabase URL and anon key.';
    return;
  }
  sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  sb.auth.getSession().then(({data})=> data.session ? onSignedIn() : showLogin());
  wireStatic();
}

function showLogin(){ $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }

async function onSignedIn(){
  const { data:{ user } } = await sb.auth.getUser();
  const { data:prof } = await sb.from('profiles').select('full_name,role').eq('id',user.id).single();
  me = { id:user.id, role: prof?.role||'contractor', name: prof?.full_name || user.email };
  $('#whoami').textContent = `${me.name}${me.role==='owner'?' · owner':''}`;
  $('#addClient').classList.toggle('hidden', me.role!=='owner');
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  // populate stage filter
  const fs = $('#fStage'); fs.innerHTML = '<option value="">All stages</option>' + STAGES.map(s=>`<option>${s}</option>`).join('');
  await loadClients();
}

// ── Data ──────────────────────────────────────────────
async function loadClients(){
  const { data, error } = await sb.from('clients').select('*').order('created_at',{ascending:false});
  if (error){ alert(error.message); return; }
  clients = data || [];
  render();
}

// ── Render ────────────────────────────────────────────
function render(){ renderCards(); view==='pipeline' ? renderPipeline() : renderFollowups(); }

function renderCards(){
  const mrr  = clients.filter(c=>c.status==='Active').reduce((a,c)=>a+(+c.monthly_value||0),0);
  const pipe = clients.filter(c=>c.status==='Prospect').reduce((a,c)=>a+(+c.monthly_value||0),0);
  const prosp= clients.filter(c=>c.status==='Prospect').length;
  $('#mMrr').textContent  = money(mrr);
  $('#mPipe').textContent = money(pipe);
  $('#mProsp').textContent= prosp;
  $('#mFu').textContent   = fuCount;   // set during follow-up load
}

function statusBadge(s){
  const k = ({Prospect:'b-prospect',Active:'b-active',Lost:'b-lost',Dormant:'b-dormant'})[s]||'b-prospect';
  return `<span class="badge ${k}">${s}</span>`;
}
function probDot(p){ const k=({Hot:'hot',Warm:'warm',Cold:'cold'})[p]; return k?`<span class="dot ${k}"></span>`:''; }

function filtered(){
  const fs=$('#fStage').value, fst=$('#fStatus').value;
  return clients.filter(c=>(!fs||c.stage===fs)&&(!fst||c.status===fst));
}

function renderPipeline(){
  const rows = filtered();
  const el = $('#pipelineView');
  if (!rows.length){ el.innerHTML = `<div class="empty">No clients yet.${me.role==='owner'?' Click “+ Add client” to start.':''}</div>`; return; }
  el.innerHTML = `<table><thead><tr>
      <th>Client</th><th class="hide-sm">Type</th><th>Stage</th>
      <th>Status</th><th class="hide-sm">$/mo</th>
    </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
  $$('#pipelineView tbody tr').forEach(tr=>tr.onclick=e=>{
    if (e.target.tagName==='SELECT') return;
    openDrawer(tr.dataset.id);
  });
  $$('#pipelineView select.stageSel').forEach(sel=>sel.onchange=()=>changeStage(sel.dataset.id, sel.value));
}
function rowHtml(c){
  return `<tr data-id="${c.id}">
    <td><div class="name-cell">${probDot(c.probability)}${esc(c.name)}</div>
        <div class="sub">${esc(c.primary_contact||'')}</div></td>
    <td class="hide-sm sub">${esc(c.type||'')}</td>
    <td><select class="stageSel" data-id="${c.id}">${STAGES.map(s=>`<option ${s===c.stage?'selected':''}>${s}</option>`).join('')}</select></td>
    <td>${statusBadge(c.status)}</td>
    <td class="hide-sm">${c.monthly_value?money(c.monthly_value):'—'}</td>
  </tr>`;
}

async function changeStage(id, stage){
  const status = statusForStage(stage);
  const { error } = await sb.from('clients').update({stage,status}).eq('id',id);
  if (error){ alert(error.message); return; }
  const c = clients.find(x=>x.id===id); if(c){ c.stage=stage; c.status=status; }
  render();
}

// ── Follow-ups ────────────────────────────────────────
let fuCount = 0;
async function renderFollowups(){
  const ids = clients.map(c=>c.id);
  const el = $('#followupsView');
  if (!ids.length){ el.innerHTML = `<div class="empty">No follow-ups.</div>`; fuCount=0; renderCards(); return; }
  const { data, error } = await sb.from('activities')
    .select('*').in('client_id',ids).eq('done',false).not('follow_up_date','is',null)
    .order('follow_up_date',{ascending:true});
  if (error){ alert(error.message); return; }
  const t = today();
  fuCount = (data||[]).filter(a=>a.follow_up_date<=t).length;
  renderCards();
  if (!data.length){ el.innerHTML = `<div class="empty">Nothing scheduled. Add a “next step + follow-up date” on a client.</div>`; return; }
  const byId = Object.fromEntries(clients.map(c=>[c.id,c]));
  el.innerHTML = data.map(a=>{
    const c = byId[a.client_id]||{}; const due = a.follow_up_date<=t;
    return `<div class="fu" data-id="${a.client_id}">
      <div class="when ${due?'due':''}">${a.follow_up_date}</div>
      <div class="meta"><b>${esc(c.name||'')}</b> — ${esc(a.next_step||a.note||'')}
        <span class="sub">· ${esc(a.type)}</span></div>
      <button class="btn ghost sm" data-done="${a.id}">Done</button>
    </div>`;
  }).join('');
  $$('#followupsView .fu .meta').forEach(m=>m.onclick=()=>openDrawer(m.parentElement.dataset.id));
  $$('#followupsView [data-done]').forEach(b=>b.onclick=async()=>{
    await sb.from('activities').update({done:true}).eq('id',b.dataset.done);
    renderFollowups();
  });
}

// ── Drawer / detail ───────────────────────────────────
function openDrawer(id){ openId=id; $('#scrim').classList.remove('hidden'); $('#drawer').classList.remove('hidden'); drawClient(); }
function closeDrawer(){ openId=null; $('#scrim').classList.add('hidden'); $('#drawer').classList.add('hidden'); }

function fieldSel(label,key,opts,val,blank=true){
  return `<div class="fld"><label>${label}</label><select data-k="${key}">
    ${blank?'<option value=""></option>':''}${opts.map(o=>`<option ${o===val?'selected':''}>${o}</option>`).join('')}
  </select></div>`;
}
function fieldTxt(label,key,val,type='text'){
  return `<div class="fld"><label>${label}</label><input type="${type}" data-k="${key}" value="${esc(val)}"></div>`;
}

async function drawClient(){
  const c = clients.find(x=>x.id===openId) || {};
  $('#dTitle').textContent = c.name || 'New client';
  const canEdit = me.role==='owner' || true; // contractors with access can edit; DB enforces real rule
  $('#dBody').innerHTML = `
    ${fieldTxt('Business name','name',c.name)}
    <div class="grid2">
      ${fieldTxt('Primary contact','primary_contact',c.primary_contact)}
      ${fieldTxt('Email','email',c.email,'email')}
      ${fieldTxt('Phone','phone',c.phone)}
      ${fieldSel('Type','type',TYPES,c.type)}
      ${fieldSel('Source','source',SOURCES,c.source)}
      ${fieldSel('Stage','stage',STAGES,c.stage||'Lead',false)}
      ${fieldSel('Pricing','pricing_model',PRICING,c.pricing_model)}
      ${fieldTxt('Value / mo','monthly_value',c.monthly_value||'','number')}
      ${fieldSel('Probability','probability',PROB,c.probability)}
      ${fieldTxt('Expected start','expected_start',c.expected_start||'','date')}
    </div>
    <div class="fld"><label>Notes</label><textarea data-k="notes">${esc(c.notes)}</textarea></div>
    <div class="row-btns">
      <button class="btn" id="saveClient">Save</button>
      ${openId && me.role==='owner' ? '<button class="btn ghost" id="delClient">Delete</button>' : ''}
    </div>
    <div class="sec-h">Activity</div>
    <div id="actList"><div class="sub">Loading…</div></div>
    <div class="sec-h">Log activity</div>
    ${fieldSel('Type','a_type',ACT_TYPES,'Note',false)}
    ${fieldTxt('Date','a_date',today(),'date')}
    <div class="fld"><label>Note</label><textarea data-k="a_note" placeholder="What happened…"></textarea></div>
    <div class="grid2">
      <div class="fld"><label>Next step</label><input data-k="a_next"></div>
      ${fieldTxt('Follow-up date','a_follow','','date')}
    </div>
    <button class="btn amber" id="addAct">Add activity</button>
  `;
  $('#saveClient').onclick = saveClient;
  const del = $('#delClient'); if (del) del.onclick = deleteClient;
  $('#addAct').onclick = addActivity;
  if (openId) loadActs();
}

function readFields(){
  const o={};
  $$('#dBody [data-k]').forEach(f=>{ if(!f.dataset.k.startsWith('a_')) o[f.dataset.k]=f.value; });
  o.monthly_value = parseFloat(o.monthly_value)||0;
  if(!o.expected_start) o.expected_start=null;
  o.status = statusForStage(o.stage);
  return o;
}

async function saveClient(){
  const o = readFields();
  if (!o.name){ alert('Business name is required.'); return; }
  let res;
  if (openId){ res = await sb.from('clients').update(o).eq('id',openId).select().single(); }
  else { o.created_by=me.id; res = await sb.from('clients').insert(o).select().single(); }
  if (res.error){ alert(res.error.message); return; }
  openId = res.data.id;
  await loadClients();
  drawClient();
}

async function deleteClient(){
  if (!confirm('Delete this client and all its activity?')) return;
  const { error } = await sb.from('clients').delete().eq('id',openId);
  if (error){ alert(error.message); return; }
  closeDrawer(); await loadClients();
}

async function loadActs(){
  const { data, error } = await sb.from('activities').select('*')
    .eq('client_id',openId).order('activity_date',{ascending:false});
  const el = $('#actList');
  if (error){ el.innerHTML=`<div class="sub">${esc(error.message)}</div>`; return; }
  if (!data.length){ el.innerHTML='<div class="sub">No activity yet.</div>'; return; }
  el.innerHTML = data.map(a=>`<div class="act">
    <div class="top"><span>${esc(a.type)} · ${a.activity_date}</span>
      <button class="x" data-del="${a.id}" title="Delete">&times;</button></div>
    <div>${esc(a.note||'')}</div>
    ${a.next_step?`<div class="nx">→ ${esc(a.next_step)}${a.follow_up_date?` (by ${a.follow_up_date})`:''}</div>`:''}
  </div>`).join('');
  $$('#actList [data-del]').forEach(b=>b.onclick=async()=>{
    await sb.from('activities').delete().eq('id',b.dataset.del); loadActs(); render();
  });
}

async function addActivity(){
  if (!openId){ alert('Save the client first.'); return; }
  const g = k => $(`#dBody [data-k="${k}"]`).value;
  const row = {
    client_id:openId, type:g('a_type'), activity_date:g('a_date')||today(),
    note:g('a_note'), next_step:g('a_next'),
    follow_up_date:g('a_follow')||null, created_by:me.id
  };
  if (!row.note && !row.next_step){ alert('Add a note or a next step.'); return; }
  const { error } = await sb.from('activities').insert(row);
  if (error){ alert(error.message); return; }
  ['a_note','a_next','a_follow'].forEach(k=>$(`#dBody [data-k="${k}"]`).value='');
  loadActs(); if(view==='followups') renderFollowups();
}

// ── Static wiring ─────────────────────────────────────
function wireStatic(){
  $('#loginForm').onsubmit = async e=>{
    e.preventDefault(); $('#loginErr').textContent='';
    const { error } = await sb.auth.signInWithPassword({ email:$('#email').value, password:$('#password').value });
    if (error){ $('#loginErr').textContent = error.message; return; }
    onSignedIn();
  };
  $('#signout').onclick = async()=>{ await sb.auth.signOut(); location.reload(); };
  $('#dClose').onclick = closeDrawer;
  $('#scrim').onclick = closeDrawer;
  $('#addClient').onclick = ()=>{ openId=null; $('#scrim').classList.remove('hidden'); $('#drawer').classList.remove('hidden'); drawClient(); };
  $('#fStage').onchange = render;
  $('#fStatus').onchange = render;
  $$('.tabs button').forEach(b=>b.onclick=()=>{
    view=b.dataset.view;
    $$('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
    $('#pipelineView').classList.toggle('hidden',view!=='pipeline');
    $('#followupsView').classList.toggle('hidden',view!=='followups');
    render();
  });
}

boot();
