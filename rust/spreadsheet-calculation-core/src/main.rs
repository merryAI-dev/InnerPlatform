use spreadsheet_calculation_core::{derive_settlement_rows, KernelRequest};
use std::io::{self, Read};

fn main() {
    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .expect("failed to read stdin");
    let request: KernelRequest =
        serde_json::from_str(&stdin).expect("failed to parse settlement kernel request");
    let response = derive_settlement_rows(request);
    serde_json::to_writer(io::stdout(), &response).expect("failed to write settlement kernel response");
}
