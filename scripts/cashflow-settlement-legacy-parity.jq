del(
  .settlementCycle,
  .monthCloseCalendar[]?.approverDeadlineAt,
  (.settlementStatuses.items[]? | select(.period == "MONTH") | .approverDeadlineAt)
)
