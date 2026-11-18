(() => {
"use strict";
const $=id=>document.getElementById(id), TOKEN_KEY="capAiAccessTokenV1", USER_KEY="capAiUserV1";
const apiBase=(localStorage.getItem("capAiApiBaseV1")||"https://cap-ai-generation-api.onrender.com").replace(/\/+$/,"");
let mode="login";
const labels={meta:"Meta · Facebook & Instagram",google:"Google Ads",tiktok:"TikTok For Business"};
function msg(id,value){const e=$(id);if(e)e.textContent=value||"";}
function bearer(){return sessionStorage.getItem(TOKEN_KEY)||"";}
async function api(path,options={},auth=true){
 const headers={...(options.headers||{})};if(options.body&&!headers["Content-Type"])headers["Content-Type"]="application/json";
 if(auth&&bearer())headers.Authorization="Bearer "+bearer();
 const response=await fetch(apiBase+path,{...options,headers,signal:AbortSignal.timeout(45000)});
 const raw=await response.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{throw new Error("CAP.AI returned an unreadable response.");}
 if(!response.ok)throw new Error(data.error||"Request failed ("+response.status+").");return data;
}
function signedIn(user){
 $("authPanel").classList.add("ws-hidden");["signedInPanel","profilePanel","connectionsPanel","analyticsPanel","billingPanel"].forEach(id=>$(id).classList.remove("ws-hidden"));
 $("signedInUser").textContent=user.name+" · "+user.email;
}
function signedOut(){ $("authPanel").classList.remove("ws-hidden");["signedInPanel","profilePanel","connectionsPanel","analyticsPanel","billingPanel"].forEach(id=>$(id).classList.add("ws-hidden")); }
function authMode(next){mode=next;$("authSubmit").textContent=mode==="register"?"Create account":"Sign in";$("authMode").textContent=mode==="register"?"I already have an account":"Create account";$("authName").required=mode==="register";$("authName").parentElement.classList.toggle("ws-hidden",mode!=="register");$("authPassword").autocomplete=mode==="register"?"new-password":"current-password";}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
async function loadProfile(){
 const d=await api("/api/business-profile"),p=d.profile||{};
 $("profileName").value=p.businessName||"";$("profileWebsite").value=p.website||"";$("profileIndustry").value=p.industry||"";
 $("profileLocation").value=p.location||"";$("profileDescription").value=p.description||"";$("profileProducts").value=(p.products||[]).join("\n");
 $("profileLogo").value=p.logoUrl||"";$("profileColor").value=p.brandColor||"#111111";$("profileVoice").value=p.brandVoice||"";
}
async function loadConnections(){
 const data=await api("/api/integrations"),root=$("providerList");root.replaceChildren();
 for(const platform of ["meta","google","tiktok"]){
  const connection=(data.connections||[]).find(item=>item.platform===platform),card=el("div","ws-provider"),left=el("div"),actions=el("div","ws-row");
  left.append(el("strong","",labels[platform]),el("small","",connection?"Connected · "+connection.accountName:(data.available?.[platform]?"Ready to connect":"Developer app setup required")));
  const connect=el("button","button secondary",connection?"Reconnect":"Connect");connect.type="button";connect.disabled=!data.available?.[platform];
  connect.addEventListener("click",()=>window.location.assign(apiBase+"/api/integrations/"+platform+"/connect"));
  actions.append(connect);
  if(connection){
   const accounts=el("button","button secondary","Load accounts");accounts.type="button";
   accounts.addEventListener("click",async()=>{
    try{const result=await api("/api/integrations/"+platform+"/accounts"),list=(result.accounts||[]),out=el("div","ws-account",list.length?list.map(a=>a.name+" · "+a.id).join("\n"):"No accessible accounts returned.");
     card.querySelector(".ws-account")?.remove();card.append(out);
     if(list.length){const use=el("button","button secondary","Use first account for analytics");use.type="button";use.addEventListener("click",()=>{$("analyticsPlatform").value=platform;$("analyticsAccount").value=list[0].id;$("analyticsPanel").scrollIntoView({behavior:"smooth"});});actions.append(use);}
    }catch(e){msg("integrationMessage",e.message);}
   });
   if(platform==="meta"){
    const pagesButton=el("button","button secondary","Load Pages");pagesButton.type="button";
    pagesButton.addEventListener("click",async()=>{
     try{
      const data=await api("/api/integrations/meta/pages");
      card.querySelector(".ws-pages")?.remove();
      const pagesBox=el("div","ws-account ws-pages");
      if(!(data.pages||[]).length)pagesBox.textContent="No Pages returned. Confirm pages_show_list permission and that this user manages a Facebook Page.";
      for(const page of data.pages||[]){
       const row=el("div","ws-row");
       row.append(el("span","",page.name+" · "+page.id+(page.canAdvertise?" · Ads access confirmed":" · ADVERTISE task not confirmed")));
       const choose=el("button","button secondary",page.canAdvertise?"Use this Page for ads":"ADVERTISE access required");choose.type="button";choose.disabled=!page.canAdvertise;
       choose.addEventListener("click",()=>{sessionStorage.setItem("capAiMetaPageId",page.id);msg("integrationMessage","Selected "+page.name+" for Meta ads. Return to Ad Studio to create a paused campaign.");});
       row.append(choose);pagesBox.append(row);
      }
      card.append(pagesBox);
      msg("integrationMessage","Loaded "+(data.pages||[]).length+" Facebook Page(s).");
     }catch(e){msg("integrationMessage",e.message);}
    });
    actions.append(pagesButton);
   }
   const disconnect=el("button","button secondary","Disconnect");disconnect.type="button";
   disconnect.addEventListener("click",async()=>{if(!confirm("Remove this connection from CAP.AI? Also revoke CAP.AI in the provider's security settings."))return;try{await api("/api/integrations/"+platform,{method:"DELETE"});msg("integrationMessage",labels[platform]+" disconnected.");await loadConnections();}catch(e){msg("integrationMessage",e.message);}});
   actions.append(accounts,disconnect);
  }
  card.append(left,actions);root.append(card);
 }
}
async function loadBilling(){try{const d=await api("/api/billing/status"),b=d.billing||{};msg("billingStatus","Plan: "+(b.plan||"free")+" · Status: "+(b.subscription_status||"inactive")+(b.current_period_end?" · Period end: "+new Date(b.current_period_end).toLocaleDateString():""));}catch(e){msg("billingStatus",e.message);}}
async function loadAccount(){
 try{const d=await api("/api/auth/me");sessionStorage.setItem(USER_KEY,JSON.stringify(d.user));signedIn(d.user);await Promise.all([loadProfile(),loadConnections(),loadBilling()]);}
 catch{sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(USER_KEY);signedOut();}
}
$("authMode").addEventListener("click",()=>authMode(mode==="login"?"register":"login"));
$("authForm").addEventListener("submit",async event=>{
 event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget).entries()),path=mode==="register"?"/api/auth/register":"/api/auth/login";
 $("authSubmit").disabled=true;msg("authMessage",mode==="register"?"Creating account…":"Signing in…");
 try{const d=await api(path,{method:"POST",body:JSON.stringify(body)},false);sessionStorage.setItem(TOKEN_KEY,d.token);sessionStorage.setItem(USER_KEY,JSON.stringify(d.user));signedIn(d.user);msg("authMessage","Account ready.");await Promise.all([loadProfile(),loadConnections(),loadBilling()]);const next=new URLSearchParams(location.search).get("next");if(next==="ads.html")location.href="ads.html";}
 catch(e){msg("authMessage",e.message);}finally{$("authSubmit").disabled=false;}
});
$("signOut").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST"});}catch{}sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(USER_KEY);signedOut();msg("authMessage","You are signed out.");});
$("profileForm").addEventListener("submit",async event=>{
 event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget).entries());data.products=String(data.products||"").split("\n").map(v=>v.trim()).filter(Boolean);
 try{const r=await api("/api/business-profile",{method:"PUT",body:JSON.stringify(data)});msg("profileMessage","Saved: "+r.profile.businessName);}catch(e){msg("profileMessage",e.message);}
});
$("loadAnalytics").addEventListener("click",async()=>{
 const platform=$("analyticsPlatform").value,id=$("analyticsAccount").value.trim();if(!id)return msg("analyticsOutput","Enter an ad account ID, or load accounts from a connected platform.");
 msg("analyticsOutput","Loading last 30 days…");try{const d=await api("/api/analytics/"+platform+"?accountId="+encodeURIComponent(id));$("analyticsOutput").textContent=JSON.stringify(d.report,null,2);}catch(e){msg("analyticsOutput",e.message);}
});
document.querySelectorAll("[data-plan]").forEach(button=>button.addEventListener("click",async()=>{try{const d=await api("/api/billing/checkout",{method:"POST",body:JSON.stringify({plan:button.dataset.plan})});location.assign(d.url);}catch(e){msg("billingStatus",e.message);}}));
$("billingPortal").addEventListener("click",async()=>{try{const d=await api("/api/billing/portal",{method:"POST",body:"{}"});location.assign(d.url);}catch(e){msg("billingStatus",e.message);}});
async function init(){
 const p=new URLSearchParams(location.search);
 if(p.get("connected"))msg("integrationMessage","Connected "+(labels[p.get("connected")]||p.get("connected"))+".");
 if(p.get("connect_error"))msg("integrationMessage","Connection failed: "+p.get("connect_error"));
 if(p.get("billing")==="success")msg("billingStatus","Checkout completed. Waiting for Stripe subscription confirmation.");
 try{const d=await api("/api/platform/status",{},false),ready=Object.entries(d.integrations||{}).filter(([,v])=>v).map(([k])=>k);msg("workspaceStatus","API online · Database "+(d.database?"configured":"not configured")+" · AI strategy "+(d.aiStrategy?"ready":"needs OpenAI API key")+" · Image generator "+(d.imageGeneration?"ready":"needs OpenAI API key")+" · Token vault "+(d.tokenVault?"ready":"needs encryption key")+" · Apps: "+(ready.join(", ")||"none configured"));}
 catch(e){msg("workspaceStatus","API unavailable: "+e.message);}
 authMode("login");await loadAccount();
}
init();
})();