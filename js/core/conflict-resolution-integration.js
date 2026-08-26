/* GotaVita Manager — Sprint 12 Controlled Conflict Resolution Integration */
(function () {
  "use strict";

  const STORAGE_KEY = "gotavita_conflict_baseline_v1";
  const CONFLICT_KEY = "gotavita_sync_conflicts";
  const RUN_LOCK_KEY = "gotavita_conflict_integration_lock";
  const RESOURCE_MAP = Object.freeze({ products:"products", clients:"clients", employees:"employees", orders:"orders", payments:"payments", expenses:"expenses", payrollRecords:"payroll_records", orderGroups:"order_groups", deliveryRoutes:"delivery_routes", orderGroupItems:"order_group_items", deliveryRouteItems:"delivery_route_items", dailyReports:"daily_reports", deletedOrders:"deleted_orders", auditLog:"audit_logs" });
  const STATE_MAP = Object.freeze({ products:"products", clients:"clients", employees:"employees", orders:"orders", payments:"payments", expenses:"expenses", payroll_records:"payrollRecords", order_groups:"orderGroups", delivery_routes:"deliveryRoutes", order_group_items:"orderGroupItems", delivery_route_items:"deliveryRouteItems", daily_reports:"dailyReports", deleted_orders:"deletedOrders", audit_logs:"auditLog" });
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function readJson(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(_){return fallback;}}
  function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch(_){return false;}}
  function stableRowId(row){if(row?.legacy_id!=null&&String(row.legacy_id).trim()!=="")return String(row.legacy_id).trim();if(row?.legacyId!=null&&String(row.legacyId).trim()!=="")return String(row.legacyId).trim();if(row?.id!=null&&String(row.id).trim()!=="")return String(row.id).trim();return null;}
  function rowKey(row,index){const stable=stableRowId(row);if(stable!=null)return stable;if(window.GVConflictDetector?.rowKey){const key=window.GVConflictDetector.rowKey(row);if(key!=null)return String(key);}return `index:${index}`;}
  function indexRows(rows){const map=new Map();(Array.isArray(rows)?rows:[]).forEach((row,index)=>map.set(rowKey(row,index),row));return map;}
  function comparableRow(row){if(!row||typeof row!=="object")return row;const output={};for(const[key,value]of Object.entries(row)){if(/^(updatedAt|updated_at|createdAt|created_at)$/.test(key))continue;output[key]=value;}return output;}
  function rowsEquivalent(left,right){try{return JSON.stringify(comparableRow(left))===JSON.stringify(comparableRow(right));}catch(_){return false;}}
  function rowTimestamp(row){if(window.GVConflictDetector?.rowUpdatedAt){const value=window.GVConflictDetector.rowUpdatedAt(row);if(value!=null)return value;}return row?.updatedAt??row?.updated_at??null;}
  function hasTimestamp(row){return rowTimestamp(row)!=null;}
  function policy(localRow,remoteRow,baselineAt){if(!window.GVConflictDetector?.resolveConflictPolicy)return{action:"manual-review",reason:"policy-unavailable",mutation:false};return window.GVConflictDetector.resolveConflictPolicy(localRow,remoteRow,baselineAt);}
  function deletionEvidence(rows,key){return(Array.isArray(rows)?rows:[]).find((row,index)=>rowKey(row,index)===key)||null;}
  function tombstone(row,deletedAt){if(!deletedAt)return null;return{id:row?.id,legacy_id:row?.legacy_id,deleted:true,deletedAt,updatedAt:deletedAt};}
  function baselinePlaceholder(id,baselineAt){if(!baselineAt)return null;return{id,updatedAt:baselineAt,createdAt:baselineAt};}

  function buildResolutionPlan(localRows,remoteRows,baselineAt,localDeletedRows=[],remoteDeletedRows=[],baselineRows=[]){
    const localMap=indexRows(localRows),remoteMap=indexRows(remoteRows),baselineMap=indexRows(baselineRows);
    const ids=new Set([...localMap.keys(),...remoteMap.keys()]);
    const decisions=[];
    for(const id of ids){
      const rawLocalRow=localMap.get(id)||null,rawRemoteRow=remoteMap.get(id)||null,baselineRow=baselineMap.get(id)||null;
      const existedAtBaseline=baselineRow!=null;let result=null;

      // Orders are deletion-sensitive business records. A missing remote row
      // is not deletion evidence: it may be a transient RLS/network snapshot
      // or an incomplete remote read. Only an explicit deleted_orders tombstone
      // authorizes removing an Order from local state.
      if(resourceCloudName("orders") === "orders" && rawLocalRow && !rawRemoteRow){
        const remoteDeletion=deletionEvidence(remoteDeletedRows,id) || deletionEvidence(localDeletedRows,id);
        if(!remoteDeletion){
          result={action:"keep-local",reason:"order-remote-missing-without-tombstone",mutation:false};
        }
      }

      if(!result&&!rawLocalRow&&rawRemoteRow&&!existedAtBaseline)result={action:"keep-remote",reason:"remote-new-record",mutation:false};
      else if(!result&&rawLocalRow&&!rawRemoteRow&&!existedAtBaseline)result={action:"keep-local",reason:"local-new-record",mutation:false};
      let localRow=rawLocalRow,remoteRow=rawRemoteRow;
      if(!localRow){const evidence=deletionEvidence(localDeletedRows,id);localRow=evidence?tombstone(evidence,evidence.archivedAt||evidence.deletedAt):(existedAtBaseline?null:baselinePlaceholder(id,baselineAt));}
      if(!remoteRow){const evidence=deletionEvidence(remoteDeletedRows,id);remoteRow=evidence?tombstone(evidence,evidence.archivedAt||evidence.deletedAt):(existedAtBaseline?null:baselinePlaceholder(id,baselineAt));}

      if(!result&&!rowsEquivalent(localRow,remoteRow)){
        const localTime=rowTimestamp(localRow),remoteTime=rowTimestamp(remoteRow);
        if(localTime!=null&&remoteTime!=null){
          const localMs=Date.parse(localTime),remoteMs=Date.parse(remoteTime);
          if(Number.isFinite(localMs)&&Number.isFinite(remoteMs)){
            if(localMs>remoteMs)result={action:"keep-local",reason:"local-newer-by-timestamp",mutation:true};
            else if(remoteMs>localMs)result={action:"keep-remote",reason:"remote-newer-by-timestamp",mutation:false};
            else result={action:"manual-review",reason:"same-timestamp-divergent-content",mutation:false};
          }
        }
      }

      if(!result&&baselineRow&&!rowsEquivalent(localRow,remoteRow)){
        const localMatchesBaseline=rowsEquivalent(localRow,baselineRow),remoteMatchesBaseline=rowsEquivalent(remoteRow,baselineRow);
        if(!localMatchesBaseline&&remoteMatchesBaseline)result={action:"keep-local",reason:"local-content-change-by-baseline",mutation:true};
        else if(localMatchesBaseline&&!remoteMatchesBaseline)result={action:"keep-remote",reason:"remote-content-change-by-baseline",mutation:false};
      }
      const legacyTimestampGap=!hasTimestamp(localRow)||!hasTimestamp(remoteRow);
      if(!result&&baselineRow&&legacyTimestampGap&&rowsEquivalent(localRow,baselineRow)&&rowsEquivalent(remoteRow,baselineRow))result={action:"no-conflict",reason:"both-match-baseline",mutation:false};
      else if(!result&&baselineRow&&legacyTimestampGap&&rowsEquivalent(localRow,baselineRow)&&!rowsEquivalent(remoteRow,baselineRow))result={action:"keep-remote",reason:"remote-only-change-by-baseline",mutation:false};
      else if(!result&&baselineRow&&legacyTimestampGap&&!rowsEquivalent(localRow,baselineRow)&&rowsEquivalent(remoteRow,baselineRow))result={action:"keep-local",reason:"local-only-change-by-baseline",mutation:false};
      else if(!result)result=policy(localRow,remoteRow,baselineAt);
      decisions.push({id,action:result.action,reason:result.reason,mutation:result.mutation,local:rawLocalRow,remote:rawRemoteRow});
    }
    return decisions;
  }
  function summarize(decisions){const summary={total:decisions.length,keepLocal:0,keepRemote:0,noConflict:0,manualReview:0};decisions.forEach(d=>{if(d.action==="keep-local")summary.keepLocal++;else if(d.action==="keep-remote")summary.keepRemote++;else if(d.action==="no-conflict")summary.noConflict++;else summary.manualReview++;});return summary;}
  function getBaseline(){return readJson(STORAGE_KEY,{});} function setBaseline(next){return writeJson(STORAGE_KEY,next);}
  function recordConflicts(entries){if(!entries.length)return;const current=readJson(CONFLICT_KEY,[]),seen=new Set(current.map(e=>`${e.resource}:${e.id}:${e.reason}`)),next=[...current];for(const entry of entries){const key=`${entry.resource}:${entry.id}:${entry.reason}`;if(!seen.has(key)){seen.add(key);next.push(entry);}}writeJson(CONFLICT_KEY,next.slice(-200));}
  function removeResourceFromQueue(resource){if(typeof window.getSyncQueue!=="function"||typeof window.setSyncQueue!=="function")return;const queue=window.getSyncQueue();window.setSyncQueue(queue.filter(item=>item!==resource&&resourceCloudName(item)!==resource));}
  function resourceCloudName(resource){return RESOURCE_MAP[resource]||resource;} function resourceStateName(resource){return STATE_MAP[resource]||resource;}
  function stateSnapshot(){const reader=window.getStateSnapshot;return typeof reader==="function"?reader():null;}
  function supportedResources(){return Object.keys(RESOURCE_MAP).filter(resource=>{const cloudName=resourceCloudName(resource);return window.GVData&&typeof window.GVData.selectResource==="function"&&typeof window.GVData.upsertResource==="function"&&(!window.GVData.supportedResources||window.GVData.supportedResources().includes(cloudName));});}
  async function applyDecision(resource,decision,nextState){const cloudName=resourceCloudName(resource),stateName=resourceStateName(cloudName);if(decision.action==="keep-local"){if(decision.local)await window.GVData.upsertResource(cloudName,[decision.local]);else if(typeof window.GVData.deleteResourceByLegacyId==="function"){const id=decision.remote?.id??decision.remote?.legacy_id??decision.id;if(id!=null)await window.GVData.deleteResourceByLegacyId(cloudName,id);}return;}if(decision.action==="keep-remote"){const rows=Array.isArray(nextState[stateName])?nextState[stateName].slice():[],index=rows.findIndex((row,rowIndex)=>rowKey(row,rowIndex)===decision.id);if(decision.remote){if(index>=0)rows[index]=clone(decision.remote);else rows.push(clone(decision.remote));}else if(index>=0)rows.splice(index,1);nextState[stateName]=rows;}}
  async function reconcileResource(resource,localRows,remoteRows,baselineAt,localDeletedRows,remoteDeletedRows,baselineRows,nextState){const decisions=buildResolutionPlan(localRows,remoteRows,baselineAt,localDeletedRows,remoteDeletedRows,baselineRows),summary=summarize(decisions),manual=decisions.filter(d=>d.action==="manual-review");if(manual.length)recordConflicts(manual.map(d=>({resource,id:d.id,reason:d.reason,detectedAt:new Date().toISOString()})));for(const decision of decisions){if(decision.action==="keep-local"||decision.action==="keep-remote")await applyDecision(resource,decision,nextState);}return{resource,decisions,summary,reconciled:true,partial:manual.length>0,unresolvedCount:manual.length};}
  async function run(force=false){if(!navigator.onLine||window.location.protocol==="file:")return{ok:false,status:"offline-or-local"};if(window.GVData?.isConfigured?.()!==true)return{ok:false,status:"not-configured"};if(!window.GVConflictDetector?.resolveConflictPolicy)return{ok:false,status:"policy-unavailable"};if(!force&&sessionStorage.getItem(RUN_LOCK_KEY)==="1")return{ok:false,status:"locked"};sessionStorage.setItem(RUN_LOCK_KEY,"1");try{await window.GVData.requireAuthenticatedManager();const baseline=getBaseline(),nextState=stateSnapshot();if(!nextState)throw new Error("Application state snapshot unavailable.");const results=[],nextBaseline={...baseline};for(const resource of supportedResources()){const stateName=resourceStateName(resource),localRows=Array.isArray(nextState[stateName])?nextState[stateName]:[],remoteRows=await window.GVData.selectResource(resourceCloudName(resource)),baselineAt=baseline[resource]?.baselineAt||null,baselineRows=Array.isArray(baseline[resource]?.rows)?baseline[resource].rows:[],localDeletedRows=resource==="orders"?(nextState.deletedOrders||[]):[],remoteDeletedRows=resource==="orders"?await window.GVData.selectResource("deleted_orders"):[];const result=await reconcileResource(resource,localRows,remoteRows,baselineAt,localDeletedRows,remoteDeletedRows,baselineRows,nextState);results.push({...result,status:baselineAt?undefined:"baseline-initialized"});const refreshed=await window.GVData.selectResource(resourceCloudName(resource));nextBaseline[resource]={baselineAt:new Date().toISOString(),rows:clone(refreshed)};if(!result.partial)removeResourceFromQueue(resourceCloudName(resource));}if(typeof window.GVGroupMembershipBridge?.reconcileRemoteState==="function")window.GVGroupMembershipBridge.reconcileRemoteState(nextState);if(typeof window.replaceState==="function")window.replaceState(nextState);if(typeof window.persistState==="function")window.persistState();setBaseline(nextBaseline);const manualReviewCount=results.reduce((sum,r)=>sum+(r.summary?.manualReview||0),0),appliedCount=results.reduce((sum,r)=>sum+(r.summary?.keepLocal||0)+(r.summary?.keepRemote||0),0);if(typeof window.setSyncStatus==="function")window.setSyncStatus(manualReviewCount?`Conflict review required · ${manualReviewCount}`:`Synced · ${appliedCount} reconciliation decision(s) applied`,manualReviewCount?"warning":"online");return{ok:true,status:manualReviewCount?"manual-review":"reconciled",results};}finally{sessionStorage.removeItem(RUN_LOCK_KEY);}}
  window.GVConflictIntegration=Object.freeze({run,buildResolutionPlan,summarize,getBaseline,setBaseline,resourceCloudName,resourceStateName});
  window.addEventListener("gv-auth-state-changed",event=>{if(event?.detail?.authenticated===true)setTimeout(()=>run(false).catch(error=>console.warn("GotaVita conflict integration:",error?.message||error)),0);});
})();
