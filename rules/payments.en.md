## Payments and money
- Keep amounts as integers in the currency's minor unit (cents, won), with the currency code. Never calculate or store them as float. {{judge}}
- Follow the rounding rule and fee calculation set in the code; ask before changing them. {{judge}}
- Payment and refund endpoints use an idempotency key so the same request gets the same result — a retry never charges twice. {{judge}}
- Verify webhook signatures and dedupe by event id so each event is processed once. {{judge}}
- Never edit or delete ledger or payment records; add a reversing entry instead. {{judge}}
- Never put full card or account numbers or CVCs in logs, error messages or test data. {{judge}}
