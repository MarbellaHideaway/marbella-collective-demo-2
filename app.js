let supabaseClient=null, bookings=[], payments=[], transfers=[], boats=[], chefs=[], experiences=[], resources=[], taskDismissals=[], selectedBooking=null, activeDetailTab='customer', bookingSort={key:'date',direction:'asc'};
let workspaceDirty=false, workspaceObserver=null, pendingDeleteId=null, pendingDeleteContext=null, pendingDuplicate=null, allowDuplicateOnce=false;
let wizardBookingType='villa_stay';
let operationsFilter='all', operationsTimeScope='upcoming';
const $=id=>document.getElementById(id);
const views={dashboard:$('dashboardSection'),bookings:$('bookingsSection'),settings:$('settingsSection'),daily:$('dailySection'),operations:$('operationsSection')};
const currencyCode=c=>['EUR','GBP'].includes(String(c||'').toUpperCase())?String(c).toUpperCase():'GBP';
const money=(n,c='GBP')=>new Intl.NumberFormat('en-GB',{style:'currency',currency:currencyCode(c),maximumFractionDigits:2}).format(Number(n||0));
const date=v=>v?new Date(v+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
const todayISO=()=>new Date().toISOString().slice(0,10);
const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const yesNo=v=>v?'<span class="status-dot yes">Booked</span>':'<span class="status-dot">Not booked</span>';
const statusClass=s=>String(s||'confirmed').toLowerCase().replace(/\s+/g,'-');
const bookingTypeLabel=t=>({villa_stay:'Villa stay',boat_charter:'Boat charter',private_chef:'Private chef',entertainment:'Entertainment',airport_transfer:'Airport transfer',decorations:'Decorations',shopping:'Shopping',beach_club:'Beach club',other:'Other'}[t]||'Villa stay');
const primaryResource=b=>{
  const type=b.booking_type||'villa_stay';
  if(type==='villa_stay')return b.villa_name||'Villa not recorded';
  if(type==='boat_charter')return bookingBoat(b.id)?.boat_name||b.service_title||b.event_location||'Boat not recorded';
  if(type==='private_chef')return bookingChef(b.id)?.chef_name||bookingChef(b.id)?.event_type||b.service_title||'Private chef';
  if(type==='entertainment')return experienceFor(b.id,'entertainment')?.title||b.service_title||'Entertainment';
  if(type==='airport_transfer')return bookingTransfer(b.id)?.supplier||b.service_title||'Airport transfer';
  return b.service_title||b.event_location||bookingTypeLabel(type);
};
const bookingDisplayPlace=b=>primaryResource(b);
const bookingDisplayDates=b=>b.booking_type==='villa_stay'?`${date(b.arrival_date)} – ${date(b.departure_date)}`:date(b.service_date||b.arrival_date);
const paymentTypeLabel=t=>({deposit:'Deposit',balance:'Balance payment',damage_deposit:'Damage deposit',refund:'Refund',other:'Other'}[t]||t||'Payment');
const paymentMethodLabel=m=>({bank_transfer:'Bank transfer',card:'Card',cash:'Cash',other:'Other'}[m]||m||'—');
let lookupIndex={
  payments:new Map(),
  transfers:new Map(),
  boats:new Map(),
  chefs:new Map(),
  experiences:new Map()
};
let operationalFeedCache={revision:-1,events:[]};
let dataRevision=0;

function rebuildLookupIndex(){
  const paymentMap=new Map(),transferMap=new Map(),boatMap=new Map(),chefMap=new Map(),experienceMap=new Map();

  payments.forEach(p=>{
    const key=String(p.booking_id);
    if(!paymentMap.has(key))paymentMap.set(key,[]);
    paymentMap.get(key).push(p);
  });
  paymentMap.forEach(list=>list.sort((a,b)=>String(b.payment_date||b.created_at||'').localeCompare(String(a.payment_date||a.created_at||''))));

  transfers.forEach(x=>transferMap.set(String(x.booking_id),x));
  boats.forEach(x=>boatMap.set(String(x.booking_id),x));
  chefs.forEach(x=>chefMap.set(String(x.booking_id),x));

  experiences.forEach(x=>{
    const key=String(x.booking_id);
    if(!experienceMap.has(key))experienceMap.set(key,[]);
    experienceMap.get(key).push(x);
  });
  experienceMap.forEach(list=>list.sort((a,b)=>Number(a.slot||0)-Number(b.slot||0)));

  lookupIndex={payments:paymentMap,transfers:transferMap,boats:boatMap,chefs:chefMap,experiences:experienceMap};
  dataRevision+=1;
  operationalFeedCache={revision:-1,events:[]};
}

const bookingPayments=id=>lookupIndex.payments.get(String(id))||[];
const bookingTransfer=id=>lookupIndex.transfers.get(String(id))||null;
const bookingBoat=id=>lookupIndex.boats.get(String(id))||null;
const bookingChef=id=>lookupIndex.chefs.get(String(id))||null;
const experienceFor=(id,type,slot=1)=>(lookupIndex.experiences.get(String(id))||[]).find(x=>x.service_type===type&&Number(x.slot)===Number(slot))||null;
const experienceList=(id,type)=>(lookupIndex.experiences.get(String(id))||[]).filter(x=>x.service_type===type);
const serviceStatusLabel=s=>({not_booked:'Not booked',enquiry:'Enquiry',awaiting_list:'Awaiting list',requested:'Requested',ordered:'Ordered',delivered:'Delivered',quoted:'Quoted',provisional:'Provisional',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'}[s]||String(s||'Not booked').replace(/_/g,' '));
const serviceDone=s=>['confirmed','completed','delivered'].includes(s);
const euro=n=>money(n).replace('£','€');
const boatStatusLabel=s=>({not_booked:'Not booked',enquiry:'Enquiry',provisional:'Provisional',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'}[s]||'Not booked');
const boatStatusClass=s=>`boat-${String(s||'not_booked').replace(/_/g,'-')}`;
const chefStatusLabel=s=>({not_booked:'Not booked',enquiry:'Enquiry',awaiting_menu:'Awaiting menu',provisional:'Provisional',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'}[s]||'Not booked');
const chefStatusClass=s=>`chef-${String(s||'not_booked').replace(/_/g,'-')}`;
const transferStatusLabel=s=>({not_booked:'Not booked',awaiting_details:'Awaiting details',provisional:'Provisional',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'}[s]||'Not booked');
const transferStatusClass=s=>`transfer-${String(s||'not_booked').replace(/_/g,'-')}`;
const transferComplete=t=>Boolean(t&&['confirmed','completed'].includes(t.status));
const paymentSignedAmount=p=>p.payment_type==='refund'?-Number(p.amount||0):Number(p.amount||0);
const bookingCurrency=b=>currencyCode(b?.booking_currency);
const paymentCurrency=p=>currencyCode(p?.currency);
const depositPaidFor=b=>Number(b?.deposit_paid||0);
const recordedDepositForCurrency=(b,c=bookingCurrency(b))=>bookingPayments(b.id).filter(p=>p.payment_type==='deposit'&&paymentCurrency(p)===currencyCode(c)).reduce((s,p)=>s+paymentSignedAmount(p),0);
const unrecordedDepositForCurrency=(b,c=bookingCurrency(b))=>currencyCode(c)===bookingCurrency(b)?Math.max(0,depositPaidFor(b)-recordedDepositForCurrency(b,c)):0;
const paidForCurrency=(b,c=bookingCurrency(b))=>bookingPayments(b.id).filter(p=>paymentCurrency(p)===currencyCode(c)).reduce((s,p)=>s+paymentSignedAmount(p),0)+unrecordedDepositForCurrency(b,c);
const paidFor=b=>paidForCurrency(b,bookingCurrency(b));
const paidBreakdown=b=>{const sums={};bookingPayments(b.id).forEach(p=>{const c=paymentCurrency(p);sums[c]=(sums[c]||0)+paymentSignedAmount(p)});const bookingC=bookingCurrency(b),virtual=unrecordedDepositForCurrency(b,bookingC);if(virtual)sums[bookingC]=(sums[bookingC]||0)+virtual;return Object.entries(sums).filter(([,v])=>v).map(([c,v])=>money(v,c)).join(' + ')||money(0,bookingCurrency(b));};
const balanceFor=b=>Math.max(0,Number(b.total_rental||0)-paidForCurrency(b,bookingCurrency(b)));
const supplierOwedFor=b=>Number(b?.supplier_amount_owed||0);
const supplierCurrencyFor=b=>currencyCode(b?.supplier_currency||b?.booking_currency);
const supplierPaymentDateFor=b=>b?.supplier_payment_due_date||bookingPrimaryDate(b)||null;
const nextPaymentAmountFor=b=>Number(b?.next_payment_amount||0);
const nextPaymentDateFor=b=>b?.next_payment_due_date||null;
const nextPaymentCurrencyFor=b=>currencyCode(b?.next_payment_currency||b?.booking_currency);
const nextPaymentStageLabel=b=>({final_balance:'Final balance',further_deposit:'Further deposit',other:'Other payment'})[b?.next_payment_stage]||'Next payment';

const paymentStrategyLabel=value=>({
  standard_50_30:'50% deposit, balance 30 days before',
  deposit_50_30:'50% deposit, balance 30 days before',
  deposit_50_60:'50% deposit, balance 60 days before',
  deposit_25_30:'25% deposit, second 25%, final 50% 30 days before',
  deposit_25_60:'25% deposit, second 25%, final 50% 60 days before',
  staged:'Staged payments',
  staged_40_30_30:'40% deposit, then 30%, final balance 30 days before',
  staged_40_30_60:'40% deposit, then 30%, final balance 60 days before',
  fully_paid:'Fully paid',
  pay_later:'Nothing due until later',
  custom:'Custom arrangement'
})[value]||'Custom arrangement';

function villaStrategyMeta(value){
  return {
    standard_50_30:{depositPct:50,finalDays:30,staged:false},
    deposit_50_30:{depositPct:50,finalDays:30,staged:false},
    deposit_50_60:{depositPct:50,finalDays:60,staged:false},
    deposit_25_30:{depositPct:25,furtherPct:25,finalPct:50,finalDays:30,staged:true,stageName:'second_deposit'},
    deposit_25_60:{depositPct:25,furtherPct:25,finalPct:50,finalDays:60,staged:true,stageName:'second_deposit'},
    staged_40_30_30:{depositPct:40,furtherPct:30,finalDays:30,staged:true},
    staged_40_30_60:{depositPct:40,furtherPct:30,finalDays:60,staged:true}
  }[value]||null;
}

function paymentSummaryFor(b){
  const total=Number(b?.total_rental||0);
  const currency=bookingCurrency(b);
  const deposit=Number(b?.deposit_paid||0);
  const paid=b?.__form_preview?Number(b?.deposit_paid||0):paidForCurrency(b,currency);
  const balance=Math.max(0,total-paid);
  const strategy=b?.payment_strategy||'custom';
  const meta=villaStrategyMeta(strategy);
  const nextAmount=nextPaymentAmountFor(b);
  const nextDate=nextPaymentDateFor(b);
  const finalDate=b?.balance_due_date||(!meta?.staged?nextDate:null);
  const bookingType=b?.booking_type||'villa_stay';

  if(strategy==='fully_paid'||balance<=0)return 'Fully paid.';

  if(bookingType==='villa_stay'&&meta){
    let summary=`${meta.depositPct}% deposit received (${money(deposit,currency)}).`;
    if(meta.staged){
      const stage=b?.next_payment_stage||'further_deposit';
      const finalAmount=meta.finalPct?total*(meta.finalPct/100):Math.max(0,total-deposit-(stage==='further_deposit'?nextAmount:0));
      if(stage==='further_deposit'){
        const stageLabel=meta.stageName==='second_deposit'?'Second deposit':'Further payment';
        if(nextAmount>0)summary+=` ${stageLabel} ${money(nextAmount,nextPaymentCurrencyFor(b))}${nextDate?` due ${date(nextDate)}`:''}.`;
      }else{
        const receivedPct=Math.round((paid/Math.max(total,1))*100);
        summary=`${Math.min(receivedPct,100)}% received (${money(paid,currency)}).`;
      }
      if(finalAmount>0)summary+=` Final payment ${money(finalAmount,currency)}${finalDate?` due ${date(finalDate)}`:''}, ${meta.finalDays} days before arrival.`;
    }else{
      const finalAmount=Math.max(0,total-deposit);
      summary+=` Remaining balance ${money(finalAmount,currency)}${finalDate?` due ${date(finalDate)}`:''}, ${meta.finalDays} days before arrival.`;
    }
    return summary.trim();
  }

  let summary=strategy==='pay_later'?'Nothing to pay until the agreed later date.':strategy==='staged'?'Staged payment arrangement.':'Custom payment arrangement.';
  if(nextAmount>0)summary+=` Next payment ${money(nextAmount,currency)}${nextDate?` due ${date(nextDate)}`:''}.`;
  else if(balance>0)summary+=` ${money(balance,currency)} outstanding.`;

  // Boat/custom notes can still form part of the summary; villa standard plans do not rely on notes.
  const notes=String(b?.payment_strategy_notes||'').trim();
  if(notes)summary+=` ${notes}`;
  return summary.trim();
}

function currentGbpEurRate(){return Math.max(0.0001,Number($('gbpEurRate')?.value||1.15));}
function convertBoatCurrency(amount,from,to){
  amount=Number(amount||0);from=currencyCode(from);to=currencyCode(to);
  if(from===to)return amount;
  const rate=currentGbpEurRate();
  if(from==='GBP'&&to==='EUR')return amount*rate;
  if(from==='EUR'&&to==='GBP')return amount/rate;
  return amount;
}
async function refreshBoatFxRate(){
  const status=$('fxRateStatus'),button=$('refreshFxRate');
  if(button)button.disabled=true;
  if(status)status.textContent='Refreshing live GBP/EUR rate…';
  let rate=null;
  const urls=[
    ['https://api.frankfurter.app/latest?from=GBP&to=EUR',d=>Number(d?.rates?.EUR)],
    ['https://open.er-api.com/v6/latest/GBP',d=>Number(d?.rates?.EUR)]
  ];
  for(const [url,read] of urls){
    try{
      const response=await fetch(url,{cache:'no-store'});
      if(!response.ok)continue;
      const data=await response.json();
      rate=read(data);
      if(rate)break;
    }catch(e){}
  }
  if(rate){
    $('gbpEurRate').value=rate.toFixed(4);
    if(status)status.textContent=`Live rate updated: 1 GBP = ${rate.toFixed(4)} EUR`;
  }else{
    if(!$('gbpEurRate').value)$('gbpEurRate').value='1.15';
    if(status)status.textContent=`Live rate unavailable. Using ${Number($('gbpEurRate').value||1.15).toFixed(4)}.`;
  }
  updateBoatCurrencyCalculations();
  if(button)button.disabled=false;
}
function boatCreatedDate(b=null){
  return b?.created_at?String(b.created_at).slice(0,10):todayISO();
}
function syncBookingCurrencySymbols(){
  const symbol=currencyCode($('bookingCurrency')?.value)==='EUR'?'€':'£';
  if($('totalRentalSymbol'))$('totalRentalSymbol').textContent=symbol;
  if(($('bookingType')?.value||'')!=='boat_charter'&&$('depositSymbol'))$('depositSymbol').textContent=symbol;
  if($('nextPaymentSymbol'))$('nextPaymentSymbol').textContent=currencyCode($('nextPaymentCurrency')?.value||$('bookingCurrency')?.value)==='EUR'?'€':'£';
}
function updateBoatCurrencyCalculations(){
  if(($('bookingType')?.value||'')!=='boat_charter')return;
  const depositC=currencyCode($('depositCurrency')?.value||'EUR');
  const deposit=Number($('depositPaid')?.value||0);
  const total=Number($('totalRental')?.value||0);
  const depositEur=convertBoatCurrency(deposit,depositC,'EUR');
  const balanceEur=Math.max(0,total-depositEur);
  const showFx=depositC==='GBP';
  if($('depositSymbol'))$('depositSymbol').textContent=showFx?'£':'€';
  ['depositConvertedWrap','fxRateWrap','finalBalanceGbpWrap'].forEach(id=>$(id)?.classList.toggle('hidden',!showFx));
  if($('finalBalanceEurWrap'))$('finalBalanceEurWrap').classList.remove('hidden');
  if(showFx&&$('depositConverted'))$('depositConverted').value=money(depositEur,'EUR');
  if(showFx&&$('depositConvertedHelp'))$('depositConvertedHelp').textContent=`At 1 GBP = ${currentGbpEurRate().toFixed(4)} EUR`;
  if(showFx&&$('finalBalanceGbp'))$('finalBalanceGbp').value=money(convertBoatCurrency(balanceEur,'EUR','GBP'),'GBP');
  if($('finalBalanceEur'))$('finalBalanceEur').value=money(balanceEur,'EUR');
  if($('nextPaymentAmount')){
    const nextC=currencyCode($('nextPaymentCurrency')?.value||'EUR');
    $('nextPaymentAmount').value=convertBoatCurrency(balanceEur,'EUR',nextC).toFixed(2);
    if($('nextPaymentSymbol'))$('nextPaymentSymbol').textContent=nextC==='GBP'?'£':'€';
  }
}
function applyBoatWorkflowDefaults(b=null){
  const isBoat=($('bookingType')?.value||'')==='boat_charter';
  if(!isBoat){
    ['depositCurrencyWrap','depositConvertedWrap','fxRateWrap','finalBalanceGbpWrap','finalBalanceEurWrap'].forEach(id=>$(id)?.classList.add('hidden'));
    
    if($('bookingCurrency'))$('bookingCurrency').disabled=false;
    if($('depositPaidDate'))$('depositPaidDate').readOnly=false;
    return;
  }
  if($('bookingCurrency')){$('bookingCurrency').value='EUR';$('bookingCurrency').disabled=true;}
  if($('totalRentalSymbol'))$('totalRentalSymbol').textContent='€';
  
  if($('depositPaidDate')){$('depositPaidDate').value=boatCreatedDate(b);$('depositPaidDate').readOnly=true;}
  if($('depositDateHelp'))$('depositDateHelp').textContent='Boat deposits use the booking-created date automatically.';
  const sail=$('serviceDate')?.value||$('boatDate')?.value||'';
  if(sail&&$('nextPaymentDueDate'))$('nextPaymentDueDate').value=sail;
  if($('nextPaymentCurrency')&&!$('nextPaymentCurrency').value)$('nextPaymentCurrency').value='EUR';
  if($('supplierPaymentDueDate')&&sail)$('supplierPaymentDueDate').value=sail;
  if($('finalPaymentHelp'))$('finalPaymentHelp').textContent='Boat final payment is due on the sailing date.';
  if($('nextPaymentStage'))$('nextPaymentStage').value='final_balance';
  if($('supplierCurrency'))$('supplierCurrency').value='EUR';
  if($('supplierCurrencyWrap'))$('supplierCurrencyWrap').classList.add('boat-fixed-currency');
  if($('supplierPaymentDueDateHelp'))$('supplierPaymentDueDateHelp').textContent='Defaults to the sailing date; change it only if the supplier needs paying earlier.';
  if($('boatStatus')&&$('boatStatus').value!=='cancelled')$('boatStatus').value='confirmed';
  if(!$('paymentStrategyNotes')?.value)$('paymentStrategyNotes').value='Final payment to be paid to Captain on the day.';
  if($('gbpEurRate')&&!$('gbpEurRate').value)$('gbpEurRate').value='1.15';
  const showFx=currencyCode($('depositCurrency')?.value||'EUR')==='GBP';
  if($('depositCurrencyWrap'))$('depositCurrencyWrap').classList.remove('hidden');
  ['depositConvertedWrap','fxRateWrap','finalBalanceGbpWrap'].forEach(id=>$(id)?.classList.toggle('hidden',!showFx));
  if($('finalBalanceEurWrap'))$('finalBalanceEurWrap').classList.remove('hidden');
  updateBoatCurrencyCalculations();
}

function updatePaymentSummaryPreview(){
  const fake={
    total_rental:Number($('totalRental')?.value||0),
    deposit_paid:Number($('depositPaid')?.value||0),
    next_payment_amount:Number($('nextPaymentAmount')?.value||0),
    next_payment_due_date:$('nextPaymentDueDate')?.value||null,
    next_payment_currency:$('nextPaymentCurrency')?.value||$('bookingCurrency')?.value||'GBP',
    next_payment_stage:$('nextPaymentStage')?.value||'final_balance',
    balance_due_date:$('balanceDueDate')?.value||null,
    payment_strategy:$('paymentStrategy')?.value||'custom',
    payment_strategy_notes:$('paymentStrategyNotes')?.value||'',
    booking_currency:$('bookingCurrency')?.value||'GBP',
    booking_type:$('bookingType')?.value||'villa_stay',
    __form_preview:true,
    id:$('bookingId')?.value||''
  };
  const el=$('paymentSummaryPreview');if(el)el.textContent=paymentSummaryFor(fake);
}
const depositPaymentFor=b=>bookingPayments(b.id).filter(p=>p.payment_type==='deposit').sort((a,z)=>new Date(a.payment_date)-new Date(z.payment_date))[0]||null;
const depositPaidDateFor=b=>b?.deposit_paid_date||depositPaymentFor(b)?.payment_date||(b?.created_at?String(b.created_at).slice(0,10):null);
const boatIsConfirmed=b=>depositPaidFor(b)>0||paidForCurrency(b,bookingCurrency(b))>0||['confirmed','completed'].includes(bookingBoat(b.id)?.status);
const effectiveBoatStatus=b=>boatIsConfirmed(b)?'confirmed':(bookingBoat(b.id)?.status||'not_booked');
const nextPaymentState=b=>{
  const amount=nextPaymentAmountFor(b),due=nextPaymentDateFor(b);
  if(!amount||!due)return'none';
  const today=new Date();today.setHours(0,0,0,0);
  const date=new Date(due+'T00:00:00');
  const days=Math.ceil((date-today)/86400000);
  if(days<0)return'overdue';
  if(days<=14)return'due-soon';
  return'upcoming';
};

let passwordRecoveryActive=false;
async function init(){
  try{
    const config=await fetch('/api/config',{cache:'no-store'}).then(r=>r.json());
    if(!config.url||!config.key){show('setupView');return;}
    supabaseClient=window.supabase.createClient(config.url,config.key);

    supabaseClient.auth.onAuthStateChange(async(event,session)=>{
      if(event==='PASSWORD_RECOVERY'){
        passwordRecoveryActive=true;
        show('resetPasswordView');
        return;
      }
      if(passwordRecoveryActive)return;
      if(session)await enterApp(session.user);else show('loginView');
    });

    const{data:{session}}=await supabaseClient.auth.getSession();
    // Recovery links often arrive with an authenticated recovery session.
    // Give Supabase's PASSWORD_RECOVERY event a moment to fire before entering the app.
    await new Promise(resolve=>setTimeout(resolve,120));
    if(passwordRecoveryActive)return;
    if(session)await enterApp(session.user);else show('loginView');
  }catch(e){console.error(e);$('boot').textContent='Unable to open the app. Please refresh.';}
}
function show(id){['boot','setupView','loginView','resetPasswordView','appView'].forEach(x=>$(x)?.classList.add('hidden'));$(id).classList.remove('hidden');}
async function enterApp(user){show('appView');$('userEmail').textContent=user.email||'';await loadData();}
async function loadData(){
  const [bookingResult,paymentResult,boatResult,chefResult,experienceResult,resourceResult,dismissalResult]=await Promise.all([
    supabaseClient.from('bookings').select('*').order('service_date',{ascending:true,nullsFirst:false}).order('arrival_date',{ascending:true,nullsFirst:false}),
    supabaseClient.from('booking_payments').select('*').order('payment_date',{ascending:false}).order('created_at',{ascending:false}),
    supabaseClient.from('booking_boats').select('*'),
    supabaseClient.from('booking_chefs').select('*'),
    supabaseClient.from('booking_experiences').select('*').order('service_date',{ascending:true}),
    supabaseClient.from('master_resources').select('*').order('resource_type').order('sort_order').order('name'),
    supabaseClient.from('operational_task_dismissals').select('*')
  ]);
  bookings=bookingResult.error?[]:(bookingResult.data||[]);
  payments=paymentResult.error?[]:(paymentResult.data||[]);
  boats=boatResult.error?[]:(boatResult.data||[]);
  chefs=chefResult.error?[]:(chefResult.data||[]);
  experiences=experienceResult.error?[]:(experienceResult.data||[]);
  resources=resourceResult.error?[]:(resourceResult.data||[]);
  taskDismissals=dismissalResult.error?[]:(dismissalResult.data||[]);
  rebuildLookupIndex();
  if(bookingResult.error)console.error(bookingResult.error);
  if(paymentResult.error)console.error(paymentResult.error);
  if(boatResult.error)console.error(boatResult.error);
  if(chefResult.error)console.error(chefResult.error);
  if(experienceResult.error)console.error(experienceResult.error);
  if(resourceResult.error)console.error(resourceResult.error);
  if(dismissalResult.error)console.error(dismissalResult.error);
  renderAll();
  if(selectedBooking){selectedBooking=bookings.find(b=>String(b.id)===String(selectedBooking.id))||null;if(selectedBooking)renderDetail();}
}

const activeResources=type=>resources.filter(r=>r.resource_type===type&&r.active!==false).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name)));
function fillSelect(id,type,current=''){
  const el=$(id);if(!el)return;const list=activeResources(type);const value=current||el.value||'';
  el.innerHTML=`<option value="">Select ${type}</option>${list.map(r=>`<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('')}`;
  if(value&&!list.some(r=>r.name===value)){el.insertAdjacentHTML('beforeend',`<option value="${esc(value)}">${esc(value)}</option>`);}el.value=value;
}
function populateMasterData(){
  fillSelect('villaName','villa',$('villaName')?.value);
  fillSelect('boatName','boat',$('boatName')?.value);
  fillSelect('primaryBoatName','boat',$('primaryBoatName')?.value);
  const nationalitySelect=$('guestNationalitySelect');
  if(nationalitySelect){
    const current=nationalitySelect.value;
    const defaults=['British','Irish','Spanish','French','German','Dutch','Belgian','Italian','Portuguese','Swiss','Swedish','Norwegian','Danish','Finnish','American','Canadian','Australian','New Zealander'];
    const custom=activeResources('nationality').map(r=>r.name).filter(n=>!defaults.includes(n));
    nationalitySelect.innerHTML='<option value="">Select nationality</option>'+[...defaults,...custom].map(n=>`<option>${esc(n)}</option>`).join('')+'<option value="Other">Other…</option>';
    if([...nationalitySelect.options].some(o=>o.value===current))nationalitySelect.value=current;
  }
  toggleOtherBoat();togglePrimaryOtherBoat();
}
const supplierTypeLabels={
  villa:'Villas',
  boat:'Boats',
  chef:'Chefs',
  musician:'Musicians',
  nightclub:'Nightclubs',
  restaurant:'Restaurants',
  beach_club:'Beach clubs'
};
const defaultSupplierTypes=['villa','boat','chef','musician'];
function supplierTypes(){
  const allowedDynamic=['nightclub','restaurant','beach_club','transfer','decorator','photographer','florist','dj','singer','other_supplier'];
  const dynamic=[...new Set(resources.map(r=>String(r.resource_type||'').trim()).filter(type=>allowedDynamic.includes(type)))];
  return [...new Set(['villa','chef','musician','boat',...dynamic])];
}
function supplierTypeDescription(type){
  return {
    villa:'Used in villa stays, filters and reports.',
    boat:'Used for standalone charters and villa concierge bookings.',
    chef:'Private chefs and catering suppliers.',
    musician:'Saxophonists, DJs, singers and other performers.',
    nightclub:'Nightclubs and late-night venues.',
    restaurant:'Restaurants and dining venues.',
    beach_club:'Beach clubs and day venues.'
  }[type]||'Approved Marbella Collective suppliers.';
}
function supplierPanelHtml(type){
  const rows=resources.filter(r=>r.resource_type===type&&!String(r.name||'').startsWith('__')).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.name).localeCompare(String(b.name)));
  const label=supplierTypeLabels[type]||type.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  return `<div class="panel resource-panel supplier-panel">
    <div class="panel-head"><div><h2>${esc(label)}</h2><p>${esc(supplierTypeDescription(type))}</p></div></div>
    <div class="resource-list">${rows.map(r=>`<div class="resource-row ${r.active===false?'inactive':''}"><span>${esc(r.name)}</span><button class="text-button" data-resource-toggle="${r.id}" data-resource-active="${r.active!==false}">${r.active===false?'Restore':'Remove'}</button></div>`).join('')||'<div class="empty">No suppliers yet.</div>'}</div>
    <form class="resource-add-form" data-resource-form="${esc(type)}"><input name="resourceName" placeholder="Add ${esc(label.replace(/s$/,'').toLowerCase())}" required><button class="button primary" type="submit">Add</button></form>
  </div>`;
}
function renderResources(){
  const grid=$('supplierTypeGrid');if(!grid)return;
  const types=supplierTypes();
  const left=['villa','chef','musician'].filter(t=>types.includes(t));
  const right=['boat',...types.filter(t=>!['villa','chef','musician','boat'].includes(t))];
  grid.innerHTML=`<div class="supplier-column">${left.map(supplierPanelHtml).join('')}</div><div class="supplier-column">${right.map(supplierPanelHtml).join('')}</div>`;
}
function toggleOtherBoat(){const isOther=$('boatName')?.value==='Other';$('boatOtherLabel')?.classList.toggle('is-hidden',!isOther);if(!isOther&&$('boatNameOther'))$('boatNameOther').value='';}
function togglePrimaryOtherBoat(){const isOther=$('primaryBoatName')?.value==='Other';$('primaryBoatOtherLabel')?.classList.toggle('is-hidden',!isOther);if(!isOther&&$('primaryBoatNameOther'))$('primaryBoatNameOther').value='';}
function selectedBoatName(){return (($('primaryBoatName')?.value==='Other'?$('primaryBoatNameOther')?.value:$('primaryBoatName')?.value)||($('boatName')?.value==='Other'?$('boatNameOther')?.value:$('boatName')?.value)||'').trim();}
function syncBoatSelectors(source='primary'){const value=source==='primary'?selectedBoatName():(($('boatName')?.value==='Other'?$('boatNameOther')?.value:$('boatName')?.value)||'').trim();if(!value)return;if($('primaryBoatName')){if(activeResources('boat').some(r=>r.name===value)){$('primaryBoatName').value=value;$('primaryBoatNameOther').value='';}else{$('primaryBoatName').value='Other';$('primaryBoatNameOther').value=value;}togglePrimaryOtherBoat();}if($('boatName')){if(activeResources('boat').some(r=>r.name===value)){$('boatName').value=value;$('boatNameOther').value='';}else{$('boatName').value='Other';$('boatNameOther').value=value;}toggleOtherBoat();}refreshGeneratedTitle();}
function bookingWorkflowConfig(type){
  return {
    villa_stay:{page:'New Villa Stay',edit:'Edit Villa Stay',eyebrow:'Accommodation',section:'Stay & customer details',date:'Arrival date',location:'Villa location',nav1:'Stay',nav2:'Customer & guests',ops:'Travel'},
    boat_charter:{page:'New Boat Charter',edit:'Edit Boat Charter',eyebrow:'Charter booking',section:'Charter & customer details',date:'Charter date',location:'Departure marina',nav1:'Charter',nav2:'Customer & guests',ops:'Charter operations'},
    private_chef:{page:'New Private Chef Booking',edit:'Edit Private Chef Booking',eyebrow:'Dining experience',section:'Event & customer details',date:'Event date',location:'Event location',nav1:'Event',nav2:'Customer & guests',ops:'Event operations'},
    entertainment:{page:'New Entertainment Booking',edit:'Edit Entertainment Booking',eyebrow:'Entertainment experience',section:'Event & customer details',date:'Event date',location:'Event location',nav1:'Event',nav2:'Customer & guests',ops:'Event operations'},
    decorations:{page:'New Decorations Booking',edit:'Edit Decorations Booking',eyebrow:'Celebration setup',section:'Setup & customer details',date:'Setup date',location:'Setup location',nav1:'Setup',nav2:'Customer',ops:'Setup operations'},
    shopping:{page:'New Shopping Order',edit:'Edit Shopping Order',eyebrow:'Pre-arrival shopping',section:'Order & customer details',date:'Delivery date',location:'Delivery location',nav1:'Order',nav2:'Customer',ops:'Delivery operations'},
    beach_club:{page:'New Beach Club Booking',edit:'Edit Beach Club Booking',eyebrow:'Beach experience',section:'Reservation & customer details',date:'Booking date',location:'Venue',nav1:'Reservation',nav2:'Customer & guests',ops:'Experience details'},
    other:{page:'New Service Booking',edit:'Edit Service Booking',eyebrow:'Marbella Collective service',section:'Service & customer details',date:'Service date',location:'Service location',nav1:'Service',nav2:'Customer',ops:'Operations'}
  }[type]||this.villa_stay;
}
function configureDepartureMarinaOptions(value=''){
  const select=$('eventLocationSelect');if(!select)return;
  const bases=['Puerto Banús','Estepona','Benalmádena'];
  const extras=activeResources('marina').map(r=>r.name).filter(Boolean);
  const choices=[...new Set([...bases,...extras])];
  select.innerHTML=choices.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')+'<option value="Other">Other…</option>';
  const desired=value||'Puerto Banús';
  if(choices.includes(desired)){select.value=desired;if($('eventLocation'))$('eventLocation').classList.add('hidden');}
  else if(desired){select.value='Other';if($('eventLocation')){$('eventLocation').classList.remove('hidden');$('eventLocation').value=desired;}}
  else select.value='Puerto Banús';
}
function syncBoatBookingFields(force=false){
  if(($('bookingType')?.value||'villa_stay')!=='boat_charter')return;
  syncBoatSelectors('primary');
  const marina=conditionalValue('eventLocationSelect','eventLocation')||'';
  const dateValue=$('serviceDate')?.value||'';
  const guests=$('guestCount')?.value||'';
  if($('boatMarina')&&(force||!$('boatMarina').value))$('boatMarina').value=marina;
  if($('boatDate')&&(force||!$('boatDate').value))$('boatDate').value=dateValue;
  if($('boatGuests')&&(force||!$('boatGuests').value))$('boatGuests').value=guests;
  if($('boatCurrency'))$('boatCurrency').value='EUR';
  if($('boatSellingPrice'))$('boatSellingPrice').value=Number($('totalRental')?.value||0);
  if($('boatDepositPaid'))$('boatDepositPaid').value=Number($('depositPaid')?.value||0);
  if($('boatAmountPaid'))$('boatAmountPaid').value=Number($('depositPaid')?.value||0);
  if($('boatSupplierCost'))$('boatSupplierCost').value=Number($('supplierAmountOwed')?.value||0);
  applyBoatWorkflowDefaults();
}

function generatedServiceTitle(type){
  const formatted=d=>{if(!d)return'';const x=new Date(d+'T12:00:00');return x.toLocaleDateString('en-GB',{day:'numeric',month:'short'});};
  if(type==='villa_stay')return [($('villaName')?.value||'Villa stay'),formatted($('arrivalDate')?.value)].filter(Boolean).join(' · ');
  if(type==='boat_charter'){const boat=selectedBoatName()||'Boat charter';return [boat,formatted($('boatDate')?.value||$('serviceDate')?.value)].filter(Boolean).join(' · ');}
  if(type==='private_chef'){const event=$('chefEventType')?.value||'Private chef';return [event,formatted($('chefDate')?.value||$('serviceDate')?.value)].filter(Boolean).join(' · ');}
  if(type==='entertainment'){const event=$('entTitle')?.value||'Entertainment';return [event,formatted($('entDate')?.value||$('serviceDate')?.value)].filter(Boolean).join(' · ');}
  const label=bookingTypeLabel(type);return [label,formatted($('serviceDate')?.value)].filter(Boolean).join(' · ');
}
function refreshGeneratedTitle(){const el=$('serviceTitle');if(el)el.value=generatedServiceTitle($('bookingType')?.value||'villa_stay');}
function applyBookingTypeTemplate(){
  const type=$('bookingType')?.value||'villa_stay',cfg=bookingWorkflowConfig(type);toggleBookingTypeFields();
  if(type==='boat_charter'){configureDepartureMarinaOptions(conditionalValue('eventLocationSelect','eventLocation')||'Puerto Banús');if($('eventLocationLabel'))$('eventLocationLabel').firstChild.textContent='Departure marina';}
  else if($('eventLocationLabel'))$('eventLocationLabel').firstChild.textContent=cfg.location;
  $('bookingForm')?.classList.toggle('villa-edit',Boolean($('bookingId')?.value)&&type==='villa_stay');
  const editing=Boolean($('bookingId')?.value);
  if(editing){
    const guest=String($('guestName')?.value||'').trim();
    $('modalTitle').innerHTML=`${esc(cfg.edit)}${guest?` <strong class="editor-guest-name">— ${esc(guest)}</strong>`:''}`;
  }else{
    $('modalTitle').textContent=cfg.page;
  }
  if($('serviceEyebrow'))$('serviceEyebrow').textContent=cfg.eyebrow;
  if($('serviceSectionTitle'))$('serviceSectionTitle').textContent=cfg.section;
  if($('navServiceLabel'))$('navServiceLabel').textContent=cfg.nav1;
  if($('navCustomerLabel'))$('navCustomerLabel').textContent=cfg.nav2;
  if($('navOperationsLabel'))$('navOperationsLabel').textContent=cfg.ops;
  const dateLabel=$('serviceDateLabel');if(dateLabel)dateLabel.childNodes[0].nodeValue=cfg.date;
  const location=$('eventLocation');if(location)location.placeholder=cfg.location;
  $('bookingTypeField')?.classList.toggle('is-hidden',type==='boat_charter');$('primaryBoatField')?.classList.toggle('is-hidden',type!=='boat_charter');if(type!=='boat_charter')$('primaryBoatOtherLabel')?.classList.add('is-hidden');else togglePrimaryOtherBoat();
  if($('primaryBoatName'))$('primaryBoatName').required=type==='boat_charter';
  if(type==='boat_charter'&&$('boatStatus')?.value!=='cancelled')$('boatStatus').value='confirmed';
  if(type==='private_chef'&&$('chefStatus')?.value==='not_booked')$('chefStatus').value='enquiry';
  if(type==='entertainment'&&$('entStatus')?.value==='not_booked')$('entStatus').value='enquiry';
  if(editing&&type==='villa_stay'){
    if($('serviceEyebrow'))$('serviceEyebrow').textContent='Booking';
    if($('serviceSectionTitle'))$('serviceSectionTitle').textContent='Customer & booking';
  }
  syncBookingCurrencySymbols();
  refreshGeneratedTitle();
}


function normaliseCommissionRate(value){const n=Number(value||0);return n>0&&n<=1?n:n/100;}
function commissionRateFor(b){const n=normaliseCommissionRate(b?.commission_rate||0);return n*100;}
function commissionFor(b){if(b?.commission_type==='fixed')return Number(b?.commission_fixed_amount||0);return Number(b?.total_rental||0)*normaliseCommissionRate(b?.commission_rate||0);}
const commissionCurrency=b=>currencyCode(b?.commission_currency||b?.booking_currency);
const inheritedGuestFields=['boatGuests','chefGuests','beachGuests','entGuests'];
function syncInheritedGuestCounts(){const total=$('guestCount')?.value;inheritedGuestFields.forEach(id=>{const el=$(id);if(!el)return;if(!el.dataset.customGuestValue)el.value=total||'';});}
function syncGuestTotal(force=false){const a=$('adultCount')?.value,c=$('childCount')?.value;if(!force&&a===''&&c==='')return;const adults=Number(a||0),children=Number(c||0);if($('guestCount'))$('guestCount').value=adults+children||'';syncInheritedGuestCounts();}
function setConditionalSelect(selectId,inputId,value,defaultValue=''){
  const s=$(selectId),i=$(inputId);if(!s||!i)return;const v=value||defaultValue;const known=[...s.options].some(o=>o.value===v&&v!=='Other');s.value=known?v:(v?'Other':defaultValue);i.value=known?'':(v&&v!==defaultValue?v:'');i.classList.toggle('hidden',s.value!=='Other');
}
function conditionalValue(selectId,inputId){const s=$(selectId),i=$(inputId);return s?.value==='Other'?(i?.value.trim()||null):(s?.value||null);}
function syncConditionalInput(selectId,inputId){const show=$(selectId)?.value==='Other';$(inputId)?.classList.toggle('hidden',!show);if(show)$(inputId)?.focus();}
function selectedCommissionRate(){return $('commissionRateSelect')?.value==='Other'?Number($('commissionRate').value||0):Number($('commissionRateSelect')?.value||0);}
function syncCommissionControl(rate){let v=Number(rate||10);if(v>0&&v<=1)v*=100;if([10,12,20].includes(v)){$('commissionRateSelect').value=String(v);$('commissionRate').classList.add('hidden');$('commissionRate').value='';}else{$('commissionRateSelect').value='Other';$('commissionRate').classList.remove('hidden');$('commissionRate').value=v||'';}}
function selectedCommissionAmount(){return $('commissionType')?.value==='fixed'?Number($('commissionFixedAmount')?.value||0):Number($('totalRental')?.value||0)*(selectedCommissionRate()/100);}
function toggleCommissionType(){const fixed=$('commissionType')?.value==='fixed';$('commissionRateLabel')?.classList.toggle('is-hidden',fixed);$('commissionFixedLabel')?.classList.toggle('is-hidden',!fixed);updateBoatFinancials();updateChefFinancials();}
function setCommissionControlsEnabled(enabled=true){
  ['commissionType','commissionRateSelect','commissionRate','commissionFixedAmount','commissionCurrency'].forEach(id=>{const el=$(id);if(el)el.disabled=!enabled;});
}
function applyResourceCommissionDefault(force=false){
  const type=$('bookingType')?.value||'villa_stay';
  let resourceType='',resourceName='';
  if(type==='villa_stay'){resourceType='villa';resourceName=$('villaName')?.value?.trim()||'';}
  else if(type==='private_chef'){resourceType='chef';resourceName=$('chefName')?.value?.trim()||'';}
  else if(type==='boat_charter'){resourceType='boat';resourceName=conditionalValue('primaryBoatName','primaryBoatNameOther')||'';}
  if(!resourceName)return;
  const lower=resourceName.toLowerCase();
  let rule=resources.find(r=>r.resource_type===resourceType&&String(r.name||'').toLowerCase()===lower);
  if(lower==='marbella hideaway')rule={default_commission_type:'fixed',default_commission_amount:0,default_commission_currency:'GBP'};
  if(lower==='chef davis')rule={default_commission_type:'fixed',default_commission_amount:120,default_commission_currency:'EUR'};
  if(!rule)return;
  const commissionType=rule.default_commission_type||((rule.default_commission_amount??null)!==null?'fixed':'percentage');
  $('commissionType').value=commissionType;
  if(commissionType==='fixed')$('commissionFixedAmount').value=Number(rule.default_commission_amount||0);
  else syncCommissionControl(Number(rule.default_commission_rate||0.10));
  $('commissionCurrency').value=currencyCode(rule.default_commission_currency||$('bookingCurrency')?.value||'GBP');
  toggleCommissionType();
  setCommissionControlsEnabled(true);
}

const operationalBookings=()=>bookings.filter(b=>(b.booking_type||'villa_stay')!=='restaurant');
const activeBookings=()=>operationalBookings().filter(b=>String(b.status).toLowerCase()!=='cancelled');
function renderAll(){renderPriorities();renderMetrics();renderUpcoming();renderBookings();populateMasterData();renderResources();}

const localDateOnly=value=>{
  if(!value)return null;
  const d=new Date(String(value).length===10?value+'T12:00:00':value);
  d.setHours(0,0,0,0);
  return d;
};
const daysFromToday=value=>{
  const d=localDateOnly(value);if(!d)return null;
  const today=new Date();today.setHours(0,0,0,0);
  return Math.round((d-today)/86400000);
};
const priorityCurrencyTotals=(items,field)=>{
  const totals={GBP:0,EUR:0};
  items.forEach(item=>{
    const amount=Number(item[field]||0),currency=currencyCode(item.currency||'GBP');
    totals[currency]=(totals[currency]||0)+amount;
  });
  return ['GBP','EUR'].filter(c=>totals[c]>0).map(c=>money(totals[c],c)).join(' / ')||money(0,'GBP');
};
function buildPriorities(){
  const items=[];
  const add=(b,title,text,tone='info',action='open',eventDate=null,score=20)=>{
    items.push({booking:b,title,text,tone,action,date:eventDate||bookingPrimaryDate(b),score});
  };
  activeBookings().forEach(b=>{
    const type=b.booking_type||'villa_stay',resource=primaryResource(b),primaryDate=bookingPrimaryDate(b);
    const days=daysFromToday(primaryDate),nextDate=nextPaymentDateFor(b),nextDays=daysFromToday(nextDate),nextAmount=nextPaymentAmountFor(b);

    if(nextAmount>0&&nextDate){
      if(nextDays<0)add(b,'Guest payment overdue',`${money(nextAmount,bookingCurrency(b))} was due ${date(nextDate)}`,'urgent','payment',nextDate,120);
      else if(nextDays===0)add(b,'Guest payment due today',`${money(nextAmount,bookingCurrency(b))} due today`,'urgent','payment',nextDate,115);
      else if(nextDays===1)add(b,'Guest payment due tomorrow',`${money(nextAmount,bookingCurrency(b))} due ${date(nextDate)}`,'soon','payment',nextDate,95);
      else if(nextDays!==null&&nextDays<=7)add(b,'Guest payment due this week',`${money(nextAmount,bookingCurrency(b))} due ${date(nextDate)}`,'soon','payment',nextDate,80-nextDays);
    }

    const supplier=supplierOwedFor(b),supplierDate=nextDate||primaryDate,supplierDays=daysFromToday(supplierDate);
    if(supplier>0&&supplierDate){
      if(supplierDays<0)add(b,'Supplier payment overdue',`${money(supplier,supplierCurrencyFor(b))} • ${resource}`,'urgent','open',supplierDate,118);
      else if(supplierDays===0)add(b,'Supplier payment due today',`${money(supplier,supplierCurrencyFor(b))} • ${resource}`,'urgent','open',supplierDate,110);
      else if(supplierDays!==null&&supplierDays<=7)add(b,'Supplier payment due soon',`${money(supplier,supplierCurrencyFor(b))} • ${date(supplierDate)}`,'soon','open',supplierDate,78-supplierDays);
    }

    if(type==='villa_stay'){
      const arrivalDays=daysFromToday(b.arrival_date),departureDays=daysFromToday(b.departure_date);
      if(arrivalDays===0)add(b,'Villa arrival today',`${resource} • ${b.number_of_guests||'—'} guests`,'urgent','open',b.arrival_date,105);
      else if(arrivalDays===1)add(b,'Villa arrival tomorrow',`${resource} • ${b.number_of_guests||'—'} guests`,'soon','open',b.arrival_date,90);
      else if(arrivalDays!==null&&arrivalDays>1&&arrivalDays<=7)add(b,'Villa arrival this week',`${resource} • ${date(b.arrival_date)}`,'info','open',b.arrival_date,55-arrivalDays);
      if(departureDays===0)add(b,'Villa departure today',`${resource} • ${b.number_of_guests||'—'} guests`,'urgent','open',b.departure_date,100);
      else if(departureDays===1)add(b,'Villa departure tomorrow',`${resource} • ${date(b.departure_date)}`,'soon','open',b.departure_date,85);
      const hasTravel=Boolean(b.arrival_flight||b.departure_flight||b.flight_details);
      if(arrivalDays!==null&&arrivalDays>=0&&arrivalDays<=14&&!hasTravel)add(b,'Flight details required',`Flight details are still missing for ${resource}`,'soon','open',b.arrival_date,82-arrivalDays);
    }

    if(type==='boat_charter'){
      const bt=bookingBoat(b.id),sail=bt?.charter_date||b.service_date,sd=daysFromToday(sail);
      if(sd===0)add(b,'Boat sailing today',`${resource} • ${bt?.departure_marina||b.event_location||'Marina not recorded'} • ${bt?.start_time||'Time not recorded'}`,'urgent','open',sail,108);
      else if(sd===1)add(b,'Boat sailing tomorrow',`${resource} • ${date(sail)}`,'soon','open',sail,92);
      else if(sd!==null&&sd>1&&sd<=7)add(b,'Boat sailing this week',`${resource} • ${date(sail)}`,'info','open',sail,58-sd);
      if(!boatIsConfirmed(b)&&sd!==null&&sd>=0)add(b,'Boat confirmation required',`${resource} • ${date(sail)}`,'urgent','open',sail,112);
    }

    if(type==='private_chef'){
      const ch=bookingChef(b.id),eventDate=ch?.event_date||b.service_date,ed=daysFromToday(eventDate);
      if(ed===0)add(b,'Chef booking today',`${resource} • ${ch?.event_time||'Time not recorded'}`,'urgent','open',eventDate,104);
      else if(ed===1)add(b,'Chef booking tomorrow',`${resource} • ${date(eventDate)}`,'soon','open',eventDate,88);
      else if(ed!==null&&ed>1&&ed<=7)add(b,'Chef booking this week',`${resource} • ${date(eventDate)}`,'info','open',eventDate,54-ed);
    }

    if(String(b.notes||'').trim()&&days!==null&&days>=0&&days<=14){
      add(b,'Important booking note',String(b.notes).trim().slice(0,180),'info','open',primaryDate,40-Math.min(days,14));
    }
    if(!b.guest_phone&&!b.guest_email){
      add(b,'Guest contact details missing',`No email or telephone recorded for ${b.guest_name}`,'info','open',primaryDate,25);
    }
  });
  return items.sort((a,b)=>b.score-a.score||String(a.date||'9999-12-31').localeCompare(String(b.date||'9999-12-31')));
}

function addOperationalEvent(list,event){if(!event?.booking||!event.date)return;list.push({...event,date:String(event.date).slice(0,10),time:event.time||'',status:event.status||'info'});}

function dailyOpsDate(){return $('dailyOperationsDate')?.value||todayISO();}
function dailyMoneyDueForDate(day){
  const guest=[],supplier=[];
  activeBookings().forEach(b=>{
    if(nextPaymentAmountFor(b)>0&&nextPaymentDateFor(b)===day)guest.push(b);
    const supplierDate=supplierPaymentDateFor(b);
    if(supplierOwedFor(b)>0&&supplierDate===day)supplier.push(b);
  });
  return {guest,supplier};
}
function dailyCustomerLine(b){return `${esc(b.guest_name||'Guest')}${b.guest_phone?` • ${esc(b.guest_phone)}`:''}`;}
function dailyCard(type,title,time,guest,detail,meta,bookingId,tone='info'){
  return `<article class="daily-op-card ${tone}"><div class="daily-op-time">${esc(time||'All day')}</div><div class="daily-op-type">${esc(type)}</div><div class="daily-op-copy"><strong>${esc(title)}</strong><span>${guest}</span><small>${detail}</small>${meta?`<em>${meta}</em>`:''}</div><button class="button secondary compact" onclick="openDetailResponsive('${bookingId}',this)">Open</button></article>`;
}


function dailyCustomerGroupKey(b){
  const customer=customerRecordForBooking(b);
  return String(
    customer.itinerary_id||
    customer.customer_id||
    customer.key||
    b?.itinerary_id||
    b?.customer_id||
    normaliseCustomerValue(b?.guest_email)||
    normalisePhone(b?.guest_phone)||
    normaliseCustomerValue(b?.guest_name)||
    b?.id||
    'unknown'
  );
}
function dailyBookingServiceSignature(b){
  const type=b?.booking_type||'villa_stay';
  if(type==='boat_charter'){
    const bt=bookingBoat(b.id);
    return `boat:${canonicalOperationalResource(bt?.boat_name||b.service_title||primaryResource(b))}`;
  }
  if(type==='villa_stay')return `villa:${canonicalOperationalResource(primaryResource(b))}`;
  if(type==='private_chef'){
    const ch=bookingChef(b.id);
    return `chef:${canonicalOperationalResource(ch?.chef_name||primaryResource(b))}`;
  }
  return `${type}:${canonicalOperationalResource(primaryResource(b))}`;
}
function dailyBookingsLikelySameCustomer(a,b,day){
  if(!a||!b)return false;

  // Strong identity always wins.
  if(a.customer_id&&b.customer_id&&String(a.customer_id)===String(b.customer_id))return true;
  if(a.itinerary_id&&b.itinerary_id&&String(a.itinerary_id)===String(b.itinerary_id))return true;

  const ae=normaliseCustomerValue(a.guest_email),be=normaliseCustomerValue(b.guest_email);
  if(ae&&be&&ae===be)return true;
  const ap=normalisePhone(a.guest_phone),bp=normalisePhone(b.guest_phone);
  if(ap&&bp&&ap===bp)return true;

  // Legacy fallback: Grace / Grace Rathbone can only collapse when:
  // 1) names are compatible,
  // 2) same operational day,
  // 3) same booking/service type and same resource (e.g. Vibe).
  if(!compatibleGuestNames(a.guest_name,b.guest_name))return false;

  const aDate=(a.booking_type==='villa_stay'?a.arrival_date:(bookingBoat(a.id)?.charter_date||bookingChef(a.id)?.event_date||a.service_date||a.arrival_date));
  const bDate=(b.booking_type==='villa_stay'?b.arrival_date:(bookingBoat(b.id)?.charter_date||bookingChef(b.id)?.event_date||b.service_date||b.arrival_date));
  if(aDate&&bDate&&aDate!==bDate)return false;
  if(day&&aDate&&aDate!==day)return false;
  if(day&&bDate&&bDate!==day)return false;

  if((a.booking_type||'villa_stay')!==(b.booking_type||'villa_stay'))return false;
  return dailyBookingServiceSignature(a)===dailyBookingServiceSignature(b);
}
function dailyPreferredBooking(rows){
  return rows.slice().sort((a,b)=>{
    let as=0,bs=0;
    if(a.customer_id)as+=20;if(b.customer_id)bs+=20;
    if(a.itinerary_id)as+=20;if(b.itinerary_id)bs+=20;
    if(a.guest_email)as+=8;if(b.guest_email)bs+=8;
    if(a.guest_phone)as+=8;if(b.guest_phone)bs+=8;
    as+=customerDisplayNameScore(a.guest_name)/10;
    bs+=customerDisplayNameScore(b.guest_name)/10;

    const ab=bookingBoat(a.id),bb=bookingBoat(b.id);
    if(ab?.start_time)as+=15;if(bb?.start_time)bs+=15;
    if(ab?.departure_marina)as+=12;if(bb?.departure_marina)bs+=12;
    if(ab?.guests||a.number_of_guests)as+=10;
    if(bb?.guests||b.number_of_guests)bs+=10;

    return bs-as;
  })[0]||rows[0];
}
function dailyCustomerGroupHeaderFromRows(rows,count){
  const preferred=dailyPreferredBooking(rows);
  const names=rows.map(x=>x.guest_name).filter(Boolean);
  const displayName=names.reduce((best,n)=>preferredCustomerName(best,n),'')||preferred.guest_name||'Guest';

  // Use the best available contact from either legacy row.
  const phone=rows.find(x=>x.guest_phone)?.guest_phone||'';
  const email=rows.find(x=>x.guest_email)?.guest_email||'';
  const contact=phone||email||'Contact not recorded';

  // Count unique linked booking IDs, but don't let legacy duplicate rows inflate the customer summary.
  const linkedCount=new Set(rows.map(x=>x.itinerary_id||x.customer_id||x.id)).size;

  return `<div class="daily-customer-head">
    <div class="daily-customer-avatar">${esc(displayName.charAt(0).toUpperCase())}</div>
    <div class="daily-customer-identity">
      <span>Guest itinerary</span>
      <strong>${esc(displayName)}</strong>
      <small>${esc(contact)} • ${linkedCount} linked booking${linkedCount===1?'':'s'}</small>
    </div>
    <div class="daily-customer-count">${count} item${count===1?'':'s'} today</div>
    <button class="button secondary compact" onclick="openDetailResponsive('${preferred.id}',this)">Open itinerary</button>
  </div>`;
}
function dailyRange(){
  const mode=$('dailyPeriodSelect')?.value||'today';
  const base=$('dailyOperationsDate')?.value||todayISO();
  const start=new Date(base+'T12:00:00');
  const end=new Date(start);
  let label='Today';
  if(mode==='tomorrow'){start.setDate(start.getDate()+1);end.setTime(start.getTime());label='Tomorrow';}
  else if(mode==='week'){end.setDate(start.getDate()+6);label='This week';}
  else if(mode==='month'){end.setMonth(end.getMonth()+1,0);label='This month';}
  return {mode,start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),label};
}
function inDailyRange(value,range){return Boolean(value&&value>=range.start&&value<=range.end);}
function renderDailyOperations(){
  const range=dailyRange();
  if($('dailyOperationsTitle'))$('dailyOperationsTitle').textContent=`Daily Operations — ${range.label}`;
  const cards=[];
  const arrivals=activeBookings().filter(b=>b.booking_type==='villa_stay'&&inDailyRange(b.arrival_date,range));
  const departures=activeBookings().filter(b=>b.booking_type==='villa_stay'&&inDailyRange(b.departure_date,range));
  const boatList=activeBookings().filter(b=>b.booking_type==='boat_charter'&&inDailyRange(bookingBoat(b.id)?.charter_date||b.service_date,range));
  const chefList=activeBookings().filter(b=>b.booking_type==='private_chef'&&inDailyRange(bookingChef(b.id)?.event_date||b.service_date,range));
  const otherList=activeBookings().filter(b=>!['villa_stay','boat_charter','private_chef'].includes(b.booking_type)&&inDailyRange(b.service_date,range));

  const moneyDue={guest:[],supplier:[]};
  activeBookings().forEach(b=>{
    if(nextPaymentAmountFor(b)>0&&inDailyRange(nextPaymentDateFor(b),range))moneyDue.guest.push(b);
    const supplierDate=supplierPaymentDateFor(b);
    if(supplierOwedFor(b)>0&&inDailyRange(supplierDate,range))moneyDue.supplier.push(b);
  });

  const push=(day,sort,html,booking)=>cards.push({day,sort,html,booking});
  arrivals.forEach(b=>push(b.arrival_date,b.arrival_time||'14:00',dailyCard('ARRIVAL',`${primaryResource(b)} arrival`,b.arrival_time||'Arrival','',`${b.number_of_guests||'—'} guests${b.arrival_flight?` • Flight ${esc(b.arrival_flight)}`:''}`,b.notes?esc(b.notes):'',b.id,'arrival'),b));
  departures.forEach(b=>push(b.departure_date,b.departure_time||'10:00',dailyCard('DEPARTURE',`${primaryResource(b)} departure`,b.departure_time||'Departure','',`${b.number_of_guests||'—'} guests${b.departure_flight?` • Flight ${esc(b.departure_flight)}`:''}`,'',b.id,'departure'),b));
  boatList.forEach(b=>{const bt=bookingBoat(b.id);const day=bt?.charter_date||b.service_date;push(day,bt?.start_time||'12:00',dailyCard('BOAT',`${bt?.boat_name||primaryResource(b)} sailing`,bt?.start_time||'Sailing','',`${bt?.departure_marina||b.event_location||'Marina not recorded'} • ${bt?.guests||b.number_of_guests||'—'} guests${bt?.duration_hours?` • ${bt.duration_hours} hrs`:''}`,bt?.notes?esc(bt.notes):'',b.id,'boat'),b)});
  chefList.forEach(b=>{const ch=bookingChef(b.id);const day=ch?.event_date||b.service_date;push(day,ch?.event_time||'18:00',dailyCard('CHEF',ch?.chef_name||'Private chef',ch?.event_time||'Event','',`${ch?.guests||b.number_of_guests||'—'} guests${ch?.menu?` • ${esc(ch.menu)}`:''}`,ch?.dietary_requirements?`Dietary: ${esc(ch.dietary_requirements)}`:'',b.id,'chef'),b)});
  otherList.forEach(b=>push(b.service_date,'12:00',dailyCard(bookingTypeLabel(b.booking_type).toUpperCase(),primaryResource(b),'All day','',b.event_location?esc(b.event_location):'',b.notes?esc(b.notes):'',b.id,'service'),b));
  moneyDue.guest.forEach(b=>push(nextPaymentDateFor(b),'08:00',dailyCard('GUEST PAYMENT','Guest payment due','08:00','',`${money(nextPaymentAmountFor(b),nextPaymentCurrencyFor(b))} due`,paymentSummaryFor(b),b.id,'money'),b));
  moneyDue.supplier.forEach(b=>{const d=supplierPaymentDateFor(b);push(d,'08:30',dailyCard('SUPPLIER','Supplier payment due','08:30','',`${money(supplierOwedFor(b),supplierCurrencyFor(b))} • ${esc(primaryResource(b))}`,'',b.id,'supplier'),b)});

  cards.sort((a,b)=>a.day.localeCompare(b.day)||String(a.sort).localeCompare(String(b.sort)));

  const guestTotals={GBP:0,EUR:0},supplierTotals={GBP:0,EUR:0};
  moneyDue.guest.forEach(b=>guestTotals[bookingCurrency(b)]+=nextPaymentAmountFor(b));
  moneyDue.supplier.forEach(b=>supplierTotals[supplierCurrencyFor(b)]+=supplierOwedFor(b));
  const dual=t=>['GBP','EUR'].filter(c=>t[c]>0).map(c=>money(t[c],c)).join(' / ')||'—';

  $('dailySummary').innerHTML=[
    ['Arrivals',arrivals.length],['Departures',departures.length],['Boats',boatList.length],['Chefs / services',chefList.length+otherList.length],['Guest money due',dual(guestTotals)],['Supplier money due',dual(supplierTotals)]
  ].map(([label,value])=>`<div class="daily-summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('');

  const grouped=new Map();
  cards.forEach(c=>{if(!grouped.has(c.day))grouped.set(c.day,[]);grouped.get(c.day).push(c);});
  $('dailyOperationsFeed').innerHTML=cards.length?[...grouped.entries()].map(([day,items])=>{
    const guestGroups=[];

    items.forEach(item=>{
      // First try exact/strong identity.
      let group=guestGroups.find(g=>g.items.some(existing=>
        dailyCustomerGroupKey(existing.booking)===dailyCustomerGroupKey(item.booking)
      ));

      // Then legacy first-name/full-name match, but only with same service evidence.
      if(!group){
        group=guestGroups.find(g=>g.items.some(existing=>
          dailyBookingsLikelySameCustomer(existing.booking,item.booking,day)
        ));
      }

      if(!group){
        group={items:[]};
        guestGroups.push(group);
      }
      group.items.push(item);
    });

    const guestBlocks=guestGroups.map(group=>{
      const groupItems=group.items;
      groupItems.sort((a,b)=>String(a.sort).localeCompare(String(b.sort)));

      // Remove duplicate same-kind operational cards inside the merged itinerary.
      const deduped=[];
      groupItems.forEach(item=>{
        const semantic = item.html.includes('GUEST PAYMENT') ? 'guest_payment' :
                         item.html.includes('SUPPLIER') ? 'supplier_payment' :
                         item.html.includes('BOAT') ? 'boat' :
                         item.html.includes('ARRIVAL') ? 'arrival' :
                         item.html.includes('DEPARTURE') ? 'departure' :
                         item.html.includes('CHEF') ? 'chef' : 'service';

        let existing=deduped.find(x=>{
          if(x.semantic!==semantic)return false;
          if(semantic==='boat'){
            return dailyBookingServiceSignature(x.item.booking)===dailyBookingServiceSignature(item.booking);
          }
          return true;
        });

        if(!existing){
          deduped.push({semantic,item});
          return;
        }

        // Prefer the card connected to the fuller booking record.
        const best=dailyPreferredBooking([existing.item.booking,item.booking]);
        if(String(best.id)===String(item.booking.id))existing.item=item;
      });

      const finalItems=deduped.map(x=>x.item);
      const rowBookings=[...new Map(groupItems.map(x=>[String(x.booking.id),x.booking])).values()];
      return `<section class="daily-customer-group">${dailyCustomerGroupHeaderFromRows(rowBookings,finalItems.length)}<div class="daily-customer-items">${finalItems.map(c=>c.html).join('')}</div></section>`;
    }).join('');

    const itemCount=guestGroups.reduce((sum,g)=>{
      const seen=new Set();
      g.items.forEach(item=>{
        const semantic = item.html.includes('GUEST PAYMENT') ? 'guest_payment' :
                         item.html.includes('SUPPLIER') ? 'supplier_payment' :
                         item.html.includes('BOAT') ? `boat:${dailyBookingServiceSignature(item.booking)}` :
                         item.html.includes('ARRIVAL') ? 'arrival' :
                         item.html.includes('DEPARTURE') ? 'departure' :
                         item.html.includes('CHEF') ? 'chef' : `service:${item.booking.id}`;
        seen.add(semantic);
      });
      return sum+seen.size;
    },0);

    return `<section class="daily-day-group"><div class="daily-date-banner"><strong>${new Date(day+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong><span>${itemCount} operational item${itemCount===1?'':'s'} • ${guestGroups.length} guest${guestGroups.length===1?'':'s'}</span></div>${guestBlocks}</section>`;
  }).join(''):`<div class="priority-empty"><span>✓</span><div><strong>No operations recorded for ${range.label.toLowerCase()}</strong><p>Change the period or date to look ahead.</p></div></div>`;
}

function buildOperationalEvents(){
  const events=[];
  buildPriorities().forEach(p=>addOperationalEvent(events,{booking:p.booking,date:p.date||bookingPrimaryDate(p.booking)||todayISO(),title:p.title,detail:p.text,category:'priority',status:p.tone}));

  activeBookings().forEach(b=>{
    const type=b.booking_type||'villa_stay',currency=bookingCurrency(b),resource=primaryResource(b);
    const nextAmount=nextPaymentAmountFor(b),nextDue=nextPaymentDateFor(b),supplierDue=supplierOwedFor(b),primaryDate=bookingPrimaryDate(b);
    addOperationalEvent(events,{booking:b,date:b.created_at,title:'Booking created',detail:`${bookingTypeLabel(type)} • ${resource}`,category:type==='villa_stay'?'villa':type==='boat_charter'?'boat':'concierge',status:'info'});
    if(depositPaidFor(b)>0)addOperationalEvent(events,{booking:b,date:depositPaidDateFor(b)||b.created_at,title:'Deposit received',detail:`${money(depositPaidFor(b),currency)}`,category:'financial',status:'complete'});
    if(nextAmount>0&&nextDue){const days=daysFromToday(nextDue);addOperationalEvent(events,{booking:b,date:nextDue,title:days<0?'Guest payment overdue':'Guest payment due',detail:`${money(nextAmount,currency)} • ${nextPaymentStageLabel(b)}`,category:'financial',status:days<0?'urgent':days<=7?'soon':'info'});}
    if(supplierDue>0){const d=nextDue||primaryDate||b.arrival_date||b.service_date;addOperationalEvent(events,{booking:b,date:d,title:'Supplier payment due',detail:`${money(supplierDue,supplierCurrencyFor(b))} • ${resource}`,category:'financial',status:daysFromToday(d)<0?'urgent':'soon'});}
    if(type==='villa_stay'){
      if(b.arrival_date)addOperationalEvent(events,{booking:b,date:b.arrival_date,time:b.arrival_time||'',title:'Villa arrival',detail:`${resource} • ${b.number_of_guests||'—'} guests`,category:'villa',status:'info'});
      if(b.departure_date)addOperationalEvent(events,{booking:b,date:b.departure_date,time:b.departure_time||'',title:'Villa departure',detail:resource,category:'villa',status:'info'});
      const days=daysFromToday(b.arrival_date),hasTravel=Boolean(b.arrival_flight||b.departure_flight||b.flight_details);
      if(days!==null&&days>=0&&days<=7&&!hasTravel)addOperationalEvent(events,{booking:b,date:b.arrival_date,title:'Flight details missing',detail:`Arrival at ${resource}`,category:'villa',status:'urgent'});
    }
    if(type==='boat_charter'){
      const bt=bookingBoat(b.id),boat=bt?.boat_name||b.service_title||'Boat charter',sailDate=bt?.charter_date||b.service_date,marina=bt?.departure_marina||b.event_location||'Marina not recorded';
      if(sailDate)addOperationalEvent(events,{booking:b,date:sailDate,time:bt?.start_time||'',title:'Boat sailing',detail:`${boat} • ${marina}${bt?.guests?` • ${bt.guests} guests`:''}`,category:'boat',status:boatIsConfirmed(b)?'complete':'urgent'});
      if(!boatIsConfirmed(b)&&sailDate)addOperationalEvent(events,{booking:b,date:sailDate,title:'Boat confirmation required',detail:`${boat} • ${marina}`,category:'boat',status:'urgent'});
    }
    const ch=bookingChef(b.id);if(ch?.event_date)addOperationalEvent(events,{booking:b,date:ch.event_date,time:ch.event_time||'',title:'Private chef',detail:`${ch.chef_name||'Chef'}${ch.guests?` • ${ch.guests} guests`:''}`,category:'concierge',status:['confirmed','completed'].includes(ch.status)?'complete':'soon'});
    ['decorations','shopping','beach_club','entertainment'].forEach(cat=>{const ex=experienceFor(b.id,cat);if(ex?.event_date)addOperationalEvent(events,{booking:b,date:ex.event_date,time:ex.event_time||'',title:cat.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),detail:ex.title||ex.notes||resource,category:'concierge',status:serviceDone(ex.status)?'complete':'soon'});});
    if(b.payment_strategy_notes)addOperationalEvent(events,{booking:b,date:nextPaymentDateFor(b)||bookingPrimaryDate(b)||b.created_at,title:'Payment arrangement',detail:paymentSummaryFor(b),category:'financial',status:balanceFor(b)>0?'info':'complete'});
    if(b.payment_notes)addOperationalEvent(events,{booking:b,date:b.payment_notes_updated_at||b.created_at,title:'Payment note',detail:b.payment_notes,category:'financial',status:'info'});
    if(b.notes)addOperationalEvent(events,{booking:b,date:b.updated_at||b.created_at,title:'Booking note',detail:b.notes,category:type==='villa_stay'?'villa':type==='boat_charter'?'boat':'concierge',status:'info'});
  });
  return events.sort((a,b)=>new Date(`${a.date}T${a.time||'00:00'}`)-new Date(`${b.date}T${b.time||'00:00'}`));
}

function operationalSemanticTitle(title=''){
  const t=String(title).toLowerCase();
  if(t.includes('supplier payment due'))return 'supplier_payment_due';
  if(t.includes('guest payment due')||t.includes('guest payment overdue'))return 'guest_payment_due';
  if(t.includes('flight details'))return 'flight_details_missing';
  if(t.includes('payment arrangement'))return 'payment_arrangement';
  if(t.includes('important booking note')||t==='booking note')return 'booking_note';
  if(t.includes('guest contact details missing')||t.includes('contact details missing'))return 'guest_contact_missing';
  if(t.includes('boat sailing'))return 'boat_sailing';
  if(t.includes('villa arrival'))return 'villa_arrival';
  if(t.includes('villa departure'))return 'villa_departure';
  if(t.includes('chef'))return 'chef_service';
  return t.replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
}


function normalisedNameWords(value=''){
  return normaliseCustomerValue(value).split(/\s+/).filter(Boolean);
}
function compatibleGuestNames(a,b){
  const aw=normalisedNameWords(a),bw=normalisedNameWords(b);
  if(!aw.length||!bw.length)return false;
  const as=aw.join(' '),bs=bw.join(' ');
  if(as===bs)return true;
  // Safe-ish fallback for legacy first-name-only records:
  // "Grace" and "Grace Rathbone" are compatible, but "Grace" and "Gracie" are not.
  if(aw.length===1&&bw.length>1&&aw[0]===bw[0])return true;
  if(bw.length===1&&aw.length>1&&bw[0]===aw[0])return true;
  return false;
}

function operationalCustomerKey(event){
  const b=event?.booking||{};
  const customer=customerRecordForBooking(b);
  return String(
    customer.itinerary_id||
    customer.customer_id||
    customer.key||
    b.itinerary_id||
    b.customer_id||
    normaliseCustomerValue(b.guest_email)||
    normalisePhone(b.guest_phone)||
    normaliseCustomerValue(b.guest_name)||
    b.id||
    'none'
  );
}
function canonicalOperationalResource(value=''){
  const raw=normaliseCustomerValue(value);
  const aliases={
    'big boat':'vibe',
    'bigboat':'vibe',
    'small boat':'saxador',
    'smallboat':'saxador'
  };
  return aliases[raw]||raw;
}
function operationalResourceKey(event){
  const b=event?.booking||{};
  if(operationalSemanticTitle(event?.title)==='boat_sailing'){
    const bt=bookingBoat(b.id);
    return canonicalOperationalResource(bt?.boat_name||b.service_title||primaryResource(b));
  }
  return canonicalOperationalResource(primaryResource(b));
}
function operationalTaskKey(event){
  const semantic=operationalSemanticTitle(event.title);
  const resource=operationalResourceKey(event);

  if(['boat_sailing','chef_service','villa_arrival','villa_departure'].includes(semantic)){
    return `${operationalCustomerKey(event)}|${semantic}|${event.date||''}|${resource}`;
  }

  if([
    'supplier_payment_due',
    'guest_payment_due',
    'payment_arrangement',
    'flight_details_missing',
    'booking_note',
    'guest_contact_missing'
  ].includes(semantic)){
    return `${operationalCustomerKey(event)}|${semantic}|${event.date||''}`;
  }

  return `${operationalCustomerKey(event)}|${semantic}|${event.date||''}|${resource}`;
}
function isOperationalTaskDismissed(event){
  const key=operationalTaskKey(event);
  return taskDismissals.some(x=>x.task_key===key);
}
function operationalEventQuality(e){
  const b=e?.booking||{};
  const detail=String(e?.detail||'').toLowerCase();
  let score=0;

  if(b.customer_id)score+=20;
  if(b.itinerary_id)score+=20;
  if(b.guest_email)score+=8;
  if(b.guest_phone)score+=8;
  score+=Math.min(15,customerDisplayNameScore(b.guest_name)/20);

  if(e?.time)score+=18;
  if(detail.includes('puerto banús')||detail.includes('puerto banus'))score+=12;
  if(detail.match(/\b\d+\s+guests?\b/))score+=10;
  if(!detail.includes('not recorded'))score+=12;
  if(!detail.includes('— guests'))score+=4;

  if(e?.category!=='priority')score+=8;
  if(!String(e?.title||'').toLowerCase().includes('soon')&&!String(e?.title||'').toLowerCase().includes('this week'))score+=5;
  if(e?.status==='complete')score+=4;

  return score;
}

function operationalComparableKey(event){
  const semantic=operationalSemanticTitle(event?.title||'');
  const resource=operationalResourceKey(event);
  // All customer-facing operational feeds use the same event identity:
  // semantic task + date + resource. Customer compatibility is checked separately.
  return `${semantic}|${event?.date||''}|${resource}`;
}
function operationalMoneyValues(text=''){
  return [...String(text).matchAll(/[€£]\s?([\d,.]+)/g)].map(m=>`${m[0].trim()}`);
}
function mergeOperationalEventDetails(primary,secondary){
  const result={...primary};
  if(!result.time&&secondary.time)result.time=secondary.time;

  const a=String(result.detail||''), b=String(secondary.detail||'');
  const aWeak=!a||a.toLowerCase().includes('not recorded')||a.includes('— guests');
  const bBetter=b&&!b.toLowerCase().includes('not recorded')&&!b.includes('— guests');
  if(aWeak&&bBetter)result.detail=secondary.detail;

  // For notes, retain useful distinct wording from both legacy rows.
  const semantic=operationalSemanticTitle(result.title);
  if(semantic==='booking_note'&&a&&b&&a!==b&&!a.includes(b)&&!b.includes(a)){
    result.detail=`${a} | ${b}`;
  }

  // If duplicate financial reminders disagree, keep one event but flag the discrepancy.
  if(['payment_arrangement','guest_payment_due','supplier_payment_due'].includes(semantic)){
    const amounts=[...new Set([...operationalMoneyValues(a),...operationalMoneyValues(b)])];
    if(amounts.length>1&&!String(result.detail||'').includes('Check figures')){
      result.detail=`${result.detail} • Check figures: ${amounts.join(' / ')}`;
    }
  }

  if(operationalEventQuality(secondary)>operationalEventQuality(primary))result.booking=secondary.booking;

  // Always display the fullest compatible guest name.
  const bestName=preferredCustomerName(primary.booking?.guest_name||'',secondary.booking?.guest_name||'');
  result.booking={...result.booking,guest_name:bestName};
  return result;
}
function dedupeOperationalEvents(events){
  const clusters=[];

  events.forEach(e=>{
    const comparable=operationalComparableKey(e);

    // First prefer an exact/strong operational task identity.
    let index=clusters.findIndex(c=>c.strongKey===operationalTaskKey(e));

    // Then collapse legacy first-name/full-name versions across ALL operational
    // event types when the semantic/date/resource match.
    if(index<0){
      index=clusters.findIndex(c=>
        c.comparable===comparable &&
        compatibleGuestNames(c.event.booking?.guest_name,e.booking?.guest_name)
      );
    }

    if(index<0){
      clusters.push({strongKey:operationalTaskKey(e),comparable,event:e});
      return;
    }

    const current=clusters[index].event;
    const currentScore=operationalEventQuality(current);
    const nextScore=operationalEventQuality(e);
    const winner=nextScore>currentScore?e:current;
    const loser=winner===e?current:e;
    clusters[index].event=mergeOperationalEventDetails(winner,loser);
    clusters[index].strongKey=operationalTaskKey(clusters[index].event);
  });

  return clusters.map(c=>c.event);
}


function setButtonBusy(button,busy=true,label='Working…'){
  if(!button)return;
  if(busy){
    if(button.dataset.busy==='1')return false;
    button.dataset.busy='1';
    button.dataset.originalText=button.textContent;
    button.classList.add('is-busy');
    button.disabled=true;
    button.textContent=label;
    return true;
  }
  button.dataset.busy='0';
  button.classList.remove('is-busy');
  button.disabled=false;
  if(button.dataset.originalText)button.textContent=button.dataset.originalText;
  return true;
}

async function dismissOperationalTask(taskKey,button=null){
  if(button&&!setButtonBusy(button,true,'Done…'))return;
  const event=canonicalOperationalFeed().find(e=>operationalTaskKey(e)===taskKey);
  if(!event)return;
  const payload={task_key:taskKey,booking_id:event.booking.id,task_type:operationalSemanticTitle(event.title),task_date:event.date,dismissed_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('operational_task_dismissals').upsert(payload,{onConflict:'task_key'});
  if(error){setButtonBusy(button,false);alert(`Could not mark task Done: ${error.message}`);return;}
  taskDismissals=taskDismissals.filter(x=>x.task_key!==taskKey).concat(payload);
  operationalFeedCache={revision:-1,events:[]};
  renderOperationsCentre();
  renderPriorities();
}
function scopeOperationalEvents(events){
  if(operationsTimeScope==='all')return events;
  return events.filter(e=>{
    const d=daysFromToday(e.date);
    if(d===null)return operationsTimeScope==='upcoming';
    if(operationsTimeScope==='previous')return d<0&&e.status!=='urgent';
    return d>=0||e.status==='urgent';
  });
}

function canonicalOperationalFeed(){
  if(operationalFeedCache.revision!==dataRevision){
    operationalFeedCache={
      revision:dataRevision,
      events:dedupeOperationalEvents(buildOperationalEvents()).filter(e=>!isOperationalTaskDismissed(e))
    };
  }
  return operationalFeedCache.events;
}
function filterOperationalEvents(events){
  // Demo 2: callers pass the canonical feed, so filtering stays lightweight.
  events=events||canonicalOperationalFeed();
  let filtered;
  if(operationsFilter==='priorities')filtered=events.filter(e=>e.category==='priority');
  else if(operationsFilter==='all')filtered=events.filter(e=>e.category!=='priority');
  else if(operationsFilter==='action')filtered=events.filter(e=>['urgent','soon'].includes(e.status));
  else if(operationsFilter==='today')filtered=events.filter(e=>daysFromToday(e.date)===0);
  else if(operationsFilter==='week')filtered=events.filter(e=>{const d=daysFromToday(e.date);return d!==null&&d>=0&&d<=7;});
  else if(operationsFilter==='overdue')filtered=events.filter(e=>e.status==='urgent'&&daysFromToday(e.date)<0);
  else filtered=events.filter(e=>e.category===operationsFilter);
  if(['today','week','overdue'].includes(operationsFilter))return filtered;
  return scopeOperationalEvents(filtered);
}
function eventStatusLabel(status){return status==='urgent'?'Action required':status==='soon'?'Due soon':status==='complete'?'Confirmed':'Information';}
function renderOperationsCentre(){
  const feed=$('operationsFeed');if(!feed)return;
  const events=filterOperationalEvents(canonicalOperationalFeed());
  $('operationsCount').textContent=`${events.length} ${events.length===1?'event':'events'}`;
  if(!events.length){feed.innerHTML='<div class="priority-empty"><span>✓</span><div><strong>No matching operational events</strong><p>Try a different filter or time period.</p></div></div>';return;}

  const months=new Map();
  events.forEach(e=>{
    const month=e.date.slice(0,7);
    if(!months.has(month))months.set(month,new Map());
    const days=months.get(month);
    if(!days.has(e.date))days.set(e.date,[]);
    days.get(e.date).push(e);
  });

  feed.innerHTML=[...months.entries()].map(([month,days])=>{
    const monthLabel=new Date(month+'-01T12:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'}).toUpperCase();
    const dayHtml=[...days.entries()].map(([day,items])=>`<section class="operations-day">
      <div class="operations-day-head"><span>${new Date(day+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long'})}</span><strong>${date(day)}</strong></div>
      <div class="operations-day-events">${items.map(e=>{
        const key=operationalTaskKey(e);
        return `<article class="operations-event ${e.status}">
          <span class="operations-time">${e.time||'All day'}</span>
          <span class="operations-dot"></span>
          <span class="operations-event-copy"><strong>${esc(e.booking.guest_name)}</strong><b>${esc(e.title)}</b><small>${esc(e.detail)}</small></span>
          <span class="operations-badge">${eventStatusLabel(e.status)}</span>
          <span class="operations-event-actions"><button class="button secondary compact" onclick="openDetailResponsive('${e.booking.id}',this)">Open</button><button class="button primary compact" onclick="dismissOperationalTask('${esc(key)}',this)">Done</button></span>
        </article>`;
      }).join('')}</div>
    </section>`).join('');
    return `<section class="operations-month"><h2 class="operations-month-title">${monthLabel}</h2>${dayHtml}</section>`;
  }).join('');
}

function priorityIcon(tone){return tone==='urgent'?'!':tone==='soon'?'⌛':'•';}
function priorityActionButtons(item){
  const id=item.booking.id;
  return `<div class="priority-actions"><button class="button secondary compact" onclick="openDetail('${id}')">Open booking</button>${item.action==='payment'?`<button class="button primary compact" onclick="openPaymentModal('${id}')">Record payment</button>`:''}</div>`;
}
function renderPriorities(){
  const greeting=$('dashboardGreeting');
  if(greeting){
    const hour=new Date().getHours();
    greeting.textContent=`Good ${hour<12?'morning':hour<18?'afternoon':'evening'}, Simon.`;
  }
  const priorityEvents=dedupeOperationalEvents(buildPriorities().map(item=>({
    booking:item.booking,
    date:item.date||bookingPrimaryDate(item.booking)||todayISO(),
    title:item.title,
    detail:item.text,
    category:'priority',
    status:item.tone,
    _priority:item
  }))).filter(event=>!isOperationalTaskDismissed(event));
  const priorities=priorityEvents.map(event=>({
    ...(event._priority||{}),
    booking:event.booking,
    date:event.date,
    title:event.title,
    text:event.detail,
    tone:event.status,
    action:event._priority?.action||null
  }));
  const visible=priorities.slice(0,8);
  const today=new Date();today.setHours(0,0,0,0);
  const weekEnd=new Date(today);weekEnd.setDate(weekEnd.getDate()+7);
  const arrivalsToday=activeBookings().filter(b=>b.booking_type==='villa_stay'&&daysFromToday(b.arrival_date)===0).length;
  const arrivalsWeek=activeBookings().filter(b=>b.booking_type==='villa_stay'&&daysFromToday(b.arrival_date)!==null&&daysFromToday(b.arrival_date)>=0&&daysFromToday(b.arrival_date)<=7).length;
  const guestDue=activeBookings().filter(b=>{const d=daysFromToday(nextPaymentDateFor(b));return nextPaymentAmountFor(b)>0&&d!==null&&d>=0&&d<=7;}).map(b=>({amount:nextPaymentAmountFor(b),currency:bookingCurrency(b)}));
  const supplierDue=activeBookings().filter(b=>supplierOwedFor(b)>0).map(b=>({amount:supplierOwedFor(b),currency:supplierCurrencyFor(b)}));

  $('priorityStats').innerHTML=[
    ['Today’s arrivals',arrivalsToday],
    ['Arrivals next 7 days',arrivalsWeek],
    ['Guest money due',priorityCurrencyTotals(guestDue,'amount')],
    ['Supplier payments due',priorityCurrencyTotals(supplierDue,'amount')]
  ].map(([label,value])=>`<div class="priority-stat"><span>${label}</span><strong>${value}</strong></div>`).join('');

  $('priorityCount').textContent=`View all priorities (${priorities.length})`;
  $('prioritySummary').textContent=priorities.length?`Start with the highest priority below. ${priorities.filter(x=>x.tone==='urgent').length} urgent item${priorities.filter(x=>x.tone==='urgent').length===1?'':'s'} need attention.`:'Everything currently looks up to date.';

  $('priorityList').innerHTML=visible.length?visible.map(item=>`<article class="priority-item ${item.tone}">
    <span class="priority-icon">${priorityIcon(item.tone)}</span>
    <div class="priority-copy"><strong>${esc(item.booking.guest_name)}</strong><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div>
    ${priorityActionButtons(item)}
  </article>`).join(''):`<div class="priority-empty"><span>✓</span><div><strong>Nothing urgent right now</strong><p>Your bookings and payments are currently up to date.</p></div></div>`;
}

function renderMetrics(){
  const active=activeBookings();
  const sumBy=(currency,getter)=>active.filter(b=>bookingCurrency(b)===currency).reduce((s,b)=>s+getter(b),0);
  const commissionBy=currency=>active.filter(b=>commissionCurrency(b)===currency).reduce((s,b)=>s+commissionFor(b),0);
  const dual=getter=>['GBP','EUR'].map(c=>money(sumBy(c,getter),c)).join(' / ');
  const values=[['Confirmed bookings',active.length,'calendar'],['Business revenue',dual(b=>Number(b.total_rental||0)),'revenue'],['Payments received',dual(b=>paidForCurrency(b,bookingCurrency(b))),'deposit'],['Balances outstanding',dual(b=>balanceFor(b)),'balance'],['Commission',['GBP','EUR'].map(c=>money(commissionBy(c),c)).join(' / '),'commission'],['Currencies','GBP / EUR','cash']];
  $('metrics').innerHTML=values.map(([a,b,c])=>`<div class="metric-card ${c}"><span>${a}</span><strong>${b}</strong></div>`).join('');
}

const bookingPrimaryDate=b=>(b.booking_type==='villa_stay'?b.arrival_date:(b.service_date||b.arrival_date));
const bookingSortValue=(b,key)=>{switch(key){case'customer':return String(b.guest_name||'').toLowerCase();case'type':return bookingTypeLabel(b.booking_type).toLowerCase();case'resource':return primaryResource(b).toLowerCase();case'date':return new Date(bookingPrimaryDate(b)||'9999-12-31').getTime();case'guests':return Number(b.number_of_guests||0);case'revenue':return Number(b.total_rental||0);case'commission':return commissionFor(b);case'deposit':return depositPaidFor(b);case'next_payment':return nextPaymentAmountFor(b);case'next_due':return nextPaymentDateFor(b)?new Date(nextPaymentDateFor(b)+'T00:00:00').getTime():Number.MAX_SAFE_INTEGER;case'paid':return paidFor(b);case'balance':return balanceFor(b);case'supplier_owed':return supplierOwedFor(b);case'status':return String(b.status||'').toLowerCase();default:return 0;}};
const sortedBookings=rows=>rows.slice().sort((a,b)=>{const av=bookingSortValue(a,bookingSort.key),bv=bookingSortValue(b,bookingSort.key);const result=typeof av==='string'?av.localeCompare(bv):av-bv;return bookingSort.direction==='asc'?result:-result;});
const sortHeader=(label,key)=>`<button class="sort-header ${bookingSort.key===key?'active':''}" data-sort-key="${key}">${label}<span>${bookingSort.key===key?(bookingSort.direction==='asc'?'▲':'▼'):'↕'}</span></button>`;
function tableHtml(rows,actions=false){
  rows=sortedBookings(rows);
  if(!rows.length)return'<div class="empty">No bookings found.</div>';
  return`<div class="table-wrap"><table><thead><tr><th>${sortHeader('Customer','customer')}</th><th>${sortHeader('Type','type')}</th><th>${sortHeader('Resource','resource')}</th><th>${sortHeader('Date / stay','date')}</th><th>${sortHeader('Guests','guests')}</th><th>${sortHeader('Revenue','revenue')}</th><th>${sortHeader('Commission','commission')}</th><th>${sortHeader('Deposit paid','deposit')}</th><th>${sortHeader('Next payment','next_payment')}</th><th>${sortHeader('Due date','next_due')}</th><th>${sortHeader('Paid','paid')}</th><th>${sortHeader('Balance','balance')}</th><th>${sortHeader('Supplier owed','supplier_owed')}</th><th>${sortHeader('Status','status')}</th>${actions?'<th></th>':''}</tr></thead><tbody>${rows.map(b=>`<tr class="click-row" onclick="openDetail('${b.id}')"><td><div class="guest-cell"><span class="guest-avatar">${esc((b.guest_name||'?').charAt(0))}</span><div><strong>${esc(b.guest_name)}</strong><br><small>${esc(b.lead_source||'')}</small></div></div></td><td><span class="booking-type-pill">${esc(bookingTypeLabel(b.booking_type))}</span></td><td>${esc(bookingDisplayPlace(b))}</td><td>${bookingDisplayDates(b)}</td><td>${b.number_of_guests||'—'}</td><td>${money(b.total_rental,bookingCurrency(b))}</td><td><strong class="commission-text">${money(commissionFor(b),commissionCurrency(b))}</strong></td><td>${money(depositPaidFor(b),bookingCurrency(b))}</td><td><strong class="next-payment-text ${nextPaymentState(b)}">${nextPaymentAmountFor(b)?money(nextPaymentAmountFor(b),nextPaymentCurrencyFor(b)):'—'}</strong><small class="payment-stage">${nextPaymentAmountFor(b)?esc(nextPaymentStageLabel(b)):''}</small></td><td><span class="next-payment-date ${nextPaymentState(b)}">${nextPaymentDateFor(b)?date(nextPaymentDateFor(b)):'—'}</span></td><td>${paidBreakdown(b)}</td><td><strong class="balance-text">${money(balanceFor(b),bookingCurrency(b))}</strong></td><td><strong class="supplier-owed-text">${money(supplierOwedFor(b),supplierCurrencyFor(b))}</strong></td><td><span class="badge ${statusClass(b.status)}">${esc(b.status||'Confirmed')}</span></td>${actions?`<td onclick="event.stopPropagation()"><div class="row-actions"><button onclick="editBooking('${b.id}')">Edit</button><button onclick="deleteBooking('${b.id}')">Delete</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function bindSortHeaders(){document.querySelectorAll('[data-sort-key]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const key=btn.dataset.sortKey;if(bookingSort.key===key)bookingSort.direction=bookingSort.direction==='asc'?'desc':'asc';else{bookingSort.key=key;bookingSort.direction='asc';}renderUpcoming();renderBookings();}));}
function renderUpcoming(){const today=new Date();today.setHours(0,0,0,0);const rows=sortedBookings(activeBookings().filter(b=>{const d=bookingPrimaryDate(b);return d&&new Date(d+'T12:00:00')>=today;})).slice(0,6);$('upcomingTable').innerHTML=tableHtml(rows);bindSortHeaders();}

function itineraryKey(b){return String(b.itinerary_id||b.customer_id||customerKey(b)||b.id);}
function itineraryGroups(list){
  const map=new Map();
  list.forEach(b=>{
    const key=itineraryKey(b);
    if(!map.has(key))map.set(key,{key,bookings:[],guest_name:b.guest_name||'Unknown'});
    map.get(key).bookings.push(b);
  });
  return [...map.values()].map(group=>{
    group.bookings.sort((a,b)=>new Date(bookingPrimaryDate(a)||'9999-12-31')-new Date(bookingPrimaryDate(b)||'9999-12-31'));
    group.primary=group.bookings.find(b=>(b.booking_type||'villa_stay')==='villa_stay')||group.bookings[0];
    group.next_payment=group.bookings.filter(b=>nextPaymentAmountFor(b)>0).sort((a,b)=>new Date(nextPaymentDateFor(a)||'9999-12-31')-new Date(nextPaymentDateFor(b)||'9999-12-31'))[0]||null;
    return group;
  });
}
function groupCurrencySummary(group,getAmount,getCurrency){
  const totals={GBP:0,EUR:0};
  group.bookings.forEach(b=>{
    const currency=currencyCode(getCurrency(b)||'GBP');
    totals[currency]=(totals[currency]||0)+Number(getAmount(b)||0);
  });
  return ['GBP','EUR'].filter(c=>totals[c]>0).map(c=>money(totals[c],c)).join(' / ')||money(0,'GBP');
}
function groupServicesHtml(group){
  return group.bookings.map(b=>`<div class="group-service-row">
    <span class="badge ${statusClass(b.status)}">${esc(bookingTypeLabel(b.booking_type||'villa_stay'))}</span>
    <strong>${esc(primaryResource(b))}</strong>
    <span>${esc(bookingDisplayDates(b))}</span>
    <span>${money(b.total_rental,bookingCurrency(b))}</span>
    <button class="link-button" onclick="openDetail('${b.id}')">Open</button>
  </div>`).join('');
}
function groupedBookingsHtml(groups){
  if(!groups.length)return'<div class="empty-state">No bookings found.</div>';
  return `<div class="grouped-bookings">${groups.map(group=>{
    const p=group.primary,next=group.next_payment;
    return `<article class="guest-itinerary-card">
      <button class="guest-itinerary-head" type="button" onclick="this.closest('.guest-itinerary-card').classList.toggle('expanded')">
        <span class="initial-avatar">${esc((group.guest_name||'?').charAt(0).toUpperCase())}</span>
        <span class="guest-itinerary-name"><strong>${esc(group.guest_name)}</strong><small>${group.bookings.length} linked booking${group.bookings.length===1?'':'s'}</small></span>
        <span><small>Itinerary</small><strong>${group.bookings.map(b=>esc(primaryResource(b))).join(' • ')}</strong></span>
        <span><small>Dates</small><strong>${esc(bookingDisplayDates(p))}</strong></span>
        <span><small>Revenue</small><strong>${groupCurrencySummary(group,b=>b.total_rental,b=>bookingCurrency(b))}</strong></span>
        <span><small>Paid</small><strong>${groupCurrencySummary(group,b=>paidForCurrency(b,bookingCurrency(b)),b=>bookingCurrency(b))}</strong></span>
        <span><small>Balance</small><strong>${groupCurrencySummary(group,b=>balanceFor(b),b=>bookingCurrency(b))}</strong></span>
        <span><small>Supplier due</small><strong>${groupCurrencySummary(group,b=>supplierOwedFor(b),b=>supplierCurrencyFor(b))}</strong></span>
        <span><small>Next payment</small><strong>${next?money(nextPaymentAmountFor(next),nextPaymentCurrencyFor(next)):'—'}</strong>${nextPaymentDateFor(next)?`<small>${date(nextPaymentDateFor(next))}</small>`:''}</span>
        <span class="expand-chevron">⌄</span>
      </button>
      <div class="guest-itinerary-body">
        <div class="group-summary-strip">
          <div><span>Itinerary commission</span><strong>${groupCurrencySummary(group,b=>commissionFor(b),b=>commissionCurrency(b))}</strong></div>
          <div><span>Itinerary deposits paid</span><strong>${groupCurrencySummary(group,b=>depositPaidFor(b),b=>bookingCurrency(b))}</strong></div>
          <div><span>Itinerary supplier payments due</span><strong>${groupCurrencySummary(group,b=>supplierOwedFor(b),b=>supplierCurrencyFor(b))}</strong></div><div class="group-payment-summary"><span>Primary booking payment position</span><strong>${esc(paymentSummaryFor(group.primary))}</strong></div>
        </div>
        ${groupServicesHtml(group)}
        <div class="group-actions"><button class="button secondary" onclick="openDetail('${p.id}')">Open itinerary</button><button class="button primary" onclick="addServiceToCustomer('${p.id}')">Add to itinerary</button></div>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderBookings(){
  const q=$('searchInput').value.trim().toLowerCase(),type=$('bookingTypeFilter')?.value||'all';
  const filtered=operationalBookings().filter(b=>(type==='all'||(b.booking_type||'villa_stay')===type)&&(!q||[b.guest_name,b.guest_email,b.guest_phone,b.villa_name,b.service_title,b.status,primaryResource(b)].join(' ').toLowerCase().includes(q)));
  $('bookingsTable').innerHTML=groupedBookingsHtml(itineraryGroups(filtered));
}
function switchView(name){
  Object.entries(views).forEach(([key,view])=>view?.classList.toggle('hidden',key!==name));
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===name));
  document.querySelector('.sidebar')?.classList.remove('open');
  if(name==='bookings')renderBookings();
  if(name==='settings')renderResources();if(name==='daily')renderDailyOperations();if(name==='operations')renderOperationsCentre();
}
function setSaveStatus(state,text){
  const el=$('saveStatus');if(!el)return;
  el.className=`save-status ${state}`;
  const label=el.querySelector('span:last-child');
  if(label)label.textContent=text;
}
function markWorkspaceDirty(){
  if($('modal').classList.contains('hidden'))return;
  workspaceDirty=true;setSaveStatus('dirty','Unsaved changes');
}
function setActiveWorkspaceSection(id){
  document.querySelectorAll('.workspace-nav a').forEach(a=>a.classList.toggle('active',a.dataset.section===id));
}
function setupWorkspaceNavigation(){
  const root=document.querySelector('.workspace-content');
  if(workspaceObserver)workspaceObserver.disconnect();
  workspaceObserver=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(visible)setActiveWorkspaceSection(visible.target.id);
  },{root,rootMargin:'-12% 0px -68% 0px',threshold:[0,.15,.35,.65]});
  document.querySelectorAll('.edit-section').forEach(section=>workspaceObserver.observe(section));
  document.querySelectorAll('.workspace-nav a').forEach(a=>a.onclick=e=>{
    e.preventDefault();document.getElementById(a.dataset.section)?.scrollIntoView({behavior:'smooth',block:'start'});setActiveWorkspaceSection(a.dataset.section);
  });
}
function updateBoatFinancials(){const sell=Number($('boatSellingPrice')?.value||0),paid=Number($('boatAmountPaid')?.value||0),margin=$('commissionType')?.value==='fixed'?Number($('commissionFixedAmount')?.value||0):sell*(selectedCommissionRate()/100);let cost=Number($('boatSupplierCost')?.value||0);if(sell){cost=sell-margin;if($('boatSupplierCost'))$('boatSupplierCost').value=cost.toFixed(2);}if($('boatBalance'))$('boatBalance').value=Math.max(0,sell-paid).toFixed(2);if($('boatMargin'))$('boatMargin').value=margin.toFixed(2);}
function updateChefFinancials(){const sell=Number($('chefSellingPrice')?.value||0),paid=Number($('chefAmountPaid')?.value||0),margin=$('commissionType')?.value==='fixed'?Number($('commissionFixedAmount')?.value||0):sell*(selectedCommissionRate()/100);let cost=Number($('chefSupplierCost')?.value||0);if(sell){cost=sell-margin;if($('chefSupplierCost'))$('chefSupplierCost').value=cost.toFixed(2);}if($('chefBalance'))$('chefBalance').value=Math.max(0,sell-paid).toFixed(2);if($('chefMargin'))$('chefMargin').value=margin.toFixed(2);}

function setExperienceFields(prefix,x){
  const map={Status:'status',Title:'title',Date:'service_date',Time:'service_time',Guests:'guests',Supplier:'supplier',Contact:'contact',Reference:'reference',Cost:'supplier_cost',Sell:'selling_price',Paid:'amount_paid',Notes:'notes'};
  Object.entries(map).forEach(([suffix,key])=>{const el=$(prefix+suffix);if(el)el.value=x?.[key]??'';});
  const details=x?.details||{};const d=$(prefix+'Details');if(d)d.value=details.description||details.items||details.list||details.reservation||'';
  const bal=$(prefix+'Balance');if(bal)bal.value=Math.max(0,Number(x?.selling_price||0)-Number(x?.amount_paid||0)).toFixed(2);
  if($(prefix+'Status')&&!x)$(prefix+'Status').value='not_booked';
}
function experiencePayload(prefix,bookingId,type,slot=1){
  const value=suffix=>$(prefix+suffix)?.value;
  return {booking_id:bookingId,service_type:type,slot,status:value('Status')||'not_booked',title:value('Title')?.trim()||null,service_date:value('Date')||null,service_time:value('Time')||null,guests:value('Guests')?Number(value('Guests')):null,supplier:value('Supplier')?.trim()||null,contact:value('Contact')?.trim()||null,reference:value('Reference')?.trim()||null,supplier_cost:Number(value('Cost')||0),selling_price:Number(value('Sell')||0),amount_paid:Number(value('Paid')||0),details:{description:value('Details')?.trim()||null},notes:value('Notes')?.trim()||null,updated_at:new Date().toISOString()};
}
function updateExperienceBalance(prefix){const sell=Number($(prefix+'Sell')?.value||0),paid=Number($(prefix+'Paid')?.value||0);if($(prefix+'Balance'))$(prefix+'Balance').value=Math.max(0,sell-paid).toFixed(2);}
function experienceSummary(b){
  const bt=bookingBoat(b.id),ch=bookingChef(b.id);
  return [
    {icon:'◒',label:'Boat charter',status:bt?.status||'not_booked'},
    {icon:'♨',label:'Private chef',status:ch?.status||'not_booked'},
    {icon:'✦',label:'Decorations',status:experienceFor(b.id,'decorations')?.status||'not_booked'},
    {icon:'▣',label:'Shopping',status:experienceFor(b.id,'shopping')?.status||'not_booked'},
    {icon:'☀',label:'Beach club',status:experienceFor(b.id,'beach_club')?.status||'not_booked'},
    {icon:'♫',label:'Entertainment',status:experienceFor(b.id,'entertainment')?.status||'not_booked'}
  ];
}
function renderGenericExperience(title,subtitle,x,detailsLabel='Details'){
  if(!x||x.status==='not_booked')return `<section class="experience-section"><div class="module-heading"><div><p class="eyebrow">${esc(title)}</p><h4>${esc(subtitle)}</h4></div><span class="transfer-badge transfer-not-booked">Not booked</span></div></section>`;
  const balance=Math.max(0,Number(x.selling_price||0)-Number(x.amount_paid||0)),description=x.details?.description||'Not recorded';
  return `<section class="experience-section"><div class="module-heading"><div><p class="eyebrow">${esc(title)}</p><h4>${esc(x.title||subtitle)}</h4></div><span class="transfer-badge ${serviceDone(x.status)?'transfer-confirmed':'transfer-provisional'}">${esc(serviceStatusLabel(x.status))}</span></div><div class="experience-card-grid"><article class="experience-card"><dl><dt>Date</dt><dd>${date(x.service_date)}</dd><dt>Time</dt><dd>${esc(x.service_time||'—')}</dd><dt>Guests</dt><dd>${x.guests||'—'}</dd><dt>${esc(detailsLabel)}</dt><dd>${esc(description)}</dd></dl></article><article class="experience-card"><dl><dt>Supplier</dt><dd>${esc(x.supplier||'Not recorded')}</dd><dt>Contact</dt><dd>${esc(x.contact||'—')}</dd><dt>Reference</dt><dd>${esc(x.reference||'—')}</dd></dl></article><article class="experience-card commercial"><dl><dt>Supplier cost</dt><dd>${euro(x.supplier_cost)}</dd><dt>Selling price</dt><dd>${euro(x.selling_price)}</dd><dt>Paid</dt><dd>${euro(x.amount_paid)}</dd><dt>Balance</dt><dd>${euro(balance)}</dd><dt>Margin</dt><dd>${euro(Number(x.selling_price||0)-Number(x.supplier_cost||0))}</dd></dl></article></div>${x.notes?`<div class="service-notes"><strong>Notes</strong><p>${esc(x.notes).replace(/\n/g,'<br>')}</p></div>`:''}</section>`;
}
function renderExperienceSuite(b){
  const summary=experienceSummary(b),done=summary.filter(x=>serviceDone(x.status)).length,progress=summary.length?Math.round(done/summary.length*100):0;
  return `<div class="experience-progress"><div class="experience-progress-head"><div><p class="eyebrow">Guest experience progress</p><strong>${progress}%</strong><div>${done} of ${summary.length} service areas complete</div></div><span>${progress>=75?'Ready for arrival':progress>=40?'In progress':'Needs attention'}</span></div><div class="progress-track"><span style="width:${progress}%"></span></div></div><div class="experience-dashboard">${summary.map(x=>`<div class="experience-tile ${serviceDone(x.status)?'complete':x.status!=='not_booked'?'active':''}"><span class="tile-icon">${x.icon}</span><strong>${esc(x.label)}</strong><small>${esc(serviceStatusLabel(x.status))}</small></div>`).join('')}</div>${renderGenericExperience('Decorations','Villa styling and celebration setup',experienceFor(b.id,'decorations'),'Items')}${renderGenericExperience('Shopping','Pre-arrival shopping order',experienceFor(b.id,'shopping'),'Shopping list')}${renderGenericExperience('Beach club','Beds, tables and minimum spend',experienceFor(b.id,'beach_club'),'Beds / table')}${renderGenericExperience('Entertainment','Music, classes and performers',experienceFor(b.id,'entertainment'),'Event details')}`;
}

const normaliseCustomerValue=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
const normalisePhone=value=>String(value||'').replace(/[^0-9+]/g,'');
function customerKey(b){return String(b.customer_id||b.guest_email||b.guest_phone||b.guest_name||'').trim().toLowerCase();}
function customerMatchKeyFromForm(){return normaliseCustomerValue($('guestEmail')?.value)||normalisePhone($('guestPhone')?.value)||normaliseCustomerValue($('guestName')?.value);}
function customerDisplayNameScore(value){
  const name=String(value||'').trim();
  if(!name)return 0;
  const words=name.split(/\s+/).filter(Boolean).length;
  return words*100+name.length;
}
function preferredCustomerName(a,b){
  return customerDisplayNameScore(b)>customerDisplayNameScore(a)?b:a;
}
function strongCustomerIdentityMatch(a,b){
  if(!a||!b)return false;
  if(a.customer_id&&b.customer_id&&String(a.customer_id)===String(b.customer_id))return true;
  const ae=normaliseCustomerValue(a.guest_email),be=normaliseCustomerValue(b.guest_email);
  if(ae&&be&&ae===be)return true;
  const ap=normalisePhone(a.guest_phone),bp=normalisePhone(b.guest_phone);
  if(ap&&bp&&ap===bp)return true;
  return false;
}

function levenshteinDistance(a,b){
  a=normaliseCustomerValue(a);b=normaliseCustomerValue(b);
  if(a===b)return 0;
  if(!a.length)return b.length;
  if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){
    cur[0]=i;
    for(let j=1;j<=b.length;j++){
      cur[j]=Math.min(
        cur[j-1]+1,
        prev[j]+1,
        prev[j-1]+(a[i-1]===b[j-1]?0:1)
      );
    }
    for(let j=0;j<=b.length;j++)prev[j]=cur[j];
  }
  return prev[b.length];
}
function splitCustomerName(value){
  const parts=normaliseCustomerValue(value).replace(/[^a-z0-9à-ÿ' -]/gi,'').split(/\s+/).filter(Boolean);
  return {first:parts[0]||'',last:parts.length>1?parts[parts.length-1]:'',parts};
}
function potentialDuplicateCustomerName(a,b){
  const x=splitCustomerName(a),y=splitCustomerName(b);
  if(!x.first||!y.first)return false;
  if(normaliseCustomerValue(a)===normaliseCustomerValue(b))return true;
  if(x.last&&y.last&&x.last===y.last){
    const d=levenshteinDistance(x.first,y.first);
    return d<=2 || x.first.startsWith(y.first) || y.first.startsWith(x.first);
  }
  const whole=levenshteinDistance(normaliseCustomerValue(a),normaliseCustomerValue(b));
  return whole<=2;
}
function customerDuplicateCandidate(customer,groups){
  return groups
    .filter(other=>other.key!==customer.key)
    .map(other=>{
      let score=0;
      if(potentialDuplicateCustomerName(customer.name,other.name))score+=70;
      const ce=normaliseCustomerValue(customer.email),oe=normaliseCustomerValue(other.email);
      const cp=normalisePhone(customer.phone),op=normalisePhone(other.phone);
      if(ce&&oe&&ce===oe)score+=100;
      if(cp&&op&&cp===op)score+=95;
      return {other,score};
    })
    .filter(x=>x.score>=70)
    .sort((a,b)=>b.score-a.score)[0]||null;
}
function bookingDuplicateCandidate(booking){
  const dateA=bookingPrimaryDate(booking),resourceA=normaliseCustomerValue(primaryResource(booking));
  return bookings.find(other=>{
    if(String(other.id)===String(booking.id))return false;
    if((other.booking_type||'villa_stay')!==(booking.booking_type||'villa_stay'))return false;
    if(!potentialDuplicateCustomerName(booking.guest_name,other.guest_name))return false;
    if(dateA&&bookingPrimaryDate(other)&&dateA!==bookingPrimaryDate(other))return false;
    const resourceB=normaliseCustomerValue(primaryResource(other));
    if(resourceA&&resourceB&&resourceA!==resourceB)return false;
    return true;
  })||null;
}

function customerGroups(){
  const groups=[];
  bookings.forEach(b=>{
    const email=normaliseCustomerValue(b.guest_email),phone=normalisePhone(b.guest_phone),name=normaliseCustomerValue(b.guest_name);
    let g=groups.find(c=>
      (b.customer_id&&c.customer_ids.has(String(b.customer_id)))||
      (email&&normaliseCustomerValue(c.email)===email)||
      (phone&&normalisePhone(c.phone)===phone)
    );

    // Exact-name fallback is used only when no strong contact identity is present.
    if(!g&&!email&&!phone&&!b.customer_id&&name){
      g=groups.find(c=>!c.email&&!c.phone&&!c.customer_id&&normaliseCustomerValue(c.name)===name);
    }

    if(!g){
      g={
        key:String(b.customer_id||b.guest_email||b.guest_phone||b.guest_name||b.id).trim().toLowerCase(),
        customer_id:b.customer_id||'',customer_ids:new Set(),name:b.guest_name||'Unknown',
        email:b.guest_email||'',phone:b.guest_phone||'',instagram:b.guest_instagram||'',
        nationality:b.guest_nationality||'',lead_source:b.lead_source||'Marbella Collective',
        itinerary_id:b.itinerary_id||b.id,bookings:[]
      };
      groups.push(g);
    }

    g.name=preferredCustomerName(g.name,b.guest_name||'');
    if(b.customer_id)g.customer_ids.add(String(b.customer_id));
    if(!g.customer_id&&b.customer_id)g.customer_id=b.customer_id;
    if(!g.email&&b.guest_email)g.email=b.guest_email;
    if(!g.phone&&b.guest_phone)g.phone=b.guest_phone;
    if(!g.instagram&&b.guest_instagram)g.instagram=b.guest_instagram;
    if(!g.nationality&&b.guest_nationality)g.nationality=b.guest_nationality;
    if(!g.itinerary_id&&b.itinerary_id)g.itinerary_id=b.itinerary_id;
    g.bookings.push(b);
  });
  return groups.sort((a,b)=>a.name.localeCompare(b.name));
}
function openBookingWizard(){if($('bookingWizardModal'))delete $('bookingWizardModal').dataset.customerKey;
  wizardBookingType='villa_stay';$('wizardTypeStep').classList.remove('hidden');$('wizardCustomerStep').classList.add('hidden');$('wizardCustomerSearchWrap').classList.add('hidden');$('wizardCustomerSearch').value='';$('wizardCustomerResults').innerHTML='';$('bookingWizardModal').classList.remove('hidden');$('bookingWizardModal').setAttribute('aria-hidden','false');
}
function closeBookingWizard(){if($('bookingWizardModal'))delete $('bookingWizardModal').dataset.customerKey;$('bookingWizardModal').classList.add('hidden');$('bookingWizardModal').setAttribute('aria-hidden','true');}
function chooseWizardType(type){wizardBookingType=type;$('wizardTypeStep').classList.add('hidden');$('wizardCustomerStep').classList.remove('hidden');$('wizardCustomerSearchWrap').classList.add('hidden');}
function renderWizardCustomers(){
  const q=$('wizardCustomerSearch').value.trim().toLowerCase();
  const allGroups=customerGroups();
  const groups=allGroups.filter(c=>!q||[c.name,c.email,c.phone].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,20);
  $('wizardCustomerResults').innerHTML=groups.map(c=>{
    const duplicate=customerDuplicateCandidate(c,allGroups);
    const bookingsHtml=(c.bookings||[]).slice().sort((a,b)=>String(bookingPrimaryDate(a)||'').localeCompare(String(bookingPrimaryDate(b)||''))).map(b=>{
      const dupBooking=bookingDuplicateCandidate(b);
      return `<div class="wizard-booking-row ${dupBooking?'possible-duplicate-booking':''}">
        <div class="wizard-booking-copy">
          <strong>${esc(bookingTypeLabel(b.booking_type))} · ${esc(primaryResource(b))}</strong>
          <small>${esc(bookingDisplayDates(b))}${Number(b.total_rental||0)>0?` · ${money(Number(b.total_rental||0),bookingCurrency(b))}`:''}</small>
          ${dupBooking?`<span class="duplicate-inline-warning">Possible duplicate booking</span>`:''}
        </div>
        <button type="button" class="button danger-outline compact" data-delete-wizard-booking="${esc(b.id)}">Delete booking</button>
      </div>`;
    }).join('');
    return `<article class="wizard-customer-card ${duplicate?'possible-duplicate-customer':''}">
      <button type="button" class="wizard-customer-select" data-wizard-customer="${esc(c.key)}">
        <span>
          <strong>${esc(c.name)}</strong>
          <small>${esc(c.email||c.phone||'No contact details')}</small>
          ${duplicate?`<span class="duplicate-customer-warning">Possible duplicate of ${esc(duplicate.other.name)}</span>`:''}
        </span>
        <em>${c.bookings.length} booking${c.bookings.length===1?'':'s'}</em>
      </button>
      <div class="wizard-booking-list">${bookingsHtml}</div>
    </article>`;
  }).join('')||'<div class="empty">No matching customers.</div>';
}
function startWizardBooking(customer=null){closeBookingWizard();openModal(null,{type:wizardBookingType,customer});}
function findCustomerMatches(){
  if($('bookingId')?.value)return[];
  const email=normaliseCustomerValue($('guestEmail')?.value),phone=normalisePhone($('guestPhone')?.value),name=normaliseCustomerValue($('guestName')?.value);
  if(!email&&!phone&&name.length<3)return[];
  return customerGroups().map(c=>{
    let score=0;
    if(email&&normaliseCustomerValue(c.email)===email)score=100;
    else if(phone&&normalisePhone(c.phone)===phone)score=95;
    else if(name&&normaliseCustomerValue(c.name)===name)score=70;
    return {c,score};
  }).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,3);
}
function renderCustomerMatchPanel(){
  const panel=$('customerMatchPanel');if(!panel)return;
  const matches=findCustomerMatches();
  if(!matches.length){panel.classList.add('hidden');panel.innerHTML='';return;}
  panel.classList.remove('hidden');
  panel.innerHTML=`<div class="smart-customer-head"><div><p class="eyebrow">Existing customer found</p><strong>Use the existing customer record</strong><small>Linking keeps all villa, boat, chef and entertainment bookings together.</small></div></div>${matches.map(({c,score})=>`<button type="button" class="customer-match-row" data-link-customer="${esc(c.key)}"><span><strong>${esc(c.name)}</strong><small>${esc(c.email||c.phone||'No contact details')} • ${c.bookings.length} existing booking${c.bookings.length===1?'':'s'}</small><small class="customer-itinerary-preview">${c.bookings.slice(0,4).map(x=>`${bookingTypeLabel(x.booking_type)} · ${primaryResource(x)} · ${bookingDisplayDates(x)}`).join('  |  ')}</small></span><em>Add to customer</em></button>`).join('')}`;
}
function applyExistingCustomer(customer){
  if(!customer)return;
  $('customerId').value=customer.customer_id||customer.key;
  $('itineraryId').value=customer.itinerary_id||customer.bookings?.[0]?.id||'';
  $('guestName').value=customer.name||$('guestName').value;
  $('guestEmail').value=customer.email||$('guestEmail').value;
  $('guestPhone').value=customer.phone||$('guestPhone').value;
  $('guestInstagram').value=customer.instagram||$('guestInstagram').value;
  setConditionalSelect('guestNationalitySelect','guestNationality',customer.nationality||'');
  $('leadSource').value=customer.lead_source||'Marbella Collective';
  $('customerMatchPanel').classList.add('hidden');
  renderLinkedCustomerPanel(customer);
  setSaveStatus('dirty','Existing customer linked');
}
function renderLinkedCustomerPanel(customer=null){
  const panel=$('linkedCustomerPanel');if(!panel)return;
  if(!customer){panel.classList.add('hidden');panel.innerHTML='';return;}
  const bs=customer.bookings||[];
  panel.classList.remove('hidden');
  panel.innerHTML=`<div><p class="eyebrow">Smart customer record</p><strong>${esc(customer.name||'Customer')}</strong><small>${esc(customer.email||customer.phone||'Contact details not recorded')}</small></div><div class="linked-customer-itinerary">${bs.map(x=>`<span><b>${esc(bookingTypeLabel(x.booking_type))}</b>${esc(primaryResource(x))} · ${bookingDisplayDates(x)}</span>`).join('')||'<span>New customer itinerary</span>'}</div><div class="linked-customer-status">New booking will be added to this itinerary</div>`;
}

function relatedBookingsFor(b){
  const email=normaliseCustomerValue(b.guest_email),phone=normalisePhone(b.guest_phone),name=normaliseCustomerValue(b.guest_name);
  return bookings.filter(x=>{
    if(String(x.id)===String(b.id))return false;
    if(b.customer_id&&x.customer_id&&String(b.customer_id)===String(x.customer_id))return true;
    if(email&&normaliseCustomerValue(x.guest_email)===email)return true;
    if(phone&&normalisePhone(x.guest_phone)===phone)return true;
    return Boolean(name&&normaliseCustomerValue(x.guest_name)===name);
  });
}
function relatedBookingsHtml(b){
  const related=relatedBookingsFor(b);if(!related.length)return'';
  return `<section class="related-bookings"><div><p class="section-kicker">Same customer</p><h3>Related bookings</h3><p>Other services recorded for ${esc(b.guest_name)}.</p></div><div class="related-booking-list">${related.map(x=>`<button type="button" onclick="openLinkedBooking('${x.id}')"><span><strong>${esc(bookingTypeLabel(x.booking_type))}</strong><small>${esc(primaryResource(x))}</small></span><em>${bookingDisplayDates(x)}</em></button>`).join('')}</div></section>`;
}
function setServiceModuleVisibility(type){
  const section=$('conciergeSection');if(!section)return;
  const children=[...section.children];children.forEach(el=>el.classList.remove('wizard-module-hidden'));
  if(type==='villa_stay')return;
  const anchors={boat_charter:'Boat charter',private_chef:'Private chef',entertainment:'Entertainment',beach_club:'Beach club'};
  if(type==='airport_transfer'){
    let hide=false;children.forEach(el=>{if(el.classList.contains('module-divider'))hide=true;if(hide)el.classList.add('wizard-module-hidden');});return;
  }
  const wanted=anchors[type];if(!wanted){section.classList.add('is-hidden');return;}section.classList.remove('is-hidden');
  let active=false,found=false;
  children.forEach(el=>{
    if(el.classList.contains('module-divider')){const text=el.textContent.trim();if(text===wanted){active=true;found=true;el.classList.remove('wizard-module-hidden');return;}if(active){active=false;} }
    if(!found||!active)el.classList.add('wizard-module-hidden');
  });
}
function confirmDiscard(){return !workspaceDirty||confirm('Discard your unsaved changes?');}
function isoDateMinusDays(value,days){
  if(!value)return'';
  const d=new Date(value+'T12:00:00');
  d.setDate(d.getDate()-days);
  return d.toISOString().slice(0,10);
}
function applyMarbellaHideawayPaymentDefaults(force=false){
  const isVilla=$('bookingType')?.value==='villa_stay';
  if(!isVilla)return;

  const strategy=$('paymentStrategy')?.value||'deposit_50_30';
  const meta=villaStrategyMeta(strategy);
  const total=Number($('totalRental')?.value||0);
  const arrival=$('arrivalDate')?.value||'';
  const existing=Boolean($('bookingId')?.value);

  // A villa booking only exists once the initial deposit has been received,
  // so its deposit date is always the booking-created date.
  const booking=bookings.find(x=>String(x.id)===String($('bookingId')?.value));
  if($('depositPaidDate')){
    $('depositPaidDate').value=existing&&booking?.created_at?String(booking.created_at).slice(0,10):todayISO();
    $('depositPaidDate').readOnly=true;
  }
  if($('depositDateHelp'))$('depositDateHelp').textContent='Automatically uses the booking-created date.';

  if($('nextPaymentSymbol'))$('nextPaymentSymbol').textContent=$('bookingCurrency')?.value==='EUR'?'€':'£';
  if($('depositSymbol')&&$('bookingType')?.value!=='boat_charter')$('depositSymbol').textContent=$('bookingCurrency')?.value==='EUR'?'€':'£';

  const staged=Boolean(meta?.staged);
  $('balanceDueDateWrap')?.classList.toggle('is-hidden',!staged);

  if(staged){
    const isSecondDeposit=meta?.stageName==='second_deposit';
    if($('nextPaymentAmountLabel'))$('nextPaymentAmountLabel').textContent=isSecondDeposit?'Second deposit':'Further payment from guest';
    if($('nextPaymentDueLabel'))$('nextPaymentDueLabel').textContent=isSecondDeposit?'Second deposit due date':'Further payment due date';
    if($('nextPaymentHelp'))$('nextPaymentHelp').textContent=isSecondDeposit?'Automatically calculated at 25% of the booking value.':'Normally the second 30% instalment.';
    if($('finalPaymentHelp'))$('finalPaymentHelp').textContent=isSecondDeposit?'Enter the agreed date for the second 25% deposit.':'Choose the agreed date for the second instalment.';
  }else{
    if($('nextPaymentAmountLabel'))$('nextPaymentAmountLabel').textContent='Final payment from guest';
    if($('nextPaymentDueLabel'))$('nextPaymentDueLabel').textContent='Final payment due date';
    if($('nextPaymentHelp'))$('nextPaymentHelp').textContent='Automatically calculated as the remaining balance.';
    if($('finalPaymentHelp'))$('finalPaymentHelp').textContent='Calculated automatically from the arrival date.';
  }

  if(!meta){
    // Custom arrangements stay fully editable.
    if($('depositPaidDate'))$('depositPaidDate').readOnly=true;
    updatePaymentSummaryPreview();
    return;
  }

  const targetDeposit=total*(meta.depositPct/100);
  const currentDeposit=Number($('depositPaid')?.value||0);
  if(force||!existing||currentDeposit===0)$('depositPaid').value=targetDeposit.toFixed(2);

  const deposit=Number($('depositPaid')?.value||0);
  const finalDate=isoDateMinusDays(arrival,meta.finalDays);

  if(staged){
    const targetFurther=total*((meta.furtherPct||30)/100);
    const targetFinal=meta.finalPct?total*(meta.finalPct/100):Math.max(0,total-targetDeposit-targetFurther);
    const savedStage=existing?(booking?.next_payment_stage||$('nextPaymentStage')?.value):'further_deposit';
    if(savedStage==='final_balance'){
      $('nextPaymentStage').value='final_balance';
      $('nextPaymentAmount').value=targetFinal.toFixed(2);
      $('nextPaymentDueDate').value=booking?.next_payment_due_date||finalDate;
    }else{
      if(force||!Number($('nextPaymentAmount')?.value||0))$('nextPaymentAmount').value=targetFurther.toFixed(2);
      if($('nextPaymentStage'))$('nextPaymentStage').value='further_deposit';
    }
    if(force||!$('balanceDueDate')?.value)$('balanceDueDate').value=finalDate;
    if($('finalPaymentAmount'))$('finalPaymentAmount').value=money(targetFinal,$('bookingCurrency')?.value||'GBP');
    $('finalPaymentAmountWrap')?.classList.remove('is-hidden');
    const canRecord=existing&&$('nextPaymentStage')?.value==='further_deposit';
    $('stagedPaymentActionWrap')?.classList.toggle('is-hidden',!canRecord);
    if($('stagedPaymentPaidDate')&&!$('stagedPaymentPaidDate').value)$('stagedPaymentPaidDate').value=todayISO();
    if($('stagedPaymentActionLabel'))$('stagedPaymentActionLabel').textContent=meta.stageName==='second_deposit'?'Second deposit paid date':'Further payment paid date';
    if($('recordStagedPayment'))$('recordStagedPayment').textContent=meta.stageName==='second_deposit'?'Record second deposit as paid':'Record further payment as paid';
  }else{
    $('finalPaymentAmountWrap')?.classList.add('is-hidden');
    $('stagedPaymentActionWrap')?.classList.add('is-hidden');
    const remaining=Math.max(0,total-deposit);
    $('nextPaymentAmount').value=remaining.toFixed(2);
    if(finalDate)$('nextPaymentDueDate').value=finalDate;
    if($('balanceDueDate'))$('balanceDueDate').value=finalDate;
    if($('nextPaymentStage'))$('nextPaymentStage').value='final_balance';
  }

  updatePaymentSummaryPreview();
}

function repopulateSavedFinancialFields(b){
  if(!b)return;
  if($('supplierAmountOwed'))$('supplierAmountOwed').value=Number(b.supplier_amount_owed||0);
  if($('supplierCurrency'))$('supplierCurrency').value=b.booking_type==='boat_charter'?'EUR':currencyCode(b.supplier_currency||b.booking_currency);
  if($('balanceDueDate'))$('balanceDueDate').value=b.balance_due_date||(
    b.booking_type==='boat_charter' ? (bookingBoat(b.id)?.charter_date||b.service_date||'') : ''
  );
  if($('nextPaymentDueDate')&&!$('nextPaymentDueDate').value)$('nextPaymentDueDate').value=b.next_payment_due_date||'';
  if($('nextPaymentAmount')&&(b.next_payment_amount!==null&&b.next_payment_amount!==undefined))$('nextPaymentAmount').value=Number(b.next_payment_amount||0);
  if($('nextPaymentCurrency'))$('nextPaymentCurrency').value=currencyCode(b.next_payment_currency||b.booking_currency);
  if($('supplierPaymentDueDate'))$('supplierPaymentDueDate').value=b.supplier_payment_due_date||(b.booking_type==='boat_charter'?(bookingBoat(b.id)?.charter_date||b.service_date||''):'');
}

function editorBookingTypeTitle(type){
  return {
    villa_stay:'Villa Stay',
    boat_charter:'Boat Charter',
    private_chef:'Private Chef',
    entertainment:'Entertainment',
    airport_transfer:'Airport Transfer',
    decorations:'Decorations',
    shopping:'Shopping',
    restaurant:'Restaurant',
    beach_club:'Beach Club',
    other:'Booking'
  }[type]||bookingTypeLabel(type);
}
function updateBookingWorkspaceTitle(b=null){
  const el=$('bookingWorkspaceTitle')||$('bookingTitle')||$('bookingEditorTitle');
  if(!el)return;
  const type=$('bookingType')?.value||b?.booking_type||'villa_stay';
  const guest=($('guestName')?.value||b?.guest_name||'').trim();
  el.textContent=`${b||$('bookingId')?.value?'Edit':'New'} ${editorBookingTypeTitle(type)}${guest?` — ${guest}`:''}`;
}
function renderEditItineraryPanel(b=null){
  const panel=$('editItineraryPanel');if(!panel)return;
  if(!b){panel.classList.add('hidden');panel.innerHTML='';return;}
  const c=customerRecordForBooking(b),rows=(c.bookings||[]).filter(x=>String(x.id)!==String(b.id));
  if(!rows.length){panel.classList.add('hidden');panel.innerHTML='';return;}
  panel.classList.remove('hidden');
  panel.innerHTML=`<div class="edit-itinerary-head"><div><p class="eyebrow">Linked itinerary</p><strong>Other bookings for ${esc(c.name)}</strong><small>These are separate linked bookings; open one to edit its own details.</small></div></div><div class="edit-itinerary-list">${rows.map(x=>`<div class="edit-itinerary-row"><span class="customer-service-icon">${({villa_stay:'🏡',boat_charter:'⛵',private_chef:'🍽',entertainment:'🎵',decorations:'🎈',shopping:'🛍',beach_club:'🏖',other:'✨'})[x.booking_type]||'•'}</span><div><b>${esc(bookingTypeLabel(x.booking_type))} · ${esc(primaryResource(x))}</b><small>${esc(bookingDisplayDates(x))}</small></div><button type="button" class="button secondary compact" onclick="openLinkedBooking('${x.id}')">Open booking</button></div>`).join('')}</div>`;
}
window.openLinkedBooking=id=>{
  const target=bookings.find(x=>String(x.id)===String(id));if(!target)return;
  if(!$('bookingModal')?.classList.contains('hidden'))closeModal(true);
  if(!$('detailPanel')?.classList.contains('hidden'))closeDetail();
  activeDetailTab='booking';
  setTimeout(()=>openDetail(id),0);
};

function hydrateSavedBoatEditFields(b){
  if(!b||b.booking_type!=='boat_charter')return;
  const bt=bookingBoat(b.id);
  if(!bt)return;
  const savedBoat=String(bt.boat_name||'').trim();
  if(savedBoat){
    const exists=activeResources('boat').some(r=>String(r.name)===savedBoat);
    if($('primaryBoatName')){
      if(exists){$('primaryBoatName').value=savedBoat;if($('primaryBoatNameOther'))$('primaryBoatNameOther').value='';}
      else{$('primaryBoatName').value='Other';if($('primaryBoatNameOther'))$('primaryBoatNameOther').value=savedBoat;}
      togglePrimaryOtherBoat();
    }
    if($('boatName')){
      if(exists){$('boatName').value=savedBoat;if($('boatNameOther'))$('boatNameOther').value='';}
      else{$('boatName').value='Other';if($('boatNameOther'))$('boatNameOther').value=savedBoat;}
      toggleOtherBoat();
    }
  }
  if($('boatMarina'))$('boatMarina').value=bt.departure_marina||b.event_location||'Puerto Banús';
  if($('boatDate'))$('boatDate').value=bt.charter_date||b.service_date||'';
  if($('boatStartTime'))$('boatStartTime').value=bt.start_time||'';
  if($('boatDuration'))$('boatDuration').value=bt.duration_hours??'';
  if($('boatGuests'))$('boatGuests').value=bt.guests??b.number_of_guests??'';
  if($('boatStatus'))$('boatStatus').value=effectiveBoatStatus(b);
}

function openModal(b=null,options={}){$('supplierCurrency')?.removeAttribute('data-overridden');
  $('bookingForm')?.classList.toggle('existing-booking',Boolean(b));
  $('bookingForm').reset();$('bookingId').value=b?.id||'';$('customerId').value=b?.customer_id||options.customer?.customer_id||options.customer?.key||'';$('itineraryId').value=b?.itinerary_id||options.itineraryId||options.customer?.itinerary_id||'';renderLinkedCustomerPanel(options.customer||null);renderEditItineraryPanel(b);$('modalTitle').textContent=b?'Edit booking':'Add booking';
  const requestedBookingType=b?.booking_type||options.type||'villa_stay';
  const fields={serviceTitle:'service_title',serviceDate:'service_date',eventLocation:'event_location',guestName:'guest_name',villaName:'villa_name',arrivalDate:'arrival_date',departureDate:'departure_date',arrivalTime:'arrival_time',departureTime:'departure_time',guestCount:'number_of_guests',adultCount:'adults',childCount:'children',guestEmail:'guest_email',guestPhone:'guest_phone',guestInstagram:'guest_instagram',guestNationality:'guest_nationality',totalRental:'total_rental',depositReceived:'deposit_received',depositPaid:'deposit_paid',depositPaidDate:'deposit_paid_date',depositCurrency:'deposit_currency',nextPaymentAmount:'next_payment_amount',nextPaymentDueDate:'next_payment_due_date',nextPaymentStage:'next_payment_stage',paymentStrategy:'payment_strategy',paymentStrategyNotes:'payment_strategy_notes',supplierAmountOwed:'supplier_amount_owed',supplierCurrency:'supplier_currency',balanceDueDate:'balance_due_date',commissionRate:'commission_rate',damageDeposit:'damage_deposit',leadSource:'lead_source',bookingStatus:'status',arrivalFlight:'arrival_flight',departureFlight:'departure_flight',arrivalAirport:'arrival_airport',departureAirport:'departure_airport',flightDetails:'flight_details',bookingNotes:'notes'};
  Object.entries(fields).forEach(([id,key])=>{const el=$(id);if(el)el.value=b?.[key]??'';});
  $('bookingType').value=requestedBookingType;
  if(b?.booking_type==='villa_stay'&&$('paymentStrategy')&&['pay_later','standard_50_30','staged'].includes(String(b?.payment_strategy||''))){
    const total=Number(b?.total_rental||0),deposit=Number(b?.deposit_paid||0);
    const pct=total?Math.round((deposit/total)*100):0;
    if(pct===25)$('paymentStrategy').value='deposit_25_30';
    else if(pct===50)$('paymentStrategy').value='deposit_50_30';
    else if(pct===40)$('paymentStrategy').value='staged_40_30_30';
    else $('paymentStrategy').value='custom';
  }
  setConditionalSelect('eventLocationSelect','eventLocation',b?.event_location||'','');
  setConditionalSelect('arrivalAirportSelect','arrivalAirport',b?.arrival_airport||'Málaga','Málaga');
  setConditionalSelect('departureAirportSelect','departureAirport',b?.departure_airport||'Málaga','Málaga');
  $('bookingCurrency').value=currencyCode(b?.booking_currency);$('supplierCurrency').value=currencyCode(b?.supplier_currency||b?.booking_currency);$('commissionCurrency').value=currencyCode(b?.commission_currency||b?.booking_currency);$('boatCurrency').value=currencyCode(b?.boat_currency||'EUR');$('chefCurrency').value=currencyCode(b?.chef_currency||'EUR');$('commissionType').value=b?.commission_type||'percentage';$('commissionFixedAmount').value=b?.commission_fixed_amount??'';syncCommissionControl(b?.commission_rate||10);toggleCommissionType();setCommissionControlsEnabled(true);setConditionalSelect('guestNationalitySelect','guestNationality',b?.guest_nationality||'');
  syncGuestTotal();
  if(!b){$('leadSource').value='Marbella Collective';$('bookingStatus').value='Confirmed';$('depositReceived').value=0;$('depositPaid').value=0;$('depositPaidDate').value=todayISO();if($('depositCurrency'))$('depositCurrency').value='EUR';if($('gbpEurRate'))$('gbpEurRate').value='1.15';$('nextPaymentAmount').value=0;$('nextPaymentDueDate').value='';$('nextPaymentStage').value='final_balance';$('paymentStrategy').value='deposit_50_30';$('paymentStrategyNotes').value='';$('supplierAmountOwed').value=0;$('supplierCurrency').value='GBP';$('arrivalAirportSelect').value='Málaga';$('departureAirportSelect').value='Málaga';$('bookingCurrency').value='GBP';$('commissionCurrency').value='GBP';$('boatCurrency').value='EUR';$('chefCurrency').value='EUR';$('commissionType').value='percentage';$('commissionFixedAmount').value='';syncCommissionControl(10);toggleCommissionType();setCommissionControlsEnabled(true);setConditionalSelect('guestNationalitySelect','guestNationality','');}
  if(!b&&options.customer)applyExistingCustomer(options.customer);
  if(!b&&options.sourceBooking){
    const s=options.sourceBooking;
    $('serviceDate').value=bookingPrimaryDate(s)||'';
    setConditionalSelect('eventLocationSelect','eventLocation',s.event_location||bookingBoat(s.id)?.departure_marina||'','');
    $('guestCount').value=s.number_of_guests||bookingBoat(s.id)?.guests||'';
    $('bookingCurrency').value=bookingCurrency(s);
    $('leadSource').value=s.lead_source||'Marbella Collective';
  }
  $('depositReceived').disabled=Boolean(b);
updateBoatFinancials();updateChefFinancials();['decor','shop','beach','ent'].forEach(updateExperienceBalance);
  $('deleteBookingButton').classList.toggle('hidden',!b);$('bookingMessage').textContent='';$('modal').classList.remove('hidden');$('modal').setAttribute('aria-hidden','false');document.body.classList.add('editor-open');
  workspaceDirty=false;setSaveStatus('saved','All changes saved');setActiveWorkspaceSection('guestSection');
  requestAnimationFrame(()=>{
    document.querySelector('.workspace-content').scrollTop=0;
    setupWorkspaceNavigation();
    applyBookingTypeTemplate();
    if(!b){
      if(Number($('depositPaid')?.value||0)>0&&!$('depositPaidDate')?.value)$('depositPaidDate').value=new Date().toISOString().slice(0,10);
      applyMarbellaHideawayPaymentDefaults(false);
    }
    if(b?.booking_type==='boat_charter'){
      populateMasterData();
      hydrateSavedBoatEditFields(b);
      syncBoatBookingFields(false);
      hydrateSavedBoatEditFields(b);
    }else{
      syncBoatBookingFields(false);
    }
    applyBoatWorkflowDefaults(b);
    renderCustomerMatchPanel();
    updatePaymentSummaryPreview();
    updateBoatCurrencyCalculations();
  });
  repopulateSavedFinancialFields(b);
  if(b?.booking_type==='villa_stay')applyMarbellaHideawayPaymentDefaults(false);
  syncBookingCurrencySymbols();
  updateBookingWorkspaceTitle(b);
}
function closeModal(force=false){if(!force&&!confirmDiscard())return;$('modal').classList.add('hidden');$('modal').setAttribute('aria-hidden','true');document.body.classList.remove('editor-open');workspaceDirty=false;if(workspaceObserver)workspaceObserver.disconnect();}
window.editBooking=id=>{
  const booking=bookings.find(b=>String(b.id)===String(id));
  if(!booking){alert('This booking could not be found. Please refresh and try again.');return;}
  try{
    openModal(booking);
    closeDetail();
  }catch(error){
    console.error('Unable to open booking editor',error);
    alert(`The booking editor could not be opened: ${error?.message||'Unknown error'}`);
  }
};
window.openDeleteConfirm=function(id,context=null){
  const b=bookings.find(x=>String(x.id)===String(id));if(!b)return;
  pendingDeleteId=id;pendingDeleteContext=context;
  const related=relatedBookings(b);
  $('deleteConfirmTitle').textContent=related.length?'Delete this booking only?':'Delete booking?';
  $('deleteConfirmSummary').textContent=related.length
    ?`${b.guest_name} has ${related.length+1} linked bookings. Only ${bookingDisplayPlace(b)} • ${bookingDisplayDates(b)} will be deleted; the other bookings will remain.`
    :`${b.guest_name} • ${bookingDisplayPlace(b)} • ${bookingDisplayDates(b)}. This is their only linked booking.`;
  $('deleteConfirmMessage').textContent='';
  $('deleteConfirmModal').classList.remove('hidden');
  $('deleteConfirmModal').setAttribute('aria-hidden','false');
}
function closeDeleteConfirm(){pendingDeleteId=null;pendingDeleteContext=null;$('deleteConfirmModal').classList.add('hidden');$('deleteConfirmModal').setAttribute('aria-hidden','true');}
async function deleteLinked(table,id){const{error}=await supabaseClient.from(table).delete().eq('booking_id',id);if(error&&error.code!=='42P01')throw error;}
window.deleteBooking=id=>openDeleteConfirm(id);
async function performDeleteBooking(){
  const id=pendingDeleteId;if(!id)return;$('confirmDeleteBooking').disabled=true;$('deleteConfirmMessage').textContent='Deleting booking…';
  try{
    const deleting=bookings.find(x=>String(x.id)===String(id));
    if(deleting){await supabaseClient.from('booking_deletion_log').insert({booking_id:id,guest_name:deleting.guest_name,booking_type:deleting.booking_type,resource:bookingDisplayPlace(deleting),booking_date:bookingPrimaryDate(deleting),details:{dates:bookingDisplayDates(deleting),customer_id:deleting.customer_id,itinerary_id:deleting.itinerary_id}}).then(()=>{}).catch(()=>{});}
    for(const table of ['booking_payments','booking_transfers','booking_boats','booking_chefs','booking_experiences'])await deleteLinked(table,id);
    const{error}=await supabaseClient.from('bookings').delete().eq('id',id);if(error)throw error;
    if(selectedBooking&&String(selectedBooking.id)===String(id)){selectedBooking=null;closeDetail();}
    const returnContext=pendingDeleteContext;
    closeDeleteConfirm();
    if(returnContext==='wizard'){
      await loadData();
      $('bookingWizardModal')?.classList.remove('hidden');
      $('bookingWizardModal')?.setAttribute('aria-hidden','false');
      $('wizardTypeStep')?.classList.add('hidden');
      $('wizardCustomerStep')?.classList.remove('hidden');
      $('wizardCustomerSearchWrap')?.classList.remove('hidden');
      renderWizardCustomers();
    }else{
      closeModal(true);switchView('bookings');await loadData();
    }
  }catch(error){$('deleteConfirmMessage').textContent=error.message||'The booking could not be deleted.';}
  finally{$('confirmDeleteBooking').disabled=false;}
}


window.mergeMatchingCustomerBookings=async()=>{
  const groups=new Map();
  operationalBookings().forEach(b=>{
    const email=normaliseCustomerValue(b.guest_email),phone=normalisePhone(b.guest_phone);
    const key=email?`email:${email}`:phone?`phone:${phone}`:b.customer_id?`customer:${b.customer_id}`:'';
    if(!key)return;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(b);
  });

  let linked=0;
  for(const rows of groups.values()){
    if(rows.length<2)continue;
    const root=rows.slice().sort((a,b)=>{
      const an=customerDisplayNameScore(a.guest_name),bn=customerDisplayNameScore(b.guest_name);
      if(an!==bn)return bn-an;
      const ac=(a.guest_email?1:0)+(a.guest_phone?1:0),bc=(b.guest_email?1:0)+(b.guest_phone?1:0);
      return bc-ac;
    })[0];
    const customerId=root.customer_id||customerKey(root);
    const itineraryId=root.itinerary_id||rows.find(x=>x.itinerary_id)?.itinerary_id||root.id;
    const bestName=rows.reduce((name,x)=>preferredCustomerName(name,x.guest_name||''),root.guest_name||'');
    const bestEmail=rows.find(x=>x.guest_email)?.guest_email||root.guest_email||'';
    const bestPhone=rows.find(x=>x.guest_phone)?.guest_phone||root.guest_phone||'';
    const ids=rows.map(x=>x.id);

    const payload={customer_id:customerId,itinerary_id:itineraryId,guest_name:bestName};
    if(bestEmail)payload.guest_email=bestEmail;
    if(bestPhone)payload.guest_phone=bestPhone;

    const {error}=await supabaseClient.from('bookings').update(payload).in('id',ids);
    if(!error)linked+=rows.length;
  }
  await loadData();
  alert(`${linked} booking records linked and customer names normalised.`);
};

window.addAnotherBoat=id=>{
  const source=bookings.find(b=>String(b.id)===String(id));if(!source)return;
  const customer=customerGroups().find(c=>c.key===customerKey(source))||{key:customerKey(source),customer_id:source.customer_id||customerKey(source),name:source.guest_name,email:source.guest_email,phone:source.guest_phone,instagram:source.guest_instagram,nationality:source.guest_nationality,lead_source:source.lead_source,itinerary_id:source.itinerary_id||source.id};
  closeDetail();
  openModal(null,{type:'boat_charter',customer,sourceBooking:source,itineraryId:source.itinerary_id||source.id});
  setSaveStatus('dirty','Adding another boat to itinerary');
};

function openDetailResponsive(id,button=null){
  if(button){
    button.classList.add('is-pressed');
    requestAnimationFrame(()=>setTimeout(()=>button.classList.remove('is-pressed'),120));
  }
  openDetail(id);
}

window.openDetail=id=>{
  selectedBooking=bookings.find(b=>String(b.id)===String(id));if(!selectedBooking)return;
  activeDetailTab='customer';$('detailGuest').textContent=selectedBooking.guest_name;
  $('detailSubtitle').textContent=`${bookingTypeLabel(selectedBooking.booking_type)} • ${bookingDisplayPlace(selectedBooking)} • ${bookingDisplayDates(selectedBooking)}`;
  $('detailStatus').textContent=selectedBooking.status||'Confirmed';$('detailStatus').className=`badge large ${statusClass(selectedBooking.status)}`;$('detailAddBoat')?.classList.remove('hidden');
  document.querySelectorAll('.detail-tab').forEach(x=>x.classList.toggle('active',x.dataset.detailTab==='overview'));
  renderDetail();$('detailPanel').classList.remove('hidden');$('detailPanel').setAttribute('aria-hidden','false');
};
function closeDetail(){$('detailPanel').classList.add('hidden');$('detailPanel').setAttribute('aria-hidden','true');}
function bookingTasks(b){
  const type=b.booking_type||'villa_stay',balance=balanceFor(b),tasks=[];
  const contact=Boolean(b.guest_email||b.guest_phone);
  tasks.push({done:paidFor(b)>0,label:'First payment received'});
  tasks.push({done:balance<=0,label:balance<=0?'Balance paid':'Balance still outstanding'});
  if(type==='villa_stay'){
    const t=bookingTransfer(b.id);
    tasks.push({done:Boolean(b.flight_details||b.arrival_flight),label:'Flight details recorded'});
    tasks.push({done:transferComplete(t)||Boolean(b.transfer_booked),label:'Airport transfer booked'});
    tasks.push({done:contact,label:'Guest contact details recorded'});
  }else if(type==='boat_charter'){
    const bt=bookingBoat(b.id);
    tasks.push({done:Boolean(bt?.boat_name),label:'Boat selected'});
    tasks.push({done:['confirmed','completed'].includes(bt?.status),label:'Supplier confirmed'});
    tasks.push({done:Boolean(bt?.guests||b.number_of_guests),label:'Guest numbers confirmed'});
    tasks.push({done:contact,label:'Customer contact details recorded'});
  }else if(type==='private_chef'){
    const ch=bookingChef(b.id);
    tasks.push({done:Boolean(ch?.menu),label:'Menu agreed'});
    tasks.push({done:Boolean(ch?.dietary_requirements),label:'Dietary requirements recorded'});
    tasks.push({done:['confirmed','completed'].includes(ch?.status),label:'Chef confirmed'});
    tasks.push({done:contact,label:'Customer contact details recorded'});
  }else if(type==='entertainment'){
    const ent=experienceFor(b.id,'entertainment');
    tasks.push({done:Boolean(ent?.title),label:'Performer selected'});
    tasks.push({done:serviceDone(ent?.status),label:'Supplier confirmed'});
    tasks.push({done:Boolean(ent?.service_date||b.service_date),label:'Event date confirmed'});
    tasks.push({done:contact,label:'Customer contact details recorded'});
  }else{
    tasks.push({done:Boolean(b.service_date||b.arrival_date),label:'Service date confirmed'});
    tasks.push({done:Boolean(primaryResource(b)),label:'Resource selected'});
    tasks.push({done:contact,label:'Customer contact details recorded'});
  }
  return tasks;
}
function renderTasks(b){return bookingTasks(b).map(t=>`<div class="task-row ${t.done?'done':''}"><span class="task-check">${t.done?'✓':'!'}</span><span>${esc(t.label)}</span></div>`).join('');}
function customerTimelineEvents(b){
  const customer=customerRecordForBooking(b),events=[];
  const add=(event)=>{if(!event?.date)return;events.push({...event,date:String(event.date).slice(0,10),time:event.time||''});};

  (customer.bookings||[]).forEach(x=>{
    const type=x.booking_type||'villa_stay',resource=primaryResource(x),currency=bookingCurrency(x);

    add({date:x.created_at,title:'Booking created',detail:`${bookingTypeLabel(type)} • ${resource}`,category:'booking',booking:x,status:'complete'});

    const payments=bookingPayments(x.id);
    payments.forEach(p=>add({
      date:p.payment_date,
      title:p.payment_type==='refund'?'Refund recorded':`${paymentTypeLabel(p.payment_type)} received`,
      detail:`${p.payment_type==='refund'?'-':'+'}${money(p.amount,paymentCurrency(p))}${p.payment_method?` • ${paymentMethodLabel(p.payment_method)}`:''}${p.reference?` • ${p.reference}`:''}`,
      category:'payment',booking:x,status:p.payment_type==='refund'?'attention':'complete'
    }));

    const virtual=unrecordedDepositForCurrency(x,bookingCurrency(x));
    if(virtual>0)add({
      date:depositPaidDateFor(x)||x.created_at,
      title:'Deposit received',
      detail:`${money(virtual,bookingCurrency(x))} • Opening payment`,
      category:'payment',booking:x,status:'complete'
    });

    const nextAmount=nextPaymentAmountFor(x),nextDate=nextPaymentDateFor(x);
    if(nextAmount>0&&nextDate)add({
      date:nextDate,
      title:daysFromToday(nextDate)<0?'Payment overdue':'Payment due',
      detail:`${money(nextAmount,bookingCurrency(x))} • ${nextPaymentStageLabel(x)}`,
      category:'payment',booking:x,status:daysFromToday(nextDate)<0?'urgent':'future'
    });

    const supplier=supplierOwedFor(x);
    if(supplier>0){
      const d=nextDate||bookingPrimaryDate(x);
      add({date:d,title:'Supplier payment due',detail:`${money(supplier,supplierCurrencyFor(x))} • ${resource}`,category:'supplier',booking:x,status:daysFromToday(d)<0?'urgent':'future'});
    }

    if(type==='villa_stay'){
      if(x.arrival_date)add({date:x.arrival_date,time:x.arrival_time||'',title:'Villa arrival',detail:`${resource} • ${x.number_of_guests||'—'} guests${x.arrival_flight?` • Flight ${x.arrival_flight}`:''}`,category:'stay',booking:x,status:'future'});
      if(x.departure_date)add({date:x.departure_date,time:x.departure_time||'',title:'Villa departure',detail:`${resource}${x.departure_flight?` • Flight ${x.departure_flight}`:''}`,category:'stay',booking:x,status:'future'});
    }

    if(type==='boat_charter'){
      const bt=bookingBoat(x.id),d=bt?.charter_date||x.service_date;
      if(d)add({date:d,time:bt?.start_time||'',title:'Boat charter',detail:`${bt?.boat_name||resource} • ${bt?.departure_marina||x.event_location||'Marina not recorded'}${bt?.guests?` • ${bt.guests} guests`:''}`,category:'service',booking:x,status:boatIsConfirmed(x)?'complete':'future'});
    }

    if(type==='private_chef'){
      const ch=bookingChef(x.id),d=ch?.event_date||x.service_date;
      if(d)add({date:d,time:ch?.event_time||'',title:'Private chef',detail:`${ch?.chef_name||resource}${ch?.guests?` • ${ch.guests} guests`:''}${ch?.menu?` • ${ch.menu}`:''}`,category:'service',booking:x,status:['confirmed','completed'].includes(ch?.status)?'complete':'future'});
    }

    if(!['villa_stay','boat_charter','private_chef'].includes(type)&&x.service_date){
      add({date:x.service_date,title:bookingTypeLabel(type),detail:`${resource}${x.event_location?` • ${x.event_location}`:''}`,category:'service',booking:x,status:'future'});
    }

    ['decorations','shopping','beach_club','entertainment'].forEach(cat=>{
      const ex=experienceFor(x.id,cat);
      if(ex?.event_date)add({date:ex.event_date,time:ex.event_time||'',title:cat.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),detail:ex.title||ex.notes||resource,category:'service',booking:x,status:serviceDone(ex.status)?'complete':'future'});
    });

    if(x.payment_strategy_notes)add({
      date:nextPaymentDateFor(x)||bookingPrimaryDate(x)||x.created_at,
      title:'Payment arrangement',
      detail:paymentSummaryFor(x),
      category:'note',booking:x,status:'info'
    });

    if(x.payment_notes)add({
      date:x.payment_notes_updated_at||x.updated_at||x.created_at,
      title:'Payment note updated',
      detail:x.payment_notes,
      category:'note',booking:x,status:'info'
    });

    if(x.notes)add({
      date:x.updated_at||x.created_at,
      title:'Booking note',
      detail:x.notes,
      category:'note',booking:x,status:'info'
    });
  });

  const categoryRank={booking:0,payment:1,supplier:2,stay:3,service:4,note:5};
  return events.sort((a,b)=>{
    const d=String(a.date).localeCompare(String(b.date));
    if(d)return d;
    const t=String(a.time||'').localeCompare(String(b.time||''));
    if(t)return t;
    return (categoryRank[a.category]||9)-(categoryRank[b.category]||9);
  });
}
function customerTimelineStats(b){
  const c=customerRecordForBooking(b),bs=c.bookings||[];
  const services=bs.filter(x=>x.booking_type!=='villa_stay').length;
  const payments=bs.reduce((n,x)=>n+bookingPayments(x.id).length+(unrecordedDepositForCurrency(x,bookingCurrency(x))>0?1:0),0);
  const first=customerTimelineEvents(b)[0]?.date;
  const last=customerTimelineEvents(b).slice(-1)[0]?.date;
  return {customer:c,bookings:bs.length,services,payments,first,last};
}
function customerTimelineIcon(category){
  return {booking:'＋',payment:'£',supplier:'€',stay:'⌂',service:'★',note:'✎'}[category]||'•';
}
function renderTimeline(b){
  const stats=customerTimelineStats(b),events=customerTimelineEvents(b);
  const today=todayISO();
  const past=events.filter(e=>e.date<today),todayEvents=events.filter(e=>e.date===today),future=events.filter(e=>e.date>today);

  const eventHtml=e=>`<article class="customer-timeline-event ${e.status||''}">
    <div class="customer-timeline-marker"><span>${customerTimelineIcon(e.category)}</span></div>
    <div class="customer-timeline-date"><strong>${date(e.date)}</strong><small>${e.time||''}</small></div>
    <div class="customer-timeline-copy"><div class="timeline-event-head"><strong>${esc(e.title)}</strong><span>${esc(bookingTypeLabel(e.booking.booking_type))}</span></div><p>${esc(e.detail||'')}</p><small>${esc(primaryResource(e.booking))}</small></div>
    <button class="button secondary compact" onclick="openDetail('${e.booking.id}');setTimeout(()=>{activeDetailTab='overview';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='overview'));renderDetail();},0)">Open booking</button>
  </article>`;

  const group=(title,list,cls)=>list.length?`<section class="customer-timeline-group ${cls}"><div class="customer-timeline-group-head"><h4>${title}</h4><span>${list.length} event${list.length===1?'':'s'}</span></div><div class="customer-timeline-events">${list.map(eventHtml).join('')}</div></section>`:'';

  return `<div class="customer-timeline-dashboard">
    <div class="customer-timeline-summary">
      <div><span>Customer</span><strong>${esc(stats.customer.name)}</strong></div>
      <div><span>Linked bookings</span><strong>${stats.bookings}</strong></div>
      <div><span>Concierge services</span><strong>${stats.services}</strong></div>
      <div><span>Payments recorded</span><strong>${stats.payments}</strong></div>
      <div><span>Journey starts</span><strong>${stats.first?date(stats.first):'—'}</strong></div>
      <div><span>Latest scheduled event</span><strong>${stats.last?date(stats.last):'—'}</strong></div>
    </div>
    <div class="timeline-toolbar"><div><p class="section-kicker">Complete customer history</p><h3>${esc(stats.customer.name)} timeline</h3><p>Every linked booking, payment, service, note and operational milestone in one chronological record.</p></div><div class="timeline-legend"><span><i class="complete"></i>Completed / recorded</span><span><i class="future"></i>Upcoming</span><span><i class="urgent"></i>Needs attention</span></div></div>
    ${group('Past',past,'past')}
    ${group('Today',todayEvents,'today')}
    ${group('Upcoming',future,'future')}
    ${!events.length?'<div class="priority-empty"><span>✓</span><div><strong>No timeline events yet</strong><p>Events will appear automatically as bookings and payments are added.</p></div></div>':''}
  </div>`;
}
function paymentRows(b){
  const rows=[...bookingPayments(b.id)];
  const virtualDeposit=unrecordedDepositForCurrency(b,bookingCurrency(b));
  if(virtualDeposit>0)rows.unshift({id:null,payment_type:'deposit',payment_date:depositPaidDateFor(b),payment_method:'bank_transfer',reference:'Opening payment',amount:virtualDeposit,currency:bookingCurrency(b),virtual:true});
  if(!rows.length)return'<div class="payment-empty"><strong>No payments recorded</strong><p>Record the first payment to begin the audit trail.</p></div>';
  return `<div class="payment-list">${rows.map(p=>`<div class="payment-row"><div class="payment-type-icon ${p.payment_type==='refund'?'refund':''}">${p.payment_type==='refund'?'↩':'£'}</div><div class="payment-main"><strong>${esc(paymentTypeLabel(p.payment_type))}</strong><span>${date(p.payment_date)} • ${esc(paymentMethodLabel(p.payment_method))}${p.reference?` • ${esc(p.reference)}`:''}</span>${p.virtual?'<small>Deposit carried over from the booking financial record.</small>':p.notes?`<small>${esc(p.notes)}</small>`:''}</div><strong class="payment-amount ${p.payment_type==='refund'?'refund':''}">${p.payment_type==='refund'?'-':'+'}${money(p.amount,paymentCurrency(p))}</strong>${p.virtual?'':`<button class="payment-delete" onclick="deletePayment('${p.id}')" title="Delete payment">Delete</button>`}</div>`).join('')}</div>`;
}

function overviewServiceCard(b){
  const type=b.booking_type||'villa_stay';
  if(type==='villa_stay')return `<div class="detail-section"><h3>Stay</h3><dl><dt>Villa</dt><dd>${esc(b.villa_name||'Not recorded')}</dd><dt>Arrival</dt><dd>${date(b.arrival_date)}</dd><dt>Departure</dt><dd>${date(b.departure_date)}</dd><dt>Guests</dt><dd>${b.number_of_guests||'—'}</dd></dl></div>`;
  if(type==='boat_charter'){
    const bt=bookingBoat(b.id);
    return `<div class="detail-section"><h3>Charter</h3><dl><dt>Boat</dt><dd>${esc(bt?.boat_name||b.service_title||'Not recorded')}</dd><dt>Marina</dt><dd>${esc(bt?.departure_marina||b.event_location||'Not recorded')}</dd><dt>Date</dt><dd>${date(bt?.charter_date||b.service_date)}</dd><dt>Time</dt><dd>${esc(bt?.start_time||'—')}</dd><dt>Guests</dt><dd>${bt?.guests||b.number_of_guests||'—'}</dd></dl></div>`;
  }
  if(type==='private_chef'){
    const ch=bookingChef(b.id);
    return `<div class="detail-section"><h3>Chef event</h3><dl><dt>Event</dt><dd>${esc(ch?.event_type||b.service_title||'Private chef')}</dd><dt>Chef</dt><dd>${esc(ch?.chef_name||'Not assigned')}</dd><dt>Date</dt><dd>${date(ch?.event_date||b.service_date)}</dd><dt>Time</dt><dd>${esc(ch?.event_time||'—')}</dd><dt>Guests</dt><dd>${ch?.guests||b.number_of_guests||'—'}</dd></dl></div>`;
  }
  if(type==='entertainment'){
    const ent=experienceFor(b.id,'entertainment');
    return `<div class="detail-section"><h3>Entertainment</h3><dl><dt>Performer</dt><dd>${esc(ent?.title||b.service_title||'Not recorded')}</dd><dt>Venue</dt><dd>${esc(b.event_location||'Not recorded')}</dd><dt>Date</dt><dd>${date(ent?.service_date||b.service_date)}</dd><dt>Time</dt><dd>${esc(ent?.service_time||'—')}</dd><dt>Guests</dt><dd>${ent?.guests||b.number_of_guests||'—'}</dd></dl></div>`;
  }
  return `<div class="detail-section"><h3>Service</h3><dl><dt>Type</dt><dd>${esc(bookingTypeLabel(type))}</dd><dt>Resource</dt><dd>${esc(primaryResource(b))}</dd><dt>Date</dt><dd>${bookingDisplayDates(b)}</dd><dt>Location</dt><dd>${esc(b.event_location||'Not recorded')}</dd></dl></div>`;
}


function customerRecordForBooking(b){
  const email=normaliseCustomerValue(b.guest_email),phone=normalisePhone(b.guest_phone),name=normaliseCustomerValue(b.guest_name);
  const group=customerGroups().find(c=>
    (b.customer_id&&c.customer_ids&&c.customer_ids.has(String(b.customer_id)))||
    (email&&normaliseCustomerValue(c.email)===email)||
    (phone&&normalisePhone(c.phone)===phone)||
    (!email&&!phone&&!b.customer_id&&name&&normaliseCustomerValue(c.name)===name)
  );
  if(group)return group;
  return {key:customerKey(b),customer_id:b.customer_id||customerKey(b),customer_ids:new Set(b.customer_id?[String(b.customer_id)]:[]),name:b.guest_name||'Unknown',email:b.guest_email||'',phone:b.guest_phone||'',instagram:b.guest_instagram||'',nationality:b.guest_nationality||'',lead_source:b.lead_source||'Marbella Collective',itinerary_id:b.itinerary_id||b.id,bookings:[b]};
}
function customerBookingCurrencySummary(list,getter){
  const totals={GBP:0,EUR:0};
  list.forEach(x=>{const c=bookingCurrency(x);totals[c]+=Number(getter(x)||0);});
  return ['GBP','EUR'].filter(c=>totals[c]!==0).map(c=>money(totals[c],c)).join(' / ')||money(0,'GBP');
}
function customerItineraryRows(customer){
  return [...customer.bookings].sort((a,b)=>new Date(bookingPrimaryDate(a)||'9999-12-31')-new Date(bookingPrimaryDate(b)||'9999-12-31')).map(x=>{
    const next=nextPaymentAmountFor(x);
    return `<article class="customer-itinerary-row">
      <div class="customer-service-icon">${({villa_stay:'🏡',boat_charter:'⛵',private_chef:'🍽',entertainment:'🎵',decorations:'🎈',shopping:'🛍',beach_club:'🏖',other:'✨'})[x.booking_type]||'•'}</div>
      <div><span>${esc(bookingTypeLabel(x.booking_type))}</span><strong>${esc(primaryResource(x))}</strong><small>${esc(bookingDisplayDates(x))}</small></div>
      <div><span>Value</span><strong>${money(x.total_rental,bookingCurrency(x))}</strong><small>${x.number_of_guests?`${x.number_of_guests} guests`:''}</small></div>
      <div><span>Paid</span><strong>${money(paidForCurrency(x,bookingCurrency(x)),bookingCurrency(x))}</strong><small>${balanceFor(x)>0?`${money(balanceFor(x),bookingCurrency(x))} outstanding`:'Fully paid'}</small></div>
      <div><span>Next</span><strong>${next?money(next,nextPaymentCurrencyFor(x)):'—'}</strong><small>${nextPaymentDateFor(x)?date(nextPaymentDateFor(x)):''}</small></div>
      <button class="button secondary compact" onclick="openLinkedBooking('${x.id}')">Open</button>
    </article>`;
  }).join('');
}
function renderCustomerRecord(b){
  const c=customerRecordForBooking(b),bs=c.bookings||[];
  const total=customerBookingCurrencySummary(bs,x=>x.total_rental);
  const paid=customerBookingCurrencySummary(bs,x=>paidForCurrency(x,bookingCurrency(x)));
  const balance=customerBookingCurrencySummary(bs,x=>balanceFor(x));
  return `<section class="customer-record-hero">
    <div class="customer-record-identity"><div class="customer-record-avatar">${esc((c.name||'?').charAt(0).toUpperCase())}</div><div><p class="eyebrow">Smart customer record</p><h3>${esc(c.name||'Customer')}</h3><p>${esc(c.email||'Email not recorded')} ${c.phone?`• ${esc(c.phone)}`:''}</p></div></div>
    <div class="customer-record-stats"><div><span>Linked bookings</span><strong>${bs.length}</strong></div><div><span>Total value</span><strong>${total}</strong></div><div><span>Received</span><strong>${paid}</strong></div><div><span>Outstanding</span><strong>${balance}</strong></div></div>
  </section>
  <section class="customer-contact-card"><div><span>WhatsApp</span><strong>${esc(c.phone||'Not recorded')}</strong></div><div><span>Email</span><strong>${esc(c.email||'Not recorded')}</strong></div><div><span>Instagram</span><strong>${esc(c.instagram||'Not recorded')}</strong></div><div><span>Nationality</span><strong>${esc(c.nationality||'Not recorded')}</strong></div><div><span>Lead source</span><strong>${esc(c.lead_source||'—')}</strong></div></section>
  <section class="customer-itinerary-section"><div class="customer-itinerary-head"><div><p class="section-kicker">Complete itinerary</p><h3>All bookings for ${esc(c.name)}</h3><p>Villa stays and concierge services are kept together under this customer.</p></div><div class="customer-itinerary-actions"><button class="button secondary" onclick="activeDetailTab='ai';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='ai'));renderDetail();">AI Concierge</button><button class="button secondary" onclick="activeDetailTab='timeline';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='timeline'));renderDetail();">Customer timeline</button><button class="button primary" onclick="addServiceToCustomer('${b.id}')">Add to itinerary</button></div></div>
  <div class="customer-itinerary-list">${customerItineraryRows(c)}</div></section>`;
}
window.addServiceToCustomer=id=>{
  const source=bookings.find(x=>String(x.id)===String(id));if(!source)return;
  const customer=customerRecordForBooking(source);
  closeDetail();
  wizardBookingType='villa_stay';
  $('bookingWizardModal').classList.remove('hidden');
  $('bookingWizardModal').setAttribute('aria-hidden','false');
  $('wizardTypeStep').classList.remove('hidden');
  $('wizardCustomerStep').classList.add('hidden');
  $('bookingWizardModal').dataset.customerKey=customer.key;
};
function startCustomerService(type){
  const source=selectedBooking||null;
  if(!source)return;
  const customer=customerRecordForBooking(source);
  closeBookingWizard();
  openModal(null,{type,customer,itineraryId:source.itinerary_id||source.id,sourceBooking:source});
}


function customerHasBookingType(customer,type){
  return (customer.bookings||[]).some(b=>b.booking_type===type);
}
function customerHasExperience(customer,type){
  return (customer.bookings||[]).some(b=>Boolean(experienceFor(b.id,type)));
}
function aiConciergeInsights(b){
  const customer=customerRecordForBooking(b),bs=customer.bookings||[],items=[];
  const villas=bs.filter(x=>x.booking_type==='villa_stay');
  const boatsForCustomer=bs.filter(x=>x.booking_type==='boat_charter');
  const chefsForCustomer=bs.filter(x=>x.booking_type==='private_chef');
  const future=bs.filter(x=>{const d=bookingPrimaryDate(x);return d&&daysFromToday(d)>=0;});
  const add=(priority,title,detail,action=null,booking=null)=>items.push({priority,title,detail,action,booking:booking||b});

  // Operational gaps.
  villas.forEach(v=>{
    const arrivalDays=daysFromToday(v.arrival_date);
    if(arrivalDays!==null&&arrivalDays>=0&&arrivalDays<=30){
      if(!v.arrival_flight&&!v.flight_details)add(100,'Flight details missing',`${v.guest_name} arrives at ${primaryResource(v)} on ${date(v.arrival_date)} but arrival flight details are not recorded.`,'Open villa booking',v);
      if(!v.guest_phone)add(92,'Guest telephone missing',`No telephone / WhatsApp is recorded for ${v.guest_name}.`,'Open customer record',v);
    }
  });

  // Payment attention.
  bs.forEach(x=>{
    const due=nextPaymentAmountFor(x),dueDate=nextPaymentDateFor(x),days=daysFromToday(dueDate);
    if(due>0&&dueDate){
      if(days<0)add(120,'Guest payment overdue',`${money(due,bookingCurrency(x))} was due ${date(dueDate)} for ${primaryResource(x)}.`,'Record payment',x);
      else if(days===0)add(115,'Guest payment due today',`${money(due,bookingCurrency(x))} is due today for ${primaryResource(x)}.`,'Record payment',x);
      else if(days!==null&&days<=7)add(90,'Guest payment due soon',`${money(due,bookingCurrency(x))} is due ${date(dueDate)} for ${primaryResource(x)}.`,'Open booking',x);
    }
    const supplier=supplierOwedFor(x),sd=supplierPaymentDateFor(x),sDays=daysFromToday(sd);
    if(supplier>0&&sDays!==null&&sDays<=7)add(sDays<0?118:88,'Supplier payment due',`${money(supplier,supplierCurrencyFor(x))} due for ${primaryResource(x)}.`,'Open booking',x);
  });

  // Commercial opportunities, only when there is a future villa stay.
  if(villas.some(v=>daysFromToday(v.arrival_date)>=0)){
    if(!boatsForCustomer.length)add(45,'Boat charter opportunity','No boat charter is currently attached to this itinerary.','Add boat');
    if(!chefsForCustomer.length)add(40,'Private chef opportunity','No private chef booking is currently attached to this itinerary.','Add chef');
    if(!customerHasExperience(customer,'entertainment')&&!customerHasBookingType(customer,'entertainment'))add(34,'Entertainment opportunity','No entertainment or musician booking is recorded.','Add entertainment');
    if(!customerHasExperience(customer,'decorations')&&!customerHasBookingType(customer,'decorations'))add(28,'Decorations opportunity','No decorations booking is recorded for the stay.','Add decorations');
  }

  // Multi-service / itinerary intelligence.
  if(bs.length>1)add(22,'Linked itinerary',`${bs.length} bookings are linked under one customer itinerary. Keep changes within this customer record to avoid duplicates.`,'Open customer');
  if(!items.length)add(10,'No immediate issues','The customer itinerary has no obvious operational gaps or payments needing attention.');

  return items.sort((a,b)=>b.priority-a.priority);
}
function aiConciergeAction(insight){
  const x=insight.booking;
  const text=String(insight.action||'');
  if(text==='Record payment')return `<button class="button primary compact" onclick="openPaymentModal('${x.id}')">Record payment</button>`;
  if(text==='Open booking')return `<button class="button secondary compact" onclick="openDetail('${x.id}');setTimeout(()=>{activeDetailTab='overview';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='overview'));renderDetail();},0)">Open booking</button>`;
  if(text==='Open villa booking')return `<button class="button secondary compact" onclick="editBooking('${x.id}')">Edit villa</button>`;
  if(text==='Open customer record'||text==='Open customer')return `<button class="button secondary compact" onclick="activeDetailTab='customer';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='customer'));renderDetail();">Customer</button>`;
  if(text==='Add boat')return `<button class="button primary compact" onclick="startCustomerService('boat_charter')">Add boat</button>`;
  if(text==='Add chef')return `<button class="button primary compact" onclick="startCustomerService('private_chef')">Add chef</button>`;
  if(text==='Add entertainment')return `<button class="button primary compact" onclick="startCustomerService('entertainment')">Add entertainment</button>`;
  if(text==='Add decorations')return `<button class="button primary compact" onclick="startCustomerService('decorations')">Add decorations</button>`;
  return '';
}
function renderAIConcierge(b){
  const c=customerRecordForBooking(b),insights=aiConciergeInsights(b);
  const urgent=insights.filter(i=>i.priority>=90).length;
  const ops=insights.filter(i=>i.priority>=50&&i.priority<90).length;
  const opportunities=insights.filter(i=>i.priority<50&&i.priority>10).length;
  return `<section class="ai-concierge">
    <div class="ai-concierge-hero">
      <div><p class="eyebrow">Phase 5</p><h3>AI Concierge</h3><p>A live reading of ${esc(c.name)}'s itinerary, highlighting what needs attention and where there may be an opportunity.</p></div>
      <div class="ai-concierge-stats"><div><span>Urgent</span><strong>${urgent}</strong></div><div><span>Operations</span><strong>${ops}</strong></div><div><span>Opportunities</span><strong>${opportunities}</strong></div></div>
    </div>
    <div class="ai-insight-list">${insights.map(i=>`<article class="ai-insight ${i.priority>=90?'urgent':i.priority>=50?'attention':i.priority>10?'opportunity':'clear'}">
      <div class="ai-insight-icon">${i.priority>=90?'!':i.priority>=50?'•':i.priority>10?'+':'✓'}</div>
      <div><strong>${esc(i.title)}</strong><p>${esc(i.detail)}</p></div>
      ${aiConciergeAction(i)}
    </article>`).join('')}</div>
  </section>`;
}

function renderDetail(){
  const b=selectedBooking;if(!b)return;const balance=balanceFor(b),received=paidFor(b);
  if(activeDetailTab==='customer')$('detailContent').innerHTML=renderCustomerRecord(b);
  else if(activeDetailTab==='ai')$('detailContent').innerHTML=renderAIConcierge(b);
  else if(activeDetailTab==='overview')$('detailContent').innerHTML=`
    <div class="booking-hero">
      <div><span class="hero-label">Balance outstanding</span><strong>${money(balance)}</strong><small>${b.balance_due_date?`Due ${date(b.balance_due_date)}`:'No due date recorded'}</small></div>
      <div><span class="hero-label">Payments received</span><strong>${money(received)}</strong><small>of ${money(b.total_rental)} rental</small></div>
      <div><span class="hero-label">Guests</span><strong>${b.number_of_guests||'—'}</strong><small>${esc(bookingDisplayPlace(b))}</small></div>
    </div>
    <div class="detail-layout stacked"><div class="detail-main"><div class="detail-grid">
      <div class="detail-section"><h3>Guest</h3><dl><dt>Email</dt><dd>${esc(b.guest_email||'Not recorded')}</dd><dt>WhatsApp</dt><dd>${esc(b.guest_phone||'Not recorded')}</dd><dt>Lead source</dt><dd>${esc(b.lead_source||'—')}</dd></dl></div>
      ${overviewServiceCard(b)}
    </div><aside class="tasks-card tasks-below"><div class="section-kicker">Needs attention</div><h3>Booking tasks</h3>${renderTasks(b)}</aside></div></div>
    <section class="overview-notes-panel"><div><p class="section-kicker">Booking notes</p><h3>Quick notes</h3></div><textarea id="overviewBookingNotes" rows="4" placeholder="Add a note about this booking…">${esc(b.notes||'')}</textarea><div class="overview-notes-actions"><button class="button secondary" onclick="saveBookingNotes('${b.id}')">Save notes</button></div><div id="bookingNotesMessage" class="form-message"></div></section>
    ${relatedBookingsHtml(b)}`;
  else if(activeDetailTab==='payments')$('detailContent').innerHTML=`
    <div class="payment-head"><div><p class="section-kicker">Financial audit trail</p><h3>Payments</h3></div><button class="button primary" onclick="openPaymentModal('${b.id}')">Record payment</button></div>
    <div class="money-summary six"><div><span>Total booking value</span><strong>${money(b.total_rental,bookingCurrency(b))}</strong></div><div><span>Commission</span><strong>${money(commissionFor(b),commissionCurrency(b))}</strong></div><div><span>Deposit paid</span><strong>${money(depositPaidFor(b),bookingCurrency(b))}</strong></div><div class="payment-strategy-card"><span>Payment strategy</span><strong>${esc(paymentStrategyLabel(b.payment_strategy))}</strong><small>${esc(paymentSummaryFor(b))}</small></div><div class="next-payment-card ${nextPaymentState(b)}"><span>${esc(nextPaymentStageLabel(b))}</span><strong>${nextPaymentAmountFor(b)?money(nextPaymentAmountFor(b),nextPaymentCurrencyFor(b)):'—'}</strong><small>${nextPaymentDateFor(b)?'Due '+date(nextPaymentDateFor(b)):''}</small></div><div><span>Payments received</span><strong>${paidBreakdown(b)}</strong></div><div class="balance-card"><span>Balance outstanding</span><strong>${money(balance,bookingCurrency(b))}</strong></div><div class="supplier-owed-card"><span>Amount owed to supplier</span><strong>${money(supplierOwedFor(b),supplierCurrencyFor(b))}</strong></div></div>
    ${paymentRows(b)}
    <section class="payment-notes-panel">
      <div><p class="section-kicker">Payment notes</p><h3>Notes</h3><p>Keep payment reminders, supplier invoice details and refund information with the financial record.</p></div>
      <textarea id="detailPaymentNotes" rows="5" placeholder="Add payment-related notes…">${esc(b.payment_notes||'')}</textarea>
      <div class="payment-notes-actions"><small>${b.payment_notes_updated_at?`Last updated ${new Date(b.payment_notes_updated_at).toLocaleString('en-GB')}`:'No payment notes saved yet.'}</small><button class="button secondary" onclick="savePaymentNotes('${b.id}')">Save notes</button></div>
      <div id="paymentNotesMessage" class="form-message"></div>
    </section>`;
  else if(activeDetailTab==='concierge'){
    const bt=bookingBoat(b.id);
    const ch=bookingChef(b.id),chefSell=Number(ch?.selling_price||0),chefPaid=Number(ch?.amount_paid||0),chefCost=Number(ch?.supplier_cost||0),chefBalance=Math.max(0,chefSell-chefPaid);
    $('detailContent').innerHTML=`<div class="experience-head"><div><p class="section-kicker">Guest experience</p><h3>Concierge hub</h3></div></div>
    <section class="concierge-module boat-module"><div class="module-heading"><div><p class="eyebrow">Boat charter</p><h4>${esc(bt?.boat_name||b.service_title||'Yacht or day boat')}</h4></div><span class="transfer-badge ${boatStatusClass(effectiveBoatStatus(b))}">${esc(boatIsConfirmed(b)?'Confirmed':boatStatusLabel(effectiveBoatStatus(b)))}</span></div>
      <div class="boat-view-grid"><article class="boat-view-card"><p class="eyebrow">Charter</p><dl><dt>Date</dt><dd>${date(bt?.charter_date||b.service_date)}</dd><dt>Start</dt><dd>${esc(bt?.start_time||'—')}</dd><dt>Duration</dt><dd>${bt?.duration_hours?`${bt.duration_hours} hours`:'—'}</dd><dt>Marina</dt><dd>${esc(bt?.departure_marina||b.event_location||'Not recorded')}</dd><dt>Guests</dt><dd>${bt?.guests||b.number_of_guests||'—'}</dd></dl></article>
      <article class="boat-view-card"><p class="eyebrow">Supplier</p><dl><dt>Company</dt><dd>${esc(bt?.supplier||'Not recorded')}</dd><dt>Reference</dt><dd>${esc(bt?.reference||'—')}</dd><dt>Supplier payment due</dt><dd>${money(supplierOwedFor(b),supplierCurrencyFor(b))}</dd><dt>Commission</dt><dd>${money(commissionFor(b),commissionCurrency(b))}</dd><dt>Gross margin</dt><dd><strong>${money(commissionFor(b),commissionCurrency(b))}</strong></dd></dl></article>
      <article class="boat-view-card boat-commercial"><p class="eyebrow">Guest payments</p><dl><dt>Total booking value</dt><dd>${money(b.total_rental,bookingCurrency(b))}</dd><dt>Deposit paid</dt><dd>${money(depositPaidFor(b),bookingCurrency(b))}</dd><dt>Total paid</dt><dd>${money(paidForCurrency(b,bookingCurrency(b)),bookingCurrency(b))}</dd><dt>Balance</dt><dd><strong>${money(balanceFor(b),bookingCurrency(b))}</strong></dd></dl></article></div>
      ${bt?.notes?`<div class="service-notes"><strong>Boat notes</strong><p>${esc(bt.notes).split('\n').join('<br>')}</p></div>`:''}
    </section>
    <section class="concierge-module chef-module"><div class="module-heading"><div><p class="eyebrow">Private chef</p><h4>${esc(ch?.event_type||'Villa dining experience')}</h4></div><span class="transfer-badge ${chefStatusClass(ch?.status)}">${esc(chefStatusLabel(ch?.status))}</span></div>
      <div class="service-view-grid"><article class="service-view-card"><p class="eyebrow">Event</p><dl><dt>Date</dt><dd>${date(ch?.event_date)}</dd><dt>Time</dt><dd>${esc(ch?.event_time||'—')}</dd><dt>Guests</dt><dd>${ch?.guests||b.number_of_guests||'—'}</dd><dt>Menu</dt><dd>${esc(ch?.menu||'Not selected')}</dd><dt>Drinks</dt><dd>${esc(ch?.drinks_package||'Not recorded')}</dd></dl></article>
      <article class="service-view-card"><p class="eyebrow">Chef & supplier</p><dl><dt>Chef</dt><dd>${esc(ch?.chef_name||'Not assigned')}</dd><dt>Company</dt><dd>${esc(ch?.supplier||'Not recorded')}</dd><dt>Contact</dt><dd>${esc(ch?.contact||'—')}</dd><dt>Reference</dt><dd>${esc(ch?.reference||'—')}</dd><dt>Dietary</dt><dd>${esc(ch?.dietary_requirements||'None recorded')}</dd></dl></article>
      <article class="service-view-card service-commercial"><p class="eyebrow">Commercial</p><dl><dt>Supplier cost</dt><dd>${money(chefCost,ch?.currency||'EUR')}</dd><dt>Selling price</dt><dd>${money(chefSell,ch?.currency||'EUR')}</dd><dt>Gross margin</dt><dd><strong>${money(commissionFor(b),commissionCurrency(b))}</strong></dd><dt>Deposit paid</dt><dd>${money(ch?.deposit_paid||0,ch?.currency||'EUR')}</dd><dt>Balance</dt><dd><strong>${money(chefBalance,ch?.currency||'EUR')}</strong></dd></dl></article></div>
      ${ch?.notes?`<div class="service-notes"><strong>Chef notes</strong><p>${esc(ch.notes).split('\n').join('<br>')}</p></div>`:''}
    </section>
    ${renderExperienceSuite(b)}`;
  }
  else if(activeDetailTab==='timeline')$('detailContent').innerHTML=renderTimeline(b);
  else $('detailContent').innerHTML=`<div class="detail-section notes-box"><h3>Internal notes</h3><p>${esc(b.notes||'No notes recorded.').replace(/\n/g,'<br>')}</p></div>`;
}
window.saveBookingNotes=async id=>{
  const notes=$('overviewBookingNotes')?.value.trim()||null;
  const button=document.querySelector('[onclick^="saveBookingNotes"]');
  if(button)button.disabled=true;
  const{error}=await supabaseClient.from('bookings').update({notes}).eq('id',id);
  if(button)button.disabled=false;
  const message=$('bookingNotesMessage');
  if(error){if(message)message.textContent=error.message;return;}
  const b=bookings.find(x=>String(x.id)===String(id));if(b)b.notes=notes;
  if(selectedBooking&&String(selectedBooking.id)===String(id))selectedBooking.notes=notes;
  if(message)message.textContent='Booking notes saved.';
  renderDetail();
};
window.savePaymentNotes=async id=>{
  const notes=$('detailPaymentNotes')?.value.trim()||null;
  const updatedAt=new Date().toISOString();
  const button=document.querySelector('[onclick^="savePaymentNotes"]');
  if(button)button.disabled=true;
  const{error}=await supabaseClient.from('bookings').update({payment_notes:notes,payment_notes_updated_at:updatedAt}).eq('id',id);
  if(button)button.disabled=false;
  const message=$('paymentNotesMessage');
  if(error){if(message)message.textContent=error.message;return;}
  const b=bookings.find(x=>String(x.id)===String(id));
  if(b){b.payment_notes=notes;b.payment_notes_updated_at=updatedAt;}
  if(selectedBooking&&String(selectedBooking.id)===String(id)){selectedBooking.payment_notes=notes;selectedBooking.payment_notes_updated_at=updatedAt;}
  if(message)message.textContent='Payment notes saved.';
  renderDetail();
};
window.manageCurrentBookingPayments=()=>{
  const id=$('bookingId')?.value;
  if(!id)return;
  const booking=bookings.find(x=>String(x.id)===String(id));
  if(!booking)return;
  closeModal(true);
  openDetail(id);
  activeDetailTab='payments';
  document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='payments'));
  renderDetail();
};
window.recordCurrentStagedPayment=async()=>{
  const id=$('bookingId')?.value;if(!id)return;
  const b=bookings.find(x=>String(x.id)===String(id));if(!b)return;
  const meta=villaStrategyMeta($('paymentStrategy')?.value||b.payment_strategy);if(!meta?.staged)return;
  const amount=Number($('nextPaymentAmount')?.value||0);if(amount<=0)return;
  const payDate=$('stagedPaymentPaidDate')?.value||todayISO();
  const currency=bookingCurrency(b);
  const reference=meta.stageName==='second_deposit'?'Second deposit':'Further staged payment';
  const ins=await supabaseClient.from('booking_payments').insert({booking_id:id,payment_date:payDate,payment_type:'deposit',amount,payment_method:'bank_transfer',reference,currency});
  if(ins.error){$('bookingMessage').textContent=ins.error.message;setSaveStatus('error','Could not record payment');return;}
  const finalAmount=meta.finalPct?Number(b.total_rental||0)*(meta.finalPct/100):Math.max(0,Number(b.total_rental||0)-Number(b.deposit_paid||0)-amount);
  const finalDate=$('balanceDueDate')?.value||isoDateMinusDays($('arrivalDate')?.value||b.arrival_date,meta.finalDays);
  const upd=await supabaseClient.from('bookings').update({next_payment_amount:finalAmount,next_payment_due_date:finalDate,next_payment_currency:currency,next_payment_stage:'final_balance',balance_due_date:finalDate}).eq('id',id);
  if(upd.error){$('bookingMessage').textContent=upd.error.message;setSaveStatus('error','Payment recorded; schedule update failed');return;}
  await loadData();
  const refreshed=bookings.find(x=>String(x.id)===String(id));
  $('nextPaymentStage').value='final_balance';$('nextPaymentAmount').value=finalAmount.toFixed(2);$('nextPaymentDueDate').value=finalDate||'';
  $('stagedPaymentActionWrap')?.classList.add('is-hidden');
  if($('finalPaymentAmount'))$('finalPaymentAmount').value=money(finalAmount,currency);
  setSaveStatus('saved','Payment recorded');updatePaymentSummaryPreview();
  renderEditItineraryPanel(refreshed);
};
window.openPaymentModal=id=>{
  const b=bookings.find(x=>String(x.id)===String(id));if(!b)return;
  $('paymentForm').reset();$('paymentBookingId').value=b.id;$('paymentGuest').textContent=`${b.guest_name} • ${b.villa_name}`;$('paymentDate').value=todayISO();$('paymentType').value=balanceFor(b)>0&&paidFor(b)>0?'balance':'deposit';$('paymentMethod').value='bank_transfer';$('paymentCurrency').value=bookingCurrency(b);$('paymentAmount').value=balanceFor(b)>0?balanceFor(b).toFixed(2):'';$('paymentMessage').textContent='';$('paymentModal').classList.remove('hidden');$('paymentModal').setAttribute('aria-hidden','false');
};
function closePaymentModal(){$('paymentModal').classList.add('hidden');$('paymentModal').setAttribute('aria-hidden','true');}
window.deletePayment=async id=>{if(!confirm('Delete this payment transaction? The booking balance will update automatically.'))return;const{error}=await supabaseClient.from('booking_payments').delete().eq('id',id);if(error)alert(error.message);else await loadData();};

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginMessage').textContent='';$('loginButton').disabled=true;const{error}=await supabaseClient.auth.signInWithPassword({email:$('email').value,password:$('password').value});$('loginButton').disabled=false;if(error)$('loginMessage').textContent=error.message;});
$('resetPasswordForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const a=$('newPassword').value,b=$('confirmNewPassword').value,msg=$('resetPasswordMessage');
  msg.textContent='';
  if(a!==b){msg.textContent='The two passwords do not match.';return;}
  if(a.length<8){msg.textContent='Please use at least 8 characters.';return;}
  $('resetPasswordButton').disabled=true;
  const{error}=await supabaseClient.auth.updateUser({password:a});
  $('resetPasswordButton').disabled=false;
  if(error){msg.textContent=error.message;return;}
  passwordRecoveryActive=false;
  msg.textContent='Password changed successfully.';
  const{data:{session}}=await supabaseClient.auth.getSession();
  if(session)await enterApp(session.user);else show('loginView');
});
$('managePaymentsButton')?.addEventListener('click',window.manageCurrentBookingPayments);

$('logoutButton').addEventListener('click',()=>supabaseClient.auth.signOut());$('retryConfig').addEventListener('click',()=>location.reload());$('searchInput').addEventListener('input',renderBookings);
document.querySelectorAll('[data-open-booking]').forEach(x=>x.addEventListener('click',openBookingWizard));document.querySelectorAll('[data-close-modal]').forEach(x=>x.addEventListener('click',()=>closeModal()));document.querySelectorAll('[data-close-delete-confirm]').forEach(x=>x.addEventListener('click',closeDeleteConfirm));document.querySelectorAll('[data-close-duplicate]').forEach(x=>x.addEventListener('click',closeDuplicateWarning));$('confirmDeleteBooking').addEventListener('click',performDeleteBooking);document.querySelectorAll('[data-close-detail]').forEach(x=>x.addEventListener('click',closeDetail));document.querySelectorAll('[data-close-payment]').forEach(x=>x.addEventListener('click',closePaymentModal));document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>switchView(x.dataset.view)));document.querySelectorAll('[data-view-button]').forEach(x=>x.addEventListener('click',()=>switchView(x.dataset.viewButton)));document.querySelectorAll('.detail-tab').forEach(x=>x.addEventListener('click',()=>{activeDetailTab=x.dataset.detailTab;document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t===x));renderDetail();}));$('detailEdit').addEventListener('click',event=>{
  event.preventDefault();
  event.stopPropagation();
  const id=selectedBooking?.id;
  if(id)window.editBooking(id);
});
$('detailAddService')?.addEventListener('click',()=>{if(selectedBooking)addServiceToCustomer(selectedBooking.id);});
$('detailAddBoat')?.addEventListener('click',()=>{if(selectedBooking)addAnotherBoat(selectedBooking.id);});$('mobileNav').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));


document.querySelectorAll('[data-close-booking-wizard]').forEach(x=>x.addEventListener('click',closeBookingWizard));
document.querySelectorAll('[data-wizard-type]').forEach(x=>x.addEventListener('click',()=>chooseWizardType(x.dataset.wizardType)));
$('wizardBackToTypes')?.addEventListener('click',()=>{$('wizardCustomerStep').classList.add('hidden');$('wizardTypeStep').classList.remove('hidden');});
$('wizardNewCustomer')?.addEventListener('click',()=>startWizardBooking());
$('wizardExistingCustomer')?.addEventListener('click',()=>{$('wizardCustomerSearchWrap').classList.remove('hidden');renderWizardCustomers();$('wizardCustomerSearch').focus();});
$('wizardCustomerSearch')?.addEventListener('input',renderWizardCustomers);
$('wizardCustomerResults')?.addEventListener('click',e=>{
  const del=e.target.closest('[data-delete-wizard-booking]');
  if(del){
    e.preventDefault();e.stopPropagation();
    openDeleteConfirm(del.dataset.deleteWizardBooking,'wizard');
    return;
  }
  const btn=e.target.closest('[data-wizard-customer]');
  if(!btn)return;
  const customer=customerGroups().find(c=>c.key===btn.dataset.wizardCustomer);
  if(customer)startWizardBooking(customer);
});
['adultCount','childCount'].forEach(id=>$(id)?.addEventListener('input',()=>syncGuestTotal(true)));
$('eventLocationSelect')?.addEventListener('change',()=>syncConditionalInput('eventLocationSelect','eventLocation'));
$('guestNationalitySelect')?.addEventListener('change',()=>syncConditionalInput('guestNationalitySelect','guestNationality'));
$('arrivalAirportSelect')?.addEventListener('change',()=>syncConditionalInput('arrivalAirportSelect','arrivalAirport'));
$('departureAirportSelect')?.addEventListener('change',()=>syncConditionalInput('departureAirportSelect','departureAirport'));
$('commissionType')?.addEventListener('change',toggleCommissionType);
$('commissionFixedAmount')?.addEventListener('input',()=>{updateBoatFinancials();updateChefFinancials();});
$('commissionRateSelect')?.addEventListener('change',()=>{syncConditionalInput('commissionRateSelect','commissionRate');updateBoatFinancials();updateChefFinancials();});
$('commissionRate')?.addEventListener('input',()=>{updateBoatFinancials();updateChefFinancials();});

$('bookingForm').addEventListener('input',markWorkspaceDirty);
$('bookingForm').addEventListener('change',markWorkspaceDirty);

['boatSupplierCost','boatSellingPrice','boatAmountPaid'].forEach(id=>$(id).addEventListener('input',updateBoatFinancials));
['chefSupplierCost','chefSellingPrice','chefAmountPaid'].forEach(id=>$(id).addEventListener('input',updateChefFinancials));
['decor','shop','beach','ent'].forEach(prefix=>[prefix+'Sell',prefix+'Paid'].forEach(id=>$(id)?.addEventListener('input',()=>updateExperienceBalance(prefix))));
function canonicalBoatResourceName(value){
  const name=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const aliases={
    'big boat':'vibe',
    'bigboat':'vibe',
    'vibe':'vibe',
    'small boat':'saxador',
    'smallboat':'saxador',
    'saxador':'saxador'
  };
  return aliases[name]||name;
}
function duplicateKeyForPayload(payload){
  const type=payload.booking_type||'villa_stay';
  let resource=type==='villa_stay'?String(payload.villa_name||'').trim().toLowerCase():String(payload.service_title||payload.event_location||'').trim().toLowerCase();
  if(type==='boat_charter')resource=canonicalBoatResourceName(resource);
  return {type,name:String(payload.guest_name||'').trim().toLowerCase(),resource,date:type==='villa_stay'?payload.arrival_date:payload.service_date};
}
function findDuplicateBooking(payload,currentId=''){
  const key=duplicateKeyForPayload(payload);if(!key.name||!key.date)return null;
  return bookings.find(b=>String(b.id)!==String(currentId)&&(()=>{const x=duplicateKeyForPayload(b);return x.type===key.type&&x.name===key.name&&x.date===key.date&&(!key.resource||x.resource===key.resource);})())||null;
}
function closeDuplicateWarning(){pendingDuplicate=null;$('duplicateWarningModal').classList.add('hidden');$('duplicateWarningModal').setAttribute('aria-hidden','true');}
function openDuplicateWarning(existing,resume){
  pendingDuplicate={existing,resume};
  const resource=bookingDisplayPlace(existing);
  const aliasNote=existing.booking_type==='boat_charter'?` Existing boat: ${resource}. Big Boat/Vibe and Small Boat/Saxador are treated as the same resource.`:'';
  $('duplicateSummary').textContent=`${existing.guest_name} • ${resource} • ${bookingDisplayDates(existing)}.${aliasNote}`;
  $('duplicateWarningModal').classList.remove('hidden');
  $('duplicateWarningModal').setAttribute('aria-hidden','false');
}
$('openExistingDuplicate').addEventListener('click',()=>{const b=pendingDuplicate?.existing;closeDuplicateWarning();if(b){closeModal(true);openDetail(b.id);}});
$('createDuplicateAnyway').addEventListener('click',()=>{const resume=pendingDuplicate?.resume;closeDuplicateWarning();allowDuplicateOnce=true;if(resume)resume();});

$('bookingForm').addEventListener('submit',async e=>{
  e.preventDefault();$('saveBooking').disabled=true;$('bookingMessage').textContent='';setSaveStatus('saving','Saving changes…');
  const id=$('bookingId').value;
  const type=$('bookingType').value;
  const openingPayment=Number($('depositPaid').value||0);
  refreshGeneratedTitle();
  if(type==='boat_charter'){if(!$('serviceTitle').value)$('serviceTitle').value=(selectedBoatName()||'Boat charter');if(!$('serviceDate').value)$('serviceDate').value=$('boatDate').value;if(!$('eventLocation').value)$('eventLocation').value=$('boatMarina').value;syncBoatBookingFields(true);}
  if(type==='private_chef'){if(!$('serviceTitle').value)$('serviceTitle').value=$('chefEventType').value?`Private chef – ${$('chefEventType').value}`:'Private chef';if(!$('serviceDate').value)$('serviceDate').value=$('chefDate').value;if(!$('totalRental').value)$('totalRental').value=$('chefSellingPrice').value||0;}
  if(type==='entertainment'){if(!$('serviceTitle').value)$('serviceTitle').value=$('entTitle').value||'Entertainment';if(!$('serviceDate').value)$('serviceDate').value=$('entDate').value;if(!$('totalRental').value)$('totalRental').value=$('entSell').value||0;}
  const payload={customer_id:$('customerId').value||customerMatchKeyFromForm()||null,itinerary_id:$('itineraryId').value||null,booking_type:type,service_title:$('serviceTitle').value.trim()||null,service_date:$('serviceDate').value||null,event_location:conditionalValue('eventLocationSelect','eventLocation'),guest_name:$('guestName').value.trim(),villa_name:type==='villa_stay'?($('villaName').value.trim()||null):null,arrival_date:type==='villa_stay'?($('arrivalDate').value||null):null,departure_date:type==='villa_stay'?($('departureDate').value||null):null,arrival_time:$('arrivalTime').value||null,departure_time:$('departureTime').value||null,number_of_guests:$('guestCount').value?Number($('guestCount').value):null,adults:$('adultCount').value?Number($('adultCount').value):null,children:$('childCount').value?Number($('childCount').value):null,guest_email:$('guestEmail').value.trim()||null,guest_phone:$('guestPhone').value.trim()||null,guest_instagram:$('guestInstagram').value.trim()||null,guest_nationality:conditionalValue('guestNationalitySelect','guestNationality'),total_rental:Number($('totalRental').value||0),deposit_paid:Number($('depositPaid').value||0),deposit_paid_date:(type==='boat_charter'||type==='villa_stay')?boatCreatedDate(bookings.find(x=>String(x.id)===String(id))):($('depositPaidDate').value||null),deposit_currency:$('depositCurrency')?.value||$('bookingCurrency').value,next_payment_amount:Number($('nextPaymentAmount').value||0),next_payment_due_date:type==='boat_charter'?($('serviceDate').value||$('boatDate').value||null):($('nextPaymentDueDate').value||null),next_payment_currency:$('nextPaymentCurrency')?.value||$('bookingCurrency').value,next_payment_stage:$('nextPaymentStage').value||'final_balance',payment_strategy:$('paymentStrategy').value||'custom',payment_strategy_notes:$('paymentStrategyNotes').value.trim()||null,supplier_amount_owed:Number($('supplierAmountOwed').value||0),supplier_payment_due_date:$('supplierPaymentDueDate')?.value||null,supplier_currency:type==='boat_charter'?'EUR':$('supplierCurrency').value,booking_currency:type==='boat_charter'?'EUR':$('bookingCurrency').value,commission_currency:$('commissionCurrency').value,balance_due_date:$('balanceDueDate').value||null,commission_rate:selectedCommissionRate()/100,commission_type:$('commissionType').value,commission_fixed_amount:$('commissionType').value==='fixed'?Number($('commissionFixedAmount').value||0):null,damage_deposit:Number($('damageDeposit').value||0),lead_source:$('leadSource').value.trim()||null,status:$('bookingStatus').value,arrival_flight:$('arrivalFlight').value.trim()||null,departure_flight:$('departureFlight').value.trim()||null,arrival_airport:conditionalValue('arrivalAirportSelect','arrivalAirport'),departure_airport:conditionalValue('departureAirportSelect','departureAirport'),flight_details:$('flightDetails').value.trim()||null,chef_booked:['confirmed','completed'].includes($('chefStatus').value),boat_booked:$('boatStatus').value==='confirmed',decorations_booked:['confirmed','completed'].includes($('decorStatus').value),notes:$('bookingNotes').value.trim()||null};
  if(!id&&!allowDuplicateOnce){const duplicate=findDuplicateBooking(payload);if(duplicate){$('saveBooking').disabled=false;setSaveStatus('dirty','Possible duplicate');openDuplicateWarning(duplicate,()=>$('bookingForm').requestSubmit());return;}}allowDuplicateOnce=false;
  let result=id?await supabaseClient.from('bookings').update(payload).eq('id',id).select().single():await supabaseClient.from('bookings').insert({...payload,deposit_received:payload.deposit_paid}).select().single();
  if(!result.error&&!id&&!payload.itinerary_id){
    const rootResult=await supabaseClient.from('bookings').update({itinerary_id:result.data.id}).eq('id',result.data.id).select().single();
    if(!rootResult.error){result.data=rootResult.data;$('itineraryId').value=result.data.id;}
  }
  if(!result.error&&!id&&openingPayment>0){const paymentResult=await supabaseClient.from('booking_payments').insert({booking_id:result.data.id,payment_date:payload.deposit_paid_date||todayISO(),payment_type:'deposit',amount:openingPayment,payment_method:'bank_transfer',reference:'Opening payment',currency:type==='boat_charter'?($('depositCurrency')?.value||$('bookingCurrency').value):$('bookingCurrency').value});if(paymentResult.error)result={error:paymentResult.error};}
  if(!result.error&&type==='boat_charter'&&$('primaryBoatName')?.value==='Other'){const newBoat=$('primaryBoatNameOther')?.value.trim();if(newBoat){const max=Math.max(0,...resources.filter(r=>r.resource_type==='boat').map(r=>Number(r.sort_order||0)));const addBoat=await supabaseClient.from('master_resources').upsert({resource_type:'boat',name:newBoat,active:true,sort_order:max+10},{onConflict:'resource_type,name'});if(addBoat.error)result={error:addBoat.error};}}
  if(!result.error&&$('guestNationalitySelect')?.value==='Other'){const newNationality=$('guestNationality')?.value.trim();if(newNationality){const max=Math.max(0,...resources.filter(r=>r.resource_type==='nationality').map(r=>Number(r.sort_order||0)));const addNationality=await supabaseClient.from('master_resources').upsert({resource_type:'nationality',name:newNationality,active:true,sort_order:max+10},{onConflict:'resource_type,name'});if(addNationality.error)result={error:addNationality.error};}}
  if(!result.error&&type==='boat_charter'&&$('eventLocationSelect')?.value==='Other'){const newMarina=$('eventLocation')?.value.trim();if(newMarina){const max=Math.max(0,...resources.filter(r=>r.resource_type==='marina').map(r=>Number(r.sort_order||0)));const addMarina=await supabaseClient.from('master_resources').upsert({resource_type:'marina',name:newMarina,active:true,sort_order:max+10},{onConflict:'resource_type,name'});if(addMarina.error)result={error:addMarina.error};}}
  if(!result.error){const bookingId=result.data.id;const effectiveStatus=$('boatStatus').value==='cancelled'?'cancelled':'confirmed';const boatPayload={booking_id:bookingId,status:effectiveStatus,supplier:null,reference:null,boat_name:(selectedBoatName()||'').trim()||null,departure_marina:$('boatMarina').value.trim()||null,charter_date:$('serviceDate').value||$('boatDate').value||null,start_time:$('boatStartTime').value||null,duration_hours:$('boatDuration').value?Number($('boatDuration').value):null,guests:$('guestCount').value?Number($('guestCount').value):null,supplier_cost:Number($('supplierAmountOwed').value||0),selling_price:Number($('totalRental').value||0),deposit_paid:Number($('depositPaid').value||0),amount_paid:Number($('depositPaid').value||0),notes:$('boatNotes').value.trim()||null,currency:'EUR'};const boatResult=await supabaseClient.from('booking_boats').upsert(boatPayload,{onConflict:'booking_id'});if(boatResult.error)result={error:boatResult.error};}
  if(!result.error){const bookingId=result.data.id;const chefPayload={booking_id:bookingId,status:$('chefStatus').value,event_type:$('chefEventType').value||null,supplier:$('chefSupplier').value.trim()||null,chef_name:$('chefName').value.trim()||null,contact:$('chefContact').value.trim()||null,reference:$('chefReference').value.trim()||null,event_date:$('chefDate').value||null,event_time:$('chefTime').value||null,guests:$('chefGuests').value?Number($('chefGuests').value):null,menu:$('chefMenu').value.trim()||null,dietary_requirements:$('chefDietary').value.trim()||null,drinks_package:$('chefDrinks').value.trim()||null,supplier_cost:Number($('chefSupplierCost').value||0),selling_price:Number($('chefSellingPrice').value||0),deposit_paid:Number($('chefDepositPaid').value||0),amount_paid:Number($('chefAmountPaid').value||0),notes:$('chefNotes').value.trim()||null,currency:$('chefCurrency').value};const chefResult=await supabaseClient.from('booking_chefs').upsert(chefPayload,{onConflict:'booking_id'});if(chefResult.error)result={error:chefResult.error};}
  if(!result.error){const bookingId=result.data.id;const generic=[experiencePayload('decor',bookingId,'decorations'),experiencePayload('shop',bookingId,'shopping'),experiencePayload('beach',bookingId,'beach_club'),experiencePayload('ent',bookingId,'entertainment')];const expResult=await supabaseClient.from('booking_experiences').upsert(generic,{onConflict:'booking_id,service_type,slot'});if(expResult.error)result={error:expResult.error};}
  $('saveBooking').disabled=false;if(result.error){$('bookingMessage').textContent=result.error.message;setSaveStatus('error','Could not save');return;}workspaceDirty=false;setSaveStatus('saved','Saved just now');setTimeout(()=>closeModal(true),350);await loadData();
});
$('paymentForm').addEventListener('submit',async e=>{
  e.preventDefault();$('savePayment').disabled=true;$('paymentMessage').textContent='';
  const payload={booking_id:$('paymentBookingId').value,payment_date:$('paymentDate').value,payment_type:$('paymentType').value,amount:Number($('paymentAmount').value),payment_method:$('paymentMethod').value,reference:$('paymentReference').value.trim()||null,notes:$('paymentNotes').value.trim()||null,currency:$('paymentCurrency').value};
  const{error}=await supabaseClient.from('booking_payments').insert(payload);$('savePayment').disabled=false;if(error){$('paymentMessage').textContent=error.message;return;}closePaymentModal();await loadData();activeDetailTab='payments';document.querySelectorAll('.detail-tab').forEach(t=>t.classList.toggle('active',t.dataset.detailTab==='payments'));renderDetail();
});
$('exportButton').addEventListener('click',()=>{const fields=['customer_id','itinerary_id','booking_type','service_title','service_date','event_location','guest_name','guest_email','guest_phone','guest_instagram','guest_nationality','villa_name','arrival_date','departure_date','arrival_time','departure_time','number_of_guests','adults','children','total_rental','deposit_paid','deposit_paid_date','deposit_currency','next_payment_amount','next_payment_due_date','next_payment_currency','next_payment_stage','payment_strategy','payment_strategy_notes','supplier_amount_owed','supplier_payment_due_date','supplier_currency','booking_currency','balance_due_date','commission_rate','commission_type','commission_fixed_amount','commission_currency','damage_deposit','status','lead_source','arrival_flight','departure_flight','arrival_airport','departure_airport','flight_details','payment_notes','payment_notes_updated_at','chef_booked','boat_booked','decorations_booked','notes'];const header=[...fields,'commission_amount','payments_received','balance_outstanding'];const csv=[header.join(','),...bookings.map(b=>[...fields.map(f=>b[f]??''),commissionFor(b),paidFor(b),balanceFor(b)].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='marbella-collective-bookings.csv';a.click();URL.revokeObjectURL(a.href);});

function toggleBookingTypeFields(){
  const type=$('bookingType')?.value||'villa_stay',isVilla=type==='villa_stay';
  document.querySelectorAll('[data-villa-only]').forEach(el=>el.classList.toggle('is-hidden',!isVilla));
  document.querySelectorAll('.service-meta-field').forEach(el=>el.classList.toggle('is-hidden',isVilla));
  $('staySection')?.classList.toggle('service-customer-only',!isVilla);
  $('travelSection')?.classList.toggle('is-hidden',!isVilla);
  $('conciergeSection')?.classList.remove('is-hidden');
  setServiceModuleVisibility(type);
  if($('villaName'))$('villaName').required=isVilla;
  if($('arrivalDate'))$('arrivalDate').required=isVilla;
  if($('departureDate'))$('departureDate').required=isVilla;
  if($('serviceDate'))$('serviceDate').required=!isVilla;
}
$('bookingType')?.addEventListener('change',applyBookingTypeTemplate);
['villaName','arrivalDate','boatName','boatNameOther','primaryBoatName','primaryBoatNameOther','boatDate','serviceDate','chefEventType','chefDate','entTitle'].forEach(id=>$(id)?.addEventListener('input',refreshGeneratedTitle));
$('boatName')?.addEventListener('change',()=>{toggleOtherBoat();syncBoatSelectors('secondary');});
$('primaryBoatName')?.addEventListener('change',()=>{togglePrimaryOtherBoat();syncBoatSelectors('primary');});
$('primaryBoatNameOther')?.addEventListener('input',()=>syncBoatSelectors('primary'));
inheritedGuestFields.forEach(id=>$(id)?.addEventListener('input',e=>{e.target.dataset.customGuestValue='true';}));
$('bookingTypeFilter')?.addEventListener('change',renderBookings);

document.addEventListener('click',async e=>{const btn=e.target.closest('[data-resource-toggle]');if(!btn)return;const active=btn.dataset.resourceActive==='true';const{error}=await supabaseClient.from('master_resources').update({active:!active}).eq('id',btn.dataset.resourceToggle);$('resourceMessage').textContent=error?error.message:(active?'Resource removed.':'Resource restored.');if(!error)await loadData();});
init();

$('bookingCurrency')?.addEventListener('change',()=>{if(!$('bookingId').value||!$('supplierCurrency').dataset.overridden)$('supplierCurrency').value=$('bookingCurrency').value;});
$('bookingCurrency')?.addEventListener('change',syncBookingCurrencySymbols);
$('supplierCurrency')?.addEventListener('change',()=>{$('supplierCurrency').dataset.overridden='true';});
$('villaName')?.addEventListener('change',()=>applyResourceCommissionDefault(true));
$('villaName')?.addEventListener('change',()=>applyMarbellaHideawayPaymentDefaults(false));
['totalRental','arrivalDate'].forEach(id=>$(id)?.addEventListener('input',()=>applyMarbellaHideawayPaymentDefaults(false)));
$('depositPaid')?.addEventListener('input',()=>{applyMarbellaHideawayPaymentDefaults(false);updatePaymentSummaryPreview();});
$('paymentStrategy')?.addEventListener('change',()=>applyMarbellaHideawayPaymentDefaults(true));
$('nextPaymentCurrency')?.addEventListener('change',()=>{syncBookingCurrencySymbols();if(($('bookingType')?.value||'')==='boat_charter')updateBoatCurrencyCalculations();updatePaymentSummaryPreview();});
$('recordStagedPayment')?.addEventListener('click',window.recordCurrentStagedPayment);
$('nextPaymentAmount')?.addEventListener('input',updatePaymentSummaryPreview);
$('nextPaymentDueDate')?.addEventListener('change',updatePaymentSummaryPreview);
$('balanceDueDate')?.addEventListener('change',updatePaymentSummaryPreview);
$('chefName')?.addEventListener('input',()=>{if(String($('chefName').value).toLowerCase()==='chef davis')applyResourceCommissionDefault(true);});

$('bookingCurrency')?.addEventListener('change',()=>{if(!$('commissionCurrency').dataset.touched)$('commissionCurrency').value=$('bookingCurrency').value;});
$('bookingCurrency')?.addEventListener('change',()=>{if($('bookingType')?.value==='villa_stay')applyMarbellaHideawayPaymentDefaults(false);});
$('commissionCurrency')?.addEventListener('change',()=>{$('commissionCurrency').dataset.touched='1';});

['guestName','guestEmail','guestPhone'].forEach(id=>$(id)?.addEventListener('input',renderCustomerMatchPanel));
$('guestName')?.addEventListener('input',()=>{if($('bookingId')?.value)applyBookingTypeTemplate();});
$('customerMatchPanel')?.addEventListener('click',e=>{const btn=e.target.closest('[data-link-customer]');if(!btn)return;applyExistingCustomer(customerGroups().find(c=>c.key===btn.dataset.linkCustomer));});
['serviceDate','guestCount','totalRental','depositPaid','supplierAmountOwed'].forEach(id=>$(id)?.addEventListener('input',()=>syncBoatBookingFields(true)));
['eventLocationSelect','eventLocation','bookingCurrency'].forEach(id=>$(id)?.addEventListener('change',()=>syncBoatBookingFields(true)));

$('mergeCustomers')?.addEventListener('click',()=>mergeMatchingCustomerBookings());

$('priorityCount')?.addEventListener('click',()=>{operationsFilter='priorities';operationsTimeScope='upcoming';document.querySelectorAll('[data-operations-filter]').forEach(b=>b.classList.remove('active'));document.querySelectorAll('[data-operations-scope]').forEach(b=>b.classList.toggle('active',b.dataset.operationsScope==='upcoming'));switchView('operations');});
$('closeOperations')?.addEventListener('click',()=>{operationsFilter='all';switchView('dashboard');});
$('operationsFilters')?.addEventListener('click',e=>{const button=e.target.closest('[data-operations-filter]');if(!button)return;operationsFilter=button.dataset.operationsFilter;document.querySelectorAll('[data-operations-filter]').forEach(b=>b.classList.toggle('active',b===button));renderOperationsCentre();});
$('operationsTimeScope')?.addEventListener('click',e=>{const button=e.target.closest('[data-operations-scope]');if(!button)return;operationsTimeScope=button.dataset.operationsScope;document.querySelectorAll('[data-operations-scope]').forEach(b=>b.classList.toggle('active',b===button));renderOperationsCentre();});

['totalRental','depositPaid','nextPaymentAmount','nextPaymentDueDate','balanceDueDate','paymentStrategy','paymentStrategyNotes','bookingCurrency'].forEach(id=>{
  $(id)?.addEventListener(id==='paymentStrategyNotes'?'input':'change',updatePaymentSummaryPreview);
  if(['totalRental','depositPaid','nextPaymentAmount'].includes(id))$(id)?.addEventListener('input',updatePaymentSummaryPreview);
});

$('refreshFxRate')?.addEventListener('click',refreshBoatFxRate);
['depositPaid','totalRental','gbpEurRate'].forEach(id=>$(id)?.addEventListener('input',updateBoatCurrencyCalculations));
['depositCurrency','bookingCurrency'].forEach(id=>$(id)?.addEventListener('change',updateBoatCurrencyCalculations));
$('serviceDate')?.addEventListener('change',()=>{if(($('bookingType')?.value||'')==='boat_charter'){syncBoatBookingFields(true);if($('nextPaymentDueDate'))$('nextPaymentDueDate').value=$('serviceDate').value;if($('supplierPaymentDueDate'))$('supplierPaymentDueDate').value=$('serviceDate').value;}});
$('guestCount')?.addEventListener('input',()=>syncBoatBookingFields(true));

$('depositCurrency')?.addEventListener('change',()=>{applyBoatWorkflowDefaults(bookings.find(x=>String(x.id)===String($('bookingId')?.value)));updateBoatCurrencyCalculations();});

document.querySelector('.wizard-type-grid')?.addEventListener('click',e=>{
  const button=e.target.closest('[data-wizard-type]');if(!button)return;
  const key=$('bookingWizardModal')?.dataset.customerKey;
  if(!key)return;
  e.preventDefault();e.stopImmediatePropagation();
  const customer=customerGroups().find(c=>c.key===key);
  const source=selectedBooking;
  delete $('bookingWizardModal').dataset.customerKey;
  closeBookingWizard();
  openModal(null,{type:button.dataset.wizardType,customer,itineraryId:source?.itinerary_id||source?.id,sourceBooking:source});
},true);

$('dailyOperationsButton')?.addEventListener('click',()=>switchView('daily'));
$('dailyOperationsDate')?.addEventListener('change',renderDailyOperations);
$('dailyPrintButton')?.addEventListener('click',()=>window.print());

function openSupplierTypeModal(){
  $('supplierTypeModal')?.classList.remove('hidden');
  $('supplierTypeModal')?.setAttribute('aria-hidden','false');
}
function closeSupplierTypeModal(){
  $('supplierTypeModal')?.classList.add('hidden');
  $('supplierTypeModal')?.setAttribute('aria-hidden','true');
}
$('addSupplierTypeButton')?.addEventListener('click',openSupplierTypeModal);
document.querySelectorAll('[data-close-supplier-type]').forEach(el=>el.addEventListener('click',closeSupplierTypeModal));
document.querySelectorAll('[data-new-supplier-type]').forEach(button=>button.addEventListener('click',async()=>{
  const type=button.dataset.newSupplierType;
  if(!type)return;
  closeSupplierTypeModal();
  if(!resources.some(r=>r.resource_type===type)){
    // Create a hidden placeholder row so the category persists in Supabase.
    const {error}=await supabaseClient.from('master_resources').insert({
      resource_type:type,
      name:`__${type}_placeholder__`,
      active:false,
      sort_order:9999
    });
    if(error){alert(error.message);return;}
    await loadData();
  }else renderResources();
}));
$('supplierTypeGrid')?.addEventListener('submit',async e=>{
  const form=e.target.closest('[data-resource-form]');if(!form)return;
  e.preventDefault();
  const name=form.resourceName.value.trim(),type=form.dataset.resourceForm;
  if(!name||!type)return;
  const {error}=await supabaseClient.from('master_resources').insert({resource_type:type,name,active:true,sort_order:resources.filter(r=>r.resource_type===type).length+1});
  if(error){alert(error.message);return;}
  form.reset();
  await loadData();
});

$('dailyPeriodSelect')?.addEventListener('change',renderDailyOperations);

$('bookingType')?.addEventListener('change',()=>updateBookingWorkspaceTitle(bookings.find(x=>String(x.id)===String($('bookingId')?.value))));
$('guestName')?.addEventListener('input',()=>updateBookingWorkspaceTitle(bookings.find(x=>String(x.id)===String($('bookingId')?.value))));
