# Recent Order state protection

Recent local Order mutations are protected at the central application-state replacement boundary. A stale remote snapshot cannot remove or overwrite a newly created or edited Order unless a newer deletion tombstone explicitly authorizes the removal.
