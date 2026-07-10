create table weekly_expense_sheets (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  sheet_key varchar(120) not null,
  name varchar(200) not null,
  sheet_version bigint not null,
  constraint uk_weekly_expense_sheet_natural_id unique (tenant_id, project_id, sheet_key)
);

create index idx_weekly_expense_sheet_project
  on weekly_expense_sheets (tenant_id, project_id);

create table weekly_expense_rows (
  id varchar(36) primary key,
  sheet_id varchar(36) not null references weekly_expense_sheets(id) on delete cascade,
  row_index integer not null,
  row_version bigint not null,
  source_tx_id varchar(120),
  entry_kind varchar(30) not null,
  validation_error_count integer not null,
  review_required_count integer not null,
  deposit_amount numeric(19, 2) not null,
  refund_amount numeric(19, 2) not null,
  expense_amount numeric(19, 2) not null,
  vat_in_amount numeric(19, 2) not null,
  bank_amount numeric(19, 2) not null,
  constraint uk_weekly_expense_row_position unique (sheet_id, row_index)
);

create index idx_weekly_expense_row_sheet
  on weekly_expense_rows (sheet_id);

create index idx_weekly_expense_row_source_tx
  on weekly_expense_rows (source_tx_id);

create table weekly_expense_cells (
  id varchar(36) primary key,
  row_id varchar(36) not null references weekly_expense_rows(id) on delete cascade,
  column_index integer not null,
  raw_value varchar(4000) not null,
  normalized_value varchar(4000) not null,
  value_type varchar(20) not null,
  validation_status varchar(30) not null,
  validation_message varchar(1000) not null,
  user_edited boolean not null,
  constraint uk_weekly_expense_cell_position unique (row_id, column_index)
);

create index idx_weekly_expense_cell_row
  on weekly_expense_cells (row_id);

create index idx_weekly_expense_cell_status
  on weekly_expense_cells (validation_status);

create table weekly_expense_actuals (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  sheet_key varchar(120) not null,
  year_month varchar(7) not null,
  week_no integer not null,
  cashflow_line varchar(200) not null,
  amount numeric(19, 2) not null,
  updated_at timestamp not null,
  constraint uk_weekly_expense_actual_line unique (
    tenant_id,
    project_id,
    sheet_key,
    year_month,
    week_no,
    cashflow_line
  )
);

create index idx_weekly_expense_actual_project
  on weekly_expense_actuals (tenant_id, project_id, year_month, week_no);

create table weekly_expense_projections (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  year_month varchar(7) not null,
  week_no integer not null,
  cashflow_line varchar(200) not null,
  amount numeric(19, 2) not null,
  updated_at timestamp not null,
  constraint uk_weekly_expense_projection_line unique (
    tenant_id,
    project_id,
    year_month,
    week_no,
    cashflow_line
  )
);

create index idx_weekly_expense_projection_project
  on weekly_expense_projections (tenant_id, project_id, year_month, week_no);

create table weekly_expense_weekly_statuses (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  year_month varchar(7) not null,
  week_no integer not null,
  state varchar(40) not null,
  submitted_by varchar(160),
  submitted_at timestamp,
  closed_by varchar(160),
  closed_at timestamp,
  updated_at timestamp not null,
  constraint uk_weekly_expense_weekly_status unique (tenant_id, project_id, year_month, week_no)
);

create index idx_weekly_expense_weekly_status_project
  on weekly_expense_weekly_statuses (tenant_id, project_id, year_month, week_no);

create table weekly_expense_idempotency_keys (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  idempotency_key varchar(160) not null,
  command_name varchar(120) not null,
  request_hash varchar(128) not null,
  response_json text not null,
  created_at timestamp not null,
  constraint uk_weekly_expense_idempotency unique (tenant_id, idempotency_key)
);

create index idx_weekly_expense_idempotency_project
  on weekly_expense_idempotency_keys (tenant_id, project_id);

create table weekly_expense_audit_events (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  sheet_key varchar(120) not null,
  command_name varchar(120) not null,
  actor_id varchar(160) not null,
  actor_role varchar(80) not null,
  idempotency_key varchar(160) not null,
  metadata_json text not null,
  created_at timestamp not null
);

create index idx_weekly_expense_audit_project
  on weekly_expense_audit_events (tenant_id, project_id, created_at);

create index idx_weekly_expense_audit_actor
  on weekly_expense_audit_events (actor_id, created_at);
