use serde::Deserialize;
use serde_json::Value;
use spreadsheet_calculation_core::{
    aggregate_budget_actuals, build_settlement_actual_sync_payload, build_settlement_flow_snapshots,
    derive_settlement_rows, KernelActualSyncRequest, KernelBudgetActualsRequest,
    KernelFlowSnapshotRequest, KernelRequest,
};
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KernelCommandEnvelope {
    #[serde(default)]
    command: Option<String>,
}

fn main() {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .expect("failed to read stdin");
    let raw: Value = serde_json::from_str(&stdin).expect("failed to parse settlement kernel input");
    let envelope: KernelCommandEnvelope = serde_json::from_value(raw.clone())
        .expect("failed to parse settlement kernel command envelope");

    match envelope.command.as_deref() {
        Some("actualSync") => {
            let request: KernelActualSyncRequest = serde_json::from_value(raw)
                .expect("failed to parse actual sync request");
            let response = build_settlement_actual_sync_payload(request);
            serde_json::to_writer(io::stdout(), &response).expect("failed to write actual sync response");
        }
        Some("budgetActuals") => {
            let request: KernelBudgetActualsRequest = serde_json::from_value(raw)
                .expect("failed to parse budget actuals request");
            let response = aggregate_budget_actuals(request);
            serde_json::to_writer(io::stdout(), &response).expect("failed to write budget actuals response");
        }
        Some("flowSnapshot") => {
            let request: KernelFlowSnapshotRequest = serde_json::from_value(raw)
                .expect("failed to parse flow snapshot request");
            let response = build_settlement_flow_snapshots(request);
            serde_json::to_writer(io::stdout(), &response).expect("failed to write flow snapshot response");
        }
        _ => {
            let request: KernelRequest = serde_json::from_value(raw)
                .expect("failed to parse settlement derivation request");
            let response = derive_settlement_rows(request);
            serde_json::to_writer(io::stdout(), &response).expect("failed to write settlement derivation response");
        }
    }
}
