/* GotaVita Manager — Phase 4.5 Core Configuration */
(function(){
  "use strict";
  window.GV_CONFIG = Object.freeze({
    KEYS: Object.freeze({products:"water_products",clients:"water_clients",orders:"water_orders",expenses:"water_expenses",deleted:"water_deleted_orders",groups:"water_order_groups",reports:"water_daily_reports",employees:"water_employees",counter:"water_order_counter",darkMode:"water_dark_mode",autobackup:"water_auto_backups",seeded:"water_seeded_v1",audit:"water_audit_log"}),
    DAYS: Object.freeze(["Mon","Tue","Wed","Thu","Fri","Sat"]), MAX_UNDO:25,
    BIZ_DETAILS:Object.freeze({name:"GotaVita Purified Drinking Water",address:"Blk 4 Lot 2 San Guillermo St., Purok 4 Villa Ananias Bayanan Muntinlupa",email:"gotavitawaterstation@gmail.com",phones:"SMART: +63 933 8563 572 | GLOBE: +63 915 8103 588"}),
    CACHE_KEYS:Object.freeze({primary:"gotavita_cache",recovery:"gotavita_cache_recovery",version:1}),
    SYNC_KEYS:Object.freeze({deviceId:"gotavita_device_id",queue:"gotavita_sync_queue",meta:"gotavita_sync_meta",conflicts:"gotavita_sync_conflicts"}),
    SYNC_RESOURCES:Object.freeze(["products","clients","services","orders","payments","expenses","payrollRecords","employees","orderGroups","deliveryRoutes","orderGroupItems","deliveryRouteItems","dailyReports","deletedOrders"])
  });
})();