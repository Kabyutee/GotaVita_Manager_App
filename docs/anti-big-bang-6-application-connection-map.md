# ANTI BIG BANG 6.0 — Whole Application Connection Map

This gate treats GotaVita as one connected system rather than isolated feature files.

## Required connection chain

UI / feature module → in-memory state → local persistence + dirty queue → canonical GVSync → Supabase gateway → cloud resource → conflict/baseline → remote hydration → state replacement → UI render.

## Protected resource set

products, clients, services, orders, payments, expenses, payrollRecords, employees, orderGroups, deliveryRoutes, orderGroupItems, deliveryRouteItems, dailyReports, deletedOrders, auditLog.

## Core processor rules

1. Every synchronized state resource must be registered in the central sync registry.
2. Every cloud resource must be supported by the gateway.
3. Every relational resource must have cloud/state mappings for conflict reconciliation.
4. GVSync is the only scheduler/transaction coordinator.
5. GVData is transport/adapter, not synchronization authority.
6. First hydration must be deterministic and resource-scoped.
7. Safe records must continue to converge when other records require manual review.
8. UI interaction preservation must not stop background synchronization.
9. Every PR runs the whole-application connection audit; sync/data/workflow changes receive the high-risk repetition.
10. Production deployment remains a separate exact-SHA gate.

## Site surface currently covered

Dashboard, New Order, Order Log, Expenses, Routes, Clients, Employees, Reports, plus Orders, Clients, Products, Expenses, Groups/Routes, Employees/Payroll, Reports, Containers, and Backups modules.
