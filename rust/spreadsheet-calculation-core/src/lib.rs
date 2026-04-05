use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelRequest {
    pub rows: Vec<KernelImportRow>,
    pub context: KernelDerivationContext,
    pub options: KernelDerivationOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelResponse {
    pub rows: Vec<KernelImportRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelYearWeek {
    pub year_month: String,
    pub week_no: usize,
    pub week_start: String,
    pub week_end: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelActualSyncRequest {
    pub rows: Vec<KernelImportRow>,
    pub year_weeks: Vec<KernelYearWeek>,
    #[serde(default)]
    pub persisted_rows: Option<Vec<KernelImportRow>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelActualSyncWeekPayload {
    pub year_month: String,
    pub week_no: usize,
    pub amounts: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelActualSyncResponse {
    pub weeks: Vec<KernelActualSyncWeekPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelBudgetActualsRequest {
    pub rows: Vec<KernelImportRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelBudgetActualItem {
    pub budget_key: String,
    pub budget_code: String,
    pub sub_code: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelBudgetActualsResponse {
    pub items: Vec<KernelBudgetActualItem>,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelImportRow {
    pub temp_id: String,
    #[serde(default)]
    pub source_tx_id: Option<String>,
    #[serde(default)]
    pub entry_kind: Option<String>,
    pub cells: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub review_hints: Option<Vec<String>>,
    #[serde(default)]
    pub review_required_cell_indexes: Option<Vec<usize>>,
    #[serde(default)]
    pub review_status: Option<String>,
    #[serde(default)]
    pub review_fingerprint: Option<String>,
    #[serde(default)]
    pub review_confirmed_at: Option<String>,
    #[serde(default)]
    pub user_edited_cells: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelDerivationContext {
    pub project_id: String,
    pub default_ledger_id: String,
    #[serde(default)]
    pub policy: Option<KernelSettlementSheetPolicy>,
    #[serde(default)]
    pub basis: Option<String>,
    pub date_idx: isize,
    pub week_idx: isize,
    pub deposit_idx: isize,
    pub refund_idx: isize,
    pub expense_idx: isize,
    pub vat_in_idx: isize,
    pub bank_amount_idx: isize,
    pub balance_idx: isize,
    pub evidence_idx: isize,
    pub evidence_completed_idx: isize,
    pub evidence_pending_idx: isize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelSettlementSheetPolicy {
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub auto_compute_expense_from_bank: Option<bool>,
    #[serde(default)]
    pub auto_compute_bank_from_expense: Option<bool>,
    #[serde(default)]
    pub auto_compute_balance: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelDerivationOptions {
    pub mode: String,
    #[serde(default)]
    pub row_idx: Option<usize>,
    #[serde(default)]
    pub respect_explicit_balance_anchors: Option<bool>,
}

#[derive(Debug, Clone)]
struct MonthWeek {
    week_start: NaiveDate,
    week_end: NaiveDate,
    label: String,
}

fn idx(value: isize) -> Option<usize> {
    if value < 0 {
        None
    } else {
        Some(value as usize)
    }
}

fn get_cell(cells: &[String], index: Option<usize>) -> String {
    index
        .and_then(|idx| cells.get(idx))
        .cloned()
        .unwrap_or_default()
}

fn set_cell(cells: &mut [String], index: Option<usize>, value: String) {
    if let Some(idx) = index {
        if let Some(cell) = cells.get_mut(idx) {
            *cell = value;
        }
    }
}

fn parse_number(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed.replace(',', "").replace('_', "");
    normalized.parse::<f64>().ok()
}

fn format_with_commas(raw: &str) -> String {
    let mut chars: Vec<char> = raw.chars().collect();
    let mut sign = String::new();
    if matches!(chars.first(), Some('-')) {
        sign.push('-');
        chars.remove(0);
    }
    let digits: String = chars.into_iter().collect();
    let reversed = digits.chars().rev().collect::<Vec<char>>();
    let mut out = String::new();
    for (index, ch) in reversed.iter().enumerate() {
        if index > 0 && index % 3 == 0 {
            out.push(',');
        }
        out.push(*ch);
    }
    format!("{sign}{}", out.chars().rev().collect::<String>())
}

fn format_number(value: f64) -> String {
    if !value.is_finite() {
        return String::new();
    }
    if (value.fract()).abs() < 1e-9 {
        return format_with_commas(&(value.round() as i64).to_string());
    }
    let mut repr = format!("{value:.6}");
    while repr.contains('.') && repr.ends_with('0') {
        repr.pop();
    }
    if repr.ends_with('.') {
        repr.pop();
    }
    let mut parts = repr.split('.').collect::<Vec<&str>>();
    let int_part = parts.first().copied().unwrap_or("0");
    let formatted_int = format_with_commas(int_part);
    if parts.len() == 2 {
        format!("{formatted_int}.{}", parts.pop().unwrap_or_default())
    } else {
        formatted_int
    }
}

fn normalize_hints(hints: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();
    for hint in hints {
        let trimmed = hint.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

fn normalize_indexes(indexes: &BTreeSet<usize>) -> Vec<usize> {
    indexes.iter().copied().collect()
}

fn build_review_fingerprint(row: &KernelImportRow, hints: &[String], indexes: &[usize]) -> String {
    if hints.is_empty() || indexes.is_empty() {
        return String::new();
    }
    #[derive(Serialize)]
    struct ReviewFingerprint<'a> {
        hints: &'a [String],
        indexes: &'a [usize],
        cells: Vec<String>,
    }

    serde_json::to_string(&ReviewFingerprint {
        hints,
        indexes,
        cells: indexes
            .iter()
            .map(|index| row.cells.get(*index).cloned().unwrap_or_default().trim().to_string())
            .collect::<Vec<String>>(),
    })
    .unwrap_or_default()
}

fn update_review_signals(row: &mut KernelImportRow, hints: &[String], indexes: &BTreeSet<usize>) {
    let normalized_hints = normalize_hints(hints);
    let normalized_indexes = normalize_indexes(indexes);
    let review_fingerprint = build_review_fingerprint(row, &normalized_hints, &normalized_indexes);
    let same_fingerprint = row.review_fingerprint.as_deref().unwrap_or_default() == review_fingerprint;

    if normalized_hints.is_empty() || normalized_indexes.is_empty() {
        row.review_hints = None;
        row.review_required_cell_indexes = None;
        row.review_status = None;
        row.review_fingerprint = None;
        row.review_confirmed_at = None;
        return;
    }

    row.review_hints = Some(normalized_hints);
    row.review_required_cell_indexes = Some(normalized_indexes);
    row.review_fingerprint = Some(review_fingerprint);
    if !(row.review_status.as_deref() == Some("confirmed") && same_fingerprint) {
        row.review_status = Some("pending".to_string());
        row.review_confirmed_at = None;
    }
}

fn derive_supply_amount_candidate(bank_amount: f64) -> (f64, f64) {
    let expense_amount = ((bank_amount / 11.0) * 10.0).round();
    let vat_in = (bank_amount - expense_amount).max(0.0);
    (expense_amount, vat_in)
}

fn is_bank_imported_source_row(row: &KernelImportRow) -> bool {
    row.source_tx_id
        .as_deref()
        .unwrap_or_default()
        .starts_with("bank:")
        && matches!(row.entry_kind.as_deref(), Some("EXPENSE") | Some("DEPOSIT"))
}

fn derive_pending_evidence(required_desc: &str, completed_desc: &str) -> String {
    let required = required_desc
        .split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect::<Vec<&str>>();
    if required.is_empty() {
        return String::new();
    }
    let completed = completed_desc
        .split(',')
        .map(|part| part.trim().to_lowercase())
        .filter(|part| !part.is_empty())
        .collect::<Vec<String>>();
    required
        .into_iter()
        .filter(|item| !completed.iter().any(|done| done.contains(&item.to_lowercase())))
        .collect::<Vec<&str>>()
        .join(", ")
}

fn parse_date_like(value: &str) -> Option<NaiveDate> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let date_part = trimmed.split_whitespace().next().unwrap_or_default();
    for fmt in ["%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(date_part, fmt) {
            return Some(date);
        }
    }
    let normalized = date_part
        .chars()
        .map(|ch| if ch.is_ascii_digit() { ch } else { ' ' })
        .collect::<String>();
    let parts = normalized
        .split_whitespace()
        .map(|part| part.parse::<u32>().ok())
        .collect::<Option<Vec<u32>>>()?;
    if parts.len() != 3 {
        return None;
    }
    NaiveDate::from_ymd_opt(parts[0] as i32, parts[1], parts[2])
}

fn start_of_week_wednesday(date: NaiveDate) -> NaiveDate {
    let weekday = date.weekday().num_days_from_sunday() as i64;
    let delta = -((weekday - 3 + 7) % 7);
    date + Duration::days(delta)
}

fn count_days_in_month_for_week(week_start: NaiveDate, year: i32, month: u32) -> usize {
    (0..7)
        .filter(|delta| {
            let date = week_start + Duration::days(*delta);
            date.year() == year && date.month() == month
        })
        .count()
}

fn get_month_monday_weeks(year: i32, month: u32) -> Vec<MonthWeek> {
    let Some(first_day) = NaiveDate::from_ymd_opt(year, month, 1) else {
        return Vec::new();
    };
    let next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    let Some(last_day) = next_month.map(|date| date - Duration::days(1)) else {
        return Vec::new();
    };

    let mut weeks = Vec::new();
    let mut week_start = start_of_week_wednesday(first_day);
    let mut week_no = 0;
    let year_short = year % 100;

    while week_start <= last_day {
        if count_days_in_month_for_week(week_start, year, month) >= 4 {
            week_no += 1;
            let week_end = week_start + Duration::days(6);
            weeks.push(MonthWeek {
                week_start,
                week_end,
                label: format!("{year_short}-{month}-{week_no}"),
            });
        }
        week_start += Duration::days(7);
    }
    weeks
}

fn get_year_monday_weeks(year: i32) -> Vec<MonthWeek> {
    (1..=12)
        .flat_map(|month| get_month_monday_weeks(year, month))
        .collect()
}

fn find_week_for_date(date: NaiveDate, weeks: &[MonthWeek]) -> Option<String> {
    weeks.iter().find_map(|week| {
        if date >= week.week_start && date <= week.week_end {
            Some(week.label.clone())
        } else {
            None
        }
    })
}

fn derive_week_label(raw_date: &str) -> String {
    let Some(date) = parse_date_like(raw_date) else {
        return String::new();
    };
    let weeks = get_year_monday_weeks(date.year());
    find_week_for_date(date, &weeks).unwrap_or_default()
}

fn cashflow_in_line_ids() -> [&'static str; 5] {
    [
        "MYSC_PREPAY_IN",
        "SALES_IN",
        "SALES_VAT_IN",
        "TEAM_SUPPORT_IN",
        "BANK_INTEREST_IN",
    ]
}

fn cashflow_all_line_ids() -> [&'static str; 12] {
    [
        "MYSC_PREPAY_IN",
        "SALES_IN",
        "SALES_VAT_IN",
        "TEAM_SUPPORT_IN",
        "BANK_INTEREST_IN",
        "DIRECT_COST_OUT",
        "INPUT_VAT_OUT",
        "MYSC_LABOR_OUT",
        "MYSC_PROFIT_OUT",
        "SALES_VAT_OUT",
        "TEAM_SUPPORT_OUT",
        "BANK_INTEREST_OUT",
    ]
}

fn parse_cashflow_line_label(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    match trimmed {
        "MYSC선입금" | "MYSC선입금(입금필요시)" | "MYSC 선입금(입금필요시)" => Some("MYSC_PREPAY_IN"),
        "매출액(입금)" | "매출액" => Some("SALES_IN"),
        "매출부가세(입금)" | "매출부가세" => Some("SALES_VAT_IN"),
        "팀지원금(입금)" => Some("TEAM_SUPPORT_IN"),
        "은행이자(입금)" => Some("BANK_INTEREST_IN"),
        "직접사업비(공급가액)" | "직접사업비" | "직접사업비(공급가액)+매입부가세" => Some("DIRECT_COST_OUT"),
        "매입부가세" => Some("INPUT_VAT_OUT"),
        "MYSC인건비" | "MYSC 인건비" => Some("MYSC_LABOR_OUT"),
        "MYSC수익(간접비등)" | "MYSC 수익(간접비등)" | "MYSC수익" => Some("MYSC_PROFIT_OUT"),
        "매출부가세(출금)" => Some("SALES_VAT_OUT"),
        "팀지원금(출금)" => Some("TEAM_SUPPORT_OUT"),
        "은행이자(출금)" => Some("BANK_INTEREST_OUT"),
        _ => {
            let stripped = trimmed.replace(' ', "");
            match stripped.as_str() {
                "MYSC선입금" | "MYSC선입금(입금필요시)" => Some("MYSC_PREPAY_IN"),
                "매출액(입금)" | "매출액" => Some("SALES_IN"),
                "매출부가세(입금)" | "매출부가세" => Some("SALES_VAT_IN"),
                "팀지원금(입금)" => Some("TEAM_SUPPORT_IN"),
                "은행이자(입금)" => Some("BANK_INTEREST_IN"),
                "직접사업비(공급가액)" | "직접사업비" | "직접사업비(공급가액)+매입부가세" => Some("DIRECT_COST_OUT"),
                "매입부가세" => Some("INPUT_VAT_OUT"),
                "MYSC인건비" => Some("MYSC_LABOR_OUT"),
                "MYSC수익(간접비등)" | "MYSC수익" => Some("MYSC_PROFIT_OUT"),
                "매출부가세(출금)" => Some("SALES_VAT_OUT"),
                "팀지원금(출금)" => Some("TEAM_SUPPORT_OUT"),
                "은행이자(출금)" => Some("BANK_INTEREST_OUT"),
                _ => None,
            }
        }
    }
}

fn policy_auto_compute_expense_from_bank(policy: Option<&KernelSettlementSheetPolicy>) -> bool {
    policy
        .and_then(|policy| policy.auto_compute_expense_from_bank)
        .unwrap_or(true)
}

fn policy_auto_compute_bank_from_expense(policy: Option<&KernelSettlementSheetPolicy>) -> bool {
    policy
        .and_then(|policy| policy.auto_compute_bank_from_expense)
        .unwrap_or(true)
}

fn policy_auto_compute_balance(policy: Option<&KernelSettlementSheetPolicy>) -> bool {
    policy
        .and_then(|policy| policy.auto_compute_balance)
        .unwrap_or(true)
}

fn user_edited_set(row: &KernelImportRow) -> BTreeSet<usize> {
    row.user_edited_cells
        .clone()
        .unwrap_or_default()
        .into_iter()
        .collect()
}

fn parse_amount(cells: &[String], index: Option<usize>) -> f64 {
    parse_number(&get_cell(cells, index)).unwrap_or(0.0)
}

fn derive_row_locally(
    row: &KernelImportRow,
    row_idx: usize,
    context: &KernelDerivationContext,
    include_balance: bool,
    running_balance: f64,
    respect_explicit_balance_anchors: bool,
) -> (KernelImportRow, f64) {
    let mut next = row.clone();
    let policy = context.policy.as_ref();
    let user_edited = user_edited_set(row);
    let mut review_hints: Vec<String> = Vec::new();
    let mut review_indexes = BTreeSet::new();

    let date_idx = idx(context.date_idx);
    let week_idx = idx(context.week_idx);
    let deposit_idx = idx(context.deposit_idx);
    let refund_idx = idx(context.refund_idx);
    let expense_idx = idx(context.expense_idx);
    let vat_idx = idx(context.vat_in_idx);
    let bank_idx = idx(context.bank_amount_idx);
    let balance_idx = idx(context.balance_idx);
    let evidence_idx = idx(context.evidence_idx);
    let evidence_completed_idx = idx(context.evidence_completed_idx);
    let evidence_pending_idx = idx(context.evidence_pending_idx);

    if let (Some(week_idx), Some(date_idx)) = (week_idx, date_idx) {
        let week_cell = get_cell(&next.cells, Some(week_idx));
        let raw_date = get_cell(&next.cells, Some(date_idx));
        if (week_cell.trim().is_empty() || week_cell.trim() == "-") && !raw_date.trim().is_empty() {
            let label = derive_week_label(&raw_date);
            if !label.is_empty() {
                set_cell(&mut next.cells, Some(week_idx), label);
            }
        }
    }

    if row.entry_kind.as_deref() == Some("ADJUSTMENT")
        && balance_idx.is_some()
        && deposit_idx.is_some()
        && expense_idx.is_some()
        && bank_idx.is_some()
    {
        let explicit_balance = parse_number(&get_cell(&next.cells, balance_idx));
        if let Some(explicit_balance) = explicit_balance {
            let delta = explicit_balance - running_balance;
            if delta > 0.0 {
                set_cell(&mut next.cells, deposit_idx, format_number(delta));
                set_cell(&mut next.cells, refund_idx, String::new());
                set_cell(&mut next.cells, expense_idx, String::new());
                set_cell(&mut next.cells, vat_idx, String::new());
                set_cell(&mut next.cells, bank_idx, format_number(delta));
            } else if delta < 0.0 {
                set_cell(&mut next.cells, deposit_idx, String::new());
                set_cell(&mut next.cells, refund_idx, String::new());
                set_cell(&mut next.cells, expense_idx, format_number(delta.abs()));
                set_cell(&mut next.cells, vat_idx, String::new());
                set_cell(&mut next.cells, bank_idx, format_number(delta.abs()));
            } else {
                set_cell(&mut next.cells, deposit_idx, String::new());
                set_cell(&mut next.cells, refund_idx, String::new());
                set_cell(&mut next.cells, expense_idx, String::new());
                set_cell(&mut next.cells, vat_idx, String::new());
                set_cell(&mut next.cells, bank_idx, String::new());
            }
        }
    }

    if policy_auto_compute_expense_from_bank(policy)
        && bank_idx.is_some()
        && expense_idx.is_some()
        && vat_idx.is_some()
        && !is_bank_imported_source_row(row)
    {
        let bank_amount = parse_amount(&next.cells, bank_idx);
        let deposit_sum = match (deposit_idx, refund_idx) {
            (Some(_), Some(_)) => parse_amount(&next.cells, deposit_idx) + parse_amount(&next.cells, refund_idx),
            _ => 0.0,
        };
        let expense = parse_amount(&next.cells, expense_idx);
        let vat = parse_amount(&next.cells, vat_idx);
        let has_expense_value = !get_cell(&next.cells, expense_idx).trim().is_empty();
        let has_vat_value = !get_cell(&next.cells, vat_idx).trim().is_empty();
        let basis = context.basis.as_deref().unwrap_or("NONE");
        let can_treat_as_expense_candidate =
            deposit_sum == 0.0 && row.entry_kind.as_deref() != Some("DEPOSIT");

        if bank_amount > 0.0 && can_treat_as_expense_candidate {
            if expense > 0.0 {
                if !vat_idx.map(|index| user_edited.contains(&index)).unwrap_or(false)
                    && !expense_idx.map(|index| user_edited.contains(&index)).unwrap_or(false)
                {
                    let derived_vat = (bank_amount - expense).max(0.0);
                    set_cell(
                        &mut next.cells,
                        vat_idx,
                        if derived_vat > 0.0 {
                            format_number(derived_vat)
                        } else {
                            String::new()
                        },
                    );
                    if basis == "공급가액" {
                        review_hints.push("매입부가세 후보값입니다. 증빙 기준 금액으로 다시 확인해 주세요.".to_string());
                        if let Some(vat_idx) = vat_idx {
                            review_indexes.insert(vat_idx);
                        }
                    }
                }
            } else if !expense_idx.map(|index| user_edited.contains(&index)).unwrap_or(false) {
                if basis == "공급가액"
                    && !has_vat_value
                    && !vat_idx.map(|index| user_edited.contains(&index)).unwrap_or(false)
                {
                    let (candidate_expense, candidate_vat) = derive_supply_amount_candidate(bank_amount);
                    set_cell(
                        &mut next.cells,
                        expense_idx,
                        if candidate_expense > 0.0 {
                            format_number(candidate_expense)
                        } else {
                            String::new()
                        },
                    );
                    set_cell(
                        &mut next.cells,
                        vat_idx,
                        if candidate_vat > 0.0 {
                            format_number(candidate_vat)
                        } else {
                            String::new()
                        },
                    );
                    review_hints.push("매입부가세 후보값입니다. 증빙 기준 금액으로 다시 확인해 주세요.".to_string());
                    if let Some(vat_idx) = vat_idx {
                        review_indexes.insert(vat_idx);
                    }
                } else {
                    let derived_expense = (bank_amount - vat.max(0.0)).max(0.0);
                    set_cell(
                        &mut next.cells,
                        expense_idx,
                        if derived_expense > 0.0 {
                            format_number(derived_expense)
                        } else {
                            String::new()
                        },
                    );
                }
            } else if has_vat_value
                && !has_expense_value
                && !expense_idx.map(|index| user_edited.contains(&index)).unwrap_or(false)
            {
                let derived_expense = (bank_amount - vat.max(0.0)).max(0.0);
                set_cell(
                    &mut next.cells,
                    expense_idx,
                    if derived_expense > 0.0 {
                        format_number(derived_expense)
                    } else {
                        String::new()
                    },
                );
            }
        }
    }

    if policy_auto_compute_bank_from_expense(policy)
        && deposit_idx.is_some()
        && refund_idx.is_some()
        && expense_idx.is_some()
        && vat_idx.is_some()
        && bank_idx.is_some()
    {
        let existing_bank_raw = get_cell(&next.cells, bank_idx);
        if existing_bank_raw.trim().is_empty() {
            let deposit_sum = parse_amount(&next.cells, deposit_idx) + parse_amount(&next.cells, refund_idx);
            let expense_sum = parse_amount(&next.cells, expense_idx) + parse_amount(&next.cells, vat_idx);
            let derived_bank_amount = if deposit_sum > 0.0 { deposit_sum } else { expense_sum };
            set_cell(
                &mut next.cells,
                bank_idx,
                if derived_bank_amount != 0.0 {
                    format_number(derived_bank_amount)
                } else {
                    String::new()
                },
            );
        }
    }

    update_review_signals(&mut next, &review_hints, &review_indexes);

    let mut next_running_balance = running_balance;
    if include_balance && balance_idx.is_some() && policy_auto_compute_balance(policy) {
        let existing_balance_raw = get_cell(&next.cells, balance_idx);
        let has_existing_balance = !existing_balance_raw.trim().is_empty();
        let explicit_balance = if has_existing_balance {
            parse_number(&existing_balance_raw)
        } else {
            None
        };
        let deposit_sum = match (deposit_idx, refund_idx) {
            (Some(_), Some(_)) => parse_amount(&next.cells, deposit_idx) + parse_amount(&next.cells, refund_idx),
            _ => 0.0,
        };
        let expense_sum = match (expense_idx, vat_idx) {
            (Some(_), Some(_)) => parse_amount(&next.cells, expense_idx) + parse_amount(&next.cells, vat_idx),
            _ => 0.0,
        };

        if explicit_balance.is_some() && respect_explicit_balance_anchors {
            next_running_balance = explicit_balance.unwrap_or(running_balance);
        } else {
            let mut computed_balance = running_balance;
            if deposit_sum != 0.0 || expense_sum != 0.0 {
                let preset = policy.and_then(|policy| policy.preset.as_deref()).unwrap_or_default();
                if (preset == "DIRECT_ENTRY" || preset == "BALANCE_TRACKING")
                    && running_balance == 0.0
                    && deposit_sum == 0.0
                    && expense_sum > 0.0
                {
                    next_running_balance = running_balance;
                    if let Some(existing_balance) = explicit_balance {
                        set_cell(&mut next.cells, balance_idx, format_number(existing_balance));
                    }
                    if let Some(user_edited_cells) = &row.user_edited_cells {
                        next.user_edited_cells = Some(user_edited_cells.clone());
                    }
                    return (next, next_running_balance);
                }
                computed_balance += deposit_sum - expense_sum;
            }
            next_running_balance = computed_balance;
            if has_existing_balance || deposit_sum != 0.0 || expense_sum != 0.0 || !respect_explicit_balance_anchors {
                set_cell(&mut next.cells, balance_idx, format_number(next_running_balance));
            }
        }
    }

    if evidence_idx.is_some() && evidence_completed_idx.is_some() && evidence_pending_idx.is_some() {
        let required_desc = get_cell(&next.cells, evidence_idx);
        let completed_desc = get_cell(&next.cells, evidence_completed_idx);
        set_cell(
            &mut next.cells,
            evidence_pending_idx,
            derive_pending_evidence(&required_desc, &completed_desc),
        );
    }

    if let Some(user_edited_cells) = &row.user_edited_cells {
        next.user_edited_cells = Some(user_edited_cells.clone());
    }
    let _ = row_idx;
    (next, next_running_balance)
}

fn compute_running_seed(
    rows: &[KernelImportRow],
    end_exclusive: usize,
    context: &KernelDerivationContext,
    respect_explicit_balance_anchors: bool,
) -> f64 {
    let balance_idx = idx(context.balance_idx);
    let deposit_idx = idx(context.deposit_idx);
    let refund_idx = idx(context.refund_idx);
    let expense_idx = idx(context.expense_idx);
    let vat_idx = idx(context.vat_in_idx);
    let mut running = 0.0;

    for row in rows.iter().take(end_exclusive) {
        let existing_balance_raw = get_cell(&row.cells, balance_idx);
        let explicit_balance = if existing_balance_raw.trim().is_empty() {
            None
        } else {
            parse_number(&existing_balance_raw)
        };
        let deposit_sum = match (deposit_idx, refund_idx) {
            (Some(_), Some(_)) => parse_amount(&row.cells, deposit_idx) + parse_amount(&row.cells, refund_idx),
            _ => 0.0,
        };
        let expense_sum = match (expense_idx, vat_idx) {
            (Some(_), Some(_)) => parse_amount(&row.cells, expense_idx) + parse_amount(&row.cells, vat_idx),
            _ => 0.0,
        };

        if explicit_balance.is_some() && respect_explicit_balance_anchors {
            running = explicit_balance.unwrap_or(running);
        } else if deposit_sum != 0.0 || expense_sum != 0.0 {
            running += deposit_sum - expense_sum;
        }
    }

    running
}

fn resolve_week_from_label(label: &str, year_weeks: &[KernelYearWeek]) -> Option<KernelYearWeek> {
    if let Some(found) = year_weeks.iter().find(|week| week.label == label) {
        return Some(found.clone());
    }
    let parts = label
        .split('-')
        .map(|part| part.trim().parse::<usize>().ok())
        .collect::<Option<Vec<usize>>>()?;
    if parts.len() != 3 {
        return None;
    }
    let year = 2000 + parts[0] as i32;
    let month = parts[1];
    let week_no = parts[2];
    let year_month = format!("{year}-{month:02}");
    year_weeks
        .iter()
        .find(|week| week.year_month == year_month && week.week_no == week_no)
        .cloned()
}

fn resolve_week_label_from_row(
    row: &KernelImportRow,
    _year_weeks: &[KernelYearWeek],
    week_idx: Option<usize>,
    date_idx: Option<usize>,
) -> String {
    let explicit = get_cell(&row.cells, week_idx);
    if !explicit.trim().is_empty() {
        return explicit.trim().to_string();
    }
    let raw_date = get_cell(&row.cells, date_idx);
    derive_week_label(&raw_date)
}

fn resolve_actual_amount(
    row: &KernelImportRow,
    line_id: &str,
    bank_amount_idx: Option<usize>,
    expense_amount_idx: Option<usize>,
    vat_in_idx: Option<usize>,
    deposit_idx: Option<usize>,
    refund_idx: Option<usize>,
) -> f64 {
    let amounts = resolve_cashflow_actual_line_amounts(
        row,
        bank_amount_idx,
        expense_amount_idx,
        vat_in_idx,
        deposit_idx,
        refund_idx,
    );
    amounts.get(line_id).copied().unwrap_or(0.0)
}

fn resolve_cashflow_actual_line_amounts(
    row: &KernelImportRow,
    bank_amount_idx: Option<usize>,
    expense_amount_idx: Option<usize>,
    vat_in_idx: Option<usize>,
    deposit_idx: Option<usize>,
    refund_idx: Option<usize>,
) -> BTreeMap<String, f64> {
    let cashflow_label = get_cell(&row.cells, Some(8usize));
    let Some(line_id) = parse_cashflow_line_label(&cashflow_label) else {
        return BTreeMap::new();
    };
    let bank_amount = parse_amount(&row.cells, bank_amount_idx);
    let expense_amount = parse_amount(&row.cells, expense_amount_idx);
    let vat_in = parse_amount(&row.cells, vat_in_idx);
    let deposit_amount = parse_amount(&row.cells, deposit_idx);
    let refund_amount = parse_amount(&row.cells, refund_idx);
    let mut result = BTreeMap::new();

    if cashflow_in_line_ids().contains(&line_id) {
        let inflow_amount = if deposit_amount > 0.0 {
            deposit_amount
        } else if refund_amount > 0.0 {
            refund_amount
        } else {
            bank_amount
        };
        if inflow_amount > 0.0 {
            result.insert(line_id.to_string(), inflow_amount);
        }
        return result;
    }

    if line_id == "INPUT_VAT_OUT" {
        if vat_in > 0.0 {
            result.insert("INPUT_VAT_OUT".to_string(), vat_in);
        }
        return result;
    }

    let primary_out_amount = if expense_amount > 0.0 {
        expense_amount
    } else if deposit_amount > 0.0 || refund_amount > 0.0 {
        0.0
    } else {
        bank_amount
    };
    if primary_out_amount > 0.0 {
        result.insert(line_id.to_string(), primary_out_amount);
    }
    if vat_in > 0.0 {
        result.insert("INPUT_VAT_OUT".to_string(), vat_in);
    }
    result
}

fn resolve_budget_actual_amount(
    row: &KernelImportRow,
    cashflow_idx: Option<usize>,
    bank_amount_idx: Option<usize>,
    expense_amount_idx: Option<usize>,
    vat_in_idx: Option<usize>,
    deposit_idx: Option<usize>,
    refund_idx: Option<usize>,
) -> f64 {
    let cashflow_label = get_cell(&row.cells, cashflow_idx);
    let line_id = parse_cashflow_line_label(&cashflow_label);
    let bank_amount = parse_amount(&row.cells, bank_amount_idx);
    let expense_amount = parse_amount(&row.cells, expense_amount_idx);
    let vat_in = parse_amount(&row.cells, vat_in_idx);
    let deposit_amount = parse_amount(&row.cells, deposit_idx);
    let refund_amount = parse_amount(&row.cells, refund_idx);

    if matches!(line_id, Some(line) if cashflow_in_line_ids().contains(&line)) {
        return 0.0;
    }
    if line_id == Some("INPUT_VAT_OUT") {
        return vat_in;
    }
    if expense_amount > 0.0 {
        return expense_amount;
    }
    if vat_in > 0.0 && bank_amount == 0.0 {
        return vat_in;
    }
    if deposit_amount > 0.0 || refund_amount > 0.0 {
        return 0.0;
    }
    bank_amount
}

pub fn build_settlement_actual_sync_payload(request: KernelActualSyncRequest) -> KernelActualSyncResponse {
    let week_idx = Some(3usize);
    let date_idx = Some(2usize);
    let cashflow_idx = Some(8usize);
    let bank_amount_idx = Some(10usize);
    let expense_amount_idx = Some(13usize);
    let vat_in_idx = Some(14usize);
    let deposit_idx = Some(11usize);
    let refund_idx = Some(12usize);

    let mut by_week: BTreeMap<String, BTreeMap<String, f64>> = BTreeMap::new();
    let mut week_labels = BTreeSet::new();

    let mut collect_week_labels = |rows: &[KernelImportRow]| {
        for row in rows {
            let label = resolve_week_label_from_row(row, &request.year_weeks, week_idx, date_idx);
            if !label.is_empty() {
                week_labels.insert(label);
            }
        }
    };

    collect_week_labels(&request.rows);
    if let Some(persisted_rows) = request.persisted_rows.as_ref() {
        collect_week_labels(persisted_rows);
    }

    for row in &request.rows {
        let week_label = resolve_week_label_from_row(row, &request.year_weeks, week_idx, date_idx);
        let cashflow_label = get_cell(&row.cells, cashflow_idx);
        let Some(line_id) = parse_cashflow_line_label(&cashflow_label) else {
            continue;
        };
        if week_label.is_empty() {
            continue;
        }
        let resolved = resolve_cashflow_actual_line_amounts(
            row,
            bank_amount_idx,
            expense_amount_idx,
            vat_in_idx,
            deposit_idx,
            refund_idx,
        );
        let amount = resolve_actual_amount(
            row,
            line_id,
            bank_amount_idx,
            expense_amount_idx,
            vat_in_idx,
            deposit_idx,
            refund_idx,
        );
        if resolved.is_empty() && amount == 0.0 {
            continue;
        }
        let bucket = by_week.entry(week_label).or_default();
        for (resolved_line_id, resolved_amount) in resolved {
            if resolved_amount == 0.0 {
                continue;
            }
            *bucket.entry(resolved_line_id).or_insert(0.0) += resolved_amount;
        }
    }

    let mut zero_amounts = BTreeMap::new();
    for line_id in cashflow_all_line_ids() {
        zero_amounts.insert(line_id.to_string(), 0.0);
    }

    let mut weeks = week_labels
        .into_iter()
        .filter_map(|label| resolve_week_from_label(&label, &request.year_weeks))
        .collect::<Vec<KernelYearWeek>>();
    weeks.sort_by(|left, right| {
        left.year_month
            .cmp(&right.year_month)
            .then(left.week_no.cmp(&right.week_no))
    });

    KernelActualSyncResponse {
        weeks: weeks
            .into_iter()
            .map(|week| KernelActualSyncWeekPayload {
                year_month: week.year_month,
                week_no: week.week_no,
                amounts: {
                    let mut amounts = zero_amounts.clone();
                    if let Some(found) = by_week.get(&week.label) {
                        for (line_id, amount) in found {
                            amounts.insert(line_id.clone(), *amount);
                        }
                    }
                    amounts
                },
            })
            .collect(),
    }
}

pub fn aggregate_budget_actuals(request: KernelBudgetActualsRequest) -> KernelBudgetActualsResponse {
    let budget_code_idx = Some(5usize);
    let sub_code_idx = Some(6usize);
    let cashflow_idx = Some(8usize);
    let bank_amount_idx = Some(10usize);
    let deposit_idx = Some(11usize);
    let refund_idx = Some(12usize);
    let expense_amount_idx = Some(13usize);
    let vat_in_idx = Some(14usize);

    let mut totals: BTreeMap<String, KernelBudgetActualItem> = BTreeMap::new();

    for row in &request.rows {
        let budget_code = get_cell(&row.cells, budget_code_idx).trim().to_string();
        let sub_code = get_cell(&row.cells, sub_code_idx).trim().to_string();
        if budget_code.is_empty() && sub_code.is_empty() {
            continue;
        }
        let amount = resolve_budget_actual_amount(
            row,
            cashflow_idx,
            bank_amount_idx,
            expense_amount_idx,
            vat_in_idx,
            deposit_idx,
            refund_idx,
        );
        if amount == 0.0 {
            continue;
        }
        let budget_key = format!("{budget_code}|{sub_code}");
        let entry = totals.entry(budget_key.clone()).or_insert(KernelBudgetActualItem {
            budget_key: budget_key.clone(),
            budget_code: budget_code.clone(),
            sub_code: sub_code.clone(),
            amount: 0.0,
        });
        entry.amount += amount;
    }

    let items = totals.into_values().collect::<Vec<KernelBudgetActualItem>>();
    let total = items.iter().map(|item| item.amount).sum::<f64>();
    KernelBudgetActualsResponse { items, total }
}

pub fn derive_settlement_rows(request: KernelRequest) -> KernelResponse {
    let mut rows = request.rows;
    if rows.is_empty() {
        return KernelResponse { rows };
    }

    let respect_explicit_balance_anchors = request
        .options
        .respect_explicit_balance_anchors
        .unwrap_or(true);

    match request.options.mode.as_str() {
        "full" => {
            let mut running = 0.0;
            for row_idx in 0..rows.len() {
                let (next_row, next_running) = derive_row_locally(
                    &rows[row_idx],
                    row_idx,
                    &request.context,
                    true,
                    running,
                    respect_explicit_balance_anchors,
                );
                rows[row_idx] = next_row;
                running = next_running;
            }
        }
        "row" => {
            let target_row_idx = request
                .options
                .row_idx
                .unwrap_or(0)
                .min(rows.len().saturating_sub(1));
            let (next_row, _) = derive_row_locally(
                &rows[target_row_idx],
                target_row_idx,
                &request.context,
                false,
                0.0,
                respect_explicit_balance_anchors,
            );
            rows[target_row_idx] = next_row;
        }
        _ => {
            let target_row_idx = request
                .options
                .row_idx
                .unwrap_or(0)
                .min(rows.len().saturating_sub(1));
            let mut running = compute_running_seed(
                &rows,
                target_row_idx,
                &request.context,
                respect_explicit_balance_anchors,
            );
            for row_idx in target_row_idx..rows.len() {
                let (next_row, next_running) = derive_row_locally(
                    &rows[row_idx],
                    row_idx,
                    &request.context,
                    true,
                    running,
                    respect_explicit_balance_anchors,
                );
                rows[row_idx] = next_row;
                running = next_running;
            }
        }
    }

    KernelResponse { rows }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_cells() -> Vec<String> {
        (0..26).map(|_| String::new()).collect()
    }

    fn base_context() -> KernelDerivationContext {
        KernelDerivationContext {
            project_id: "p1".to_string(),
            default_ledger_id: "l1".to_string(),
            policy: None,
            basis: None,
            date_idx: 2,
            week_idx: 3,
            deposit_idx: 11,
            refund_idx: 12,
            expense_idx: 13,
            vat_in_idx: 14,
            bank_amount_idx: 10,
            balance_idx: 9,
            evidence_idx: 17,
            evidence_completed_idx: 18,
            evidence_pending_idx: 19,
        }
    }

    #[test]
    fn derives_supply_amount_candidate_and_marks_review() {
        let mut cells = create_cells();
        cells[10] = "110,000".to_string();
        let response = derive_settlement_rows(KernelRequest {
            rows: vec![KernelImportRow {
                temp_id: "row-1".to_string(),
                source_tx_id: Some("bank:row-1".to_string()),
                entry_kind: None,
                cells,
                error: None,
                review_hints: None,
                review_required_cell_indexes: None,
                review_status: None,
                review_fingerprint: None,
                review_confirmed_at: None,
                user_edited_cells: None,
            }],
            context: KernelDerivationContext {
                basis: Some("공급가액".to_string()),
                ..base_context()
            },
            options: KernelDerivationOptions {
                mode: "cascade".to_string(),
                row_idx: Some(0),
                respect_explicit_balance_anchors: Some(true),
            },
        });

        let row = &response.rows[0];
        assert_eq!(row.cells[13], "100,000");
        assert_eq!(row.cells[14], "10,000");
        assert_eq!(
            row.review_hints.clone().unwrap_or_default(),
            vec!["매입부가세 후보값입니다. 증빙 기준 금액으로 다시 확인해 주세요.".to_string()]
        );
        assert_eq!(row.review_status.as_deref(), Some("pending"));
    }

    #[test]
    fn keeps_cleared_expense_empty_when_user_edited() {
        let mut cells = create_cells();
        cells[10] = "110,000".to_string();
        let response = derive_settlement_rows(KernelRequest {
            rows: vec![KernelImportRow {
                temp_id: "manual-clear-row".to_string(),
                source_tx_id: None,
                entry_kind: None,
                cells,
                error: None,
                review_hints: None,
                review_required_cell_indexes: None,
                review_status: None,
                review_fingerprint: None,
                review_confirmed_at: None,
                user_edited_cells: Some(vec![13]),
            }],
            context: base_context(),
            options: KernelDerivationOptions {
                mode: "cascade".to_string(),
                row_idx: Some(0),
                respect_explicit_balance_anchors: Some(true),
            },
        });

        let row = &response.rows[0];
        assert_eq!(row.cells[13], "");
        assert_eq!(row.cells[10], "110,000");
    }

    #[test]
    fn keeps_bank_imported_outflow_split_cells_empty_until_human_input() {
        let mut cells = create_cells();
        cells[9] = "890,000".to_string();
        cells[10] = "110,000".to_string();
        let response = derive_settlement_rows(KernelRequest {
            rows: vec![KernelImportRow {
                temp_id: "bank-import-expense-row".to_string(),
                source_tx_id: Some("bank:expense-import-1".to_string()),
                entry_kind: Some("EXPENSE".to_string()),
                cells,
                error: None,
                review_hints: None,
                review_required_cell_indexes: None,
                review_status: None,
                review_fingerprint: None,
                review_confirmed_at: None,
                user_edited_cells: None,
            }],
            context: KernelDerivationContext {
                basis: Some("공급가액".to_string()),
                ..base_context()
            },
            options: KernelDerivationOptions {
                mode: "cascade".to_string(),
                row_idx: Some(0),
                respect_explicit_balance_anchors: Some(true),
            },
        });

        let row = &response.rows[0];
        assert_eq!(row.cells[13], "");
        assert_eq!(row.cells[14], "");
        assert!(row.review_hints.is_none());
    }

    #[test]
    fn builds_actual_sync_payloads_from_rows() {
        let mut out_cells = create_cells();
        out_cells[2] = "2026-03-03".to_string();
        out_cells[3] = "26-03-01".to_string();
        out_cells[8] = "직접사업비".to_string();
        out_cells[13] = "30,000".to_string();

        let mut in_cells = create_cells();
        in_cells[2] = "2026-03-04".to_string();
        in_cells[3] = "26-03-01".to_string();
        in_cells[8] = "매출액(입금)".to_string();
        in_cells[10] = "250,000".to_string();

        let response = build_settlement_actual_sync_payload(KernelActualSyncRequest {
            rows: vec![
                KernelImportRow {
                    temp_id: "out-row".to_string(),
                    source_tx_id: None,
                    entry_kind: None,
                    cells: out_cells,
                    error: None,
                    review_hints: None,
                    review_required_cell_indexes: None,
                    review_status: None,
                    review_fingerprint: None,
                    review_confirmed_at: None,
                    user_edited_cells: None,
                },
                KernelImportRow {
                    temp_id: "in-row".to_string(),
                    source_tx_id: None,
                    entry_kind: None,
                    cells: in_cells,
                    error: None,
                    review_hints: None,
                    review_required_cell_indexes: None,
                    review_status: None,
                    review_fingerprint: None,
                    review_confirmed_at: None,
                    user_edited_cells: None,
                },
            ],
            year_weeks: vec![KernelYearWeek {
                year_month: "2026-03".to_string(),
                week_no: 1,
                week_start: "2026-03-02".to_string(),
                week_end: "2026-03-08".to_string(),
                label: "26-03-01".to_string(),
            }],
            persisted_rows: None,
        });

        assert_eq!(response.weeks.len(), 1);
        assert_eq!(response.weeks[0].amounts.get("DIRECT_COST_OUT").copied(), Some(30000.0));
        assert_eq!(response.weeks[0].amounts.get("SALES_IN").copied(), Some(250000.0));
    }

    #[test]
    fn aggregates_budget_actuals_from_rows() {
        let mut direct_cells = create_cells();
        direct_cells[5] = "회의비".to_string();
        direct_cells[6] = "다과비".to_string();
        direct_cells[8] = "직접사업비".to_string();
        direct_cells[13] = "30,000".to_string();

        let mut vat_cells = create_cells();
        vat_cells[5] = "부가세".to_string();
        vat_cells[6] = "매입부가세".to_string();
        vat_cells[8] = "매입부가세".to_string();
        vat_cells[14] = "3,000".to_string();

        let response = aggregate_budget_actuals(KernelBudgetActualsRequest {
            rows: vec![
                KernelImportRow {
                    temp_id: "direct".to_string(),
                    source_tx_id: None,
                    entry_kind: None,
                    cells: direct_cells,
                    error: None,
                    review_hints: None,
                    review_required_cell_indexes: None,
                    review_status: None,
                    review_fingerprint: None,
                    review_confirmed_at: None,
                    user_edited_cells: None,
                },
                KernelImportRow {
                    temp_id: "vat".to_string(),
                    source_tx_id: None,
                    entry_kind: None,
                    cells: vat_cells,
                    error: None,
                    review_hints: None,
                    review_required_cell_indexes: None,
                    review_status: None,
                    review_fingerprint: None,
                    review_confirmed_at: None,
                    user_edited_cells: None,
                },
            ],
        });

        assert_eq!(response.total, 33000.0);
        assert_eq!(response.items.len(), 2);
        assert!(response.items.iter().any(|item| item.budget_key == "회의비|다과비" && item.amount == 30000.0));
        assert!(response.items.iter().any(|item| item.budget_key == "부가세|매입부가세" && item.amount == 3000.0));
    }
}
