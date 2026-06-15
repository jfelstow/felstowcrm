/* Felstow CRM — front-end logic (vanilla JS + Supabase) */

const STAGES = ['Lead','Contacted','Discovery Call','Proposal Sent','Signed','Onboarding','Active Client','Lost','Dormant'];
const TYPES  = ['Bookkeeping','Bookkeeping & Cash-flow','Consulting','Cash-flow','Cleanup','Brand Sourcing'];
const SOURCES= ['Referral','Website','Network','Cold outreach'];
const PRICING= ['Retainer','Hourly','Project'];
const PROB   = ['Hot','Warm','Cold'];
const ACT_TYPES = ['Call','Email','Meeting','Note','Task'];

// ── Onboarding form (mirrors felstowbookkeeping.com/onboarding.html) ──
const ENTITY_TYPES   = ['Sole Proprietorship','Single-Member LLC','Multi-Member LLC','LLC taxed as S-Corp','S-Corporation','C-Corporation','Partnership','Nonprofit','Not sure'];
const FISCAL_YEARS   = ['Calendar year (Jan–Dec)','Other / not sure'];
const CONTACT_PREFS  = ['Email','Text','Phone call','No preference'];
const PAYROLL_FREQS  = ['Weekly','Bi-weekly','Semi-monthly','Monthly','Other'];
const PLATFORMS      = ['Stripe','Square','PayPal','Venmo','Cash App','Zelle','Shopify Payments','Apple Pay / Google Pay','ACH (direct bank)','Checks','Cash','Other merchant processor'];
const HAS_QBO_OPTS   = ['No / not sure','Yes — I have a subscription','Yes — but it’s been unused','I have QuickBooks Desktop (not Online)'];
const ACCESS_NEEDED  = ['QuickBooks Online','Business bank(s)','Business credit card(s)','Payroll provider','PayPal / Venmo','Stripe / Square / Shopify','Bill.com / AP tool','Receipt app (Dext/Hubdoc/etc.)'];
const CRED_METHODS   = ['Bitwarden Send','1Password Share','Phone call','In person','Not sure'];
const BOOKS_STATUS   = ['Up to date — closed through last month','1–3 months behind','3–12 months behind','More than a year behind','Never been set up','Not sure'];
const SALES_TAX_OPTS = ['No','Yes — one state','Yes — multiple states','Not sure / probably should be'];

// Each field: [key, label, type?, opts?, placeholder?]   (type defaults to 'text')
const ONBOARDING_SECTIONS = [
  { title:'01 · Business basics', fields:[
    ['legal_name','Legal business name'],
    ['dba','DBA / "doing business as" (if different)'],
    ['entity_type','Business type','select',ENTITY_TYPES],
    ['ein','EIN','text',null,'XX-XXXXXXX'],
    ['state_formed','State of formation'],
    ['date_started','Date business started','date'],
    ['fiscal_year','Fiscal year','select',FISCAL_YEARS],
    ['biz_address','Business address','textarea'],
    ['industry','Industry / what the business does','textarea'],
  ]},
  { title:'02 · Ownership & primary contact', fields:[
    ['owners','Owner(s) and ownership %','textarea'],
    ['contact_name','Primary contact name'],
    ['contact_role','Their role'],
    ['contact_email','Email','email'],
    ['contact_phone','Phone'],
    ['contact_pref','Best way to reach you','select',CONTACT_PREFS],
  ]},
  { title:'03 · People & payroll', fields:[
    ['num_employees','# of W-2 employees','number'],
    ['num_contractors','# of 1099 contractors','number'],
    ['payroll_provider','Payroll provider (if any)'],
    ['payroll_frequency','Payroll frequency','select',PAYROLL_FREQS],
    ['owner_pay','How do owners take money out?','textarea'],
  ]},
  { title:'04 · Bank accounts & credit cards', fields:[
    ['bank_accounts','Active business bank accounts','textarea'],
    ['credit_cards','Active business credit cards','textarea'],
    ['personal_mixing','Personal accounts used for business expenses?','textarea'],
  ]},
  { title:'05 · Loans & financing', fields:[
    ['loans','Active loans & lines of credit','textarea'],
  ]},
  { title:'06 · Business assets', fields:[
    ['vehicles','Business vehicles','textarea'],
    ['other_assets','Other major assets (last ~3 years)','textarea'],
  ]},
  { title:'07 · Payment platforms', fields:[
    ['platforms','Platforms used (check all)','checks',PLATFORMS],
    ['venmo_paypal_type','If Venmo/PayPal for business — personal or business account?'],
  ]},
  { title:'08 · Software & tools', fields:[
    ['has_qbo','Do you already have QuickBooks Online?','select',HAS_QBO_OPTS],
    ['qbo_subscription','QBO subscription level (if known)'],
    ['other_tools','Other tools you use','textarea'],
    ['receipts_handling','How do you currently handle receipts?','textarea'],
  ]},
  { title:'09 · Access & credentials', fields:[
    ['access_needed','Logins I’ll eventually need access to','checks',ACCESS_NEEDED],
    ['cred_method','Preferred way to share credentials','select',CRED_METHODS],
  ]},
  { title:'10 · Current state of the books', fields:[
    ['books_status','How current are your books?','select',BOOKS_STATUS],
    ['last_reconciled','Approximate last reconciled date'],
    ['last_tax_return','Most recent tax return filed (year)'],
    ['has_cpa','Do you have a CPA or tax preparer?'],
    ['previous_bookkeeper','Previous bookkeeper — what wasn’t working?','textarea'],
  ]},
  { title:'11 · Sales tax', fields:[
    ['sales_tax','Do you collect sales tax?','select',SALES_TAX_OPTS],
    ['sales_tax_detail','If yes — which states, and who files?','textarea'],
  ]},
  { title:'12 · Goals & anything else', fields:[
    ['top_goals','Top 2–3 things you want out of working together','textarea'],
    ['pain_points','What hurts the most right now?','textarea'],
    ['anything_else','Anything else I should know?','textarea'],
  ]},
];

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
  document.body.classList.toggle('is-contractor', me.role!=='owner');
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  // populate stage filter
  const fs = $('#fStage'); fs.innerHTML = '<option value="">All stages</option>' + STAGES.map(s=>`<option>${s}</option>`).join('');
  await loadClients();
}

// ── Data ──────────────────────────────────────────────
async function loadClients(){
  // Read through the view, which masks financial columns for non-owners.
  const { data, error } = await sb.from('clients_view').select('*').order('created_at',{ascending:false});
  if (error){ alert(error.message); return; }
  clients = data || [];
  render();
  refreshQuestionBadge();
}

// ── Render ────────────────────────────────────────────
function render(){
  renderCards();
  if (view==='pipeline')        renderPipeline();
  else if (view==='followups')  renderFollowups();
  else if (view==='questions')  renderQuestions();
  else if (view==='team')       renderTeam();
}

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
      <th>Status</th><th class="hide-sm money">$/mo</th>
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
    <td class="hide-sm money">${c.monthly_value?money(c.monthly_value):'—'}</td>
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
function openDrawer(id, tab){ openId=id; $('#scrim').classList.remove('hidden'); $('#drawer').classList.remove('hidden'); drawClient(); if (tab) switchTab(tab); }
function closeDrawer(){ openId=null; $('#scrim').classList.add('hidden'); $('#drawer').classList.add('hidden'); }

function fieldSel(label,key,opts,val,blank=true){
  return `<div class="fld"><label>${label}</label><select data-k="${key}">
    ${blank?'<option value=""></option>':''}${opts.map(o=>`<option ${o===val?'selected':''}>${o}</option>`).join('')}
  </select></div>`;
}
function fieldTxt(label,key,val,type='text'){
  return `<div class="fld"><label>${label}</label><input type="${type}" data-k="${key}" value="${esc(val)}"></div>`;
}

let onbCache = null;

async function drawClient(){
  const c = clients.find(x=>x.id===openId) || {};
  $('#dTitle').textContent = c.name || 'New client';
  onbCache = null;

  const pinned = openId ? `<div id="nextStepsBox" class="nextsteps"></div>` : '';
  const tabs = openId ? `
    <div class="dtabs">
      <button data-dt="details" class="on">Details</button>
      <button data-dt="onboarding">Onboarding</button>
      <button data-dt="activity">Activity</button>
      <button data-dt="qa">Q&amp;A</button>
    </div>` : '';

  $('#dBody').innerHTML = `${pinned}${tabs}
    <div id="dtDetails">${detailsTabHtml(c)}</div>
    <div id="dtOnboarding" class="hidden"></div>
    <div id="dtActivity" class="hidden"></div>
    <div id="dtQA" class="hidden"></div>`;

  $('#saveClient').onclick = saveClient;
  const del = $('#delClient'); if (del) del.onclick = deleteClient;
  $$('#dBody .dtabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.dt));
  if (openId) loadNextSteps();
}

function switchTab(t){
  $$('#dBody .dtabs button').forEach(b=>b.classList.toggle('on', b.dataset.dt===t));
  $('#dtDetails').classList.toggle('hidden', t!=='details');
  $('#dtOnboarding').classList.toggle('hidden', t!=='onboarding');
  $('#dtActivity').classList.toggle('hidden', t!=='activity');
  $('#dtQA').classList.toggle('hidden', t!=='qa');
  if (t==='onboarding' && !onbCache) loadOnboardingTab();
  if (t==='activity' && !$('#dtActivity').innerHTML.trim()) renderActivityTab();
  if (t==='qa' && !$('#dtQA').innerHTML.trim()) renderQATab();
}

function detailsTabHtml(c){
  return `
    ${fieldTxt('Business name','name',c.name)}
    <div class="grid2">
      ${fieldTxt('Primary contact','primary_contact',c.primary_contact)}
      ${fieldTxt('Email','email',c.email,'email')}
      ${fieldTxt('Phone','phone',c.phone)}
      ${fieldSel('Type','type',TYPES,c.type)}
      ${fieldSel('Source','source',SOURCES,c.source)}
      ${fieldSel('Stage','stage',STAGES,c.stage||'Lead',false)}
      ${me.role==='owner' ? fieldSel('Pricing','pricing_model',PRICING,c.pricing_model) : ''}
      ${me.role==='owner' ? fieldTxt('Value / mo','monthly_value',c.monthly_value||'','number') : ''}
      ${me.role==='owner' ? fieldSel('Probability','probability',PROB,c.probability) : ''}
      ${fieldTxt('Expected start','expected_start',c.expected_start||'','date')}
    </div>
    <div class="fld"><label>Notes</label><textarea data-k="notes">${esc(c.notes)}</textarea></div>
    <div class="row-btns">
      <button class="btn" id="saveClient">Save</button>
      ${openId && me.role==='owner' ? '<button class="btn ghost" id="delClient">Delete</button>' : ''}
    </div>`;
}

function renderActivityTab(){
  $('#dtActivity').innerHTML = `
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
    <button class="btn amber" id="addAct">Add activity</button>`;
  $('#addAct').onclick = addActivity;
  loadActs();
}

// ── Onboarding ───────────────────────────────────────
async function loadOnboardingTab(){
  $('#dtOnboarding').innerHTML = `<div class="sub" style="padding:14px 0">Loading…</div>`;
  const { data, error } = await sb.from('client_onboarding').select('*').eq('client_id', openId).maybeSingle();
  if (error){ $('#dtOnboarding').innerHTML = `<div class="sub">${esc(error.message)}</div>`; return; }
  onbCache = data || { client_id: openId };
  renderOnboardingTab();
}

function onbFieldHtml(f, o){
  const key = f[0], label = f[1], type = f[2] || 'text', opts = f[3] || null, placeholder = f[4] || '';
  const v = o[key];
  if (type === 'textarea'){
    return `<div class="fld"><label>${esc(label)}</label><textarea data-onb="${key}">${esc(v)}</textarea></div>`;
  }
  if (type === 'select'){
    return `<div class="fld"><label>${esc(label)}</label><select data-onb="${key}">
      <option value=""></option>
      ${opts.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}
    </select></div>`;
  }
  if (type === 'checks'){
    const arr = Array.isArray(v) ? v : [];
    return `<div class="fld"><label>${esc(label)}</label><div class="checks" data-onb-checks="${key}">
      ${opts.map(o=>`<label class="chk"><input type="checkbox" value="${esc(o)}" ${arr.includes(o)?'checked':''}> ${esc(o)}</label>`).join('')}
    </div></div>`;
  }
  return `<div class="fld"><label>${esc(label)}</label><input type="${type}" data-onb="${key}" value="${esc(v==null?'':v)}"${placeholder?` placeholder="${esc(placeholder)}"`:''}></div>`;
}

function renderOnboardingTab(){
  const o = onbCache || {};
  const sectionsHtml = ONBOARDING_SECTIONS.map((sec, i) => `
    <details class="onbSec" ${i===0?'open':''}>
      <summary>${esc(sec.title)}</summary>
      <div class="onbBody">${sec.fields.map(f=>onbFieldHtml(f,o)).join('')}</div>
    </details>`).join('');
  $('#dtOnboarding').innerHTML = `
    <div class="onb">${sectionsHtml}</div>
    <div class="row-btns">
      <button class="btn amber" id="saveOnb">Save onboarding</button>
      <span class="sub" id="onbStatus"></span>
    </div>`;
  $('#saveOnb').onclick = saveOnboarding;
}

async function saveOnboarding(){
  const row = { client_id: openId, updated_by: me.id, updated_at: new Date().toISOString() };
  $$('#dtOnboarding [data-onb]').forEach(f => {
    let v = f.value;
    if (f.type === 'number') v = v === '' ? null : Number(v);
    if (f.type === 'date')   v = v || null;
    row[f.dataset.onb] = (v === '' ? null : v);
  });
  $$('#dtOnboarding [data-onb-checks]').forEach(grp => {
    const vals = [...grp.querySelectorAll('input:checked')].map(i => i.value);
    row[grp.dataset.onbChecks] = vals.length ? vals : null;
  });
  const s = $('#onbStatus'); s.textContent = 'Saving…'; s.style.color = 'var(--grey)';
  const { error } = await sb.from('client_onboarding').upsert(row, { onConflict:'client_id' });
  if (error){ s.textContent = error.message; s.style.color = 'var(--bad)'; return; }
  s.textContent = 'Saved.'; s.style.color = 'var(--good)';
  onbCache = row;
  setTimeout(()=>{ if (s && s.textContent==='Saved.') s.textContent=''; }, 2500);
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
  let err;
  if (openId){
    // Avoid select().single() so the response can't leak masked columns back to a contractor.
    ({ error: err } = await sb.from('clients').update(o).eq('id', openId));
  } else {
    o.created_by = me.id;
    // Only read back the id — the financial columns are no longer SELECTable on the
    // base table (locked to owner via clients_view), so select() would error.
    const { data, error } = await sb.from('clients').insert(o).select('id').single();
    err = error; if (data) openId = data.id;
  }
  if (err){ alert(err.message); return; }
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
  // Questions live in their own Q&A tab; keep them out of the general log.
  const { data, error } = await sb.from('activities').select('*')
    .eq('client_id',openId).neq('type','Question').order('activity_date',{ascending:false});
  const el = $('#actList');
  if (error){ el.innerHTML=`<div class="sub">${esc(error.message)}</div>`; return; }
  if (!data.length){ el.innerHTML='<div class="sub">No activity yet.</div>'; return; }
  el.innerHTML = data.map(a=>`<div class="act ${a.done?'done':''}">
    <div class="top">
      <label class="act-done"><input type="checkbox" class="actDone" data-id="${a.id}" ${a.done?'checked':''}>
        <span>${esc(a.type)} · ${a.activity_date}</span></label>
      <button class="x" data-del="${a.id}" title="Delete">&times;</button></div>
    ${a.note?`<div class="actText">${esc(a.note)}</div>`:''}
    ${a.next_step?`<div class="nx actText">→ ${esc(a.next_step)}${a.follow_up_date?` (by ${a.follow_up_date})`:''}</div>`:''}
  </div>`).join('');
  $$('#actList .actDone').forEach(cb=>cb.onclick=async()=>{
    await sb.from('activities').update({done:cb.checked}).eq('id',cb.dataset.id);
    loadActs(); loadNextSteps(); if(view==='followups') renderFollowups();
  });
  $$('#actList [data-del]').forEach(b=>b.onclick=async()=>{
    await sb.from('activities').delete().eq('id',b.dataset.del); loadActs(); loadNextSteps(); render();
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

// ── Next steps (pinned checklist on each client) ──────
async function loadNextSteps(){
  const box = $('#nextStepsBox'); if (!box || !openId) return;
  const { data, error } = await sb.from('activities')
    .select('id,next_step,follow_up_date')
    .eq('client_id',openId).eq('done',false).not('next_step','is',null)
    .order('follow_up_date',{ascending:true,nullsFirst:false});
  if (error){ box.innerHTML = `<div class="ns-head">📌 Next steps</div><div class="sub">${esc(error.message)}</div>`; return; }
  const items = (data||[]).filter(a=>a.next_step && a.next_step.trim());
  box.innerHTML = `
    <div class="ns-head">📌 Next steps</div>
    <div class="ns-list">${
      items.length ? items.map(nsItemHtml).join('')
                   : '<div class="sub ns-empty">Nothing open — add the next thing to do below.</div>'}</div>
    <div class="ns-add">
      <input id="nsInput" placeholder="Add a next step…" maxlength="300">
      <button class="btn amber sm" id="nsAdd">Add</button>
    </div>`;
  $('#nsAdd').onclick = addNextStep;
  $('#nsInput').onkeydown = e=>{ if(e.key==='Enter'){ e.preventDefault(); addNextStep(); } };
  $$('#nextStepsBox .ns-check').forEach(cb=>cb.onchange=()=>completeNextStep(cb.dataset.id));
}
function nsItemHtml(a){
  return `<label class="ns-item">
    <input type="checkbox" class="ns-check" data-id="${a.id}">
    <span class="ns-text">${esc(a.next_step)}</span>
    ${a.follow_up_date?`<span class="ns-due">${a.follow_up_date}</span>`:''}
  </label>`;
}
async function addNextStep(){
  const inp = $('#nsInput'); const v = (inp.value||'').trim(); if(!v) return;
  const { error } = await sb.from('activities').insert({
    client_id:openId, type:'Task', activity_date:today(), next_step:v, created_by:me.id });
  if (error){ alert(error.message); return; }
  inp.value=''; loadNextSteps();
  if (!$('#dtActivity').classList.contains('hidden')) loadActs();
  if (view==='followups') renderFollowups();
}
async function completeNextStep(id){
  const { error } = await sb.from('activities').update({done:true}).eq('id',id);
  if (error){ alert(error.message); return; }
  loadNextSteps();
  if (!$('#dtActivity').classList.contains('hidden')) loadActs();
  if (view==='followups') renderFollowups();
}

// ── Q&A (per-client tab) ──────────────────────────────
function renderQATab(){
  $('#dtQA').innerHTML = `
    <div class="sec-h">Questions on this client</div>
    <div id="qaList"><div class="sub">Loading…</div></div>
    <div class="sec-h">Ask a question</div>
    <div class="fld"><textarea id="qaInput" placeholder="Ask a question about this client…"></textarea></div>
    <button class="btn amber" id="qaAsk">Ask</button>`;
  $('#qaAsk').onclick = askQuestion;
  loadQA();
}
async function loadQA(){
  const { data, error } = await sb.from('activities').select('*')
    .eq('client_id',openId).eq('type','Question')
    .order('done',{ascending:true}).order('activity_date',{ascending:false});
  const el = $('#qaList'); if (!el) return;
  if (error){ el.innerHTML = `<div class="sub">${esc(error.message)}</div>`; return; }
  if (!data.length){ el.innerHTML = '<div class="sub">No questions yet.</div>'; return; }
  el.innerHTML = data.map(qaItemHtml).join('');
  $$('#qaList [data-answer]').forEach(b=>b.onclick=()=>submitAnswer(b.dataset.answer));
  $$('#qaList [data-resolve]').forEach(cb=>cb.onchange=async()=>{
    await sb.from('activities').update({done:cb.checked}).eq('id',cb.dataset.resolve);
    loadQA(); refreshQuestionBadge();
  });
}
function qaItemHtml(a){
  const answered = a.answer && String(a.answer).trim();
  const state = a.done ? 'Resolved' : answered ? 'Answered' : 'Open';
  const cls   = a.done ? 'r' : answered ? 'a' : 'o';
  let block;
  if (answered){
    block = `<div class="qa-answer">💬 ${esc(a.answer)}</div>`;
  } else if (me.role==='owner'){
    block = `<div class="qa-answerbox">
      <textarea data-ans-input="${a.id}" placeholder="Type your answer…"></textarea>
      <button class="btn sm" data-answer="${a.id}">Answer</button></div>`;
  } else {
    block = `<div class="sub qa-waiting">Waiting for an answer…</div>`;
  }
  return `<div class="qa-item ${a.done?'resolved':''}">
    <div class="qa-q"><span class="qa-badge ${cls}">${state}</span>${esc(a.note||'')}</div>
    <div class="qa-meta sub">${a.activity_date}</div>
    ${block}
    <label class="qa-resolve sub"><input type="checkbox" data-resolve="${a.id}" ${a.done?'checked':''}> Resolved</label>
  </div>`;
}
async function askQuestion(){
  const t = $('#qaInput'); const v = (t.value||'').trim(); if(!v) return;
  const { error } = await sb.from('activities').insert({
    client_id:openId, type:'Question', activity_date:today(), note:v, created_by:me.id });
  if (error){ alert(error.message); return; }
  t.value=''; loadQA(); refreshQuestionBadge();
}
async function submitAnswer(id){
  const ta = $(`#qaList [data-ans-input="${id}"]`); const v = (ta.value||'').trim(); if(!v) return;
  const { error } = await sb.from('activities')
    .update({ answer:v, answered_at:new Date().toISOString(), answered_by:me.id }).eq('id',id);
  if (error){ alert(error.message); return; }
  loadQA(); refreshQuestionBadge();
}

// ── Questions (global view + tab badge) ───────────────
async function renderQuestions(){
  const el = $('#questionsView');
  const ids = clients.map(c=>c.id);
  if (!ids.length){ el.innerHTML = `<div class="empty">No clients yet.</div>`; return; }
  const { data, error } = await sb.from('activities').select('*')
    .eq('type','Question').in('client_id',ids)
    .order('done',{ascending:true}).order('activity_date',{ascending:false});
  if (error){ el.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  if (!data.length){ el.innerHTML = `<div class="empty">No questions yet. Open a client → Q&amp;A to ask one.</div>`; return; }
  const byId = Object.fromEntries(clients.map(c=>[c.id,c]));
  el.innerHTML = data.map(a=>{
    const c = byId[a.client_id]||{};
    const answered = a.answer && String(a.answer).trim();
    const state = a.done ? 'Resolved' : answered ? 'Answered' : 'Open';
    const cls   = a.done ? 'r' : answered ? 'a' : 'o';
    return `<div class="qrow ${a.done?'resolved':''}" data-id="${a.client_id}">
      <div class="qrow-main">
        <div><span class="qa-badge ${cls}">${state}</span><b>${esc(c.name||'')}</b> — ${esc(a.note||'')}</div>
        ${answered?`<div class="qrow-ans sub">💬 ${esc(a.answer)}</div>`:''}
      </div>
      <div class="sub">${a.activity_date}</div>
    </div>`;
  }).join('');
  $$('#questionsView .qrow').forEach(r=>r.onclick=()=>openDrawer(r.dataset.id,'qa'));
}
async function refreshQuestionBadge(){
  const ids = clients.map(c=>c.id);
  if (!ids.length){ setQBadge(0); return; }
  const { count, error } = await sb.from('activities')
    .select('id',{count:'exact',head:true})
    .eq('type','Question').eq('done',false).in('client_id',ids);
  if (error) return;
  setQBadge(count||0);
}
function setQBadge(n){
  const b = $('#qBadge'); if(!b) return;
  b.textContent = n; b.classList.toggle('hidden', !n);
}

// ── Team access (owner-only) ──────────────────────────
async function renderTeam(){
  const el = $('#teamView');
  if (me.role!=='owner'){ el.innerHTML = `<div class="empty">Owners only.</div>`; return; }
  const { data:profs, error } = await sb.from('profiles')
    .select('id,full_name,role').neq('role','owner').order('full_name');
  if (error){ el.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  if (!profs.length){
    el.innerHTML = `<div class="empty">No contractors yet.<br><span class="sub">Add one in Supabase → Authentication → Add user, then refresh.</span></div>`;
    return;
  }
  const opts = profs.map(p=>`<option value="${p.id}">${esc(p.full_name||p.id)}</option>`).join('');
  el.innerHTML = `<div class="team-wrap">
      <div class="fld"><label>Contractor</label><select id="teamSel">${opts}</select></div>
      <div id="teamGrid"><div class="sub">Loading…</div></div>
    </div>
    <div class="team-hint">Check <b>Access</b> to let this person see a client; <b>Can edit</b> lets them log activity, check off next steps, and ask questions. Changes save instantly.</div>`;
  $('#teamSel').onchange = ()=>loadTeamGrid($('#teamSel').value);
  loadTeamGrid(profs[0].id);
}
async function loadTeamGrid(uid){
  const grid = $('#teamGrid'); grid.innerHTML = '<div class="sub">Loading…</div>';
  const { data:acc, error } = await sb.from('client_access').select('client_id,can_edit').eq('user_id',uid);
  if (error){ grid.innerHTML = `<div class="sub">${esc(error.message)}</div>`; return; }
  const accMap = Object.fromEntries((acc||[]).map(a=>[a.client_id,a]));
  const all = [...clients].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if (!all.length){ grid.innerHTML = '<div class="sub">No clients to assign yet.</div>'; return; }
  grid.innerHTML = `<table><thead><tr><th>Client</th><th>Access</th><th>Can edit</th></tr></thead><tbody>
    ${all.map(c=>{
      const a = accMap[c.id]; const has = !!a; const edit = a ? a.can_edit : false;
      return `<tr><td>${esc(c.name)}</td>
        <td><input type="checkbox" class="tAcc"  data-c="${c.id}" ${has?'checked':''}></td>
        <td><input type="checkbox" class="tEdit" data-c="${c.id}" ${edit?'checked':''} ${has?'':'disabled'}></td></tr>`;
    }).join('')}
  </tbody></table>`;
  $$('#teamGrid .tAcc').forEach(cb=>cb.onchange=()=>toggleAccess(uid,cb.dataset.c,cb.checked));
  $$('#teamGrid .tEdit').forEach(cb=>cb.onchange=()=>setCanEdit(uid,cb.dataset.c,cb.checked));
}
async function toggleAccess(uid,cid,on){
  const { error } = on
    ? await sb.from('client_access').upsert({user_id:uid,client_id:cid,can_edit:true},{onConflict:'user_id,client_id'})
    : await sb.from('client_access').delete().eq('user_id',uid).eq('client_id',cid);
  if (error){ alert(error.message); }
  loadTeamGrid(uid);
}
async function setCanEdit(uid,cid,on){
  const { error } = await sb.from('client_access').update({can_edit:on}).eq('user_id',uid).eq('client_id',cid);
  if (error){ alert(error.message); }
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
    ['pipeline','followups','questions','team'].forEach(v=>{
      const node=$('#'+v+'View'); if(node) node.classList.toggle('hidden', view!==v);
    });
    const onPipe = view==='pipeline';
    $('#fStage').classList.toggle('hidden',!onPipe);
    $('#fStatus').classList.toggle('hidden',!onPipe);
    $('#addClient').classList.toggle('hidden', !(onPipe && me.role==='owner'));
    render();
  });
}

boot();
