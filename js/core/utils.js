/* GotaVita Manager — Phase 4.5 Shared Utilities */
(function(){
  "use strict";
  const dateTimeFormatter=new Intl.DateTimeFormat([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
  window.GV_UTILS=Object.freeze({
    peso:(n)=>"₱"+(Number(n)||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2}),
    esc:(s)=>String(s==null?"":s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),
    jsAttrArg:(value)=>JSON.stringify(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),
    clone:(o)=>{if(o==null)return o;if(typeof structuredClone==="function"){try{return structuredClone(o)}catch{}}return JSON.parse(JSON.stringify(o));},
    sameDay:(iso,d)=>{const x=new Date(iso);return x.getFullYear()===d.getFullYear()&&x.getMonth()===d.getMonth()&&x.getDate()===d.getDate();},
    fmtDate:(iso)=>{const d=new Date(iso);return Number.isNaN(d.getTime())?"—":dateTimeFormatter.format(d);}
  });
})();
