create table weekly_expense_audit_exports (
  id varchar(36) primary key,
  tenant_id varchar(120) not null,
  project_id varchar(120) not null,
  artifact_type varchar(40) not null,
  artifact_file_name varchar(240) not null,
  artifact_sha256 varchar(64) not null,
  artifact_content text not null,
  projection_line_count integer not null,
  actual_line_count integer not null,
  audit_event_count integer not null,
  created_by varchar(160) not null,
  created_at timestamp not null
);

create index idx_weekly_expense_export_project
  on weekly_expense_audit_exports (tenant_id, project_id, created_at);

create index idx_weekly_expense_export_hash
  on weekly_expense_audit_exports (artifact_sha256);
