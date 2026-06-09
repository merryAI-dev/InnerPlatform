alter table weekly_expense_idempotency_keys
  drop constraint if exists uk_weekly_expense_idempotency;

alter table weekly_expense_idempotency_keys
  add constraint uk_weekly_expense_idempotency
  unique (tenant_id, project_id, command_name, idempotency_key);

drop index if exists idx_weekly_expense_idempotency_project;

create index idx_weekly_expense_idempotency_project
  on weekly_expense_idempotency_keys (tenant_id, project_id, command_name);
