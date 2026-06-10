create table weekly_expense_bank_import_batches (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  upload_name varchar(240) not null,
  column_json text not null,
  status varchar(40) not null,
  created_by varchar(160) not null,
  created_at timestamp not null
);

create index idx_weekly_expense_bank_import_batch_project
  on weekly_expense_bank_import_batches (tenant_id, project_id, created_at);

create table weekly_expense_bank_import_lines (
  id varchar(36) primary key,
  batch_id varchar(36) not null references weekly_expense_bank_import_batches(id) on delete cascade,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  line_index integer not null,
  source_line_key varchar(160) not null,
  transaction_date varchar(40) not null,
  counterparty varchar(400) not null,
  memo varchar(1000) not null,
  signed_amount numeric(19, 2) not null,
  balance_after numeric(19, 2) not null,
  raw_cells_json text not null,
  status varchar(40) not null,
  applied_sheet_key varchar(120),
  applied_row_id varchar(36),
  applied_at timestamp,
  applied_by varchar(160),
  constraint uk_weekly_expense_bank_import_line_key unique (tenant_id, project_id, source_line_key)
);

create index idx_weekly_expense_bank_import_line_batch
  on weekly_expense_bank_import_lines (batch_id, line_index);

create index idx_weekly_expense_bank_import_line_status
  on weekly_expense_bank_import_lines (tenant_id, project_id, status);
